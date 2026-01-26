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
    if (pageName === 'manage') {
        loadManage();
    }
}

// Load and match repositories with apps
async function loadManage() {
    const manageLoading = document.getElementById('manageLoading');
    const manageList = document.getElementById('manageList');
    const manageError = document.getElementById('manageError');
    const manageContent = document.getElementById('manageContent');
    const manageErrorContent = document.getElementById('manageErrorContent');
    
    manageLoading.style.display = 'block';
    manageList.style.display = 'none';
    manageError.style.display = 'none';
    
    // Reset select all checkbox
    document.getElementById('selectAllManage').checked = false;
    updateSelectedManageCount();
    
    try {
        // Load both repos and apps in parallel
        const [reposResponse, appsResponse] = await Promise.all([
            fetch('/api/repos', { credentials: 'include' }),
            fetch('/api/apps', { credentials: 'include' })
        ]);
        
        if (reposResponse.status === 401 || appsResponse.status === 401) {
            showLogin();
            return;
        }
        
        const reposData = await reposResponse.json();
        const appsData = await appsResponse.json();
        
        if (!reposData.success || !appsData.success) {
            throw new Error(reposData.error || appsData.error || 'Failed to load data');
        }
        
        manageLoading.style.display = 'none';
        
        const repos = reposData.repos || [];
        const apps = appsData.apps || [];
        
        // Create a map of apps by name for quick lookup
        const appsMap = {};
        apps.forEach(app => {
            appsMap[app.appName] = app;
        });
        
        // Match repos with apps and create combined list
        const matched = [];
        const unmatchedRepos = [];
        const unmatchedApps = [];
        
        repos.forEach(repo => {
            const app = appsMap[repo.name];
            if (app) {
                matched.push({ repo, app, name: repo.name });
                delete appsMap[repo.name];
            } else {
                unmatchedRepos.push(repo);
            }
        });
        
        // Add unmatched apps
        Object.values(appsMap).forEach(app => {
            unmatchedApps.push(app);
        });
        
        // Sort matched by name
        matched.sort((a, b) => a.name.localeCompare(b.name));
        
        if (matched.length === 0 && unmatchedRepos.length === 0 && unmatchedApps.length === 0) {
            manageContent.innerHTML = '<div class="empty-state"><p>No repositories or apps found.</p></div>';
            manageList.style.display = 'block';
            return;
        }
        
        let html = '';
        
        // Render matched pairs side by side
        matched.forEach(({ repo, app, name }) => {
            html += `
                <div class="manage-item">
                    <div class="manage-repo">
                        <div class="manage-repo-header">
                            <div class="manage-checkbox-wrapper">
                                <input type="checkbox" class="repo-checkbox" value="${repo.name}" onchange="updateSelectedManageCount()">
                                <span class="manage-repo-name">${escapeHtml(repo.name)}</span>
                            </div>
                            <button onclick="deleteRepo('${repo.name}')" class="btn-danger" id="delete-repo-${repo.name}" style="width: auto; padding: 6px 12px; font-size: 0.85rem;">
                                Delete
                            </button>
                        </div>
                        <div class="manage-repo-url">
                            <a href="${repo.html_url}" target="_blank">${repo.html_url}</a>
                        </div>
                    </div>
                    <div class="manage-app">
                        <div class="manage-app-header">
                            <div class="manage-checkbox-wrapper">
                                <input type="checkbox" class="app-checkbox" value="${app.appName}" onchange="updateSelectedManageCount()">
                                <span class="manage-app-name">${escapeHtml(app.appName)}</span>
                            </div>
                            <button onclick="deleteApp('${app.appName}')" class="btn-danger" id="delete-app-${app.appName}" style="width: auto; padding: 6px 12px; font-size: 0.85rem;">
                                Delete
                            </button>
                        </div>
                        <div class="manage-app-info">
                            Port: ${app.containerHttpPort || 'N/A'} | Instances: ${app.instanceCount || 1}
                        </div>
                    </div>
                </div>
            `;
        });
        
        // Render unmatched repos (full width)
        unmatchedRepos.forEach(repo => {
            html += `
                <div class="manage-item manage-item-single">
                    <div class="manage-repo">
                        <div class="manage-repo-header">
                            <div class="manage-checkbox-wrapper">
                                <input type="checkbox" class="repo-checkbox" value="${repo.name}" onchange="updateSelectedManageCount()">
                                <span class="manage-repo-name">${escapeHtml(repo.name)}</span>
                            </div>
                            <button onclick="deleteRepo('${repo.name}')" class="btn-danger" id="delete-repo-${repo.name}" style="width: auto; padding: 6px 12px; font-size: 0.85rem;">
                                Delete
                            </button>
                        </div>
                        <div class="manage-repo-url">
                            <a href="${repo.html_url}" target="_blank">${repo.html_url}</a>
                        </div>
                    </div>
                </div>
            `;
        });
        
        // Render unmatched apps (full width)
        unmatchedApps.forEach(app => {
            html += `
                <div class="manage-item manage-item-single">
                    <div class="manage-app">
                        <div class="manage-app-header">
                            <div class="manage-checkbox-wrapper">
                                <input type="checkbox" class="app-checkbox" value="${app.appName}" onchange="updateSelectedManageCount()">
                                <span class="manage-app-name">${escapeHtml(app.appName)}</span>
                            </div>
                            <button onclick="deleteApp('${app.appName}')" class="btn-danger" id="delete-app-${app.appName}" style="width: auto; padding: 6px 12px; font-size: 0.85rem;">
                                Delete
                            </button>
                        </div>
                        <div class="manage-app-info">
                            Port: ${app.containerHttpPort || 'N/A'} | Instances: ${app.instanceCount || 1}
                        </div>
                    </div>
                </div>
            `;
        });
        
        manageContent.innerHTML = html;
        manageList.style.display = 'block';
        
    } catch (error) {
        manageLoading.style.display = 'none';
        manageErrorContent.textContent = error.message || 'Failed to load repositories and apps';
        manageError.style.display = 'block';
    }
}

