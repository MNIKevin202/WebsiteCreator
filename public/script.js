// Check authentication status on page load
async function checkAuthStatus() {
    try {
        const response = await fetch('/api/auth-status', {
            credentials: 'include'
        });
        const data = await response.json();
        
        if (data.isAuthenticated) {
            showDashboard();
        } else {
            showLogin();
        }
    } catch (error) {
        console.error('Error checking auth status:', error);
        showLogin();
    }
}

function showLogin() {
    document.getElementById('loginCard').style.display = 'block';
    document.getElementById('dashboard').style.display = 'none';
}

function showDashboard() {
    document.getElementById('loginCard').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    showPage('create'); // Default to create page
}

function showPage(pageName) {
    // Hide all pages
    document.querySelectorAll('.page-content').forEach(page => {
        page.style.display = 'none';
    });
    
    // Remove active class from all nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    
    // Show selected page
    const pageElement = document.getElementById(`page-${pageName}`);
    if (pageElement) {
        pageElement.style.display = 'block';
    }
    
    // Add active class to selected nav button
    const navBtn = document.getElementById(`nav-${pageName}`);
    if (navBtn) {
        navBtn.classList.add('active');
    }
    
    // Load data if needed
    if (pageName === 'repos') {
        loadRepos();
    } else if (pageName === 'apps') {
        loadApps();
    }
}

// Load GitHub repositories
async function loadRepos() {
    const reposLoading = document.getElementById('reposLoading');
    const reposList = document.getElementById('reposList');
    const reposError = document.getElementById('reposError');
    const reposContent = document.getElementById('reposContent');
    const reposErrorContent = document.getElementById('reposErrorContent');
    
    reposLoading.style.display = 'block';
    reposList.style.display = 'none';
    reposError.style.display = 'none';
    
    try {
        const response = await fetch('/api/repos', {
            credentials: 'include'
        });
        
        if (response.status === 401) {
            showLogin();
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            reposLoading.style.display = 'none';
            
            if (data.repos && data.repos.length > 0) {
                reposContent.innerHTML = data.repos.map(repo => `
                    <div class="repo-item">
                        <div class="repo-item-info">
                            <div class="repo-item-name">${repo.name}</div>
                            <div class="repo-item-url">
                                <a href="${repo.html_url}" target="_blank">${repo.html_url}</a>
                            </div>
                        </div>
                        <button onclick="deleteRepo('${repo.name}')" class="btn-danger" id="delete-repo-${repo.name}">
                            Delete
                        </button>
                    </div>
                `).join('');
                reposList.style.display = 'block';
            } else {
                reposContent.innerHTML = '<div class="empty-state"><p>No repositories found.</p></div>';
                reposList.style.display = 'block';
            }
        } else {
            throw new Error(data.error || 'Failed to load repositories');
        }
    } catch (error) {
        reposLoading.style.display = 'none';
        reposErrorContent.textContent = error.message || 'Failed to load repositories';
        reposError.style.display = 'block';
    }
}

