# GitHub Auto-Deployment Troubleshooting Guide

## Problem: CapRover Not Auto-Deploying After GitHub Push

When you push to GitHub, CapRover should automatically detect the change and redeploy your app. If it's not working, follow these steps:

## Step 1: Verify CapRover Deployment Configuration

1. **Go to CapRover Dashboard** → Your App → **App Configs** → **Deployment** tab
2. **Check these settings:**
   - ✅ Repository URL: Should be `https://github.com/[owner]/[repo]` or `git@github.com:[owner]/[repo].git`
   - ✅ Branch: Should match the branch you're pushing to (usually `main` or `master`)
   - ✅ Username: Your GitHub username
   - ✅ Password/Token: Your GitHub personal access token (starts with `ghp_`)
3. **Click "Save & Update"** to ensure settings are saved

## Step 2: Set Up GitHub Webhook (CRITICAL!)

CapRover needs a webhook from GitHub to know when you push code. Without this, auto-deployment won't work.

### Option A: Use CapRover's Webhook URL (Recommended)

1. **In CapRover Dashboard** → Your App → **Deployment** tab
2. Look for a section that says **"Webhook URL"** or **"Deploy Hook"**
3. Copy the webhook URL (it should look like: `https://captain.yourdomain.com/api/v2/user/apps/appData/[app-name]`)
4. **Go to your GitHub repository** → **Settings** → **Webhooks** → **Add webhook**
5. **Paste the webhook URL**
6. **Content type**: `application/json`
7. **Events**: Select "Just the push event" (or "Let me select individual events" and check "Pushes")
8. **Active**: ✅ Checked
9. **Click "Add webhook"**

### Option B: Manual Webhook Setup

If CapRover doesn't show a webhook URL, create one manually:

1. **Webhook URL**: `https://[your-caprover-url]/api/v2/user/apps/appData/[your-app-name]`
   - Replace `[your-caprover-url]` with your CapRover domain (e.g., `captain.kpanel.xyz`)
   - Replace `[your-app-name]` with your app name
2. **Content type**: `application/json`
3. **Secret**: Leave empty (unless CapRover requires it)
4. **Events**: Select "Just the push event"
5. **Active**: ✅ Checked

## Step 3: Test the Webhook

1. **Make a small change** to your code (add a comment, update README, etc.)
2. **Commit and push** to GitHub:
   ```bash
   git add .
   git commit -m "Test deployment"
   git push origin main
   ```
3. **Check GitHub Webhook Delivery**:
   - Go to GitHub repo → **Settings** → **Webhooks**
   - Click on your webhook
   - Check "Recent Deliveries" tab
   - You should see a green checkmark ✅ for successful deliveries
   - If you see ❌ red X, click on it to see the error

## Step 4: Check CapRover Logs

1. **Go to CapRover Dashboard** → Your App → **App Logs** tab
2. **Look for deployment activity** after pushing to GitHub
3. You should see messages like:
   - "Building image..."
   - "Deploying..."
   - "Deployment successful"

## Step 5: Manual Trigger (If Webhook Fails)

If auto-deployment isn't working, you can manually trigger a deployment:

1. **In CapRover Dashboard** → Your App → **Deployment** tab
2. **Click "Save & Update"** or **"Deploy"** button
3. This will pull the latest code from GitHub and redeploy

## Common Issues & Fixes

### ❌ Issue: Webhook returns 404
**Fix**: Check that your webhook URL is correct. The format should be:
```
https://[caprover-url]/api/v2/user/apps/appData/[app-name]
```

### ❌ Issue: Webhook returns 401 Unauthorized
**Fix**: 
- Check your CapRover password is correct
- The webhook might need authentication - check CapRover docs for webhook authentication

### ❌ Issue: Webhook delivers but nothing happens
**Fix**:
- Check that the branch name matches exactly (case-sensitive)
- Verify GitHub token has `repo` scope
- Check CapRover app logs for errors

### ❌ Issue: "Repository not found" error
**Fix**:
- Verify GitHub token has access to the repository
- Check repository URL is correct in CapRover
- Ensure token has `repo` scope

### ❌ Issue: Branch mismatch
**Fix**:
- Make sure you're pushing to the branch configured in CapRover
- Default branch is usually `main` (not `master`)

## Quick Checklist

- [ ] CapRover deployment tab shows correct repo URL
- [ ] Branch name matches your GitHub branch
- [ ] GitHub username is correct
- [ ] GitHub token is valid and has `repo` scope
- [ ] GitHub webhook is configured and active
- [ ] Webhook URL points to correct CapRover endpoint
- [ ] Webhook shows successful deliveries in GitHub
- [ ] CapRover app logs show deployment activity

## Still Not Working?

1. **Try manual deployment** first (click "Save & Update" in CapRover)
2. **Check CapRover system logs** for errors
3. **Verify GitHub token** hasn't expired
4. **Test webhook** by clicking "Redeliver" in GitHub webhook settings
5. **Check CapRover version** - older versions might have different webhook requirements
