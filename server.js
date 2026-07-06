const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const {
  caproverLogin,
  caproverEnsureApp,
  caproverSetContainerHttpPort,
  caproverSetEnvVars,
  caproverGetEnvVars,
  caproverSetGitHubDeployment,
  caproverSetCustomDomains,
  caproverListApps,
  caproverDeleteApp,
  caproverForceBuild,
  caproverGetAppData,
  caproverGetImageCount,
  caproverDeleteOldImages,
  caproverGetAppLogs,
  caproverRestartApp,
  caproverGetSystemInfo,
  caproverGetNodes,
  caproverGetVersionInfo,
  caproverGetLoadBalancerInfo,
  caproverGetAppsAndRoot,
} = require('./caproverClient');

// Load .env file only in local development (not in CapRover)
// CapRover provides environment variables directly
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config();
  } catch (e) {
    // dotenv not available or .env file doesn't exist - that's fine
  }
}

const app = express();
const PORT = process.env.PORT || 3800;

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ═══════════════════════════════════════════════════════`);
  console.log(`[${timestamp}] 📥 INCOMING REQUEST`);
  console.log(`[${timestamp}] Method: ${req.method}`);
  console.log(`[${timestamp}] URL: ${req.url}`);
  console.log(`[${timestamp}] IP: ${req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown'}`);
  console.log(`[${timestamp}] Host: ${req.headers.host || 'not set'}`);
  console.log(`[${timestamp}] X-Forwarded-For: ${req.headers['x-forwarded-for'] || 'not set'}`);
  console.log(`[${timestamp}] X-Real-IP: ${req.headers['x-real-ip'] || 'not set'}`);
  console.log(`[${timestamp}] User-Agent: ${req.headers['user-agent'] || 'not set'}`);
  console.log(`[${timestamp}] ═══════════════════════════════════════════════════════`);
  next();
});

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Trust the CapRover/nginx reverse proxy so secure cookies are set correctly over HTTPS
app.set('trust proxy', 1);

// Session configuration
// Persist sessions in MongoDB so they survive server restarts/redeploys (the default
// in-memory store loses every session on redeploy, which forced constant re-logins).
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const sessionConfig = {
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  rolling: true, // refresh the 30-day window on activity
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: THIRTY_DAYS_MS
  }
};
if (process.env.MONGO_URI) {
  sessionConfig.store = MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    dbName: 'WebsiteCreator',
    collectionName: 'sessions',
    ttl: THIRTY_DAYS_MS / 1000
  });
} else {
  console.warn(`[${new Date().toISOString()}] ⚠️  Sessions using in-memory store (no MONGO_URI) — logins won't survive restarts`);
}
app.use(session(sessionConfig));

app.use(express.static('public'));

// Log static file serving
app.use(express.static('public', {
  setHeaders: (res, path) => {
    console.log(`[${new Date().toISOString()}] Serving static file: ${path}`);
  }
}));

// Configuration from environment variables (set in CapRover App Configs)
// These are read directly from CapRover's environment variables
// For local development, you can use a .env file (dotenv will load it automatically)
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const CAPROVER_URL = process.env.CAPROVER_URL; // e.g., https://captain.yourdomain.com
const CAPROVER_PASSWORD = process.env.CAPROVER_PASSWORD;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
const MONGO_URI = process.env.MONGO_URI;

// MongoDB connection
if (MONGO_URI) {
  mongoose.connect(MONGO_URI, {
    dbName: 'WebsiteCreator'
  }).then(() => {
    console.log(`[${new Date().toISOString()}] ✅ Connected to MongoDB - Database: WebsiteCreator`);
  }).catch((error) => {
    console.error(`[${new Date().toISOString()}] ❌ MongoDB connection error:`, error.message);
  });
} else {
  console.warn(`[${new Date().toISOString()}] ⚠️  MONGO_URI not set - MongoDB features will be disabled`);
}

