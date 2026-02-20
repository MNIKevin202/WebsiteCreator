# Diagnose Why Auto-Deployment Stopped Working

Since it was working before, something external likely changed. Check these in order:

## Quick Diagnostic Checklist

### 1. Check GitHub Webhook Status
- Go to your GitHub repo → **Settings → Webhooks**
- Find your CapRover webhook
- **Is it still there?** If not, it was deleted - recreate it
- **Is it active?** Check if the "Active" checkbox is checked
- **Check Recent Deliveries**: Click on the webhook → "Recent Deliveries" tab
  - Do you see recent pushes? (even failed ones)
  - If you see ❌ red X's, click on them to see the error
  - If you see nothing recent, the webhook might not be receiving events

### 2. Check GitHub Token
- Your GitHub token might have expired or been revoked
- Go to GitHub → **Settings → Developer settings → Personal access tokens**
- Find your token and check:
  - ✅ Is it still active?
  - ✅ Does it have `repo` scope?
  - ✅ Has it expired? (tokens can expire)
- **Test**: Try manually deploying in CapRover (click "Save & Update")
  - If manual deploy works but auto-deploy doesn't → webhook issue
  - If manual deploy fails → token/credentials issue

### 3. Check CapRover Deployment Settings
- Go to CapRover → Your App → **App Configs → Deployment**
- Verify these settings are still correct:
  - ✅ Repository URL (hasn't changed)
  - ✅ Branch name (still matches your GitHub branch)
  - ✅ Username (still correct)
  - ✅ Password/Token (still set)
- **Try clicking "Save & Update"** to refresh the configuration

### 4. Check Branch Name
- **Common issue**: Branch renamed from `master` to `main` or vice versa
- Verify what branch you're pushing to: `git branch` or check GitHub
- Verify what branch CapRover is configured for
- They must match exactly (case-sensitive)

### 5. Check CapRover App Status
- Go to CapRover → Your App → **App Logs**
- Look for any error messages
- Check if the app is still active/running
- Look for deployment-related errors

### 6. Test Manual Deployment
- In CapRover → Your App → **Deployment** tab
- Click **"Save & Update"** or **"Deploy"** button
- Does it deploy successfully?
  - ✅ **Yes** → Webhook issue (auto-deploy broken, manual works)
  - ❌ **No** → Configuration issue (credentials, repo, etc.)

## Most Likely Causes (in order)

1. **GitHub webhook was deleted or disabled** (most common)
2. **GitHub token expired or was revoked**
3. **Branch name mismatch** (you're pushing to different branch)
4. **CapRover configuration was reset** (someone changed settings)
5. **GitHub repository was renamed or moved**

## Quick Fixes

### If Webhook is Missing:
1. Get webhook URL from CapRover → Deployment tab
2. Add it to GitHub → Settings → Webhooks
3. Test by pushing a commit

### If Token Expired:
1. Generate new GitHub token with `repo` scope
2. Update it in CapRover → Deployment tab
3. Save and test

### If Branch Mismatch:
1. Check what branch you're pushing to
2. Update CapRover → Deployment → Branch to match
3. Save and test

## Still Not Working?

Check CapRover system logs for webhook-related errors, or try recreating the webhook from scratch.
