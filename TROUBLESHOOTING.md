# CapRover 502 Error Troubleshooting Guide

## Common Causes of 502 Error

A 502 Bad Gateway error means NGINX (CapRover's reverse proxy) cannot connect to your application container.

## Solution Steps

### 1. Set Container HTTP Port in CapRover

**This is the most common fix!**

1. Go to your CapRover dashboard
2. Click on your app (`websitecreator`)
3. Go to the **"App Configs"** tab
4. Scroll down to **"HTTP Settings"**
5. Set **"Container HTTP Port"** to: `3117`
6. Click **"Save & Update"**

### 2. Check Application Logs

1. In CapRover dashboard, go to your app
2. Click on **"App Logs"** tab
3. Look for any errors or crashes
4. Common issues:
   - Missing environment variables
   - Application crashed on startup
   - Port binding issues

### 3. Verify Environment Variables

Make sure these are set in **"App Configs"** → **"Environment Variables"**:
- `GITHUB_TOKEN`
- `CAPROVER_URL`
- `CAPROVER_PASSWORD`
- `GITHUB_USERNAME` (optional)
- `GITHUB_PASSWORD` (optional)

### 4. Check if App is Running

1. Go to **"App Logs"** in CapRover
2. You should see: `Server running on port 3117`
3. If you see errors, check the logs for details

### 5. Restart the App

After setting the Container HTTP Port:
1. Go to **"App Configs"**
2. Click **"Save & Update"** (this restarts the app)
3. Wait for the deployment to complete
4. Check the logs to confirm it's running

### 6. Verify Port Binding

The application should be listening on `0.0.0.0:3117` (which it is configured to do).

## Quick Checklist

- [ ] Container HTTP Port is set to `3117` in CapRover
- [ ] Environment variables are configured
- [ ] App logs show "Server running on port 3117"
- [ ] No errors in the application logs
- [ ] App has been restarted after configuration changes

## Still Not Working?

If the issue persists:
1. Check CapRover's main logs: Dashboard → System Logs
2. Verify your domain DNS is pointing to CapRover
3. Try accessing the app via IP address to rule out DNS issues
4. Check if other apps on CapRover are working (to rule out server issues)