// Admin schema
const adminSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true
  },
  password: {
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Admin = mongoose.model('adminLogin', adminSchema, 'adminLogin');

// Pinned service schema - stores the CapRover apps the user pins for post-reboot force builds
const pinnedServiceSchema = new mongoose.Schema({
  appName: {
    type: String,
    required: true,
    unique: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const PinnedService = mongoose.model('pinnedService', pinnedServiceSchema, 'pinnedServices');

// ─── Diagnostics: persisted logs + crash/restart journal ─────────────────────
// Capped collection = rolling log history that auto-evicts oldest, so logs
// survive container crashes/restarts (unlike CapRover's ephemeral live buffer).
const appLogChunkSchema = new mongoose.Schema({
  appName: { type: String, index: true },
  ts: { type: Date, default: Date.now },
  text: String,
  hasError: { type: Boolean, default: false }
}, { capped: { size: 1024 * 1024 * 50, max: 200000 } }); // ~50MB rolling window
appLogChunkSchema.index({ appName: 1, ts: 1 });
const AppLogChunk = mongoose.model('appLogChunk', appLogChunkSchema, 'appLogChunks');

const crashEventSchema = new mongoose.Schema({
  appName: { type: String, index: true },
  ts: { type: Date, default: Date.now },
  type: { type: String },       // 'restart' | 'error-burst'
  note: String,
  logSnapshot: String
});
crashEventSchema.index({ ts: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 }); // keep 30 days
const CrashEvent = mongoose.model('crashEvent', crashEventSchema, 'crashEvents');

// Collector configuration + heuristics
const DIAG_POLL_MS = Math.max(parseInt(process.env.DIAG_POLL_INTERVAL_MS || '30000', 10), 10000);
const DIAG_STARTUP_MARKER = /(listening on|server (is )?running|app listening|ready on|server started|discord client ready|bot ready|nodemon|connected to mongo)/i;
const DIAG_ERROR_MARKER = /(error|exception|unhandled|fatal|ECONNREFUSED|EADDRINUSE|out of memory|heap out|FATAL|killed|segfault|panic)/i;
// In-memory anchor of the last log line we stored per app (to append only new lines)
const diagLastLineByApp = new Map();

async function collectDiagnosticsOnce() {
  if (!MONGO_URI || !CAPROVER_URL || !CAPROVER_PASSWORD) return;
  const baseUrl = CAPROVER_URL.replace(/\/+$/, '');

  let token;
  try {
    token = await caproverLogin(baseUrl, CAPROVER_PASSWORD);
  } catch (e) {
    return; // CapRover unreachable this cycle; try again next tick
  }

  let apps;
  try {
    apps = await caproverListApps(baseUrl, token);
  } catch (e) {
    return;
  }

  for (const app of apps) {
    const appName = app.appName;
    try {
      const logs = await caproverGetAppLogs(baseUrl, token, appName);
      if (!logs) continue;
      const lines = logs.split('\n').filter(l => l.length > 0);
      if (!lines.length) continue;

      const anchor = diagLastLineByApp.get(appName);
      let newLines;
      let bufferReset = false;

      if (anchor == null) {
        // First capture since collector (re)start: keep only a recent tail to avoid a dump
        newLines = lines.slice(-Math.min(lines.length, 150));
      } else {
        const idx = lines.lastIndexOf(anchor);
        if (idx >= 0) {
          newLines = lines.slice(idx + 1);
        } else {
          // Our last-known line is gone: either heavy logging scrolled it out, or the
          // container restarted (fresh log buffer). Treat a startup marker as a restart.
          newLines = lines;
          bufferReset = true;
        }
      }

      diagLastLineByApp.set(appName, lines[lines.length - 1]);
      if (!newLines.length) continue;

      const joined = newLines.join('\n');
      const hasError = DIAG_ERROR_MARKER.test(joined);
      await AppLogChunk.create({ appName, text: joined, hasError });

      // Restart detection: a startup-marker line appears in the new output
      const startLine = newLines.find(l => DIAG_STARTUP_MARKER.test(l));
      if (startLine && (bufferReset || anchor != null)) {
        await CrashEvent.create({
          appName,
          type: 'restart',
          note: `(Re)start detected: ${startLine.slice(0, 160)}`,
          logSnapshot: newLines.slice(0, 40).join('\n')
        });
      } else if (hasError) {
        // Only log one error-burst event per cycle per app to avoid noise
        await CrashEvent.create({
          appName,
          type: 'error-burst',
          note: (newLines.find(l => DIAG_ERROR_MARKER.test(l)) || 'error in logs').slice(0, 160),
          logSnapshot: newLines.filter(l => DIAG_ERROR_MARKER.test(l)).slice(0, 20).join('\n')
        });
      }
    } catch (e) {
      // Per-app failure (e.g. app has no running container yet) — ignore this cycle
    }
  }
}

function startDiagnosticsCollector() {
  if (!MONGO_URI) {
    console.warn(`[${new Date().toISOString()}] ⚠️  Diagnostics collector disabled (no MONGO_URI)`);
    return;
  }
  if (!CAPROVER_URL || !CAPROVER_PASSWORD) {
    console.warn(`[${new Date().toISOString()}] ⚠️  Diagnostics collector disabled (no CapRover credentials)`);
    return;
  }
  console.log(`[${new Date().toISOString()}] 🩺 Diagnostics collector started (every ${DIAG_POLL_MS}ms)`);
  setTimeout(() => { collectDiagnosticsOnce().catch(() => {}); }, 8000);
  setInterval(() => { collectDiagnosticsOnce().catch(() => {}); }, DIAG_POLL_MS);
}

// Authentication middleware
function requireAuth(req, res, next) {
  if (req.session && req.session.isAuthenticated) {
    return next();
  } else {
    return res.status(401).json({ error: 'Authentication required' });
  }
}

// GitHub API helper
const githubAPI = axios.create({
  baseURL: 'https://api.github.com',
  headers: {
    'Authorization': `Bearer ${GITHUB_TOKEN}`, // Use Bearer for better compatibility
    'Accept': 'application/vnd.github.v3+json'
  }
});

// CapRover API helper
const caproverAPI = axios.create({
  baseURL: `${CAPROVER_URL.replace(/\/$/, '')}/api/v2`, // Remove trailing slash if present
  headers: {
    'x-namespace': 'captain',
    'content-type': 'application/json;charset=UTF-8'
  }
});

// Get CapRover auth token
async function getCapRoverAuthToken() {
  try {
    const caproverUrl = CAPROVER_URL.replace(/\/$/, ''); // Remove trailing slash
    console.log(`[${new Date().toISOString()}] Attempting to authenticate with CapRover at: ${caproverUrl}/api/v2/login`);
    
    const response = await caproverAPI.post('/login', {
      password: CAPROVER_PASSWORD
    });
    
    // Check if we got HTML instead of JSON (wrong URL or redirect)
    const responseText = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
    if (responseText.trim().startsWith('<')) {
      throw new Error(`CapRover login did NOT return JSON. Got HTML instead. Check CAPROVER_URL. First 200 chars:\n${responseText.slice(0, 200)}`);
    }
    
    // CapRover returns token at response.data.data.token (nested structure)
    // Response structure: { status: 100, description: "OK", data: { token: "..." } }
    const token = response.data?.data?.token || response.data?.token;
    
    console.log(`[${new Date().toISOString()}] ✅ CapRover authentication successful. Token length: ${token ? token.length : 0}, Token preview: ${token ? token.substring(0, 20) + '...' : 'null'}`);
    console.log(`[${new Date().toISOString()}] Full response structure:`, JSON.stringify({
      hasData: !!response.data,
      hasDataData: !!response.data?.data,
      hasToken: !!token,
      responseKeys: response.data ? Object.keys(response.data) : []
    }));
    
    if (!token) {
      throw new Error(`CapRover authentication succeeded but no token was returned. Full response:\n${JSON.stringify(response.data, null, 2)}`);
    }
    
    return token;
  } catch (error) {
    const errorMsg = error.response 
      ? `CapRover API returned ${error.response.status}: ${error.response.statusText}. URL: ${error.config?.url || 'unknown'}. Response: ${JSON.stringify(error.response.data)}`
      : error.message;
    console.error(`[${new Date().toISOString()}] CapRover authentication error:`, errorMsg);
    throw new Error(`Failed to authenticate with CapRover: ${errorMsg}`);
  }
}

// Get all apps to find used ports
async function getUsedPorts(authToken) {
  try {
    const response = await caproverAPI.get('/user/apps/appDefinitions', {
      headers: {
        'x-captain-auth': authToken,
        'content-type': 'application/json;charset=UTF-8'
      }
    });
    
    const apps = response.data.data.appDefinitions || [];
    const usedPorts = new Set();
    
    apps.forEach(app => {
      // Check container HTTP port for all apps
      const port = app.containerHttpPort;
      if (port && port > 0) {
        usedPorts.add(port);
      }
    });
    
    return usedPorts;
  } catch (error) {
    console.error('Error fetching used ports:', error.message);
    return new Set();
  }
}

// Find a random available port
function findNextAvailablePort(usedPorts, startPort = 3000) {
  const minPort = startPort;
  const maxPort = 65535;
  const maxAttempts = 1000; // Prevent infinite loops
  
  // Try random ports first
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const randomPort = Math.floor(Math.random() * (maxPort - minPort + 1)) + minPort;
    if (!usedPorts.has(randomPort)) {
      return randomPort;
    }
  }
  
  // Fallback to sequential if random fails (unlikely)
  let port = minPort;
  while (usedPorts.has(port) && port <= maxPort) {
    port++;
  }
  
  if (port > maxPort) {
    throw new Error('No available ports found in range 3000-65535');
  }
  
  return port;
}

// List GitHub repositories
async function listGitHubRepos() {
  try {
    if (!GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN environment variable is not set');
    }
    
    const response = await githubAPI.get('/user/repos', {
      params: {
        sort: 'updated',
        direction: 'desc',
        per_page: 100
      }
    });
    
    return response.data.map(repo => ({
      name: repo.name,
      html_url: repo.html_url,
      private: repo.private,
      updated_at: repo.updated_at
    }));
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ GitHub API error listing repos:`, error.message);
    throw new Error(`Failed to list GitHub repos: ${error.message}`);
  }
}

// Delete GitHub repository
async function deleteGitHubRepo(repoName) {
  try {
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
      throw new Error('GITHUB_TOKEN and GITHUB_USERNAME environment variables are required');
    }
    
    console.log(`[${new Date().toISOString()}] Deleting GitHub repository: ${repoName}`);
    
    const response = await githubAPI.delete(`/repos/${GITHUB_USERNAME}/${repoName}`);
    
    console.log(`[${new Date().toISOString()}] ✅ GitHub repository deleted successfully: ${repoName}`);
    return { success: true };
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ GitHub API error deleting repo:`, {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message
    });
    
    if (error.response?.status === 404) {
      throw new Error(`Repository "${repoName}" not found`);
    }
    
    // Check for permission-related errors
    const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
    if (error.response?.status === 403 || errorMessage.toLowerCase().includes('admin') || errorMessage.toLowerCase().includes('permission')) {
      throw new Error(`Permission denied: Your GitHub token needs the 'delete_repo' scope. Please create a new token at https://github.com/settings/tokens with 'delete_repo' permission and update GITHUB_TOKEN.`);
    }
    
    if (error.response?.status === 401) {
      throw new Error(`Authentication failed: Please check that your GITHUB_TOKEN is valid and not expired.`);
    }
    
    throw new Error(`Failed to delete GitHub repo: ${errorMessage}`);
  }
}

// Push default starter files to GitHub repository
async function pushDefaultFilesToGitHub(repoOwner, repoName, branch = 'main', containerPort = 3000, templateType = 'website') {
  try {
    console.log(`[${new Date().toISOString()}] Pushing default files to GitHub repo: ${repoOwner}/${repoName} template=${templateType} port=${containerPort}`);
    console.log(`[${new Date().toISOString()}] ⚠️ IMPORTANT: Files will use PORT=${containerPort} (this must match CapRover Container HTTP Port)`);

    const websiteFiles = {
      'server.js': `const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || ${containerPort};

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve specific pages
app.get('/event-preview', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'event-preview.html'));
});

app.get('/obs-dock', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'obs-dock.html'));
});

// Serve index.html for all other routes (SPA support)
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(\`Server running on port \${PORT}\`);
  console.log(\`Listening on: 0.0.0.0:\${PORT}\`);
});
`,
      'package.json': `{
  "name": "${repoName}",
  "version": "1.0.0",
  "description": "Auto-generated website",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2"
  },
  "engines": {
    "node": ">=18"
  }
}
`,
      'Dockerfile': `FROM node:18-alpine

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies (using npm install since we don't have package-lock.json yet)
RUN npm install --omit=dev && npm cache clean --force

# Copy application files
COPY . .

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \\
    adduser -S nodejs -u 1001 && \\
    chown -R nodejs:nodejs /usr/src/app

USER nodejs

# Expose port
EXPOSE ${containerPort}

# Start the application
CMD ["npm", "start"]
`,
      'captain-definition': `{
  "schemaVersion": 2,
  "dockerfilePath": "./Dockerfile"
}
`,
      'public/index.html': `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Welcome</title>
    <link rel="stylesheet" href="/styles.css">
</head>
<body>
    <div class="container">
        <div class="welcome-card">
            <h1>🚀 Welcome!</h1>
            <p>Your website is up and running.</p>
            <p>Start editing <code>public/index.html</code> to customize this page.</p>
            
            <!-- Reset Countdown Timer -->
            <div id="resetCountdown" class="countdown-container">
                <div class="countdown-label">Next Reset:</div>
                <div id="countdownDisplay" class="countdown-display">00:00:00:00</div>
            </div>
        </div>
    </div>
    <script src="/countdown.js"></script>
</body>
</html>
`,
      'public/event-preview.html': `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Event Preview</title>
    <link rel="stylesheet" href="/styles.css">
    <style>
        body {
            background: #000;
            color: #fff;
            font-family: 'Arial', sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
        }
        .event-preview {
            text-align: center;
            padding: 40px;
        }
        .event-title {
            font-size: 3rem;
            margin-bottom: 30px;
            text-shadow: 0 0 20px rgba(255, 255, 255, 0.5);
        }
        .countdown-display {
            font-size: 4rem;
            font-weight: bold;
            font-family: 'Courier New', monospace;
            color: #00ff00;
            text-shadow: 0 0 10px rgba(0, 255, 0, 0.8);
            margin: 20px 0;
        }
        .countdown-label {
            font-size: 1.5rem;
            color: #aaa;
            margin-bottom: 10px;
        }
    </style>
</head>
<body>
    <div class="event-preview">
        <h1 class="event-title">Next Reset</h1>
        <div class="countdown-label">Time Remaining:</div>
        <div id="countdownDisplay" class="countdown-display">00:00:00:00</div>
    </div>
    <script src="/countdown.js"></script>
</body>
</html>
`,
      'public/obs-dock.html': `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>OBS Dock - Reset Countdown</title>
    <link rel="stylesheet" href="/styles.css">
    <style>
        body {
            background: transparent;
            color: #fff;
            font-family: 'Arial', sans-serif;
            margin: 0;
            padding: 20px;
            overflow: hidden;
        }
        .obs-dock {
            text-align: center;
        }
        .countdown-label {
            font-size: 1rem;
            color: #aaa;
            margin-bottom: 8px;
        }
        .countdown-display {
            font-size: 2rem;
            font-weight: bold;
            font-family: 'Courier New', monospace;
            color: #00ff00;
            text-shadow: 0 0 5px rgba(0, 255, 0, 0.8);
        }
    </style>
</head>
<body>
    <div class="obs-dock">
        <div class="countdown-label">Next Reset:</div>
        <div id="countdownDisplay" class="countdown-display">00:00:00:00</div>
    </div>
    <script src="/countdown.js"></script>
</body>
</html>
`,
      'public/countdown.js': `// Reset Countdown Timer
// Configure reset time (daily reset at midnight UTC, adjust as needed)
function getNextResetTime() {
    const now = new Date();
    const resetTime = new Date();
    
    // Set reset time (default: daily at midnight UTC)
    // Change this to your desired reset schedule
    resetTime.setUTCHours(0, 0, 0, 0);
    
    // If reset time has passed today, set for tomorrow
    if (resetTime <= now) {
        resetTime.setUTCDate(resetTime.getUTCDate() + 1);
    }
    
    return resetTime;
}

function updateCountdown() {
    const now = new Date();
    const resetTime = getNextResetTime();
    const diff = resetTime - now;
    
    if (diff <= 0) {
        // Reset time has passed, get next reset
        const nextReset = getNextResetTime();
        updateDisplay(nextReset - now);
        return;
    }
    
    updateDisplay(diff);
}

function updateDisplay(milliseconds) {
    const totalSeconds = Math.floor(milliseconds / 1000);
    const days = Math.floor(totalSeconds / 86400);
    const hours = Math.floor((totalSeconds % 86400) / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    const display = \`\${String(days).padStart(2, '0')}:\${String(hours).padStart(2, '0')}:\${String(minutes).padStart(2, '0')}:\${String(seconds).padStart(2, '0')}\`;
    
    const countdownElement = document.getElementById('countdownDisplay');
    if (countdownElement) {
        countdownElement.textContent = display;
    }
}

// Update countdown every second
setInterval(updateCountdown, 1000);
updateCountdown(); // Initial update
`,
      'public/styles.css': `* {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
}

body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
    background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
}

.container {
    width: 100%;
    max-width: 600px;
}

.welcome-card {
    background: white;
    border-radius: 16px;
    padding: 40px;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
    text-align: center;
}

h1 {
    color: #333;
    margin-bottom: 20px;
    font-size: 2.5rem;
}

p {
    color: #666;
    margin-bottom: 15px;
    font-size: 1.1rem;
    line-height: 1.6;
}

code {
    background: #f4f4f4;
    padding: 4px 8px;
    border-radius: 4px;
    font-family: 'Courier New', monospace;
    color: #e83e8c;
}

/* Countdown Timer Styles */
.countdown-container {
    margin-top: 30px;
    padding: 20px;
    background: rgba(0, 0, 0, 0.05);
    border-radius: 12px;
}

.countdown-label {
    font-size: 1rem;
    color: #666;
    margin-bottom: 10px;
    font-weight: 600;
}

.countdown-display {
    font-size: 2rem;
    font-weight: bold;
    font-family: 'Courier New', monospace;
    color: #667eea;
    letter-spacing: 2px;
}
`,
      '.gitignore': `node_modules/
.env
.DS_Store
*.log
`
    };

    const discordBotFiles = {
      'server.js': `const express = require('express');
const { Client, GatewayIntentBits } = require('discord.js');

const app = express();
const PORT = process.env.PORT || ${containerPort};

// Discord env vars (set these in CapRover → App Configs → Environment Variables)
const DISCORD_APPLICATION_ID = process.env.DISCORD_APPLICATION_ID || '';
const DISCORD_SECRET = process.env.DISCORD_SECRET || '';
const DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || '';
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID || '';
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || '';
const DISCORD_PREFIX = process.env.DISCORD_PREFIX || '!';
const DISCORD_PREFIX_ENABLED = (process.env.DISCORD_PREFIX_ENABLED ?? 'true').toString().toLowerCase() === 'true';

// Optional additional env vars (you can ignore until you need them)
const mongoDB_URI = process.env.mongoDB_URI || '';
const mongoDB_DB = process.env.mongoDB_DB || '';
const mongoDB_User = process.env.mongoDB_User || '';
const mongoDB_Password = process.env.mongoDB_Password || '';
const admin_role_ID = process.env.admin_role_ID || '';
const mod_role_ID = process.env.mod_role_ID || '';
const member_role_ID = process.env.member_role_ID || '';
const mongodb_atlas_email = process.env.mongodb_atlas_email || '';
const mongodb_atlas_password = process.env.mongodb_atlas_password || '';

// Health check endpoint (CapRover-friendly)
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    discord: {
      hasToken: !!DISCORD_BOT_TOKEN,
      hasApplicationId: !!DISCORD_APPLICATION_ID,
      hasSecret: !!DISCORD_SECRET,
      hasPublicKey: !!DISCORD_PUBLIC_KEY,
      hasGuildId: !!DISCORD_GUILD_ID,
      prefixEnabled: DISCORD_PREFIX_ENABLED,
    },
    mongo: {
      hasMongoUri: !!mongoDB_URI,
      db: mongoDB_DB ? 'set' : '',
      user: mongoDB_User ? 'set' : '',
    },
  });
});

// Simple landing page
app.get('/', (req, res) => {
  res.type('text/plain').send('Discord bot is running. Check /api/health');
});

// Discord client (prefix command example: "!ping")
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.once('ready', () => {
  console.log('✅ Discord client ready:', client.user?.tag || '(unknown user)');
});

// Timer state management
let timerState = {
  isPaused: false,
  pauseReason: null,
  pauseMessage: null
};

client.on('messageCreate', async (message) => {
  try {
    if (!DISCORD_PREFIX_ENABLED) return;
    if (!message || !message.content) return;
    if (message.author?.bot) return;
    const content = message.content.trim();
    
    // Handle ping command
    if (content === \`\${DISCORD_PREFIX}ping\`) {
      await message.reply('pong');
    }
    
    // Handle pause command: !pause [reason]
    if (content.startsWith(\`\${DISCORD_PREFIX}pause\`)) {
      const reason = content.slice(\`\${DISCORD_PREFIX}pause\`.length).trim() || 'No reason provided';
      
      if (timerState.isPaused) {
        await message.reply('Timer is already paused.');
        return;
      }
      
      timerState.isPaused = true;
      timerState.pauseReason = reason;
      
      // Send pause message and store it for deletion later
      const pauseMsg = await message.channel.send(\`⏸️ **Timer Paused**\\n**REASON:** \${reason}\`);
      timerState.pauseMessage = pauseMsg;
      
      await message.react('✅');
    }
    
    // Handle resume command: !resume
    if (content === \`\${DISCORD_PREFIX}resume\`) {
      if (!timerState.isPaused) {
        await message.reply('Timer is not paused.');
        return;
      }
      
      // Reset timer state first
      timerState.isPaused = false;
      const pauseReason = timerState.pauseReason;
      timerState.pauseReason = null;
      
      // Handle the pause message - edit it to show resumed status for browser sources
      if (timerState.pauseMessage) {
        try {
          // Edit the message to show it's been resumed (better for browser sources)
          await timerState.pauseMessage.edit('▶️ **Timer Resumed**\\n~~Timer was paused~~');
          
          // Then try to delete it after a short delay
          setTimeout(async () => {
            try {
              await timerState.pauseMessage.delete();
            } catch (deleteErr) {
              // If deletion fails, that's okay - the edit already shows it's resumed
              // Browser sources will see the updated message content
              console.log('Pause message edited to show resumed status (deletion optional)');
            }
          }, 2000);
        } catch (editErr) {
          // If edit fails, try to delete instead
          try {
            await timerState.pauseMessage.delete();
          } catch (deleteErr) {
            // If both fail, send a new message to ensure browser sources see the update
            try {
              await message.channel.send('▶️ **Timer Resumed**');
            } catch (sendErr) {
              console.warn('Could not update pause message:', sendErr.message);
            }
          }
        }
        timerState.pauseMessage = null;
      } else {
        // If no pause message exists, send a resume message anyway
        await message.channel.send('▶️ **Timer Resumed**');
      }
      
      await message.reply('▶️ Timer resumed!');
    }
  } catch (err) {
    console.error('messageCreate handler error:', err);
  }
});

async function start() {
  // Start HTTP server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(\`HTTP server listening on 0.0.0.0:\${PORT}\`);
  });

  // Start Discord bot (keep process running even if token is missing)
  if (!DISCORD_BOT_TOKEN) {
    console.error('❌ Missing DISCORD_BOT_TOKEN. Set it in CapRover env vars, then redeploy.');
    return;
  }

  await client.login(DISCORD_BOT_TOKEN);
}

start().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exitCode = 1;
});
`,
      'package.json': `{
  "name": "${repoName}",
  "version": "1.0.0",
  "description": "Auto-generated Discord bot",
  "main": "server.js",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "discord.js": "latest",
    "express": "^4.18.2"
  },
  "engines": {
    "node": ">=18"
  }
}
`,
      'Dockerfile': `FROM node:18-alpine

WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --omit=dev && npm cache clean --force

# Copy application files
COPY . .

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \\
    adduser -S nodejs -u 1001 && \\
    chown -R nodejs:nodejs /usr/src/app

USER nodejs

# Expose port
EXPOSE ${containerPort}

# Start the application
CMD ["npm", "start"]
`,
      'captain-definition': `{
  "schemaVersion": 2,
  "dockerfilePath": "./Dockerfile"
}
`,
      'README.md': `# ${repoName}

Auto-generated Discord bot (CapRover + GitHub).

## Required environment variables (CapRover)

- \`DISCORD_BOT_TOKEN\` (required)
- \`DISCORD_APPLICATION_ID\` (recommended)
- \`DISCORD_PUBLIC_KEY\` (recommended)
- \`DISCORD_SECRET\` (optional)
- \`DISCORD_GUILD_ID\` (optional)
- \`DISCORD_PREFIX\` (optional, default \`!\`)
- \`DISCORD_PREFIX_ENABLED\` (optional, default \`true\`)
- \`PORT\` (required by CapRover; set automatically)

## Optional environment variables

- \`mongoDB_URI\`
- \`mongoDB_DB\`
- \`mongoDB_User\`
- \`mongoDB_Password\`
- \`admin_role_ID\`
- \`mod_role_ID\`
- \`member_role_ID\`
- \`mongodb_atlas_email\`
- \`mongodb_atlas_password\`

## Local run

\`\`\`bash
npm install
npm start
\`\`\`

Health check: \`/api/health\`
`,
      '.gitignore': `node_modules/
.env
.DS_Store
*.log
`
    };

    // Default files to create
    const defaultFiles = templateType === 'discord-bot' ? discordBotFiles : websiteFiles;

    // Push each file to GitHub
    for (const [filePath, content] of Object.entries(defaultFiles)) {
      const contentBase64 = Buffer.from(content).toString('base64');
      
      try {
        await githubAPI.put(`/repos/${repoOwner}/${repoName}/contents/${filePath}`, {
          message: `Add default ${filePath}`,
          content: contentBase64,
          branch: branch
        });
        console.log(`[${new Date().toISOString()}] ✅ Pushed ${filePath}`);
      } catch (error) {
        // If file already exists (409), try to update it
        if (error.response?.status === 409) {
          // Get current file SHA first
          try {
            const getResponse = await githubAPI.get(`/repos/${repoOwner}/${repoName}/contents/${filePath}`, {
              params: { ref: branch }
            });
            const sha = getResponse.data.sha;
            
            await githubAPI.put(`/repos/${repoOwner}/${repoName}/contents/${filePath}`, {
              message: `Update default ${filePath}`,
              content: contentBase64,
              branch: branch,
              sha: sha
            });
            console.log(`[${new Date().toISOString()}] ✅ Updated ${filePath}`);
          } catch (updateError) {
            console.warn(`[${new Date().toISOString()}] ⚠️ Could not update ${filePath}:`, updateError.message);
          }
        } else {
          console.warn(`[${new Date().toISOString()}] ⚠️ Could not push ${filePath}:`, error.message);
        }
      }
    }

    console.log(`[${new Date().toISOString()}] ✅ Default files pushed successfully`);
    return { success: true };
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ Error pushing default files:`, error.message);
    throw new Error(`Failed to push default files: ${error.message}`);
  }
}
async function createGitHubRepo(repoName, isPrivate = true) {
  try {
    if (!GITHUB_TOKEN) {
      throw new Error('GITHUB_TOKEN environment variable is not set');
    }
    
    console.log(`[${new Date().toISOString()}] Creating GitHub repository: ${repoName} (private: ${isPrivate})`);
    
    const response = await githubAPI.post('/user/repos', {
      name: repoName,
      private: isPrivate,
      auto_init: true,
      description: `Auto-created by Website Creator`
    });
    
    console.log(`[${new Date().toISOString()}] ✅ GitHub repository created successfully: ${response.data.html_url}`);
    
    return {
      success: true,
      repoUrl: response.data.html_url,
      cloneUrl: response.data.clone_url,
      repoName: response.data.name
    };
  } catch (error) {
    console.error(`[${new Date().toISOString()}] ❌ GitHub API error details:`, {
      status: error.response?.status,
      statusText: error.response?.statusText,
      data: error.response?.data,
      message: error.message
    });
    
    if (error.response) {
      const errorData = error.response.data;
      let errorMessage = 'Repository creation failed';
      
      // Extract detailed error message from errors array
      if (errorData?.errors && Array.isArray(errorData.errors) && errorData.errors.length > 0) {
        const firstError = errorData.errors[0];
        if (typeof firstError === 'object' && firstError.message) {
          errorMessage = firstError.message;
        } else if (typeof firstError === 'string') {
          errorMessage = firstError;
        } else if (firstError.field && firstError.code) {
          errorMessage = `${firstError.field}: ${firstError.code}`;
        }
      } else if (errorData?.message) {
        errorMessage = errorData.message;
      }
      
      throw new Error(`GitHub API error: ${errorMessage} (Status: ${error.response.status})`);
    }
    throw new Error(`Failed to create GitHub repo: ${error.message}`);
  }
}

// Create CapRover app
async function createCapRoverApp(appName, authToken) {
  try {
    console.log(`Creating CapRover app: ${appName}`);
    
    // Try register endpoint first
    try {
      console.log(`Attempting to register app using /register endpoint...`);
      const registerResponse = await caproverAPI.post('/user/apps/appDefinitions/register', {
        appName: appName,
        hasPersistentData: false
      }, {
        headers: {
          'x-captain-auth': authToken,
          'content-type': 'application/json;charset=UTF-8'
        }
      });
      
      // Check response for errors
      let registerData = registerResponse.data;
      if (typeof registerData === 'string') {
        try {
          registerData = JSON.parse(registerData);
        } catch (e) {
          // Continue to update endpoint if parse fails
        }
      }
      
      // If register succeeded (no error status), we're done
      if (registerData && typeof registerData === 'object' && registerData.status !== undefined) {
        if (registerData.status >= 1000) {
          // Register failed, try update endpoint
          console.log(`Register endpoint returned error status ${registerData.status}, trying update endpoint...`);
        } else {
          // Register succeeded
          console.log(`✅ CapRover app "${appName}" registered successfully`);
          return { success: true, appName, response: registerData };
        }
      } else if (registerResponse.status >= 200 && registerResponse.status < 300) {
        // Register succeeded (no error status in response)
        console.log(`✅ CapRover app "${appName}" registered successfully`);
        return { success: true, appName, response: registerData };
      }
    } catch (registerError) {
      // If register fails, try update endpoint
      console.log(`Register endpoint failed, trying update endpoint...`);
      if (registerError.response) {
        const errorData = registerError.response.data || {};
        if (typeof errorData === 'string') {
          try {
            const parsed = JSON.parse(errorData);
            if (parsed.status >= 1000 && parsed.status !== 1106) {
              // Not an auth error, try update endpoint
            } else if (parsed.status === 1106) {
              // Auth error, throw it to trigger retry
              const error = new Error(`CapRover API error: ${parsed.description || 'Auth token corrupted'} (Status: ${parsed.status})`);
              error.isAuthTokenError = true;
              throw error;
            }
          } catch (e) {
            // Continue to update endpoint
          }
        }
      }
    }
    
    // Fallback to update endpoint with minimal config
    const minimalAppConfig = {
      appName: appName,
      instanceCount: 1,
      captainDefinitionRelativeFilePath: './captain-definition',
      notExposeAsWebApp: false,
      hasPersistentData: false,
      description: `Auto-created app: ${appName}`,
      volumes: [],
      ports: [],
      preDeployFunction: '',
      customNginxConfig: '',
      customDomain: [],
      forceSsl: false,
      websocketSupport: false,
      appDeployTokenConfig: {
        enabled: false,
        appDeployToken: ''
      }
    };
    
    console.log(`Using update endpoint to create app with config:`, JSON.stringify(minimalAppConfig, null, 2));
    
    const response = await caproverAPI.post('/user/apps/appDefinitions/update', minimalAppConfig, {
      headers: {
        'x-captain-auth': authToken,
        'content-type': 'application/json;charset=UTF-8'
      }
    });
    
    // Log the full response to see what CapRover returns
    console.log(`✅ CapRover API response for app creation:`, {
      status: response.status,
      statusText: response.statusText,
      data: JSON.stringify(response.data)
    });
    
    // CapRover returns HTTP 200 even for errors, but includes error status in response body
    // Parse response data to check for errors
    let responseData = response.data;
    if (typeof responseData === 'string') {
      try {
        responseData = JSON.parse(responseData);
      } catch (e) {
        // If parsing fails, treat as error
        throw new Error(`CapRover API returned invalid response: ${responseData}`);
      }
    }
    
    // Check if response contains an error status (CapRover uses status codes in response body)
    if (responseData && typeof responseData === 'object' && responseData.status !== undefined) {
      // CapRover error status codes are typically >= 1000
      if (responseData.status >= 1000) {
        const errorMsg = responseData.description || responseData.message || `CapRover API error (status: ${responseData.status})`;
        const error = new Error(`CapRover API error: ${errorMsg} (Status: ${responseData.status})`);
        // Mark auth token errors for retry logic
        if (responseData.status === 1106 || errorMsg.toLowerCase().includes('auth token')) {
          error.isAuthTokenError = true;
          error.statusCode = responseData.status;
        }
        throw error;
      }
    }
    
    // Check if the HTTP response indicates success
    if (response.status >= 200 && response.status < 300) {
      console.log(`✅ CapRover app "${appName}" creation API call succeeded`);
      return { success: true, appName, response: responseData };
    } else {
      throw new Error(`CapRover API returned unexpected HTTP status: ${response.status}`);
    }
  } catch (error) {
    // Preserve auth token error flag if it exists
    const isAuthTokenError = error.isAuthTokenError || false;
    
    if (error.response) {
      const errorData = error.response.data || {};
      const status = error.response.status;
      const statusText = error.response.statusText;
      
      console.error('❌ CapRover API error details:', {
        status,
        statusText,
        data: errorData,
        message: error.message,
        url: error.config?.url,
        method: error.config?.method
      });
      
      // Extract error message
      let errorMessage = error.message;
      if (errorData.description) {
        errorMessage = errorData.description;
      } else if (errorData.message) {
        errorMessage = errorData.message;
      } else if (typeof errorData === 'string') {
        errorMessage = errorData;
      }
      
      const errorDetails = `Status: ${status}${statusText ? ` (${statusText})` : ''}, Data: ${JSON.stringify(errorData)}`;
      const newError = new Error(`CapRover API error: ${errorMessage}. Details: ${errorDetails}`);
      if (isAuthTokenError || status === 1106 || errorMessage.toLowerCase().includes('auth token')) {
        newError.isAuthTokenError = true;
      }
      throw newError;
    }
    console.error('❌ CapRover API error (no response):', error.message);
    const newError = new Error(`Failed to create CapRover app: ${error.message}`);
    if (isAuthTokenError) {
      newError.isAuthTokenError = true;
    }
    throw newError;
  }
}

// Get app definition to merge with updates
async function getAppDefinition(appName, authToken) {
  try {
    const response = await caproverAPI.get('/user/apps/appDefinitions', {
      headers: {
        'x-captain-auth': authToken,
        'content-type': 'application/json;charset=UTF-8'
      }
    });
    
    const apps = response.data.data.appDefinitions || [];
    const app = apps.find(a => a.appName === appName);
    return app || null;
  } catch (error) {
    console.error('Error fetching app definition:', error.message);
    return null;
  }
}

// Configure GitHub deployment and port in CapRover
async function configureCapRoverApp(appName, repoUrl, branch, username, password, port, authToken) {
  try {
    // Extract repo owner and name from URL
    const repoMatch = repoUrl.match(/github\.com[/:]([^/]+)\/([^/]+)(?:\.git)?$/);
    if (!repoMatch) {
      throw new Error('Invalid GitHub repository URL');
    }
    const repoOwner = repoMatch[1];
    const repoName = repoMatch[2].replace('.git', '');
    
    // Get existing app definition to merge
    const existingApp = await getAppDefinition(appName, authToken);
    
    // Build update payload, merging with existing app data
    const updatePayload = {
      appName: appName,
      containerHttpPort: port,
      repoInfo: {
        repo: `${repoOwner}/${repoName}`,
        branch: branch || 'main',
        user: username,
        password: password,
        sshKey: ''
      }
    };
    
    // Merge with existing app data if available
    if (existingApp) {
      updatePayload.hasPersistentData = existingApp.hasPersistentData || false;
      updatePayload.description = existingApp.description || `Auto-configured app: ${appName}`;
      updatePayload.instanceCount = existingApp.instanceCount || 1;
      updatePayload.captainDefinitionRelativeFilePath = existingApp.captainDefinitionRelativeFilePath || './captain-definition';
      updatePayload.volumes = existingApp.volumes || [];
      updatePayload.ports = existingApp.ports || [];
      updatePayload.preDeployFunction = existingApp.preDeployFunction || '';
      updatePayload.customNginxConfig = existingApp.customNginxConfig || '';
      updatePayload.notExposeAsWebApp = existingApp.notExposeAsWebApp || false;
      updatePayload.customDomain = existingApp.customDomain || [];
      updatePayload.forceSsl = existingApp.forceSsl || false;
      updatePayload.websocketSupport = existingApp.websocketSupport || false;
      updatePayload.appDeployTokenConfig = existingApp.appDeployTokenConfig || {
        enabled: false,
        appDeployToken: ''
      };
    } else {
      // Default values if app doesn't exist yet
      updatePayload.hasPersistentData = false;
      updatePayload.description = `Auto-configured app: ${appName}`;
      updatePayload.instanceCount = 1;
      updatePayload.captainDefinitionRelativeFilePath = './captain-definition';
      updatePayload.volumes = [];
      updatePayload.ports = [];
      updatePayload.preDeployFunction = '';
      updatePayload.customNginxConfig = '';
      updatePayload.notExposeAsWebApp = false;
      updatePayload.customDomain = [];
      updatePayload.forceSsl = false;
      updatePayload.websocketSupport = false;
      updatePayload.appDeployTokenConfig = {
        enabled: false,
        appDeployToken: ''
      };
    }
    
    // Configure deployment and port in one call
    console.log(`Configuring CapRover app: ${appName} with repo ${repoOwner}/${repoName}, branch ${branch}, port ${port}`);
    const response = await caproverAPI.post(`/user/apps/appDefinitions/update`, updatePayload, {
      headers: {
        'x-captain-auth': authToken,
        'content-type': 'application/json;charset=UTF-8'
      }
    });
    
    // CapRover returns HTTP 200 even for errors, but includes error status in response body
    // Parse response data to check for errors
    let responseData = response.data;
    if (typeof responseData === 'string') {
      try {
        responseData = JSON.parse(responseData);
      } catch (e) {
        // If parsing fails, treat as error
        throw new Error(`CapRover API returned invalid response: ${responseData}`);
      }
    }
    
    // Check if response contains an error status (CapRover uses status codes in response body)
    if (responseData && typeof responseData === 'object' && responseData.status !== undefined) {
      // CapRover error status codes are typically >= 1000
      if (responseData.status >= 1000) {
        const errorMsg = responseData.description || responseData.message || `CapRover API error (status: ${responseData.status})`;
        throw new Error(`CapRover API error: ${errorMsg} (Status: ${responseData.status})`);
      }
    }
    
    return { success: true };
  } catch (error) {
    if (error.response) {
      const errorData = error.response.data || {};
      const status = error.response.status;
      const statusText = error.response.statusText;
      
      console.error('❌ CapRover API error details (configure):', {
        status,
        statusText,
        data: errorData,
        message: error.message,
        url: error.config?.url,
        method: error.config?.method
      });
      
      // Extract error message
      let errorMessage = error.message;
      if (errorData.description) {
        errorMessage = errorData.description;
      } else if (errorData.message) {
        errorMessage = errorData.message;
      } else if (typeof errorData === 'string') {
        errorMessage = errorData;
      }
      
      const errorDetails = `Status: ${status}${statusText ? ` (${statusText})` : ''}, Data: ${JSON.stringify(errorData)}`;
      throw new Error(`CapRover API error: ${errorMessage}. Details: ${errorDetails}`);
    }
    console.error('❌ CapRover API error (no response, configure):', error.message);
    throw new Error(`Failed to configure CapRover app: ${error.message}`);
  }
}

// Login endpoint
app.post('/api/login', async (req, res) => {
  const requestId = Date.now();
  console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] POST /api/login`);
  
  try {
    if (!MONGO_URI) {
      return res.status(500).json({ error: 'MongoDB not configured' });
    }
    
    const { username, password } = req.body;
    
    if (!username || !password) {
      console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Validation failed: Username or password missing`);
      return res.status(400).json({ error: 'Username and password are required' });
    }
    
    // Find admin
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Looking up admin: ${username}`);
    const admin = await Admin.findOne({ username: username });
    
    if (!admin) {
      console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Admin not found`);
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Verify password
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Verifying password...`);
    const isValidPassword = await bcrypt.compare(password, admin.password);
    
    if (!isValidPassword) {
      console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Invalid password`);
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    
    // Create session
    req.session.isAuthenticated = true;
    req.session.username = admin.username;
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] ✅ Login successful`);
    
    res.json({
      success: true,
      message: 'Login successful'
    });
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [REQUEST ${requestId}] ❌ Error during login:`, error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to login'
    });
  }
});

// Logout endpoint
app.post('/api/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error(`[${new Date().toISOString()}] Error destroying session:`, err);
      return res.status(500).json({ error: 'Failed to logout' });
    }
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// Check authentication status
app.get('/api/auth-status', (req, res) => {
  res.json({
    isAuthenticated: !!(req.session && req.session.isAuthenticated),
    username: req.session?.username || null
  });
});

// Main endpoint to create everything (protected)
app.post('/api/create-website', requireAuth, async (req, res) => {
  const requestId = Date.now();
  console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] POST /api/create-website`);
  
  try {
    const { projectName, branch = 'main', isDomain, domain } = req.body;
    
    if (!projectName) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    const repoName = String(projectName).trim();
    if (!/^[a-z0-9-]+$/i.test(repoName)) {
      return res.status(400).json({ error: 'Invalid project name. Only letters, numbers, and hyphens are allowed.' });
    }

    // CapRover app names should be lowercase
    const appName = repoName.toLowerCase();

    if (isDomain && !domain) {
      return res.status(400).json({ error: 'Domain is required if "This is a custom domain" is checked.' });
    }
    
    // Validate GitHub credentials (use token, not password)
    if (!GITHUB_TOKEN) {
      return res.status(400).json({ error: 'GitHub credentials not configured. Please set GITHUB_TOKEN environment variable.' });
    }
    
    if (!GITHUB_USERNAME) {
      return res.status(400).json({ error: 'GitHub username not configured. Please set GITHUB_USERNAME environment variable.' });
    }
    
    // Step 1: Create GitHub repository
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 1: Creating GitHub repository: ${repoName}`);
    const githubResult = await createGitHubRepo(repoName, true);
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 1: ✅ GitHub repo created: ${githubResult.repoUrl}`);
    
    // Step 2: Authenticate with CapRover ONCE (needed to determine port)
    const baseUrl = CAPROVER_URL.replace(/\/+$/, '');
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 2: Authenticating with CapRover at ${baseUrl}...`);
    const token = await caproverLogin(baseUrl, CAPROVER_PASSWORD);
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 2: ✅ CapRover authentication successful`);
    
    // Step 3: Determine port (use provided port or generate one)
    let containerPort;
    if (req.body.port) {
      containerPort = parseInt(req.body.port, 10);
      if (isNaN(containerPort) || containerPort < 3000 || containerPort > 65535) {
        return res.status(400).json({ error: 'Invalid port. Port must be between 3000 and 65535.' });
      }
      console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 3: Using provided container port: ${containerPort}`);
    } else {
      // Generate an available port
      console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 3: Generating available port...`);
      const apps = await caproverListApps(baseUrl, token);
      const usedPorts = new Set(apps.map(app => app.containerHttpPort).filter(p => p && p > 0));
      containerPort = findNextAvailablePort(usedPorts, 3000);
      console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 3: Generated available port: ${containerPort} (used ports: ${Array.from(usedPorts).join(', ') || 'none'})`);
    }
    
    // Step 3b: Push default starter files to GitHub (with correct port)
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 3b: Pushing default starter files to GitHub with port ${containerPort}...`);
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 3b: Files will use PORT=${containerPort} in server.js and EXPOSE ${containerPort} in Dockerfile`);
    try {
      await pushDefaultFilesToGitHub(GITHUB_USERNAME, repoName, branch, containerPort);
      console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 3b: ✅ Default files pushed/updated to GitHub with port ${containerPort}`);
    } catch (error) {
      console.warn(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 3b: ⚠️ Could not push default files: ${error.message}. Continuing anyway...`);
      // Continue even if file push fails - repo is created and CapRover can deploy empty repo
    }
    
    // Step 4: Ensure app exists (idempotent)
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 4: Ensuring CapRover app exists: ${appName}`);
    const appResult = await caproverEnsureApp(baseUrl, token, appName);
    if (appResult.created) {
      console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 4: ✅ CapRover app created`);
    } else {
      console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 4: ✅ CapRover app already exists, continuing`);
    }
    
    // Step 5: Set Container HTTP Port
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 5: Setting container HTTP port to ${containerPort}...`);
    await caproverSetContainerHttpPort(baseUrl, token, appName, containerPort);
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 5: ✅ Container HTTP port set to ${containerPort}`);
    
    // Step 6: Set environment variables (copy from template app "a-staxxio-web")
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 6: Setting environment variables...`);
    
    // Get environment variables from template app
    const templateAppName = 'a-staxxio-web';
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 6a: Fetching env vars from template app: ${templateAppName}...`);
    const templateEnvCheck = await caproverGetEnvVars(baseUrl, token, templateAppName);
    
    let envVars = {};
    
    if (templateEnvCheck.ok) {
      const templateEnvVarsData = templateEnvCheck.result?.data?.envVars || templateEnvCheck.result?.envVars || [];
      // Convert array of {key, value} to object
      templateEnvVarsData.forEach(env => {
        const key = env.key || env.name;
        const value = env.value;
        // Skip PORT - we'll set it explicitly based on containerPort
        if (key && value !== undefined && key !== 'PORT') {
          envVars[key] = value;
        }
      });
      console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 6a: ✅ Copied ${Object.keys(envVars).length} env vars from template app (excluding PORT)`);
    } else {
      console.warn(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 6a: ⚠️ Could not fetch template env vars: ${templateEnvCheck.message}. Using defaults.`);
    }
    
    // Override with app-specific variables (PORT must match containerPort)
    envVars.PORT = String(containerPort);
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 6b: Setting PORT=${containerPort} (must match Container HTTP Port)`);
    envVars.GITHUB_USERNAME = GITHUB_USERNAME;
    envVars.GITHUB_TOKEN = GITHUB_TOKEN;
    envVars.REPO_NAME = repoName;
    envVars.REPO_URL = githubResult.cloneUrl;
    envVars.REPO_BRANCH = branch;
    
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 6c: Applying ${Object.keys(envVars).length} env vars to new app...`);
    await caproverSetEnvVars(baseUrl, token, appName, envVars);
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 6: ✅ Environment variables set (${Object.keys(envVars).length} total, PORT=${containerPort})`);
    
    // Step 7: Verify env vars were applied
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 7: Verifying environment variables...`);
    const envCheck = await caproverGetEnvVars(baseUrl, token, appName);
    
    if (!envCheck.ok) {
      console.warn(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 7: ⚠️ Could not verify env vars: ${envCheck.message}`);
      // Continue anyway - env vars might still be set even if getter doesn't work
    } else {
      const envVarsData = envCheck.result?.data?.envVars || envCheck.result?.envVars || [];
      const envKeys = envVarsData.map(e => e.key || e.name);
      
      // Check that required vars exist
      const requiredKeys = ['PORT', 'GITHUB_TOKEN'];
      const missingKeys = requiredKeys.filter(key => !envKeys.includes(key));
      if (missingKeys.length > 0) {
        throw new Error(`Environment variables not properly set. Missing: ${missingKeys.join(', ')}. Found keys: ${envKeys.join(', ')}`);
      }
      
      // Verify PORT value matches containerPort
      const portEnvVar = envVarsData.find(e => (e.key || e.name) === 'PORT');
      const actualPort = portEnvVar?.value;
      if (actualPort && actualPort !== String(containerPort)) {
        console.warn(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 7: ⚠️ PORT env var mismatch! Expected: ${containerPort}, Found: ${actualPort}`);
      } else if (actualPort) {
        console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 7: ✅ PORT env var verified: ${actualPort} (matches Container HTTP Port)`);
      }
      console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 7: ✅ Environment variables verified (${envKeys.length} vars found)`);
    }
    
    // Step 8: Configure GitHub deployment (optional)
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 8: Configuring GitHub deployment...`);
    await caproverSetGitHubDeployment(baseUrl, token, appName, githubResult.cloneUrl, branch, GITHUB_TOKEN, GITHUB_USERNAME, containerPort);
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 8: ✅ GitHub deployment configured`);

    // Step 9: Set custom domains if domain is provided
    if (isDomain && domain) {
      console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 9: Setting custom domains: ${domain} and www.${domain}...`);
      const customDomains = [domain, `www.${domain}`];
      await caproverSetCustomDomains(baseUrl, token, appName, customDomains);
      console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 9: ✅ Custom domains set: ${customDomains.join(', ')}`);
    }

    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] ✅ All steps completed successfully!`);
    res.json({
      success: true,
      message: 'Website created successfully!',
      data: {
        githubRepo: githubResult.repoUrl,
        caproverApp: appName,
        port: containerPort,
        branch: branch,
        isDomain: isDomain,
        domain: domain
      }
    });
    
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [REQUEST ${requestId}] ❌ Error creating website:`, error);
    console.error(`[${new Date().toISOString()}] [REQUEST ${requestId}] Error stack:`, error.stack);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create website'
    });
  }
});