// Delete GitHub repository
async function deleteRepo(repoName) {
    if (!confirm(`Are you sure you want to delete the repository "${repoName}"? This action cannot be undone.`)) {
        return;
    }
    
    const deleteBtn = document.getElementById(`delete-repo-${repoName}`);
    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Deleting...';
    
    try {
        const response = await fetch(`/api/repos/${encodeURIComponent(repoName)}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        if (response.status === 401) {
            showLogin();
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            // Reload repos list
            loadRepos();
        } else {
            throw new Error(data.error || 'Failed to delete repository');
        }
    } catch (error) {
        alert(error.message || 'Failed to delete repository');
        deleteBtn.disabled = false;
        deleteBtn.textContent = 'Delete';
    }
}

// Load CapRover apps
async function loadApps() {
    const appsLoading = document.getElementById('appsLoading');
    const appsList = document.getElementById('appsList');
    const appsError = document.getElementById('appsError');
    const appsContent = document.getElementById('appsContent');
    const appsErrorContent = document.getElementById('appsErrorContent');
    
    appsLoading.style.display = 'block';
    appsList.style.display = 'none';
    appsError.style.display = 'none';
    
    try {
        const response = await fetch('/api/apps', {
            credentials: 'include'
        });
        
        if (response.status === 401) {
            showLogin();
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            appsLoading.style.display = 'none';
            
            if (data.apps && data.apps.length > 0) {
                appsContent.innerHTML = data.apps.map(app => `
                    <div class="app-item">
                        <div class="app-item-info">
                            <div class="app-item-name">${app.appName}</div>
                            <div class="app-item-url">
                                Port: ${app.containerHttpPort || 'N/A'} | 
                                Instances: ${app.instanceCount || 1}
                            </div>
                        </div>
                        <button onclick="deleteApp('${app.appName}')" class="btn-danger" id="delete-app-${app.appName}">
                            Delete
                        </button>
                    </div>
                `).join('');
                appsList.style.display = 'block';
            } else {
                appsContent.innerHTML = '<div class="empty-state"><p>No apps found.</p></div>';
                appsList.style.display = 'block';
            }
        } else {
            throw new Error(data.error || 'Failed to load apps');
        }
    } catch (error) {
        appsLoading.style.display = 'none';
        appsErrorContent.textContent = error.message || 'Failed to load apps';
        appsError.style.display = 'block';
    }
}

// Delete CapRover app
async function deleteApp(appName) {
    if (!confirm(`Are you sure you want to delete the CapRover app "${appName}"? This action cannot be undone.`)) {
        return;
    }
    
    const deleteBtn = document.getElementById(`delete-app-${appName}`);
    deleteBtn.disabled = true;
    deleteBtn.textContent = 'Deleting...';
    
    try {
        const response = await fetch(`/api/apps/${encodeURIComponent(appName)}`, {
            method: 'DELETE',
            credentials: 'include'
        });
        
        if (response.status === 401) {
            showLogin();
            return;
        }
        
        const data = await response.json();
        
        if (data.success) {
            // Reload apps list
            loadApps();
        } else {
            throw new Error(data.error || 'Failed to delete app');
        }
    } catch (error) {
        alert(error.message || 'Failed to delete app');
        deleteBtn.disabled = false;
        deleteBtn.textContent = 'Delete';
    }
}

// Login form elements
const loginCard = document.getElementById('loginCard');
const loginForm = document.getElementById('loginForm');
const loginBtn = document.getElementById('loginBtn');
const loginError = document.getElementById('loginError');
const loginErrorContent = document.getElementById('loginErrorContent');

// Login form submission
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    loginError.style.display = 'none';
    loginBtn.disabled = true;
    const btnText = loginBtn.querySelector('.btn-text');
    const btnLoader = loginBtn.querySelector('.btn-loader');
    btnText.style.display = 'none';
    btnLoader.style.display = 'inline-block';
    
    const formData = {
        username: document.getElementById('username').value.trim(),
        password: document.getElementById('password').value.trim()
    };
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            showDashboard();
            loginForm.reset();
        } else {
            throw new Error(data.error || 'Login failed');
        }
    } catch (error) {
        loginErrorContent.textContent = error.message || 'Login failed. Please try again.';
        loginError.style.display = 'block';
    } finally {
        loginBtn.disabled = false;
        btnText.style.display = 'inline-block';
        btnLoader.style.display = 'none';
    }
});

// Logout function
async function logout() {
    try {
        const response = await fetch('/api/logout', {
            method: 'POST',
            credentials: 'include'
        });
        
        const data = await response.json();
        
        if (data.success) {
            showLogin();
        }
    } catch (error) {
        console.error('Logout error:', error);
        // Still show login even if logout fails
        showLogin();
    }
}

// Dashboard form elements
const form = document.getElementById('createForm');
const submitBtn = document.getElementById('submitBtn');
const resultCard = document.getElementById('result');
const errorCard = document.getElementById('error');
const resultContent = document.getElementById('resultContent');
const errorContent = document.getElementById('errorContent');

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    // Hide previous results
    resultCard.style.display = 'none';
    errorCard.style.display = 'none';
    
    // Disable submit button and show loading
    submitBtn.disabled = true;
    const btnText = submitBtn.querySelector('.btn-text');
    const btnLoader = submitBtn.querySelector('.btn-loader');
    btnText.style.display = 'none';
    btnLoader.style.display = 'inline-block';
    
    // Get form data
    const formData = {
        projectName: document.getElementById('projectName').value.trim(),
        branch: document.getElementById('branch').value.trim() || 'main'
    };
    
    try {
        const response = await fetch('/api/create-website', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include',
            body: JSON.stringify(formData)
        });
        
        if (response.status === 401) {
            // Not authenticated, redirect to login
            showLogin();
            throw new Error('Session expired. Please login again.');
        }
        
        const data = await response.json();
        
        if (data.success) {
            // Show success result
            resultContent.innerHTML = `
                <div class="result-item">
                    <strong>GitHub Repo:</strong>
                    <a href="${data.data.githubRepo}" target="_blank">${data.data.githubRepo}</a>
                </div>
                <div class="result-item">
                    <strong>CapRover App:</strong>
                    <span>${data.data.caproverApp}</span>
                </div>
                <div class="result-item">
                    <strong>Container Port:</strong>
                    <span>${data.data.port}</span>
                </div>
                <div class="result-item">
                    <strong>Branch:</strong>
                    <span>${data.data.branch}</span>
                </div>
            `;
            resultCard.style.display = 'block';
            resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            throw new Error(data.error || 'Unknown error occurred');
        }
    } catch (error) {
        // Show error
        errorContent.textContent = error.message || 'Failed to create website. Please check your configuration.';
        errorCard.style.display = 'block';
        errorCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } finally {
        // Re-enable submit button
        submitBtn.disabled = false;
        btnText.style.display = 'inline-block';
        btnLoader.style.display = 'none';
    }
});

function resetForm() {
    form.reset();
    resultCard.style.display = 'none';
    errorCard.style.display = 'none';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Validate project name format
const projectNameInput = document.getElementById('projectName');
if (projectNameInput) {
    projectNameInput.addEventListener('input', (e) => {
        const value = e.target.value;
        const isValid = /^[a-z0-9-]+$/.test(value) || value === '';
        
        if (value && !isValid) {
            e.target.setCustomValidity('Only lowercase letters, numbers, and hyphens allowed');
        } else {
            e.target.setCustomValidity('');
        }
    });
}

// Check auth status on page load
checkAuthStatus();
