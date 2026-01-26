# Website Creator - CapRover & GitHub Automation

A web application that automates the creation of GitHub repositories and CapRover apps, including automatic port assignment and GitHub deployment configuration.

## Features

- ✅ Automatically creates private GitHub repositories
- ✅ Creates CapRover apps with unique names
- ✅ Automatically assigns unused container HTTP ports
- ✅ Configures GitHub deployment settings (repo, branch, username, password)
- ✅ Beautiful, modern web interface

## Prerequisites

1. **GitHub Personal Access Token**
   - Go to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
   - Generate a new token with `repo` scope
   - Copy the token (starts with `ghp_`)

2. **CapRover Instance**
   - You need a running CapRover instance
   - Know your CapRover URL (e.g., `https://captain.yourdomain.com`)
   - Know your CapRover password

## Installation

1. Clone or download this repository

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

4. Edit `.env` and fill in your credentials:
```env
GITHUB_TOKEN=ghp_your_token_here
CAPROVER_URL=https://captain.yourdomain.com
CAPROVER_PASSWORD=your_caprover_password
GITHUB_USERNAME=your_github_username
GITHUB_PASSWORD=your_github_token_or_password
```

## Usage

1. Start the server:
```bash
npm start
```

For development with auto-reload:
```bash
npm run dev
```

2. Open your browser and navigate to `http://localhost:3117`

3. Fill in the form:
   - **Project Name**: The name for your project (will be used for both GitHub repo and CapRover app)
   - **Git Branch**: The branch to deploy (default: `main`)
   - **GitHub Username**: Your GitHub username
   - **GitHub Token/Password**: Your GitHub Personal Access Token or password

4. Click "Create Website" and wait for the magic to happen!

## How It Works

1. **Creates GitHub Repository**: Creates a private repository with the specified name
2. **Authenticates with CapRover**: Logs into your CapRover instance
3. **Finds Available Port**: Scans existing apps to find an unused container HTTP port
4. **Creates CapRover App**: Creates a new app with the project name
5. **Assigns Port**: Sets the container HTTP port to the available port
6. **Configures Deployment**: Sets up GitHub deployment with repo, branch, username, and password

## API Endpoints

### POST `/api/create-website`

Creates a new website (GitHub repo + CapRover app).

**Request Body:**
```json
{
  "projectName": "my-project",
  "branch": "main",
  "githubUsername": "username",
  "githubPassword": "token_or_password"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Website created successfully!",
  "data": {
    "githubRepo": "https://github.com/username/my-project",
    "caproverApp": "my-project",
    "port": 3000,
    "branch": "main"
  }
}
```

### GET `/api/health`

Health check endpoint.

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GITHUB_TOKEN` | GitHub Personal Access Token | Yes |
| `CAPROVER_URL` | Your CapRover instance URL | Yes |
| `CAPROVER_PASSWORD` | CapRover admin password | Yes |
| `GITHUB_USERNAME` | GitHub username (can also be provided in form) | Optional |
| `GITHUB_PASSWORD` | GitHub token/password (can also be provided in form) | Optional |
| `PORT` | Server port (default: 3117) | No |

## Security Notes

- Never commit your `.env` file to version control
- Use GitHub Personal Access Tokens instead of passwords when possible
- Keep your CapRover password secure
- Consider deploying this app behind authentication if exposed to the internet

## Troubleshooting

### "Failed to authenticate with CapRover"
- Check that `CAPROVER_URL` and `CAPROVER_PASSWORD` are correct
- Ensure your CapRover instance is accessible

### "Failed to create GitHub repo"
- Verify your `GITHUB_TOKEN` is valid and has `repo` scope
- Check that the project name doesn't already exist

### "Failed to set container HTTP port"
- Ensure you have admin access to CapRover
- Check that the app was created successfully

## License

MIT
