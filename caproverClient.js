const axios = require('axios');

const safePreview = (val) => {
  if (!val) return null;
  const s = String(val);
  if (s.length <= 8) return '***';
  return s.slice(0, 4) + '...' + s.slice(-4);
};

async function caproverRequest({ baseUrl, path, method = 'GET', token = null, body = null, allow404 = false }) {
  const url = baseUrl.replace(/\/+$/, '') + path;
  const headers = { 'x-namespace': 'captain' };
  if (token) headers['x-captain-auth'] = token;
  if (body) headers['content-type'] = 'application/json;charset=UTF-8';

  try {
    const config = {
      method,
      url,
      headers,
      data: body || undefined,
    };

    const res = await axios(config);
    
    // Log response (mask secrets)
    const responseData = res.data;
    let responsePreview = '';
    if (typeof responseData === 'string') {
      responsePreview = responseData.length > 500 ? responseData.slice(0, 500) + '…' : responseData;
    } else {
      responsePreview = JSON.stringify(responseData).slice(0, 500);
    }
    
    console.log('[CAPROVER]', method, path, 'status=', res.status, 'body=', responsePreview);

    return responseData;
  } catch (error) {
    const errorData = error.response?.data || error.message;
    const errorPreview = typeof errorData === 'string' 
      ? (errorData.length > 500 ? errorData.slice(0, 500) + '…' : errorData)
      : JSON.stringify(errorData).slice(0, 500);
    
    const status = error.response?.status;
    
    console.log('[CAPROVER]', method, path, 'ERROR status=', status, 'body=', errorPreview);
    
    // If allow404 and status is 404, return special marker instead of throwing
    if (allow404 && status === 404) {
      return { __notFound: true, status: status, body: errorPreview };
    }
    
    throw new Error(`CapRover ${method} ${path} failed: ${status || 'network'} ${errorPreview}`);
  }
}

async function caproverLogin(baseUrl, password) {
  const json = await caproverRequest({
    baseUrl,
    path: '/api/v2/login',
    method: 'POST',
    body: { password },
  });

  const token = json?.data?.token;
  if (!token) throw new Error(`CapRover login returned no data.token. Keys: ${Object.keys(json || {})}`);

  console.log('[CAPROVER] token preview', safePreview(token), 'len=', String(token).length);
  return token;
}

async function caproverEnsureApp(baseUrl, token, appName) {
  // Register is idempotent-ish but may error if exists. We handle both.
  try {
    await caproverRequest({
      baseUrl,
      token,
      path: '/api/v2/user/apps/appDefinitions/register',
      method: 'POST',
      body: { appName, hasPersistentData: false },
    });
    return { created: true };
  } catch (e) {
    // If it already exists, continue. Detect by message text.
    const msg = String(e.message || '');
    if (msg.toLowerCase().includes('already exists') || msg.toLowerCase().includes('exists')) {
      console.log('[CAPROVER] app already exists, continuing:', appName);
      return { created: false, existed: true };
    }
    throw e;
  }
}

// Set Container HTTP Port
async function caproverSetContainerHttpPort(baseUrl, token, appName, containerPort) {
  // Endpoint used by dashboard is:
  // POST /api/v2/user/apps/appDefinitions/update
  // Body includes appName and instanceCount etc. BUT safest is to use the dedicated endpoint:
  // POST /api/v2/user/apps/appDefinitions/updateAppDefinition
  // Different CapRover versions vary. We'll attempt both.

  const portNum = Number(containerPort);
  if (!Number.isFinite(portNum)) throw new Error('containerPort must be a number');

  // Attempt 1: updateAppDefinition (newer)
  try {
    await caproverRequest({
      baseUrl, token,
      path: '/api/v2/user/apps/appDefinitions/updateAppDefinition',
      method: 'POST',
      body: { appName, containerHttpPort: portNum },
    });
    return { ok: true, method: 'updateAppDefinition' };
  } catch (e) {
    console.log('[CAPROVER] updateAppDefinition failed, trying fallback:', e.message);
  }

  // Attempt 2: update (older)
  await caproverRequest({
    baseUrl, token,
    path: '/api/v2/user/apps/appDefinitions/update',
    method: 'POST',
    body: { appName, containerHttpPort: portNum },
  });

  return { ok: true, method: 'update' };
}