// Main endpoint to create a Discord bot (GitHub + CapRover) (protected)
app.post('/api/create-discord-bot', requireAuth, async (req, res) => {
  const requestId = Date.now();
  console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] POST /api/create-discord-bot`);

  try {
    const { projectName, branch = 'main' } = req.body;

    if (!projectName) {
      return res.status(400).json({ error: 'Project name is required' });
    }

    const repoName = String(projectName).trim();
    if (!/^[a-z0-9-]+$/i.test(repoName)) {
      return res.status(400).json({ error: 'Invalid project name. Only letters, numbers, and hyphens are allowed.' });
    }

    const appName = repoName.toLowerCase();

    // Validate GitHub credentials
    if (!GITHUB_TOKEN) {
      return res.status(400).json({ error: 'GitHub credentials not configured. Please set GITHUB_TOKEN environment variable.' });
    }

    if (!GITHUB_USERNAME) {
      return res.status(400).json({ error: 'GitHub username not configured. Please set GITHUB_USERNAME environment variable.' });
    }

    if (!CAPROVER_URL || !CAPROVER_PASSWORD) {
      return res.status(400).json({ error: 'CapRover credentials not configured. Please set CAPROVER_URL and CAPROVER_PASSWORD environment variables.' });
    }

    // Step 1: Create GitHub repository
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 1: Creating GitHub repository: ${repoName}`);
    const githubResult = await createGitHubRepo(repoName, true);
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 1: ✅ GitHub repo created: ${githubResult.repoUrl}`);

    // Step 2: Authenticate with CapRover
    const baseUrl = CAPROVER_URL.replace(/\/+$/, '');
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 2: Authenticating with CapRover at ${baseUrl}...`);
    const token = await caproverLogin(baseUrl, CAPROVER_PASSWORD);
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 2: ✅ CapRover authentication successful`);

    // Step 3: Determine port (use provided port or generate one)
    let containerPort;
    if (req.body.port) {
      containerPort = parseInt(req.body.port, 10);
      if (isNaN(containerPort) || containerPort < 3000 || containerPort > 65535) {
        return res.status(400).json({ error: 'Invalid port. Port must be between 3000 and 65535.' });
      }
      console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 3: Using provided container port: ${containerPort}`);
    } else {
      console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 3: Generating available port...`);
      const apps = await caproverListApps(baseUrl, token);
      const usedPorts = new Set(apps.map(app => app.containerHttpPort).filter(p => p && p > 0));
      containerPort = findNextAvailablePort(usedPorts, 3000);
      console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 3: Generated available port: ${containerPort}`);
    }

    // Step 3b: Push Discord bot starter files to GitHub (with correct port)
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 3b: Pushing Discord bot starter files to GitHub with port ${containerPort}...`);
    try {
      await pushDefaultFilesToGitHub(GITHUB_USERNAME, repoName, branch, containerPort, 'discord-bot');
      console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 3b: ✅ Discord bot files pushed/updated to GitHub`);
    } catch (error) {
      console.warn(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 3b: ⚠️ Could not push default files: ${error.message}. Continuing anyway...`);
    }

    // Step 4: Ensure app exists (idempotent)
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 4: Ensuring CapRover app exists: ${appName}`);
    await caproverEnsureApp(baseUrl, token, appName);

    // Step 5: Set Container HTTP Port
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 5: Setting container HTTP port to ${containerPort}...`);
    await caproverSetContainerHttpPort(baseUrl, token, appName, containerPort);

    // Step 6: Set minimal env vars (PORT only; Discord vars are set in a later step)
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 6: Setting minimal environment variables...`);
    await caproverSetEnvVars(baseUrl, token, appName, { PORT: String(containerPort) });

    // Step 7: Configure GitHub deployment
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 7: Configuring GitHub deployment...`);
    await caproverSetGitHubDeployment(baseUrl, token, appName, githubResult.cloneUrl, branch, GITHUB_TOKEN, GITHUB_USERNAME, containerPort);

    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] ✅ Discord bot created successfully!`);
    res.json({
      success: true,
      message: 'Discord bot created successfully!',
      data: {
        githubRepo: githubResult.repoUrl,
        caproverApp: appName,
        port: containerPort,
        branch: branch,
      }
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [REQUEST ${requestId}] ❌ Error creating Discord bot:`, error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create Discord bot'
    });
  }
});

// Save Discord bot config into CapRover env vars (protected)
app.post('/api/apps/:appName/discord-bot-config', requireAuth, async (req, res) => {
  const requestId = Date.now();
  const { appName } = req.params;
  console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] POST /api/apps/${appName}/discord-bot-config`);

  try {
    if (!CAPROVER_URL || !CAPROVER_PASSWORD) {
      return res.status(400).json({ success: false, error: 'CapRover credentials not configured' });
    }

    const body = req.body || {};

    // Support both legacy keys and direct env-var keys
    const envKeys = [
      'DISCORD_APPLICATION_ID',
      'DISCORD_SECRET',
      'DISCORD_PUBLIC_KEY',
      'DISCORD_BOT_TOKEN',
      'DISCORD_PREFIX',
      'DISCORD_PREFIX_ENABLED',
      'DISCORD_GUILD_ID',
      'mongoDB_URI',
      'mongoDB_DB',
      'mongoDB_User',
      'mongoDB_Password',
      'admin_role_ID',
      'mod_role_ID',
      'member_role_ID',
      'mongodb_atlas_email',
      'mongodb_atlas_password',
    ];

    const picked = {};

    // Legacy aliases
    if (body.applicationId && !body.DISCORD_APPLICATION_ID) picked.DISCORD_APPLICATION_ID = body.applicationId;
    if (body.publicKey && !body.DISCORD_PUBLIC_KEY) picked.DISCORD_PUBLIC_KEY = body.publicKey;
    if (body.botToken && !body.DISCORD_BOT_TOKEN) picked.DISCORD_BOT_TOKEN = body.botToken;
    if (body.guildId && !body.DISCORD_GUILD_ID) picked.DISCORD_GUILD_ID = body.guildId;

    // Direct keys
    envKeys.forEach((k) => {
      if (body[k] !== undefined && body[k] !== null && String(body[k]).trim() !== '') {
        picked[k] = String(body[k]).trim();
      }
    });

    if (!picked.DISCORD_APPLICATION_ID || !picked.DISCORD_PUBLIC_KEY || !picked.DISCORD_BOT_TOKEN) {
      return res.status(400).json({
        success: false,
        error: 'DISCORD_APPLICATION_ID, DISCORD_PUBLIC_KEY, and DISCORD_BOT_TOKEN are required'
      });
    }

    // Normalize boolean flag if provided
    if (picked.DISCORD_PREFIX_ENABLED !== undefined) {
      const v = String(picked.DISCORD_PREFIX_ENABLED).trim().toLowerCase();
      picked.DISCORD_PREFIX_ENABLED = (v === 'true' || v === '1' || v === 'yes') ? 'true' : 'false';
    }

    const baseUrl = CAPROVER_URL.replace(/\/+$/, '');
    const token = await caproverLogin(baseUrl, CAPROVER_PASSWORD);

    // Fetch existing env vars so we don't wipe unrelated values
    const existingEnvCheck = await caproverGetEnvVars(baseUrl, token, appName);
    let existingEnvObj = {};

    if (existingEnvCheck.ok) {
      const envVarsData = existingEnvCheck.result?.data?.envVars || existingEnvCheck.result?.envVars || [];
      envVarsData.forEach(env => {
        const key = env.key || env.name;
        const value = env.value;
        if (key && value !== undefined) existingEnvObj[key] = String(value);
      });
    }

    const merged = {
      ...existingEnvObj,
      ...picked,
    };

    await caproverSetEnvVars(baseUrl, token, appName, merged);

    res.json({ success: true, message: 'Discord bot env vars saved successfully' });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [REQUEST ${requestId}] ❌ Error saving Discord bot config:`, error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to save Discord bot config'
    });
  }
});

// Delete old images for an app (keeps 5 most recent) (protected)
app.delete('/api/apps/:appName/images/old', requireAuth, async (req, res) => {
  const requestId = Date.now();
  const { appName } = req.params;
  console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] DELETE /api/apps/${appName}/images/old`);

  try {
    if (!CAPROVER_URL || !CAPROVER_PASSWORD) {
      return res.status(400).json({ success: false, error: 'CapRover credentials not configured' });
    }

    const baseUrl = CAPROVER_URL.replace(/\/+$/, '');
    const token = await caproverLogin(baseUrl, CAPROVER_PASSWORD);

    const result = await caproverDeleteOldImages(baseUrl, token, appName, 5);

    res.json({
      success: true,
      message: `Deleted ${result.deleted} old image(s), kept ${result.kept} most recent`,
      deleted: result.deleted,
      kept: result.kept,
      total: result.total
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [REQUEST ${requestId}] ❌ Error deleting old images:`, error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete old images'
    });
  }
});

// API endpoint to generate an available port
app.get('/api/generate-port', requireAuth, async (req, res) => {
  try {
    if (!CAPROVER_URL || !CAPROVER_PASSWORD) {
      return res.status(400).json({
        success: false,
        error: 'CapRover credentials not configured'
      });
    }

    const baseUrl = CAPROVER_URL.replace(/\/+$/, '');
    const token = await caproverLogin(baseUrl, CAPROVER_PASSWORD);
    const apps = await caproverListApps(baseUrl, token);
    
    const usedPorts = new Set(apps.map(app => app.containerHttpPort).filter(p => p && p > 0));
    const availablePort = findNextAvailablePort(usedPorts, 3000);
    
    res.json({
      success: true,
      port: availablePort,
      usedPorts: Array.from(usedPorts)
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error generating port:`, error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate port'
    });
  }
});

