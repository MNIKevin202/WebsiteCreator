# Message to send to Cursor AI:

I'm deploying a Node.js Express app to CapRover and getting 502 errors. Here's what worked for my other websites:

**Critical Configuration:**

1. **Server must listen on `0.0.0.0`** (not localhost):
   ```javascript
   app.listen(PORT, '0.0.0.0', () => {
     console.log(`Server running on port ${PORT}`);
   });
   ```

2. **CapRover HTTP Settings** - This is the most important step:
   - Go to CapRover Dashboard → Your App → HTTP Settings tab
   - Set "Container HTTP Port" to match your app's port (e.g., 3117)
   - Make sure "Do not expose as web-app externally" is UNCHECKED
   - Click "Save & Restart" (not just Save) - this is critical!

3. **Dockerfile** should expose the port:
   ```dockerfile
   EXPOSE 3117
   ```

4. **captain-definition** file:
   ```json
   {
     "schemaVersion": 2,
     "dockerfilePath": "./Dockerfile"
   }
   ```

**The #1 cause of 502 errors:** Container HTTP Port not set in CapRover HTTP Settings. Even if your server is running perfectly, CapRover's NGINX won't know which port to route to without this setting.

**Verification:**
- Server logs should show: "Listening on: 0.0.0.0:3117"
- CapRover HTTP Settings: Container HTTP Port = 3117
- App status should be "active" (not "inactive")
- After setting port, MUST click "Save & Restart"

Please help me configure this app the same way.