// Set env vars with fallback probe for different CapRover versions
async function caproverSetEnvVars(baseUrl, token, appName, envObj) {
  const envVars = Object.entries(envObj).map(([key, value]) => ({
    key,
    value: String(value),
  }));

  // Known endpoint variants across CapRover versions
  const candidates = [
    '/api/v2/user/apps/appDefinitions/updateEnvVars',
    '/api/v2/user/apps/appDefinitions/updateAppEnvVars',
    '/api/v2/user/apps/appDefinitions/updateAppEnvVar',      // some forks
    '/api/v2/user/apps/appDefinitions/updateEnvVar',         // some forks
    '/api/v2/user/apps/appDefinitions/saveEnvVars',          // older naming sometimes
    '/api/v2/user/apps/appDefinitions/setEnvVars',           // older naming sometimes
    '/api/v2/user/apps/appDefinitions/update',               // last resort (may accept envVars)
  ];

  // Try each endpoint until one is not 404
  let lastErr = null;

  for (const path of candidates) {
    try {
      const body =
        path.endsWith('/update')
          ? { appName, envVars } // some versions might accept this in update
          : { appName, envVars };

      const result = await caproverRequest({
        baseUrl,
        token,
        path,
        method: 'POST',
        body,
        allow404: true,
      });

      if (result && result.__notFound) {
        continue; // try next endpoint
      }

      console.log('[CAPROVER] env vars updated using:', path);
      return { ok: true, usedEndpoint: path, result };
    } catch (e) {
      lastErr = e;
      // If it wasn't 404, stop: that's a real failure, not version mismatch
      if (!String(e.message).includes(' 404 ')) throw e;
    }
  }

  throw new Error(
    `Could not find a working CapRover env var endpoint. Tried: ${candidates.join(', ')}. Last error: ${lastErr?.message || 'unknown'}`
  );
}

async function caproverGetEnvVars(baseUrl, token, appName) {
  const candidates = [
    '/api/v2/user/apps/appDefinitions/getEnvVars',
    '/api/v2/user/apps/appDefinitions/getAppEnvVars',
    '/api/v2/user/apps/appDefinitions/envVars',
  ];

  for (const path of candidates) {
    try {
      const result = await caproverRequest({
        baseUrl,
        token,
        path,
        method: 'POST',
        body: { appName },
        allow404: true,
      });

      if (result && result.__notFound) continue;

      console.log('[CAPROVER] env vars fetched using:', path);
      return { ok: true, usedEndpoint: path, result };
    } catch (e) {
      // If it wasn't 404, stop: that's a real failure
      if (!String(e.message).includes(' 404 ')) throw e;
    }
  }

  return { ok: false, message: 'No env var getter endpoint found on this CapRover version' };
}

// List CapRover apps
async function caproverListApps(baseUrl, token) {
  const result = await caproverRequest({
    baseUrl,
    token,
    path: '/api/v2/user/apps/appDefinitions',
    method: 'GET',
  });
  
  // CapRover returns apps in result.data.appDefinitions
  const apps = result?.data?.appDefinitions || [];
  return apps.map(app => ({
    appName: app.appName,
    instanceCount: app.instanceCount,
    containerHttpPort: app.containerHttpPort,
    hasPersistentData: app.hasPersistentData,
    description: app.description
  }));
}

// Delete CapRover app
async function caproverDeleteApp(baseUrl, token, appName) {
  return caproverRequest({
    baseUrl,
    token,
    path: '/api/v2/user/apps/appDefinitions/delete',
    method: 'POST',
    body: { appName },
  });
}