// List GitHub repositories (protected)
app.get('/api/repos', requireAuth, async (req, res) => {
  try {
    if (!GITHUB_TOKEN) {
      return res.status(400).json({ 
        success: false, 
        error: 'GITHUB_TOKEN not configured' 
      });
    }
    
    const repos = await listGitHubRepos();
    res.json({ success: true, repos });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error listing repos:`, error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to list repositories' 
    });
  }
});

// Delete GitHub repository (protected)
app.delete('/api/repos/:repoName', requireAuth, async (req, res) => {
  const { repoName } = req.params;
  
  try {
    if (!GITHUB_TOKEN || !GITHUB_USERNAME) {
      return res.status(400).json({ 
        success: false, 
        error: 'GitHub credentials not configured' 
      });
    }
    
    await deleteGitHubRepo(repoName);
    res.json({ success: true, message: `Repository "${repoName}" deleted successfully` });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error deleting repo:`, error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to delete repository' 
    });
  }
});

// List CapRover apps (protected)
app.get('/api/apps', requireAuth, async (req, res) => {
  try {
    if (!CAPROVER_URL || !CAPROVER_PASSWORD) {
      return res.status(400).json({ 
        success: false, 
        error: 'CapRover credentials not configured' 
      });
    }
    
    const baseUrl = CAPROVER_URL.replace(/\/+$/, '');
    const token = await caproverLogin(baseUrl, CAPROVER_PASSWORD);
    const apps = await caproverListApps(baseUrl, token);
    
    // Optionally include image counts (can be slow for many apps, so make it optional)
    const includeImageCounts = req.query.includeImageCounts === 'true';
    
    if (includeImageCounts) {
      // Fetch image counts in parallel
      const appsWithCounts = await Promise.all(
        apps.map(async (app) => {
          try {
            const imageCount = await caproverGetImageCount(baseUrl, token, app.appName);
            return { ...app, imageCount };
          } catch (error) {
            console.warn(`Failed to get image count for ${app.appName}:`, error.message);
            return { ...app, imageCount: 0 };
          }
        })
      );
      res.json({ success: true, apps: appsWithCounts });
    } else {
      res.json({ success: true, apps });
    }
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error listing apps:`, error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to list CapRover apps' 
    });
  }
});

// Get image count for a specific app (protected)
app.get('/api/apps/:appName/images/count', requireAuth, async (req, res) => {
  const { appName } = req.params;
  const requestId = Date.now();
  console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] GET /api/apps/${appName}/images/count`);
  
  try {
    if (!CAPROVER_URL || !CAPROVER_PASSWORD) {
      return res.status(400).json({ 
        success: false, 
        error: 'CapRover credentials not configured' 
      });
    }
    
    const baseUrl = CAPROVER_URL.replace(/\/+$/, '');
    const token = await caproverLogin(baseUrl, CAPROVER_PASSWORD);
    const imageCount = await caproverGetImageCount(baseUrl, token, appName);
    
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Image count for ${appName}: ${imageCount}`);
    res.json({ success: true, appName, imageCount });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [REQUEST ${requestId}] Error getting image count:`, error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to get image count' 
    });
  }
});

