const axios = require('axios');

const safePreview = (val) => {
  if (!val) return null;
  const s = String(val);
  if (s.length <= 8) return '***';
  return s.slice(0, 4) + '...' + s.slice(-4);
};

async function caproverRequest({ baseUrl, path, method = 'GET', token = null, body = null }) {
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
    
    console.log('[CAPROVER]', method, path, 'ERROR status=', error.response?.status, 'body=', errorPreview);
    
    throw new Error(`CapRover ${method} ${path} failed: ${error.response?.status || 'network'} ${errorPreview}`);
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

// Set env vars
async function caproverSetEnvVars(baseUrl, token, appName, envObj) {
  const envVars = Object.entries(envObj).map(([key, value]) => ({
    key,
    value: String(value),
  }));

  return caproverRequest({
    baseUrl,
    token,
    path: '/api/v2/user/apps/appDefinitions/updateEnvVars',
    method: 'POST',
    body: {
      appName,
      envVars,
    },
  });
}

async function caproverGetEnvVars(baseUrl, token, appName) {
  return caproverRequest({
    baseUrl,
    token,
    path: '/api/v2/user/apps/appDefinitions/getEnvVars',
    method: 'POST',
    body: { appName },
  });
}

// Configure GitHub deployment
async function caproverSetGitHubDeployment(baseUrl, token, appName, repoUrl, branch, githubToken) {
  // Extract repo owner and name from URL
  const repoMatch = repoUrl.match(/github\.com[/:]([^/]+)\/([^/]+)(?:\.git)?$/);
  if (!repoMatch) {
    throw new Error('Invalid GitHub repository URL');
  }
  const repoOwner = repoMatch[1];
  const repoName = repoMatch[2].replace('.git', '');

  // Use update endpoint to set repoInfo
  return caproverRequest({
    baseUrl, token,
    path: '/api/v2/user/apps/appDefinitions/update',
    method: 'POST',
    body: {
      appName,
      repoInfo: {
        repo: `${repoOwner}/${repoName}`,
        branch: branch || 'main',
        user: repoOwner, // GitHub username
        password: githubToken, // Use token instead of password
        sshKey: ''
      }
    },
  });
}

module.exports = {
  caproverLogin,
  caproverEnsureApp,
  caproverSetContainerHttpPort,
  caproverSetEnvVars,
  caproverGetEnvVars,
  caproverSetGitHubDeployment,
};
