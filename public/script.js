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
    
    // Reset select all checkbox
    document.getElementById('selectAllRepos').checked = false;
    updateSelectedReposCount();
    
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
                        <div class="repo-item-checkbox">
                            <input type="checkbox" class="repo-checkbox" value="${repo.name}" onchange="updateSelectedReposCount()">
                            <div class="repo-item-info">
                                <div class="repo-item-name">${repo.name}</div>
                                <div class="repo-item-url">
                                    <a href="${repo.html_url}" target="_blank">${repo.html_url}</a>
                                </div>
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

// Toggle select all repos
function toggleSelectAllRepos() {
    const selectAll = document.getElementById('selectAllRepos').checked;
    const checkboxes = document.querySelectorAll('.repo-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = selectAll;
    });
    updateSelectedReposCount();
}

// Update selected repos count
function updateSelectedReposCount() {
    const checkboxes = document.querySelectorAll('.repo-checkbox');
    const selected = Array.from(checkboxes).filter(cb => cb.checked);
    const count = selected.length;
    document.getElementById('selectedReposCount').textContent = count;
    document.getElementById('bulkDeleteReposBtn').disabled = count === 0;
    
    // Update select all checkbox state
    const selectAll = document.getElementById('selectAllRepos');
    if (checkboxes.length === 0) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
    } else {
        selectAll.checked = count === checkboxes.length;
        selectAll.indeterminate = count > 0 && count < checkboxes.length;
    }
}

// Bulk delete repositories
async function bulkDeleteRepos() {
    const checkboxes = document.querySelectorAll('.repo-checkbox:checked');
    const selectedRepos = Array.from(checkboxes).map(cb => cb.value);
    
    if (selectedRepos.length === 0) {
        return;
    }
    
    showConfirmModal(
        'Confirm Bulk Delete',
        `Are you sure you want to delete ${selectedRepos.length} repository/repositories? This action cannot be undone.\n\nRepositories:\n${selectedRepos.join('\n')}`,
        () => performBulkDeleteRepos(selectedRepos),
        'Delete',
        'danger'
    );
    return;
}

async function performBulkDeleteRepos(selectedRepos) {
    
    const bulkDeleteBtn = document.getElementById('bulkDeleteReposBtn');
    bulkDeleteBtn.disabled = true;
    bulkDeleteBtn.textContent = `Deleting... (0/${selectedRepos.length})`;
    
    let successCount = 0;
    let failCount = 0;
    const errors = [];
    
    for (let i = 0; i < selectedRepos.length; i++) {
        const repoName = selectedRepos[i];
        bulkDeleteBtn.textContent = `Deleting... (${i + 1}/${selectedRepos.length})`;
        
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
                successCount++;
            } else {
                failCount++;
                errors.push(`${repoName}: ${data.error || 'Failed to delete'}`);
            }
        } catch (error) {
            failCount++;
            errors.push(`${repoName}: ${error.message || 'Failed to delete'}`);
        }
    }
    
    // Show results
    if (failCount > 0) {
        const errorMessage = `Deleted ${successCount} repository/repositories successfully.\n\nFailed to delete ${failCount}:\n${errors.join('\n')}`;
        showErrorModal('Bulk Delete Results', errorMessage);
    } else {
        showToast(`Successfully deleted ${successCount} repository/repositories!`, 'success');
    }
    
    // Reload repos list
    loadRepos();
}

// Delete GitHub repository
async function deleteRepo(repoName) {
    showConfirmModal(
        'Confirm Delete',
        `Are you sure you want to delete the repository "${repoName}"? This action cannot be undone.`,
        () => performDeleteRepo(repoName),
        'Delete',
        'danger'
    );
}

async function performDeleteRepo(repoName) {
    
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
            showToast(`Repository "${repoName}" deleted successfully`, 'success');
            // Reload repos list
            loadRepos();
        } else {
            throw new Error(data.error || 'Failed to delete repository');
        }
    } catch (error) {
        showToast(error.message || 'Failed to delete repository', 'error');
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
    
    // Reset select all checkbox
    document.getElementById('selectAllApps').checked = false;
    updateSelectedAppsCount();
    
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
                        <div class="app-item-checkbox">
                            <input type="checkbox" class="app-checkbox" value="${app.appName}" onchange="updateSelectedAppsCount()">
                            <div class="app-item-info">
                                <div class="app-item-name">${app.appName}</div>
                                <div class="app-item-url">
                                    Port: ${app.containerHttpPort || 'N/A'} | 
                                    Instances: ${app.instanceCount || 1}
                                </div>
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

// Toggle select all apps
function toggleSelectAllApps() {
    const selectAll = document.getElementById('selectAllApps').checked;
    const checkboxes = document.querySelectorAll('.app-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = selectAll;
    });
    updateSelectedAppsCount();
}