// Delete CapRover app (protected)
app.delete('/api/apps/:appName', requireAuth, async (req, res) => {
  const { appName } = req.params;
  
  try {
    if (!CAPROVER_URL || !CAPROVER_PASSWORD) {
      return res.status(400).json({ 
        success: false, 
        error: 'CapRover credentials not configured' 
      });
    }
    
    const baseUrl = CAPROVER_URL.replace(/\/+$/, '');
    const token = await caproverLogin(baseUrl, CAPROVER_PASSWORD);
    await caproverDeleteApp(baseUrl, token, appName);
    
    res.json({ success: true, message: `App "${appName}" deleted successfully` });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error deleting app:`, error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Failed to delete CapRover app' 
    });
  }
});

// ─── Ops: app logs, restart, system overview, health checks ──────────────────

// Get an app's runtime (container) logs (protected)
app.get('/api/apps/:appName/logs', requireAuth, async (req, res) => {
  const { appName } = req.params;
  try {
    if (!CAPROVER_URL || !CAPROVER_PASSWORD) {
      return res.status(400).json({ success: false, error: 'CapRover credentials not configured' });
    }
    const baseUrl = CAPROVER_URL.replace(/\/+$/, '');
    const token = await caproverLogin(baseUrl, CAPROVER_PASSWORD);
    const logs = await caproverGetAppLogs(baseUrl, token, appName);
    res.json({ success: true, appName, logs });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting app logs for ${appName}:`, error.message);
    res.status(500).json({ success: false, error: error.message || 'Failed to get app logs' });
  }
});

