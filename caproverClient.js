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

// Get the full raw app definition for a single app (includes appPushWebhookToken, repoInfo, etc.)
async function caproverGetAppDefinition(baseUrl, token, appName) {
  const result = await caproverRequest({
    baseUrl,
    token,
    path: '/api/v2/user/apps/appDefinitions',
    method: 'GET',
  });

  const apps = result?.data?.appDefinitions || [];
  const app = apps.find(a => a.appName === appName);
  return app || null;
}

// Force a build/deploy from the app's configured git repo (the CapRover "Force Build" action).
// Uses the per-app push webhook token with an empty POST to the triggerbuild webhook.
async function caproverForceBuild(baseUrl, token, appName) {
  const app = await caproverGetAppDefinition(baseUrl, token, appName);
  if (!app) {
    throw new Error(`App "${appName}" not found on CapRover`);
  }

  // CapRover stores the signed webhook JWT at appPushWebhook.pushWebhookToken (this is exactly
  // what the dashboard's "Force Build" button uses). It only exists once the app has git
  // deployment configured (repo/branch saved).
  const webhookToken = app.appPushWebhook && app.appPushWebhook.pushWebhookToken;

  if (!webhookToken) {
    throw new Error(`No webhook token for "${appName}". This app has no GitHub deployment configured — open it in CapRover → Deployment tab, enter the repo/branch and save, then try again.`);
  }

  // The triggerbuild webhook authorizes via the ?token= query param and needs NO x-captain-auth
  // header and NO body (an empty POST = "no branch detected" = unconditional rebuild).
  const path = `/api/v2/user/apps/webhooks/triggerbuild?namespace=captain&token=${encodeURIComponent(webhookToken)}`;
  await caproverRequest({
    baseUrl,
    token: null,
    path,
    method: 'POST',
  });

  console.log('[CAPROVER] force build triggered for app:', appName);
  return { ok: true };
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

// Get image count for an app
async function caproverGetImageCount(baseUrl, token, appName) {
  try {
    // Try to get versions from appData first
    const appData = await caproverGetAppData(baseUrl, token, appName);
    
    // Debug: log what we got from appData
    console.log(`[CAPROVER] appData keys for ${appName}:`, Object.keys(appData || {}));
    
    let versions = [];
    
    if (appData.versions && Array.isArray(appData.versions)) {
      versions = appData.versions;
      console.log(`[CAPROVER] Found ${versions.length} versions in appData.versions`);
    } else if (appData.images && Array.isArray(appData.images)) {
      versions = appData.images;
      console.log(`[CAPROVER] Found ${versions.length} images in appData.images`);
    } else if (appData.deployedVersion) {
      versions = [appData.deployedVersion];
      console.log(`[CAPROVER] Found deployedVersion in appData`);
    }
    
    // If we found versions in appData, return count
    if (versions.length > 0) {
      return versions.length;
    }
    
    // Try querying Docker images via CapRover's Docker API proxy
    // CapRover stores images with pattern: captain-<appName>-<timestamp>
    try {
      // Try CapRover's Docker images endpoint (if available)
      const dockerResponse = await caproverRequest({
        baseUrl,
        token,
        path: '/api/v2/user/system/docker/images',
        method: 'GET',
        allow404: true,
      });
      
      if (dockerResponse && dockerResponse.data && Array.isArray(dockerResponse.data)) {
        // Filter images that belong to this app
        // CapRover images are typically tagged as: captain-<appName>-<timestamp>
        const appImages = dockerResponse.data.filter(img => {
          if (!img.RepoTags || !Array.isArray(img.RepoTags)) return false;
          return img.RepoTags.some(tag => 
            tag.includes(`captain-${appName}-`) || 
            tag.includes(`captain-${appName}:`) ||
            tag === `captain-${appName}`
          );
        });
        console.log(`[CAPROVER] Found ${appImages.length} Docker images for ${appName}`);
        return appImages.length;
      }
    } catch (dockerError) {
      // Docker API might not be available, that's okay
      console.log(`[CAPROVER] Docker API not available for image count: ${dockerError.message}`);
    }
    
    // Try alternative: query app definition which might have image info
    try {
      const appDefResponse = await caproverRequest({
        baseUrl,
        token,
        path: `/api/v2/user/apps/appDefinitions/${appName}`,
        method: 'GET',
        allow404: true,
      });
      
      if (appDefResponse && appDefResponse.data) {
        const appDef = appDefResponse.data;
        console.log(`[CAPROVER] appDefinition keys for ${appName}:`, Object.keys(appDef || {}));
        
        // Check if app definition has image/version info
        if (appDef.versions && Array.isArray(appDef.versions)) {
          console.log(`[CAPROVER] Found ${appDef.versions.length} versions in appDefinition`);
          return appDef.versions.length;
        }
        if (appDef.imageName) {
          // If there's an imageName, assume at least 1 image exists
          console.log(`[CAPROVER] Found imageName in appDefinition, assuming 1 image`);
          return 1;
        }
      }
    } catch (appDefError) {
      // App definition endpoint might not exist or have version info
      console.log(`[CAPROVER] App definition endpoint not available: ${appDefError.message}`);
    }
    
    // If app exists and is deployed, assume at least 1 image exists
    // This is a fallback - if the app is running, it must have at least one image
    console.log(`[CAPROVER] Could not determine image count for ${appName}, returning 0`);
    return 0;
  } catch (error) {
    console.warn(`[CAPROVER] Could not get image count for ${appName}:`, error.message);
    return 0; // Return 0 if we can't determine
  }
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
  caproverGetAppDefinition,
  caproverForceBuild,
  caproverGetAppData,
  caproverGetImageCount,
  caproverDeleteOldImages,
};