// Set custom domains for an app
async function caproverSetCustomDomains(baseUrl, token, appName, domains) {
  // Domains should be an array of strings
  if (!Array.isArray(domains)) {
    throw new Error('domains must be an array');
  }

  console.log('[CAPROVER] Setting custom domains for app:', appName, 'domains:', domains);

  // First, get the current app definition to preserve other settings
  const getResult = await caproverRequest({
    baseUrl, token,
    path: '/api/v2/user/apps/appDefinitions',
    method: 'GET',
  });

  const apps = getResult?.data?.appDefinitions || [];
  const app = apps.find(a => a.appName === appName);
  
  if (!app) {
    throw new Error(`App ${appName} not found`);
  }

  // Merge new domains with existing domains (don't replace, add to existing)
  const existingDomains = app.customDomain || [];
  const allDomains = [...new Set([...existingDomains, ...domains])]; // Remove duplicates
  
  console.log('[CAPROVER] Existing domains:', existingDomains, 'New domains:', domains, 'Merged:', allDomains);

  // Merge custom domains with existing app definition
  const updatePayload = {
    appName: app.appName,
    instanceCount: app.instanceCount || 1,
    captainDefinitionRelativeFilePath: app.captainDefinitionRelativeFilePath || './captain-definition',
    notExposeAsWebApp: app.notExposeAsWebApp || false,
    hasPersistentData: app.hasPersistentData || false,
    description: app.description || `Auto-configured app: ${appName}`,
    volumes: app.volumes || [],
    ports: app.ports || [],
    preDeployFunction: app.preDeployFunction || '',
    customNginxConfig: app.customNginxConfig || '',
    customDomain: allDomains, // Merge with existing domains
    forceSsl: app.forceSsl || false,
    websocketSupport: app.websocketSupport || false,
    appDeployTokenConfig: app.appDeployTokenConfig || {
      enabled: false,
      appDeployToken: ''
    },
    // Preserve repoInfo if it exists
    repoInfo: app.repoInfo || undefined,
    // Preserve containerHttpPort if it exists
    containerHttpPort: app.containerHttpPort || undefined,
  };

  // Remove undefined fields
  Object.keys(updatePayload).forEach(key => {
    if (updatePayload[key] === undefined) {
      delete updatePayload[key];
    }
  });

  console.log('[CAPROVER] Updating app with payload (customDomain):', updatePayload.customDomain);

  // Use update endpoint to set customDomain along with other settings
  const result = await caproverRequest({
    baseUrl, token,
    path: '/api/v2/user/apps/appDefinitions/update',
    method: 'POST',
    body: updatePayload,
  });

  console.log('[CAPROVER] Custom domains update result:', JSON.stringify(result).slice(0, 500));

  // Check for CapRover error status codes (>= 1000 means error)
  if (result && typeof result === 'object' && result.status !== undefined) {
    if (result.status >= 1000) {
      const errorMsg = result.description || result.message || `CapRover API error (status: ${result.status})`;
      throw new Error(`Failed to set custom domains: ${errorMsg} (Status: ${result.status})`);
    }
  }

  return result;
}

// Configure GitHub deployment
async function caproverSetGitHubDeployment(baseUrl, token, appName, repoUrl, branch, githubToken, githubUsername, containerHttpPort) {
  // Extract repo owner and name from URL
  const repoMatch = repoUrl.match(/github\.com[/:]([^/]+)\/([^/]+)(?:\.git)?$/);
  if (!repoMatch) {
    throw new Error('Invalid GitHub repository URL');
  }
  const repoOwner = repoMatch[1];
  const repoName = repoMatch[2].replace('.git', '');

  console.log('[CAPROVER] Setting GitHub deployment for app:', appName, 'repo:', `${repoOwner}/${repoName}`, 'branch:', branch, 'user:', githubUsername);

  // Get the current app definition to preserve other settings
  const getResult = await caproverRequest({
    baseUrl, token,
    path: '/api/v2/user/apps/appDefinitions',
    method: 'GET',
  });

  const apps = getResult?.data?.appDefinitions || [];
  const app = apps.find(a => a.appName === appName);
  
  if (!app) {
    throw new Error(`App ${appName} not found`);
  }

  // Merge repoInfo with existing app definition
  const updatePayload = {
    appName: app.appName,
    instanceCount: app.instanceCount || 1,
    captainDefinitionRelativeFilePath: app.captainDefinitionRelativeFilePath || './captain-definition',
    notExposeAsWebApp: app.notExposeAsWebApp || false,
    hasPersistentData: app.hasPersistentData || false,
    description: app.description || `Auto-configured app: ${appName}`,
    volumes: app.volumes || [],
    ports: app.ports || [],
    preDeployFunction: app.preDeployFunction || '',
    customNginxConfig: app.customNginxConfig || '',
    customDomain: app.customDomain || [],
    forceSsl: app.forceSsl || false,
    websocketSupport: app.websocketSupport || false,
    appDeployTokenConfig: app.appDeployTokenConfig || {
      enabled: false,
      appDeployToken: ''
    },
    // Set repoInfo with GitHub username (not repo owner)
    repoInfo: {
      repo: `${repoOwner}/${repoName}`,
      branch: branch || 'main',
      user: githubUsername || repoOwner, // Use provided GitHub username
      password: githubToken, // Use token instead of password
      sshKey: ''
    },
    // Include containerHttpPort if provided (to ensure it's set)
    containerHttpPort: containerHttpPort || app.containerHttpPort || undefined,
  };

  // Remove undefined fields
  Object.keys(updatePayload).forEach(key => {
    if (updatePayload[key] === undefined) {
      delete updatePayload[key];
    }
  });

  console.log('[CAPROVER] Updating app with repoInfo:', updatePayload.repoInfo, 'containerHttpPort:', updatePayload.containerHttpPort);

  // Use update endpoint to set repoInfo along with other settings
  const result = await caproverRequest({
    baseUrl, token,
    path: '/api/v2/user/apps/appDefinitions/update',
    method: 'POST',
    body: updatePayload,
  });

  console.log('[CAPROVER] GitHub deployment update result:', JSON.stringify(result).slice(0, 500));

  // Check for CapRover error status codes (>= 1000 means error)
  if (result && typeof result === 'object' && result.status !== undefined) {
    if (result.status >= 1000) {
      const errorMsg = result.description || result.message || `CapRover API error (status: ${result.status})`;
      throw new Error(`Failed to set GitHub deployment: ${errorMsg} (Status: ${result.status})`);
    }
  }

  return result;
}