// Restart an app (scale instances 0 -> back) (protected)
app.post('/api/apps/:appName/restart', requireAuth, async (req, res) => {
  const requestId = Date.now();
  const { appName } = req.params;
  console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] POST /api/apps/${appName}/restart`);
  try {
    if (!CAPROVER_URL || !CAPROVER_PASSWORD) {
      return res.status(400).json({ success: false, error: 'CapRover credentials not configured' });
    }
    const baseUrl = CAPROVER_URL.replace(/\/+$/, '');
    const token = await caproverLogin(baseUrl, CAPROVER_PASSWORD);
    const result = await caproverRestartApp(baseUrl, token, appName);
    res.json({ success: true, message: `Restarted "${appName}"`, instanceCount: result.instanceCount });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [REQUEST ${requestId}] Error restarting ${appName}:`, error.message);
    res.status(500).json({ success: false, error: error.message || 'Failed to restart app' });
  }
});

// System / VPS overview (protected)
app.get('/api/system/overview', requireAuth, async (req, res) => {
  try {
    if (!CAPROVER_URL || !CAPROVER_PASSWORD) {
      return res.status(400).json({ success: false, error: 'CapRover credentials not configured' });
    }
    const baseUrl = CAPROVER_URL.replace(/\/+$/, '');
    const token = await caproverLogin(baseUrl, CAPROVER_PASSWORD);

    // Gather independently so one failing piece doesn't sink the whole dashboard
    const [info, nodes, version, lb, apps] = await Promise.allSettled([
      caproverGetSystemInfo(baseUrl, token),
      caproverGetNodes(baseUrl, token),
      caproverGetVersionInfo(baseUrl, token),
      caproverGetLoadBalancerInfo(baseUrl, token),
      caproverListApps(baseUrl, token),
    ]);

    const val = (r, d) => (r.status === 'fulfilled' ? r.value : d);
    const appList = val(apps, []);
    const totalInstances = appList.reduce((sum, a) => sum + (a.instanceCount || 0), 0);

    res.json({
      success: true,
      info: val(info, {}),
      nodes: val(nodes, []),
      version: val(version, {}),
      loadBalancer: val(lb, {}),
      appCount: appList.length,
      totalInstances,
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting system overview:`, error.message);
    res.status(500).json({ success: false, error: error.message || 'Failed to get system overview' });
  }
});

// Health-check every web-exposed app by pinging its public URL (protected)
app.get('/api/health-check', requireAuth, async (req, res) => {
  try {
    if (!CAPROVER_URL || !CAPROVER_PASSWORD) {
      return res.status(400).json({ success: false, error: 'CapRover credentials not configured' });
    }
    const baseUrl = CAPROVER_URL.replace(/\/+$/, '');
    const token = await caproverLogin(baseUrl, CAPROVER_PASSWORD);
    const { apps, rootDomain } = await caproverGetAppsAndRoot(baseUrl, token);

    // Only apps that are actually exposed as web apps can be pinged
    const webApps = apps.filter(a => !a.notExposeAsWebApp);

    const results = await Promise.all(webApps.map(async (a) => {
      const customDomains = Array.isArray(a.customDomain)
        ? a.customDomain.map(d => (typeof d === 'string' ? d : d.publicDomain)).filter(Boolean)
        : [];
      const host = customDomains[0] || (rootDomain ? `${a.appName}.${rootDomain}` : null);
      if (!host) {
        return { appName: a.appName, url: null, up: false, status: null, ms: null, error: 'no domain' };
      }
      const url = `https://${host}`;
      const started = Date.now();
      try {
        const r = await axios.get(url, {
          timeout: 8000,
          maxRedirects: 3,
          // any HTTP response (even 401/403/404) means the container is answering
          validateStatus: () => true,
        });
        return { appName: a.appName, url, up: r.status < 500, status: r.status, ms: Date.now() - started };
      } catch (err) {
        return { appName: a.appName, url, up: false, status: null, ms: Date.now() - started, error: err.code || err.message };
      }
    }));

    results.sort((x, y) => Number(x.up) - Number(y.up) || x.appName.localeCompare(y.appName));
    res.json({ success: true, rootDomain, results });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error running health check:`, error.message);
    res.status(500).json({ success: false, error: error.message || 'Failed to run health check' });
  }
});

// ─── Diagnostics: persisted logs + crash journal ─────────────────────────────

// Get stored (historical) log chunks for an app (protected)
app.get('/api/diagnostics/:appName/logs', requireAuth, async (req, res) => {
  const { appName } = req.params;
  try {
    if (!MONGO_URI) return res.status(500).json({ success: false, error: 'MongoDB not configured' });
    const limit = Math.min(parseInt(req.query.limit || '400', 10) || 400, 1500);
    const chunks = await AppLogChunk.find({ appName }).sort({ ts: -1 }).limit(limit).lean();
    // Return chronological (oldest first) for natural reading
    res.json({
      success: true,
      appName,
      chunks: chunks.reverse().map(c => ({ ts: c.ts, text: c.text, hasError: c.hasError }))
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error reading diagnostics logs for ${appName}:`, error.message);
    res.status(500).json({ success: false, error: error.message || 'Failed to read stored logs' });
  }
});

