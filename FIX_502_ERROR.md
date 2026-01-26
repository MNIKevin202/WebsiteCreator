# Fix 502 Bad Gateway Error - Step by Step Guide

## The Problem
Your app is running inside the container on port 3117, but CapRover's NGINX doesn't know which port to route traffic to. This causes a 502 Bad Gateway error.

## The Solution: Set Container HTTP Port

### Step-by-Step Instructions:

1. **Open CapRover Dashboard**
   - Go to `https://captain.yourdomain.com` (or your CapRover URL)
   - Log in with your admin password

2. **Navigate to Your App**
   - Click on the app name: `websitecreator`
   - You should see tabs: Overview, App Configs, App Logs, etc.

3. **Open App Configs Tab**
   - Click on **"App Configs"** tab at the top

4. **Find HTTP Settings**
   - Scroll down in the App Configs page
   - Look for a section called **"HTTP Settings"** or **"Port Configuration"**
   - You should see a field labeled **"Container HTTP Port"** or **"HTTP Port"**

5. **Set the Port**
   - In the **"Container HTTP Port"** field, enter: `3117`
   - This tells CapRover that your app listens on port 3117 inside the container

6. **Save and Update**
   - Click the **"Save & Update"** button (usually at the bottom)
   - CapRover will restart your app with the new configuration
   - Wait for the deployment to complete (check App Logs tab)

7. **Verify It Works**
   - Try accessing: `https://websitecreator.kpanel.xyz`
   - Or test the health endpoint: `https://websitecreator.kpanel.xyz/api/health`
   - You should see JSON response instead of 502 error

## Visual Guide

```
CapRover Dashboard
├── Apps
│   └── websitecreator
│       ├── Overview
│       ├── App Configs  ← CLICK HERE
│       │   └── HTTP Settings
│       │       └── Container HTTP Port: [3117] ← SET THIS
│       ├── App Logs
│       └── ...
```

## Alternative: Check Current Port Setting

If you're not sure where to find it:
1. In App Configs, look for any field related to "port" or "HTTP"
2. It might be under "Advanced Settings" or "Deployment Settings"
3. The field might be labeled as:
   - Container HTTP Port
   - HTTP Port
   - Port Mapping
   - Container Port

## Still Getting 502?

If you've set the port and still get 502:

1. **Check App Logs**
   - Go to "App Logs" tab in CapRover
   - Verify you see: "Server running on port 3117"
   - Look for any errors

2. **Verify Port Match**
   - The port in logs should match the Container HTTP Port setting
   - Both should be `3117`

3. **Restart the App**
   - After changing the port, make sure to click "Save & Update"
   - Wait for the app to fully restart (check logs)

4. **Check Domain Configuration**
   - Make sure your domain `websitecreator.kpanel.xyz` is properly configured
   - Verify DNS is pointing to your CapRover server

## Quick Test

After setting the port, test with:
```bash
curl https://websitecreator.kpanel.xyz/api/health
```

Should return:
```json
{
  "status": "ok",
  "port": 3117,
  "timestamp": "...",
  "env": {...}
}
```
