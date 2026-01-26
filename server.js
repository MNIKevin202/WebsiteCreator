const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');

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

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'your-secret-key-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

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
const GITHUB_PASSWORD = process.env.GITHUB_PASSWORD; // Personal Access Token or password
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
    'Authorization': `token ${GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github.v3+json'
  }
});

// CapRover API helper
const caproverAPI = axios.create({
  baseURL: `${CAPROVER_URL.replace(/\/$/, '')}/api/v2`, // Remove trailing slash if present
  headers: {
    'x-namespace': 'captain'
  }
});

// Get CapRover auth token
async function getCapRoverAuthToken() {
  try {
    const response = await caproverAPI.post('/login', {
      password: CAPROVER_PASSWORD
    });
    return response.data.token;
  } catch (error) {
    throw new Error(`Failed to authenticate with CapRover: ${error.message}`);
  }
}

// Get all apps to find used ports
async function getUsedPorts(authToken) {
  try {
    const response = await caproverAPI.get('/user/apps/appDefinitions', {
      headers: {
        'x-captain-auth': authToken
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

// Find next available port
function findNextAvailablePort(usedPorts, startPort = 3000) {
  let port = startPort;
  while (usedPorts.has(port)) {
    port++;
  }
  return port;
}

// Create GitHub repository
async function createGitHubRepo(repoName, isPrivate = true) {
  try {
    const response = await githubAPI.post('/user/repos', {
      name: repoName,
      private: isPrivate,
      auto_init: true,
      description: `Auto-created by Website Creator`
    });
    return {
      success: true,
      repoUrl: response.data.html_url,
      cloneUrl: response.data.clone_url,
      repoName: response.data.name
    };
  } catch (error) {
    if (error.response) {
      throw new Error(`GitHub API error: ${error.response.data.message || error.message}`);
    }
    throw new Error(`Failed to create GitHub repo: ${error.message}`);
  }
}

// Create CapRover app
async function createCapRoverApp(appName, authToken) {
  try {
    const response = await caproverAPI.post('/user/apps/appDefinitions/register', {
      appName: appName
    }, {
      headers: {
        'x-captain-auth': authToken
      }
    });
    return { success: true, appName };
  } catch (error) {
    if (error.response) {
      throw new Error(`CapRover API error: ${error.response.data.description || error.message}`);
    }
    throw new Error(`Failed to create CapRover app: ${error.message}`);
  }
}

// Get app definition to merge with updates
async function getAppDefinition(appName, authToken) {
  try {
    const response = await caproverAPI.get('/user/apps/appDefinitions', {
      headers: {
        'x-captain-auth': authToken
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
    const response = await caproverAPI.post(`/user/apps/appDefinitions/update`, updatePayload, {
      headers: {
        'x-captain-auth': authToken
      }
    });
    
    return { success: true };
  } catch (error) {
    if (error.response) {
      const errorMsg = error.response.data?.description || error.response.data?.message || error.message;
      throw new Error(`CapRover API error: ${errorMsg}`);
    }
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
    const { projectName, branch = 'main' } = req.body;
    
    if (!projectName) {
      return res.status(400).json({ error: 'Project name is required' });
    }
    
    // Use GitHub credentials from environment variables
    if (!GITHUB_USERNAME || !GITHUB_PASSWORD) {
      return res.status(400).json({ error: 'GitHub credentials not configured. Please set GITHUB_USERNAME and GITHUB_PASSWORD environment variables.' });
    }
    
    const githubUsername = GITHUB_USERNAME;
    const githubPassword = GITHUB_PASSWORD;
    
    // Step 1: Create GitHub repository
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 1: Creating GitHub repository: ${projectName}`);
    const githubResult = await createGitHubRepo(projectName, true);
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 1: GitHub repo created: ${githubResult.repoUrl}`);
    
    // Step 2: Authenticate with CapRover
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 2: Authenticating with CapRover at ${CAPROVER_URL}...`);
    const authToken = await getCapRoverAuthToken();
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 2: CapRover authentication successful`);
    
    // Step 3: Get used ports and find available port
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 3: Finding available port...`);
    const usedPorts = await getUsedPorts(authToken);
    const availablePort = findNextAvailablePort(usedPorts);
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 3: Available port found: ${availablePort} (used ports: ${Array.from(usedPorts).join(', ') || 'none'})`);
    
    // Step 4: Create CapRover app
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 4: Creating CapRover app: ${projectName}`);
    await createCapRoverApp(projectName, authToken);
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 4: CapRover app created successfully`);
    
    // Step 5: Configure GitHub deployment and set container HTTP port
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 5: Configuring GitHub deployment and setting container HTTP port to ${availablePort}...`);
    await configureCapRoverApp(
      projectName,
      githubResult.cloneUrl,
      branch,
      githubUsername,
      githubPassword,
      availablePort,
      authToken
    );
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 5: Configuration completed successfully`);
    
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] ✅ All steps completed successfully!`);
    res.json({
      success: true,
      message: 'Website created successfully!',
      data: {
        githubRepo: githubResult.repoUrl,
        caproverApp: projectName,
        port: availablePort,
        branch: branch
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
  console.log(`   GITHUB_PASSWORD: ${GITHUB_PASSWORD ? '✅ Set' : '⚠️  Not set (optional)'}`);
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