// Get crash/restart events for an app (protected)
app.get('/api/diagnostics/:appName/events', requireAuth, async (req, res) => {
  const { appName } = req.params;
  try {
    if (!MONGO_URI) return res.status(500).json({ success: false, error: 'MongoDB not configured' });
    const events = await CrashEvent.find({ appName }).sort({ ts: -1 }).limit(100).lean();
    res.json({ success: true, appName, events });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error reading diagnostics events for ${appName}:`, error.message);
    res.status(500).json({ success: false, error: error.message || 'Failed to read events' });
  }
});

// Collector status (protected)
app.get('/api/diagnostics/status', requireAuth, async (req, res) => {
  try {
    if (!MONGO_URI) return res.status(500).json({ success: false, error: 'MongoDB not configured' });
    const [logChunks, events] = await Promise.all([
      AppLogChunk.estimatedDocumentCount(),
      CrashEvent.estimatedDocumentCount()
    ]);
    res.json({
      success: true,
      enabled: !!(CAPROVER_URL && CAPROVER_PASSWORD),
      pollMs: DIAG_POLL_MS,
      appsTracked: diagLastLineByApp.size,
      logChunks,
      events
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message || 'Failed to read diagnostics status' });
  }
});

// ─── Reboot VPS recovery: pinned services + force build ──────────────────────

// List pinned services (protected)
app.get('/api/pinned-apps', requireAuth, async (req, res) => {
  try {
    if (!MONGO_URI) {
      return res.status(500).json({ success: false, error: 'MongoDB not configured' });
    }
    const pins = await PinnedService.find().sort({ createdAt: 1 });
    res.json({ success: true, pinned: pins.map(p => p.appName) });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error listing pinned apps:`, error);
    res.status(500).json({ success: false, error: error.message || 'Failed to list pinned apps' });
  }
});