// Update selected apps count
function updateSelectedAppsCount() {
    const checkboxes = document.querySelectorAll('.app-checkbox');
    const selected = Array.from(checkboxes).filter(cb => cb.checked);
    const count = selected.length;
    document.getElementById('selectedAppsCount').textContent = count;
    document.getElementById('bulkDeleteAppsBtn').disabled = count === 0;
    
    // Update select all checkbox state
    const selectAll = document.getElementById('selectAllApps');
    if (checkboxes.length === 0) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
    } else {
        selectAll.checked = count === checkboxes.length;
        selectAll.indeterminate = count > 0 && count < checkboxes.length;
    }
}

// Bulk delete CapRover apps
async function bulkDeleteApps() {
    const checkboxes = document.querySelectorAll('.app-checkbox:checked');
    const selectedApps = Array.from(checkboxes).map(cb => cb.value);
    
    if (selectedApps.length === 0) {
        return;
    }
    
    showConfirmModal(
        'Confirm Bulk Delete',
        `Are you sure you want to delete ${selectedApps.length} app/apps? This action cannot be undone.\n\nApps:\n${selectedApps.join('\n')}`,
        () => performBulkDeleteApps(selectedApps),
        'Delete',
        'danger'
    );
    return;
}

async function performBulkDeleteApps(selectedApps) {
    
    const bulkDeleteBtn = document.getElementById('bulkDeleteAppsBtn');
    bulkDeleteBtn.disabled = true;
    bulkDeleteBtn.textContent = `Deleting... (0/${selectedApps.length})`;
    
    let successCount = 0;
    let failCount = 0;
    const errors = [];
    
    for (let i = 0; i < selectedApps.length; i++) {
        const appName = selectedApps[i];
        bulkDeleteBtn.textContent = `Deleting... (${i + 1}/${selectedApps.length})`;
        
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
                successCount++;
            } else {
                failCount++;
                errors.push(`${appName}: ${data.error || 'Failed to delete'}`);
            }
        } catch (error) {
            failCount++;
            errors.push(`${appName}: ${error.message || 'Failed to delete'}`);
        }
    }
    
    // Show results
    if (failCount > 0) {
        const errorMessage = `Deleted ${successCount} app/apps successfully.\n\nFailed to delete ${failCount}:\n${errors.join('\n')}`;
        showErrorModal('Bulk Delete Results', errorMessage);
    } else {
        showToast(`Successfully deleted ${successCount} app/apps!`, 'success');
    }
    
    // Reload apps list
    loadApps();
}

// Delete CapRover app
async function deleteApp(appName) {
    showConfirmModal(
        'Confirm Delete',
        `Are you sure you want to delete the CapRover app "${appName}"? This action cannot be undone.`,
        () => performDeleteApp(appName),
        'Delete',
        'danger'
    );
}

async function performDeleteApp(appName) {
    
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
            showToast(`App "${appName}" deleted successfully`, 'success');
            // Reload apps list
            loadApps();
        } else {
            throw new Error(data.error || 'Failed to delete app');
        }
    } catch (error) {
        showToast(error.message || 'Failed to delete app', 'error');
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
        branch: document.getElementById('branch').value.trim() || 'main',
        isDomain: document.getElementById('isDomain').checked,
        domain: document.getElementById('domain').value.trim() || null
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
            let resultHtml = `
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
            
            // Add DNS instructions if domain was provided
            if (formData.isDomain && formData.domain) {
                const hostingerUrl = `https://hpanel.hostinger.com/domain/${formData.domain}/dns?tab=dns_records`;
                resultHtml += `
                    <div class="result-item" style="flex-direction: column; align-items: flex-start; gap: 12px; margin-top: 16px; padding: 20px; background: var(--bg-secondary); border: 2px solid var(--primary-color);">
                        <strong style="color: var(--primary-color); font-size: 1.1rem;">🌐 DNS Configuration Required</strong>
                        <p style="margin: 0; color: var(--text-secondary);">
                            To complete the setup, you need to add an A record for your domain <strong>${escapeHtml(formData.domain)}</strong>:
                        </p>
                        <div style="background: var(--bg-color); padding: 12px; border-radius: 8px; width: 100%; font-family: monospace; font-size: 0.9rem;">
                            <div><strong>Type:</strong> A</div>
                            <div><strong>Name:</strong> @</div>
                            <div><strong>Points to:</strong> 46.202.178.170</div>
                            <div><strong>TTL:</strong> 60</div>
                        </div>
                        <a href="${hostingerUrl}" target="_blank" class="modal-link-btn" style="margin-top: 8px;">
                            Open Hostinger DNS Settings
                        </a>
                        <small style="color: var(--text-muted); margin-top: 8px;">
                            Click the button above to open your Hostinger DNS management page. Add a new A record with the values shown above.
                        </small>
                    </div>
                `;
            }
            
            resultContent.innerHTML = resultHtml;
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
    document.getElementById('isDomain').checked = false;
    toggleDomainField();
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