// Toggle select all for manage page
function toggleSelectAllManage() {
    const selectAll = document.getElementById('selectAllManage').checked;
    const repoCheckboxes = document.querySelectorAll('.repo-checkbox');
    const appCheckboxes = document.querySelectorAll('.app-checkbox');
    
    [...repoCheckboxes, ...appCheckboxes].forEach(checkbox => {
        checkbox.checked = selectAll;
    });
    updateSelectedManageCount();
}

// Update selected count for manage page
function updateSelectedManageCount() {
    const repoCheckboxes = document.querySelectorAll('.repo-checkbox');
    const appCheckboxes = document.querySelectorAll('.app-checkbox');
    
    const selectedRepos = Array.from(repoCheckboxes).filter(cb => cb.checked);
    const selectedApps = Array.from(appCheckboxes).filter(cb => cb.checked);
    
    const totalSelected = selectedRepos.length + selectedApps.length;
    
    document.getElementById('selectedTotalCount').textContent = totalSelected;
    document.getElementById('bulkDeleteAllBtn').disabled = totalSelected === 0;
    
    // Update select all checkbox state
    const selectAll = document.getElementById('selectAllManage');
    const totalCheckboxes = repoCheckboxes.length + appCheckboxes.length;
    if (totalCheckboxes === 0) {
        selectAll.checked = false;
        selectAll.indeterminate = false;
    } else {
        selectAll.checked = totalSelected === totalCheckboxes;
        selectAll.indeterminate = totalSelected > 0 && totalSelected < totalCheckboxes;
    }
}

// Bulk delete all selected (repos and apps)
async function bulkDeleteAll() {
    const repoCheckboxes = document.querySelectorAll('.repo-checkbox:checked');
    const appCheckboxes = document.querySelectorAll('.app-checkbox:checked');
    
    const selectedRepos = Array.from(repoCheckboxes).map(cb => cb.value);
    const selectedApps = Array.from(appCheckboxes).map(cb => cb.value);
    
    const totalSelected = selectedRepos.length + selectedApps.length;
    
    if (totalSelected === 0) {
        return;
    }
    
    let message = `Are you sure you want to delete ${totalSelected} item(s)? This action cannot be undone.\n\n`;
    if (selectedRepos.length > 0) {
        message += `Repositories (${selectedRepos.length}):\n${selectedRepos.join('\n')}\n\n`;
    }
    if (selectedApps.length > 0) {
        message += `Apps (${selectedApps.length}):\n${selectedApps.join('\n')}`;
    }
    
    showConfirmModal(
        'Confirm Bulk Delete',
        message,
        () => performBulkDeleteAll(selectedRepos, selectedApps),
        'Delete',
        'danger'
    );
}