// Pin a service (protected)
app.post('/api/pinned-apps', requireAuth, async (req, res) => {
  try {
    if (!MONGO_URI) {
      return res.status(500).json({ success: false, error: 'MongoDB not configured' });
    }
    const appName = String(req.body?.appName || '').trim();
    if (!appName || !/^[a-z0-9-]+$/i.test(appName)) {
      return res.status(400).json({ success: false, error: 'Invalid app name' });
    }
    await PinnedService.updateOne({ appName }, { $set: { appName } }, { upsert: true });
    res.json({ success: true, message: `Pinned "${appName}"` });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error pinning app:`, error);
    res.status(500).json({ success: false, error: error.message || 'Failed to pin app' });
  }
});

// Unpin a service (protected)
app.delete('/api/pinned-apps/:appName', requireAuth, async (req, res) => {
  try {
    if (!MONGO_URI) {
      return res.status(500).json({ success: false, error: 'MongoDB not configured' });
    }
    const { appName } = req.params;
    await PinnedService.deleteOne({ appName });
    res.json({ success: true, message: `Unpinned "${appName}"` });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error unpinning app:`, error);
    res.status(500).json({ success: false, error: error.message || 'Failed to unpin app' });
  }
});

// Force build an app from its configured GitHub repo (protected)
app.post('/api/apps/:appName/force-build', requireAuth, async (req, res) => {
  const requestId = Date.now();
  const { appName } = req.params;
  console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] POST /api/apps/${appName}/force-build`);

  try {
    if (!CAPROVER_URL || !CAPROVER_PASSWORD) {
      return res.status(400).json({ success: false, error: 'CapRover credentials not configured' });
    }

    const baseUrl = CAPROVER_URL.replace(/\/+$/, '');
    const token = await caproverLogin(baseUrl, CAPROVER_PASSWORD);
    await caproverForceBuild(baseUrl, token, appName);

    res.json({ success: true, message: `Force build triggered for "${appName}"` });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] [REQUEST ${requestId}] Error force building:`, error);
    res.status(500).json({ success: false, error: error.message || 'Failed to force build' });
  }
});

// Get current build status/logs for an app (protected)
// Note: re-authenticates to CapRover on each call, consistent with the other routes.
app.get('/api/apps/:appName/build-logs', requireAuth, async (req, res) => {
  const { appName } = req.params;

  try {
    if (!CAPROVER_URL || !CAPROVER_PASSWORD) {
      return res.status(400).json({ success: false, error: 'CapRover credentials not configured' });
    }

    const baseUrl = CAPROVER_URL.replace(/\/+$/, '');
    const token = await caproverLogin(baseUrl, CAPROVER_PASSWORD);
    const appData = await caproverGetAppData(baseUrl, token, appName);

    res.json({
      success: true,
      isAppBuilding: !!appData?.isAppBuilding,
      isBuildFailed: !!appData?.isBuildFailed,
      logs: appData?.logs || { lines: [], firstLineNumber: 0 }
    });
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Error getting build logs for ${appName}:`, error);
    res.status(500).json({ success: false, error: error.message || 'Failed to get build logs' });
  }
});

// Test endpoint to verify routing is working
app.get('/test', (req, res) => {
  console.log(`[${new Date().toISOString()}] ✅ Test endpoint hit! Routing is working!`);
  res.json({
    success: true,
    message: 'Server is reachable! Routing is working correctly.',
    timestamp: new Date().toISOString(),
    port: PORT,
    serverAddress: server.address(),
    requestHeaders: {
      host: req.headers.host,
      'x-forwarded-for': req.headers['x-forwarded-for'],
      'x-real-ip': req.headers['x-real-ip']
    }
  });
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  console.log(`[${new Date().toISOString()}] Health check requested`);
  const healthData = {
    status: 'ok',
    port: PORT,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
    },
    env: {
      hasGithubToken: !!GITHUB_TOKEN,
      hasCaproverUrl: !!CAPROVER_URL,
      hasCaproverPassword: !!CAPROVER_PASSWORD,
      nodeEnv: process.env.NODE_ENV || 'not set',
      portFromEnv: process.env.PORT || 'not set (using default 3800)'
    },
    server: {
      listening: true,
      address: '0.0.0.0',
      port: PORT
    }
  };
  console.log(`[${new Date().toISOString()}] Health check response:`, JSON.stringify(healthData, null, 2));
  res.json(healthData);
});

// Root endpoint
app.get('/', (req, res) => {
  console.log(`[${new Date().toISOString()}] Root endpoint requested, serving index.html`);
  const indexPath = __dirname + '/public/index.html';
  console.log(`[${new Date().toISOString()}] Index file path: ${indexPath}`);
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error(`[${new Date().toISOString()}] Error serving index.html:`, err);
      res.status(500).send('Error loading page');
    } else {
      console.log(`[${new Date().toISOString()}] Successfully served index.html`);
    }
  });
});

// Catch-all for undefined routes
app.use((req, res) => {
  console.log(`[${new Date().toISOString()}] 404 - Route not found: ${req.method} ${req.url}`);
  res.status(404).json({ error: 'Route not found', path: req.url, method: req.method });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(`[${new Date().toISOString()}] Unhandled error:`, err);
  console.error(`[${new Date().toISOString()}] Error stack:`, err.stack);
  res.status(500).json({ error: 'Internal server error', message: err.message });
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`═══════════════════════════════════════════════════════`);
  console.log(`🚀 Server is running!`);
  console.log(`   Port: ${PORT}`);
  console.log(`   Listening on: 0.0.0.0:${PORT}`);
  console.log(`   Server address: ${server.address().address}:${server.address().port}`);
  console.log(`   Process ID: ${process.pid}`);
  console.log(`═══════════════════════════════════════════════════════`);
  console.log(`📋 IMPORTANT: Set Container HTTP Port in CapRover!`);
  console.log(`   1. Go to CapRover Dashboard → websitecreator app`);
  console.log(`   2. Click "App Configs" tab`);
  console.log(`   3. Scroll to "HTTP Settings"`);
  console.log(`   4. Set "Container HTTP Port" to: ${PORT}`);
  console.log(`   5. Click "Save & Update"`);
  console.log(`═══════════════════════════════════════════════════════`);
  
  // Check if required environment variables are set
  const missingVars = [];
  if (!GITHUB_TOKEN) missingVars.push('GITHUB_TOKEN');
  if (!CAPROVER_URL) missingVars.push('CAPROVER_URL');
  if (!CAPROVER_PASSWORD) missingVars.push('CAPROVER_PASSWORD');
  
  console.log(`📦 Environment Variables:`);
  console.log(`   GITHUB_TOKEN: ${GITHUB_TOKEN ? '✅ Set (' + GITHUB_TOKEN.substring(0, 10) + '...)' : '❌ Missing'}`);
  console.log(`   CAPROVER_URL: ${CAPROVER_URL || '❌ Missing'}`);
  console.log(`   CAPROVER_PASSWORD: ${CAPROVER_PASSWORD ? '✅ Set' : '❌ Missing'}`);
  console.log(`   GITHUB_USERNAME: ${GITHUB_USERNAME || '⚠️  Not set (optional)'}`);
  console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'not set'}`);
  console.log(`   PORT (from env): ${process.env.PORT || 'not set (using default 3800)'}`);
  
  if (missingVars.length > 0) {
    console.warn(`⚠️  Warning: Missing required environment variables: ${missingVars.join(', ')}`);
    console.warn(`   Set these in CapRover: App Configs → Environment Variables`);
  } else {
    console.log(`✅ All required environment variables are set`);
  }
  console.log(`═══════════════════════════════════════════════════════`);
  console.log(`📡 Server is ready to accept connections`);
  console.log(`   Internal address: http://0.0.0.0:${PORT}`);
  console.log(`   Public domain: https://websitecreator.kpanel.xyz`);
  console.log(`   Health check: https://websitecreator.kpanel.xyz/api/health`);
  console.log(`   Test endpoint: https://websitecreator.kpanel.xyz/test`);
  console.log(`═══════════════════════════════════════════════════════`);

  // Start the background diagnostics collector (persists logs + crash events)
  startDiagnosticsCollector();
});

// Log server errors
server.on('error', (err) => {
  console.error(`[${new Date().toISOString()}] Server error:`, err);
  if (err.code === 'EADDRINUSE') {
    console.error(`[${new Date().toISOString()}] Port ${PORT} is already in use!`);
  }
});

// Log connection events
server.on('connection', (socket) => {
  console.log(`[${new Date().toISOString()}] New connection from ${socket.remoteAddress}:${socket.remotePort}`);
  socket.on('close', () => {
    console.log(`[${new Date().toISOString()}] Connection closed: ${socket.remoteAddress}:${socket.remotePort}`);
  });
});