// Error Modal Functions
function showErrorModal(title, message) {
    const modal = document.getElementById('errorModal');
    const modalTitle = document.getElementById('errorModalTitle');
    const modalMessage = document.getElementById('errorModalMessage');
    const modalLinks = document.getElementById('errorModalLinks');
    
    modalTitle.textContent = title || 'Error';
    
    // Extract URLs from message
    const urlRegex = /(https?:\/\/[^\s\)]+)/g;
    const urls = message.match(urlRegex) || [];
    
    // Format message - if it's a string with newlines, preserve them
    let formattedMessage = typeof message === 'string' ? message : JSON.stringify(message, null, 2);
    
    // Replace URLs with placeholders to avoid double rendering
    const urlPlaceholders = [];
    urls.forEach((url, index) => {
        const placeholder = `__URL_PLACEHOLDER_${index}__`;
        urlPlaceholders.push({ placeholder, url });
        formattedMessage = formattedMessage.replace(url, placeholder);
    });
    
    modalMessage.innerHTML = `<pre>${escapeHtml(formattedMessage)}</pre>`;
    
    // Create link buttons for URLs
    if (urls.length > 0) {
        modalLinks.innerHTML = '';
        urls.forEach((url, index) => {
            // Create a friendly label for common URLs
            let label = url;
            if (url.includes('github.com/settings/tokens')) {
                label = 'Open GitHub Token Settings';
            } else if (url.includes('github.com')) {
                label = 'Open GitHub';
            } else {
                // Extract domain for display
                try {
                    const urlObj = new URL(url);
                    label = `Open ${urlObj.hostname}`;
                } catch (e) {
                    label = 'Open Link';
                }
            }
            
            const linkBtn = document.createElement('a');
            linkBtn.href = url;
            linkBtn.target = '_blank';
            linkBtn.rel = 'noopener noreferrer';
            linkBtn.className = 'modal-link-btn';
            linkBtn.textContent = label;
            modalLinks.appendChild(linkBtn);
        });
        modalLinks.style.display = 'flex';
    } else {
        modalLinks.style.display = 'none';
        modalLinks.innerHTML = '';
    }
    
    modal.classList.add('show');
    modal.style.display = 'flex';
}

function closeErrorModal() {
    const modal = document.getElementById('errorModal');
    modal.classList.remove('show');
    setTimeout(() => {
        modal.style.display = 'none';
    }, 200);
}

function copyErrorToClipboard() {
    const modalMessage = document.getElementById('errorModalMessage');
    const text = modalMessage.textContent || modalMessage.innerText;
    
    navigator.clipboard.writeText(text).then(() => {
        const copyBtn = event.target;
        const originalText = copyBtn.textContent;
        copyBtn.textContent = '✓ Copied!';
        copyBtn.style.background = 'var(--success-color)';
        
        setTimeout(() => {
            copyBtn.textContent = originalText;
            copyBtn.style.background = '';
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy:', err);
        showToast('Failed to copy to clipboard', 'error');
    });
}

// Confirmation Modal Functions
let confirmModalCallback = null;

function showConfirmModal(title, message, callback, confirmText = 'Confirm', confirmType = 'danger') {
    const modal = document.getElementById('confirmModal');
    const modalTitle = document.getElementById('confirmModalTitle');
    const modalMessage = document.getElementById('confirmModalMessage');
    const confirmBtn = document.getElementById('confirmModalOkBtn');
    
    modalTitle.textContent = title || 'Confirm';
    modalMessage.textContent = message;
    confirmBtn.textContent = confirmText;
    
    // Set button style based on type
    confirmBtn.className = confirmType === 'danger' ? 'btn-danger' : 'btn-primary';
    confirmBtn.style.width = 'auto';
    
    confirmModalCallback = callback;
    
    modal.classList.add('show');
    modal.style.display = 'flex';
}

function closeConfirmModal() {
    const modal = document.getElementById('confirmModal');
    modal.classList.remove('show');
    setTimeout(() => {
        modal.style.display = 'none';
        confirmModalCallback = null;
    }, 200);
}

function confirmModalAction() {
    if (confirmModalCallback) {
        confirmModalCallback();
    }
    closeConfirmModal();
}

// Toast Notification Functions
function showToast(message, type = 'info', duration = 5000) {
    const container = document.getElementById('toastContainer');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    const icons = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-content">${escapeHtml(message)}</span>
        <button class="toast-close" onclick="this.parentElement.remove()">&times;</button>
    `;
    
    container.appendChild(toast);
    
    // Auto remove after duration
    setTimeout(() => {
        toast.classList.add('hiding');
        setTimeout(() => {
            if (toast.parentElement) {
                toast.remove();
            }
        }, 300);
    }, duration);
}

// Close modal when clicking outside
window.onclick = function(event) {
    const errorModal = document.getElementById('errorModal');
    const confirmModal = document.getElementById('confirmModal');
    
    if (event.target === errorModal) {
        closeErrorModal();
    }
    if (event.target === confirmModal) {
        closeConfirmModal();
    }
}

// Close modal with Escape key
document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape') {
        closeErrorModal();
        closeConfirmModal();
    }
});