async function performBulkDeleteAll(selectedRepos, selectedApps) {
    const bulkDeleteBtn = document.getElementById('bulkDeleteAllBtn');
    const totalItems = selectedRepos.length + selectedApps.length;
    let currentItem = 0;
    
    bulkDeleteBtn.disabled = true;
    bulkDeleteBtn.textContent = `Deleting... (0/${totalItems})`;
    
    let reposSuccessCount = 0;
    let reposFailCount = 0;
    let appsSuccessCount = 0;
    let appsFailCount = 0;
    const errors = [];
    
    // Delete repos first
    for (let i = 0; i < selectedRepos.length; i++) {
        const repoName = selectedRepos[i];
        currentItem++;
        bulkDeleteBtn.textContent = `Deleting... (${currentItem}/${totalItems})`;
        
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
                reposSuccessCount++;
            } else {
                reposFailCount++;
                errors.push(`Repo ${repoName}: ${data.error || 'Failed to delete'}`);
            }
        } catch (error) {
            reposFailCount++;
            errors.push(`Repo ${repoName}: ${error.message || 'Failed to delete'}`);
        }
    }
    
    // Delete apps
    for (let i = 0; i < selectedApps.length; i++) {
        const appName = selectedApps[i];
        currentItem++;
        bulkDeleteBtn.textContent = `Deleting... (${currentItem}/${totalItems})`;
        
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
                appsSuccessCount++;
            } else {
                appsFailCount++;
                errors.push(`App ${appName}: ${data.error || 'Failed to delete'}`);
            }
        } catch (error) {
            appsFailCount++;
            errors.push(`App ${appName}: ${error.message || 'Failed to delete'}`);
        }
    }
    
    // Show results
    const totalSuccess = reposSuccessCount + appsSuccessCount;
    const totalFail = reposFailCount + appsFailCount;
    
    if (totalFail > 0) {
        let errorMessage = `Deleted ${totalSuccess} item(s) successfully.\n\n`;
        if (reposSuccessCount > 0) errorMessage += `Repositories: ${reposSuccessCount}\n`;
        if (appsSuccessCount > 0) errorMessage += `Apps: ${appsSuccessCount}\n\n`;
        errorMessage += `Failed to delete ${totalFail}:\n${errors.join('\n')}`;
        showErrorModal('Bulk Delete Results', errorMessage);
    } else {
        showToast(`Successfully deleted ${totalSuccess} item(s)!`, 'success');
    }
    
    // Reload manage list
    loadManage();
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

// Bulk delete repositories (updated for manage page)
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
    
    // Reload manage list
    loadManage();
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
            // Reload manage list
            loadManage();
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

// Bulk delete CapRover apps (updated for manage page)
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
    
    // Reload manage list
    loadManage();
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
            // Reload manage list
            loadManage();
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

