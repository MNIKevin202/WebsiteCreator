const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3117;

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// Configuration from environment variables
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const CAPROVER_URL = process.env.CAPROVER_URL; // e.g., https://captain.yourdomain.com
const CAPROVER_PASSWORD = process.env.CAPROVER_PASSWORD;
const GITHUB_USERNAME = process.env.GITHUB_USERNAME;
const GITHUB_PASSWORD = process.env.GITHUB_PASSWORD; // Personal Access Token or password

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
  baseURL: `${CAPROVER_URL}/api/v2`,
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

// Main endpoint to create everything
app.post('/api/create-website', async (req, res) => {
  try {
    const { projectName, branch = 'main', githubUsername, githubPassword } = req.body;
    
    if (!projectName) {
      return res.status(400).json({ error: 'Project name is required' });
    }
    
    if (!githubUsername || !githubPassword) {
      return res.status(400).json({ error: 'GitHub username and password/token are required' });
    }
    
    // Step 1: Create GitHub repository
    console.log(`Creating GitHub repository: ${projectName}`);
    const githubResult = await createGitHubRepo(projectName, true);
    
    // Step 2: Authenticate with CapRover
    console.log('Authenticating with CapRover...');
    const authToken = await getCapRoverAuthToken();
    
    // Step 3: Get used ports and find available port
    console.log('Finding available port...');
    const usedPorts = await getUsedPorts(authToken);
    const availablePort = findNextAvailablePort(usedPorts);
    
    // Step 4: Create CapRover app
    console.log(`Creating CapRover app: ${projectName}`);
    await createCapRoverApp(projectName, authToken);
    
    // Step 5: Configure GitHub deployment and set container HTTP port
    console.log(`Configuring GitHub deployment and setting container HTTP port to ${availablePort}...`);
    await configureCapRoverApp(
      projectName,
      githubResult.cloneUrl,
      branch,
      githubUsername,
      githubPassword,
      availablePort,
      authToken
    );
    
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
    console.error('Error creating website:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to create website'
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Make sure to set the following environment variables:`);
  console.log(`- GITHUB_TOKEN`);
  console.log(`- CAPROVER_URL`);
  console.log(`- CAPROVER_PASSWORD`);
  console.log(`- GITHUB_USERNAME (optional, can be provided in form)`);
  console.log(`- GITHUB_PASSWORD (optional, can be provided in form)`);
});
