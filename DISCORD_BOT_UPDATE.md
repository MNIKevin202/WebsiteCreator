# Discord Bot Update - Timer Pause/Resume Fix

## Problem
When using `!resume`, the "Timer Paused" message doesn't disappear in browser sources (like OBS).

## Solution
Update your Discord bot's `server.js` file with the following code.

## Step 1: Find the `!resume` command handler

Look for this section in your bot's `server.js` file (around line 754-802):

```javascript
// Handle resume command: !resume
if (content === `${DISCORD_PREFIX}resume`) {
  // ... existing code ...
}
```

## Step 2: Replace it with this updated code:

```javascript
// Handle resume command: !resume
if (content === `${DISCORD_PREFIX}resume`) {
  if (!timerState.isPaused) {
    await message.reply('Timer is not paused.');
    return;
  }
  
  // Reset timer state first
  timerState.isPaused = false;
  const pauseReason = timerState.pauseReason;
  timerState.pauseReason = null;
  
  // Handle the pause message - edit it to show resumed status for browser sources
  if (timerState.pauseMessage) {
    try {
      // Edit the message to show it's been resumed (better for browser sources)
      await timerState.pauseMessage.edit('▶️ **Timer Resumed**\n~~Timer was paused~~');
      
      // Then try to delete it after a short delay
      setTimeout(async () => {
        try {
          await timerState.pauseMessage.delete();
        } catch (deleteErr) {
          // If deletion fails, that's okay - the edit already shows it's resumed
          // Browser sources will see the updated message content
          console.log('Pause message edited to show resumed status (deletion optional)');
        }
      }, 2000);
    } catch (editErr) {
      // If edit fails, try to delete instead
      try {
        await timerState.pauseMessage.delete();
      } catch (deleteErr) {
        // If both fail, send a new message to ensure browser sources see the update
        try {
          await message.channel.send('▶️ **Timer Resumed**');
        } catch (sendErr) {
          console.warn('Could not update pause message:', sendErr.message);
        }
      }
    }
    timerState.pauseMessage = null;
  } else {
    // If no pause message exists, send a resume message anyway
    await message.channel.send('▶️ **Timer Resumed**');
  }
  
  await message.reply('▶️ Timer resumed!');
}
```

## Step 3: Deploy the changes

After updating the code:

1. **If using GitHub + CapRover:**
   - Commit and push the changes to GitHub
   - CapRover will automatically redeploy the bot

2. **If running locally:**
   - Restart your bot (stop and start it again)

## How It Works

The updated code:
1. **Edits the pause message first** - This immediately updates the message content, which browser sources will see
2. **Then deletes it** - After 2 seconds, it tries to delete the message
3. **Has fallbacks** - If editing fails, it tries deletion, and if that fails, it sends a new message

This ensures browser sources (like OBS) always see the update because edited messages refresh immediately in browser sources, while deleted messages might be cached.