// Utility Functions
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
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
        port: document.getElementById('port').value.trim() || null,
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
            const githubRepoUrl = data.data.githubRepo;
            const webhookUrl = githubRepoUrl + '/settings/hooks';
            let resultHtml = `
                <div class="result-item" style="flex-direction: column; align-items: flex-start; gap: 8px;">
                    <strong>GitHub Repo:</strong>
                    <div style="display: flex; align-items: center; gap: 8px; width: 100%;">
                        <a href="${githubRepoUrl}" target="_blank" style="flex: 1; color: var(--primary-color); text-decoration: none; word-break: break-all;">${githubRepoUrl}</a>
                        <button onclick="copyToClipboard('${githubRepoUrl}', this)" class="btn-secondary" style="width: auto; padding: 8px 16px; font-size: 0.85rem; flex-shrink: 0;">
                            📋 Copy
                        </button>
                    </div>
                </div>
                <div class="result-item" style="flex-direction: column; align-items: flex-start; gap: 8px;">
                    <strong>Webhook Settings:</strong>
                    <a href="${webhookUrl}" target="_blank" style="color: var(--primary-color); text-decoration: none; word-break: break-all;">${webhookUrl}</a>
                </div>
                <div class="result-item">
                    <strong>CapRover App:</strong>
                    <span>${data.data.caproverApp}</span>
                    <a href="https://captain.kpanel.xyz/#/apps/details/${escapeHtml(data.data.caproverApp)}" target="_blank" class="modal-link-btn" style="margin-left: 12px; padding: 6px 12px; font-size: 0.85rem; display: inline-flex; align-items: center; color: white !important;">
                        Open in CapRover
                    </a>
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
                        <div style="background: var(--bg-color); padding: 12px; border-radius: 8px; width: 100%; font-family: monospace; font-size: 0.9rem; border: 1px solid var(--border-color);">
                            <div><strong>Type:</strong> A</div>
                            <div><strong>Name:</strong> @</div>
                            <div><strong>Points to:</strong> 46.202.178.170</div>
                            <div><strong>TTL:</strong> 60</div>
                        </div>
                        <button onclick="openHostingerDNS('${escapeHtml(formData.domain)}'); return false;" class="modal-link-btn" style="margin-top: 8px; cursor: pointer; border: none;">
                            Open Hostinger DNS Settings
                        </button>
                        <div style="margin-top: 12px; padding: 12px; background: var(--bg-color); border-radius: 8px; width: 100%; border: 1px solid var(--border-color);">
                            <strong style="color: var(--text-primary); font-size: 0.9rem; display: block; margin-bottom: 8px;">⚡ Auto-Fill Script:</strong>
                            <p style="margin: 0 0 8px 0; color: var(--text-secondary); font-size: 0.85rem;">
                                After opening Hostinger DNS page, copy and paste this script into the browser console (F12) to auto-fill the fields:
                            </p>
                            <pre id="hostingerScript-${escapeHtml(formData.domain)}" style="background: var(--card-bg); padding: 10px; border-radius: 6px; overflow-x: auto; font-size: 0.8rem; margin: 0; border: 1px solid var(--border-color); cursor: pointer; user-select: all;" onclick="copyHostingerScript('hostingerScript-${escapeHtml(formData.domain)}')" title="Click to copy">(function() {
    const pointsToField = document.getElementById('hdomains_dns_create_record_pointsTo');
    const ttlField = document.getElementById('hdomains_dns_create_record_ttl');
    if (pointsToField) {
        pointsToField.value = '46.202.178.170';
        pointsToField.dispatchEvent(new Event('input', { bubbles: true }));
        pointsToField.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (ttlField) {
        ttlField.value = '60';
        ttlField.dispatchEvent(new Event('input', { bubbles: true }));
        ttlField.dispatchEvent(new Event('change', { bubbles: true }));
    }
    if (pointsToField && ttlField) {
        alert('Fields filled! Type: A, Name: @, Points to: 46.202.178.170, TTL: 60');
    } else {
        alert('Fields not found. Make sure you are on the DNS records page.');
    }
})();</pre>
                            <small style="color: var(--text-muted); margin-top: 4px; display: block;">Click the code block above to copy the script, then paste it into the browser console (F12) on the Hostinger page</small>
                        </div>
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
    document.getElementById('port').value = '';
    toggleDomainField();
    resultCard.style.display = 'none';
    errorCard.style.display = 'none';
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// Generate an available port
async function generatePort() {
    const portInput = document.getElementById('port');
    const generateBtn = event.target;
    const originalText = generateBtn.textContent;
    
    generateBtn.disabled = true;
    generateBtn.textContent = 'Generating...';
    
    try {
        const response = await fetch('/api/generate-port', {
            method: 'GET',
            credentials: 'include'
        });
        
        if (response.status === 401) {
            showLogin();
            throw new Error('Session expired. Please login again.');
        }
        
        const data = await response.json();
        
        if (data.success && data.port) {
            portInput.value = data.port;
            showToast(`Generated port: ${data.port}`, 'success');
        } else {
            throw new Error(data.error || 'Failed to generate port');
        }
    } catch (error) {
        showErrorModal('Port Generation Failed', error.message || 'Failed to generate an available port. Please try again.');
    } finally {
        generateBtn.disabled = false;
        generateBtn.textContent = originalText;
    }
}

// Toggle domain field visibility
function toggleDomainField() {
    const isDomain = document.getElementById('isDomain').checked;
    const domainInput = document.getElementById('domain');
    const domainHelp = document.getElementById('domainHelp');
    
    if (isDomain) {
        domainInput.style.display = 'block';
        domainInput.required = true;
        domainHelp.style.display = 'block';
    } else {
        domainInput.style.display = 'none';
        domainInput.required = false;
        domainHelp.style.display = 'none';
        domainInput.value = '';
    }
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

// Hostinger DNS Functions
function openHostingerDNS(domain) {
    const hostingerUrl = `https://hpanel.hostinger.com/domain/${domain}/dns?tab=dns_records`;
    window.open(hostingerUrl, '_blank');
    showToast('Hostinger DNS page opened in new tab. Use the auto-fill script below.', 'info');
}

// Copy to clipboard utility function
function copyToClipboard(text, buttonElement) {
    navigator.clipboard.writeText(text).then(() => {
        const originalText = buttonElement.textContent;
        buttonElement.textContent = '✓ Copied!';
        buttonElement.style.background = 'var(--success-color)';
        buttonElement.style.borderColor = 'var(--success-color)';
        
        setTimeout(() => {
            buttonElement.textContent = originalText;
            buttonElement.style.background = '';
            buttonElement.style.borderColor = '';
        }, 2000);
    }).catch(err => {
        console.error('Failed to copy:', err);
        showToast('Failed to copy to clipboard', 'error');
    });
}

function copyHostingerScript(elementId) {
    const scriptElement = document.getElementById(elementId);
    if (!scriptElement) return;
    
    const text = scriptElement.textContent || scriptElement.innerText;
    
    navigator.clipboard.writeText(text).then(() => {
        scriptElement.style.borderColor = 'var(--success-color)';
        scriptElement.style.background = 'var(--bg-secondary)';
        setTimeout(() => {
            scriptElement.style.borderColor = 'var(--border-color)';
            scriptElement.style.background = 'var(--card-bg)';
        }, 2000);
        showToast('Script copied! Paste it into the browser console (F12) on Hostinger page.', 'success');
    }).catch(err => {
        console.error('Failed to copy:', err);
        showToast('Failed to copy script', 'error');
    });
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