// Get app data including versions/images
async function caproverGetAppData(baseUrl, token, appName) {
  const result = await caproverRequest({
    baseUrl,
    token,
    path: `/api/v2/user/apps/appData/${appName}`,
    method: 'GET',
  });
  
  return result?.data || result || {};
}

// Delete old images/versions (keeps the N most recent)
async function caproverDeleteOldImages(baseUrl, token, appName, keepCount = 5) {
  try {
    // Get app data to find versions/images
    const appData = await caproverGetAppData(baseUrl, token, appName);
    
    // CapRover stores versions in different places depending on version
    // Try common patterns: versions, images, deployedVersion, etc.
    let versions = [];
    
    if (appData.versions && Array.isArray(appData.versions)) {
      versions = appData.versions;
    } else if (appData.images && Array.isArray(appData.images)) {
      versions = appData.images;
    } else if (appData.deployedVersion) {
      // Single version format
      versions = [appData.deployedVersion];
    }
    
    // Sort by timestamp if available, or keep as-is
    if (versions.length > 0 && versions[0].timeStamp) {
      versions.sort((a, b) => {
        const timeA = a.timeStamp || 0;
        const timeB = b.timeStamp || 0;
        return timeB - timeA; // Most recent first
      });
    }
    
    // Keep the N most recent
    const toKeep = versions.slice(0, keepCount);
    const toDelete = versions.slice(keepCount);
    
    if (toDelete.length === 0) {
      return { deleted: 0, kept: toKeep.length, message: 'No old images to delete' };
    }
    
    // Delete old versions
    // CapRover API: DELETE /api/v2/user/apps/appData/[appName] with version/image identifier
    let deletedCount = 0;
    const errors = [];
    
    for (const version of toDelete) {
      try {
        // Try different identifier fields
        const identifier = version.version || version.imageName || version.tag || version.id || version;
        
        if (!identifier) {
          console.warn('[CAPROVER] Skipping version with no identifier:', version);
          continue;
        }
        
        // Try DELETE endpoint - format may vary
        try {
          await caproverRequest({
            baseUrl,
            token,
            path: `/api/v2/user/apps/appData/${appName}`,
            method: 'DELETE',
            body: { version: String(identifier) },
            allow404: true,
          });
          deletedCount++;
        } catch (deleteError) {
          // Try alternative endpoint format
          try {
            await caproverRequest({
              baseUrl,
              token,
              path: `/api/v2/user/apps/appData/${appName}/${encodeURIComponent(String(identifier))}`,
              method: 'DELETE',
              allow404: true,
            });
            deletedCount++;
          } catch (altError) {
            errors.push(`Failed to delete version ${identifier}: ${altError.message}`);
          }
        }
      } catch (err) {
        errors.push(`Error processing version: ${err.message}`);
      }
    }
    
    if (errors.length > 0 && deletedCount === 0) {
      throw new Error(`Failed to delete images: ${errors.join('; ')}`);
    }
    
    return {
      deleted: deletedCount,
      kept: toKeep.length,
      total: versions.length,
      errors: errors.length > 0 ? errors : undefined
    };
  } catch (error) {
    console.error('[CAPROVER] Error deleting old images:', error);
    throw error;
  }
}

module.exports = {
  caproverLogin,
  caproverEnsureApp,
  caproverSetContainerHttpPort,
  caproverSetEnvVars,
  caproverGetEnvVars,
  caproverSetGitHubDeployment,
  caproverSetCustomDomains,
  caproverListApps,
  caproverDeleteApp,
  caproverGetAppData,
  caproverDeleteOldImages,
};
