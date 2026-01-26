const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const {
  caproverLogin,
  caproverEnsureApp,
  caproverSetContainerHttpPort,
  caproverSetEnvVars,
  caproverGetEnvVars,
  caproverSetGitHubDeployment,
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
    const { projectName, branch = 'main' } = req.body;
    
    if (!projectName) {
      return res.status(400).json({ error: 'Project name is required' });
    }
    
    // Validate GitHub credentials (use token, not password)
    if (!GITHUB_TOKEN) {
      return res.status(400).json({ error: 'GitHub credentials not configured. Please set GITHUB_TOKEN environment variable.' });
    }
    
    if (!GITHUB_USERNAME) {
      return res.status(400).json({ error: 'GitHub username not configured. Please set GITHUB_USERNAME environment variable.' });
    }
    
    // Step 1: Create GitHub repository
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 1: Creating GitHub repository: ${projectName}`);
    const githubResult = await createGitHubRepo(projectName, true);
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 1: ✅ GitHub repo created: ${githubResult.repoUrl}`);
    
    // Step 2: Authenticate with CapRover ONCE
    const baseUrl = CAPROVER_URL.replace(/\/+$/, '');
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 2: Authenticating with CapRover at ${baseUrl}...`);
    const token = await caproverLogin(baseUrl, CAPROVER_PASSWORD);
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 2: ✅ CapRover authentication successful`);
    
    // Step 3: Determine port (standardize to 3000 for all Node apps)
    const containerPort = 3000; // Standard port for all apps
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 3: Using standard container port: ${containerPort}`);
    
    // Step 4: Ensure app exists (idempotent)
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 4: Ensuring CapRover app exists: ${projectName}`);
    const appResult = await caproverEnsureApp(baseUrl, token, projectName);
    if (appResult.created) {
      console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 4: ✅ CapRover app created`);
    } else {
      console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 4: ✅ CapRover app already exists, continuing`);
    }
    
    // Step 5: Set Container HTTP Port
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 5: Setting container HTTP port to ${containerPort}...`);
    await caproverSetContainerHttpPort(baseUrl, token, projectName, containerPort);
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 5: ✅ Container HTTP port set to ${containerPort}`);
    
    // Step 6: Set environment variables
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 6: Setting environment variables...`);
    const envVars = {
      PORT: String(containerPort),
      GITHUB_USERNAME: GITHUB_USERNAME,
      GITHUB_TOKEN: GITHUB_TOKEN,
      REPO_NAME: projectName,
      REPO_URL: githubResult.cloneUrl,
      REPO_BRANCH: branch
    };
    await caproverSetEnvVars(baseUrl, token, projectName, envVars);
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 6: ✅ Environment variables set`);
    
    // Step 7: Verify env vars were applied
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 7: Verifying environment variables...`);
    const envCheck = await caproverGetEnvVars(baseUrl, token, projectName);
    const envVarsData = envCheck?.data?.envVars || [];
    const envKeys = envVarsData.map(e => e.key);
    
    // Check that required vars exist
    const requiredKeys = ['PORT', 'GITHUB_TOKEN'];
    const missingKeys = requiredKeys.filter(key => !envKeys.includes(key));
    if (missingKeys.length > 0) {
      throw new Error(`Environment variables not properly set. Missing: ${missingKeys.join(', ')}. Found keys: ${envKeys.join(', ')}`);
    }
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 7: ✅ Environment variables verified (${envKeys.length} vars found)`);
    
    // Step 8: Configure GitHub deployment (optional)
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 8: Configuring GitHub deployment...`);
    await caproverSetGitHubDeployment(baseUrl, token, projectName, githubResult.cloneUrl, branch, GITHUB_TOKEN);
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] Step 8: ✅ GitHub deployment configured`);
    
    console.log(`[${new Date().toISOString()}] [REQUEST ${requestId}] ✅ All steps completed successfully!`);
    res.json({
      success: true,
      message: 'Website created successfully!',
      data: {
        githubRepo: githubResult.repoUrl,
        caproverApp: projectName,
        port: containerPort,
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
