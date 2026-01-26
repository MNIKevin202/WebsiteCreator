# CapRover Node.js App Deployment Guide

## Problem
Getting 502 Bad Gateway errors when deploying a Node.js Express app to CapRover, even though the server logs show it's running correctly.

## Solution - Key Configuration Steps

### 1. Server Configuration (server.js)
Your Express server MUST:
- Listen on `0.0.0.0` (not `localhost` or `127.0.0.1`)
- Use the PORT environment variable or a specific port (e.g., 3117)
- Example:
```javascript
const PORT = process.env.PORT || 3117;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});
```

### 2. CapRover HTTP Settings (CRITICAL!)
In CapRover Dashboard → Your App → HTTP Settings:
- **Container HTTP Port**: Set this to match your app's port (e.g., `3117`)
- **Do not expose as web-app externally**: MUST be unchecked
- Click **"Save & Restart"** (not just Save) after making changes

### 3. Dockerfile Configuration
```dockerfile
FROM node:18-alpine
WORKDIR /usr/src/app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY . .
EXPOSE 3117  # Match your app port
CMD ["npm", "start"]
```

### 4. captain-definition File
```json
{
  "schemaVersion": 2,
  "dockerfilePath": "./Dockerfile"
}
```

### 5. Environment Variables
Set these in CapRover: App Configs → Environment Variables
- Your app's required environment variables
- `PORT` is optional (CapRover may set it automatically)

### 6. Common Issues & Fixes

**502 Error but server logs show it's running:**
- Container HTTP Port is NOT set or is wrong
- App status shows "inactive" - need to click "Save & Restart"
- Check that "Do not expose as web-app externally" is unchecked

**No requests reaching the server:**
- Container HTTP Port mismatch
- App not restarted after changing HTTP settings
- Domain not properly configured in CapRover

**Server binding issues:**
- Must use `0.0.0.0` not `localhost` or `127.0.0.1`
- Port must match Container HTTP Port setting

## Verification Steps

1. Check server logs show: "Listening on: 0.0.0.0:3117"
2. Verify Container HTTP Port = 3117 in CapRover HTTP Settings
3. App status should be "active" (not "inactive")
4. Test endpoint: `https://yourapp.yourdomain.com/api/health`
5. Check App Logs for incoming requests when accessing the site

## Key Takeaway
The most common cause of 502 errors is the **Container HTTP Port** not being set correctly in CapRover's HTTP Settings. This tells CapRover's NGINX which port inside the container is serving HTTP traffic.
