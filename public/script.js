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

// Handle page visibility changes (pause refresh when tab is hidden)
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // Page is hidden, pause auto-refresh
        if (refreshInterval) {
            console.log('[Auto-Refresh] Page hidden, pausing auto-refresh');
            clearInterval(refreshInterval);
            refreshInterval = null;
        }
    } else {
        // Page is visible again, resume auto-refresh if needed
        if (currentPage === 'manage' || currentPage === 'images') {
            console.log(`[Auto-Refresh] Page visible again, resuming auto-refresh for ${currentPage} page`);
            startAutoRefresh(currentPage);
        }
    }
});

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
    // Clear any existing refresh interval
    if (refreshInterval) {
        console.log(`[Auto-Refresh] Clearing refresh interval when switching to ${pageName} page`);
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
    // Stop the logs auto-refresh when navigating away from the Logs page
    if (logsInterval && pageName !== 'logs') {
        clearInterval(logsInterval);
        logsInterval = null;
        const cb = document.getElementById('logsAutoRefresh');
        if (cb) cb.checked = false;
    }
    
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
    
    // Update current page
    currentPage = pageName;
    
    // Load data if needed
    if (pageName === 'manage') {
        loadManage();
        // Start auto-refresh for manage page
        startAutoRefresh('manage');
    } else if (pageName === 'wizard') {
        initWizard();
    } else if (pageName === 'discord') {
        // Nothing to pre-load right now (kept for symmetry / future)
    } else if (pageName === 'images') {
        loadImages();
        // Start auto-refresh for images page
        startAutoRefresh('images');
    } else if (pageName === 'reboot') {
        // No auto-refresh: it would clobber the console while builds are streaming
        loadReboot();
    } else if (pageName === 'system') {
        loadSystem();
    } else if (pageName === 'logs') {
        initLogsPage();
    }
}

// Start auto-refresh for pages that need it
function startAutoRefresh(pageName) {
    // Clear any existing interval
    if (refreshInterval) {
        clearInterval(refreshInterval);
        console.log(`[Auto-Refresh] Stopped previous refresh interval for ${pageName}`);
    }
    
    console.log(`[Auto-Refresh] Starting auto-refresh for ${pageName} page (every 5 seconds)`);
    
    // Set up new interval to refresh every 5 seconds
    refreshInterval = setInterval(() => {
        // Only refresh if we're still on the same page
        if (currentPage === pageName) {
            const timestamp = new Date().toLocaleTimeString();
            console.log(`[Auto-Refresh] ${timestamp} - Refreshing ${pageName} page...`);
            
            if (pageName === 'manage') {
                loadManage();
            } else if (pageName === 'images') {
                loadImages();
            }
        } else {
            // If we've switched pages, clear the interval
            console.log(`[Auto-Refresh] Page changed from ${pageName} to ${currentPage}, stopping refresh`);
            clearInterval(refreshInterval);
            refreshInterval = null;
        }
    }, 5000); // 5 seconds
}

// Load and match repositories with apps
// Store manage data globally so tabs can access it
let manageData = {
    matched: [],
    repos: [],
    apps: [],
    unmatchedRepos: [],
    unmatchedApps: []
};

let currentManageTab = 'matched';

// Auto-refresh interval management
let refreshInterval = null;
let currentPage = 'create';

// Reboot VPS recovery state
let pinnedApps = new Set();
let rebootApps = [];
let rebootBuilding = false;
let activeConsoleApp = null; // which app's inline console is currently receiving logs

// Switch between manage tabs
function switchManageTab(tab) {
    currentManageTab = tab;
    
    // Update tab buttons
    document.querySelectorAll('.manage-tab').forEach(btn => {
        btn.classList.remove('active');
    });
    document.getElementById(`tab-${tab}`).classList.add('active');
    
    // Clear search input
    const searchInput = document.getElementById('manageSearchInput');
    if (searchInput) {
        searchInput.value = '';
    }
    
    // Render the appropriate content
    renderManageTab(tab);
}

// Render content for the active tab
function renderManageTab(tab) {
    const manageContent = document.getElementById('manageContent');
    let html = '';
    
    // Add search input
    const searchPlaceholder = tab === 'matched' ? 'Search matched pairs...' : 
                              tab === 'repos' ? 'Search repositories...' : 
                              'Search CapRover apps...';
    html += `
        <div class="manage-search-container">
            <input 
                type="text" 
                id="manageSearchInput" 
                class="manage-search-input" 
                placeholder="${searchPlaceholder}"
                oninput="filterManageContent('${tab}')"
            >
        </div>
    `;
    
    if (tab === 'matched') {
        // Render matched pairs
        if (manageData.matched.length === 0) {
            html += '<div class="empty-state"><p>No matched repositories and apps found.</p></div>';
        } else {
            html += '<div id="manageItemsContainer">';
            manageData.matched.forEach(({ repo, app, name }) => {
                html += `
                    <div class="manage-matched-item" data-search="${escapeHtml(name.toLowerCase())}">
                        <div class="manage-matched-header-row">
                            <label class="checkbox-label">
                                <input type="checkbox" class="matched-pair-checkbox" data-repo="${repo.name}" data-app="${app.appName}" onchange="toggleMatchedPair('${repo.name}', '${app.appName}', this.checked)">
                                <span style="font-weight: 600; color: var(--primary-color);">Select Both</span>
                            </label>
                        </div>
                        <div class="manage-matched-repo">
                            <div class="manage-matched-header">
                                <div class="manage-checkbox-wrapper">
                                    <input type="checkbox" class="repo-checkbox" value="${repo.name}" onchange="updateMatchedPairCheckbox('${repo.name}', '${app.appName}'); updateSelectedManageCount()">
                                    <span class="manage-repo-name">${escapeHtml(repo.name)}</span>
                                </div>
                                <button onclick="deleteRepo('${repo.name}')" class="btn-danger" style="width: auto; padding: 6px 12px; font-size: 0.85rem;">
                                    Delete
                                </button>
                            </div>
                            <div class="manage-repo-url">
                                <a href="${repo.html_url}" target="_blank">${repo.html_url}</a>
                            </div>
                        </div>
                        <div class="manage-matched-app">
                            <div class="manage-matched-header">
                                <div class="manage-checkbox-wrapper">
                                    <input type="checkbox" class="app-checkbox" value="${app.appName}" onchange="updateMatchedPairCheckbox('${repo.name}', '${app.appName}'); updateSelectedManageCount()">
                                    <span class="manage-app-name">${escapeHtml(app.appName)}</span>
                                </div>
                                <div style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap;">
                                    <a href="https://captain.kpanel.xyz/#/apps/details/${escapeHtml(app.appName)}" target="_blank" class="manage-app-link" title="Open in CapRover">
                                        🔗 CapRover
                                    </a>
                                    <button onclick="deleteApp('${app.appName}')" class="btn-danger" style="width: auto; padding: 6px 12px; font-size: 0.85rem;">
                                        Delete
                                    </button>
                                </div>
                            </div>
                            <div class="manage-app-info">
                                Port: ${app.containerHttpPort || 'N/A'} | Instances: ${app.instanceCount || 1}
                            </div>
                        </div>
                    </div>
                `;
            });
            html += '</div>';
        }
    } else if (tab === 'repos') {
        // Render all repos
        if (manageData.repos.length === 0) {
            html += '<div class="empty-state"><p>No repositories found.</p></div>';
        } else {
            html += '<div id="manageItemsContainer">';
            manageData.repos.forEach(repo => {
                html += `
                    <div class="manage-item-single" data-search="${escapeHtml(repo.name.toLowerCase())}">
                        <div class="manage-repo">
                            <div class="manage-repo-header">
                                <div class="manage-checkbox-wrapper">
                                    <input type="checkbox" class="repo-checkbox" value="${repo.name}" onchange="updateSelectedManageCount()">
                                    <span class="manage-repo-name">${escapeHtml(repo.name)}</span>
                                </div>
                                <button onclick="deleteRepo('${repo.name}')" class="btn-danger" style="width: auto; padding: 6px 12px; font-size: 0.85rem;">
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
            html += '</div>';
        }
    } else if (tab === 'apps') {
        // Render all apps
        if (manageData.apps.length === 0) {
            html += '<div class="empty-state"><p>No CapRover apps found.</p></div>';
        } else {
            html += '<div id="manageItemsContainer">';
            manageData.apps.forEach(app => {
                html += `
                    <div class="manage-item-single" data-search="${escapeHtml(app.appName.toLowerCase())}">
                        <div class="manage-app">
                            <div class="manage-app-header">
                                <div class="manage-checkbox-wrapper">
                                    <input type="checkbox" class="app-checkbox" value="${app.appName}" onchange="updateSelectedManageCount()">
                                    <span class="manage-app-name">${escapeHtml(app.appName)}</span>
                                </div>
                                <div style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap;">
                                    <a href="https://captain.kpanel.xyz/#/apps/details/${escapeHtml(app.appName)}" target="_blank" class="manage-app-link" title="Open in CapRover">
                                        🔗 CapRover
                                    </a>
                                    <button onclick="deleteApp('${app.appName}')" class="btn-danger" style="width: auto; padding: 6px 12px; font-size: 0.85rem;">
                                        Delete
                                    </button>
                                </div>
                            </div>
                            <div class="manage-app-info">
                                Port: ${app.containerHttpPort || 'N/A'} | Instances: ${app.instanceCount || 1}
                            </div>
                        </div>
                    </div>
                `;
            });
            html += '</div>';
        }
    }
    
    manageContent.innerHTML = html;
    updateSelectedManageCount();
}

// Filter manage content based on search input
function filterManageContent(tab) {
    const searchInput = document.getElementById('manageSearchInput');
    const searchTerm = searchInput.value.toLowerCase().trim();
    const itemsContainer = document.getElementById('manageItemsContainer');
    
    if (!itemsContainer) return;
    
    const items = itemsContainer.querySelectorAll('[data-search]');
    let visibleCount = 0;
    
    items.forEach(item => {
        const searchText = item.getAttribute('data-search');
        if (searchText.includes(searchTerm)) {
            item.style.display = '';
            visibleCount++;
        } else {
            item.style.display = 'none';
        }
    });
    
    // Show "no results" message if no items match
    let noResultsMsg = itemsContainer.querySelector('.no-results-message');
    if (visibleCount === 0 && searchTerm !== '') {
        if (!noResultsMsg) {
            noResultsMsg = document.createElement('div');
            noResultsMsg.className = 'no-results-message';
            noResultsMsg.style.cssText = 'text-align: center; padding: 40px; color: var(--text-secondary);';
            noResultsMsg.textContent = 'No results found';
            itemsContainer.appendChild(noResultsMsg);
        }
        noResultsMsg.style.display = 'block';
    } else if (noResultsMsg) {
        noResultsMsg.style.display = 'none';
    }
}

// Toggle matched pair checkbox (selects both repo and app)
function toggleMatchedPair(repoName, appName, checked) {
    const repoCheckbox = document.querySelector(`.repo-checkbox[value="${repoName}"]`);
    const appCheckbox = document.querySelector(`.app-checkbox[value="${appName}"]`);
    
    if (repoCheckbox) repoCheckbox.checked = checked;
    if (appCheckbox) appCheckbox.checked = checked;
    
    updateSelectedManageCount();
}

// Update matched pair checkbox based on individual checkboxes
function updateMatchedPairCheckbox(repoName, appName) {
    const repoCheckbox = document.querySelector(`.repo-checkbox[value="${repoName}"]`);
    const appCheckbox = document.querySelector(`.app-checkbox[value="${appName}"]`);
    const pairCheckbox = document.querySelector(`.matched-pair-checkbox[data-repo="${repoName}"][data-app="${appName}"]`);
    
    if (repoCheckbox && appCheckbox && pairCheckbox) {
        pairCheckbox.checked = repoCheckbox.checked && appCheckbox.checked;
        pairCheckbox.indeterminate = (repoCheckbox.checked || appCheckbox.checked) && !(repoCheckbox.checked && appCheckbox.checked);
    }
}

async function loadManage() {
    console.log('[loadManage] Starting to load manage data...');
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
        
        // Create a map of apps by lowercased name for quick lookup (CapRover app names are lowercased)
        const appsMap = {};
        apps.forEach(app => {
            appsMap[String(app.appName || '').toLowerCase()] = app;
        });
        
        // Match repos with apps and create combined list
        const matched = [];
        const unmatchedRepos = [];
        const unmatchedApps = [];
        
        repos.forEach(repo => {
            const repoKey = String(repo.name || '').toLowerCase();
            const app = appsMap[repoKey];
            if (app) {
                matched.push({ repo, app, name: repo.name });
                delete appsMap[repoKey];
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
        
        // Sort repos and apps alphabetically
        repos.sort((a, b) => a.name.localeCompare(b.name));
        apps.sort((a, b) => a.appName.localeCompare(b.appName));
        
        // Store data globally
        manageData = {
            matched: matched,
            repos: repos,
            apps: apps,
            unmatchedRepos: unmatchedRepos,
            unmatchedApps: unmatchedApps
        };
        
        if (matched.length === 0 && unmatchedRepos.length === 0 && unmatchedApps.length === 0) {
            manageContent.innerHTML = '<div class="empty-state"><p>No repositories or apps found.</p></div>';
            manageList.style.display = 'block';
            return;
        }
        
        // Render the initial tab
        renderManageTab(currentManageTab);
        manageList.style.display = 'block';
        console.log(`[loadManage] ✅ Successfully loaded ${repos.length} repos and ${apps.length} apps`);
        
    } catch (error) {
        console.error('[loadManage] ❌ Error loading manage data:', error);
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
    const matchedPairCheckboxes = document.querySelectorAll('.matched-pair-checkbox');
    
    [...repoCheckboxes, ...appCheckboxes].forEach(checkbox => {
        checkbox.checked = selectAll;
    });
    
    // Update matched pair checkboxes
    matchedPairCheckboxes.forEach(pairCheckbox => {
        const repoName = pairCheckbox.getAttribute('data-repo');
        const appName = pairCheckbox.getAttribute('data-app');
        const repoCheckbox = document.querySelector(`.repo-checkbox[value="${repoName}"]`);
        const appCheckbox = document.querySelector(`.app-checkbox[value="${appName}"]`);
        
        if (repoCheckbox && appCheckbox) {
            pairCheckbox.checked = selectAll;
            pairCheckbox.indeterminate = false;
        }
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
    
    // Update matched pair checkboxes
    const matchedPairCheckboxes = document.querySelectorAll('.matched-pair-checkbox');
    matchedPairCheckboxes.forEach(pairCheckbox => {
        const repoName = pairCheckbox.getAttribute('data-repo');
        const appName = pairCheckbox.getAttribute('data-app');
        const repoCheckbox = document.querySelector(`.repo-checkbox[value="${repoName}"]`);
        const appCheckbox = document.querySelector(`.app-checkbox[value="${appName}"]`);
        
        if (repoCheckbox && appCheckbox) {
            pairCheckbox.checked = repoCheckbox.checked && appCheckbox.checked;
            pairCheckbox.indeterminate = (repoCheckbox.checked || appCheckbox.checked) && !(repoCheckbox.checked && appCheckbox.checked);
        }
    });
    
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
    // Clear refresh interval on logout
    if (refreshInterval) {
        clearInterval(refreshInterval);
        refreshInterval = null;
    }
    
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
            const webhookUrl = githubRepoUrl + '/settings/hooks/new';
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

// =========================
// Create Discord Bot
// =========================
const discordForm = document.getElementById('createDiscordBotForm');
const discordSubmitBtn = document.getElementById('discordSubmitBtn');
const discordResultCard = document.getElementById('discordResult');
const discordErrorCard = document.getElementById('discordError');
const discordResultContent = document.getElementById('discordResultContent');
const discordErrorContent = document.getElementById('discordErrorContent');

let lastCreatedDiscordBotApp = null;

if (discordForm) {
    discordForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Hide previous results
        discordResultCard.style.display = 'none';
        discordErrorCard.style.display = 'none';

        // Disable submit button and show loading
        discordSubmitBtn.disabled = true;
        const btnText = discordSubmitBtn.querySelector('.btn-text');
        const btnLoader = discordSubmitBtn.querySelector('.btn-loader');
        btnText.style.display = 'none';
        btnLoader.style.display = 'inline-block';

        const formData = {
            projectName: document.getElementById('discordProjectName').value.trim(),
            branch: document.getElementById('discordBranch').value.trim() || 'main',
            port: document.getElementById('discordPort').value.trim() || null,
        };

        try {
            const response = await fetch('/api/create-discord-bot', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify(formData)
            });

            if (response.status === 401) {
                showLogin();
                throw new Error('Session expired. Please login again.');
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(data.error || 'Unknown error occurred');
            }

            lastCreatedDiscordBotApp = data.data.caproverApp;

            const githubRepoUrl = data.data.githubRepo;
            const webhookUrl = githubRepoUrl + '/settings/hooks/new';
            const caproverApp = data.data.caproverApp;

            const discordPortalUrl = 'https://discord.com/developers/applications';

            const resultHtml = `
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
                    <span>${escapeHtml(caproverApp)}</span>
                    <a href="https://captain.kpanel.xyz/#/apps/details/${escapeHtml(caproverApp)}" target="_blank" class="modal-link-btn" style="margin-left: 12px; padding: 6px 12px; font-size: 0.85rem; display: inline-flex; align-items: center; color: white !important;">
                        Open in CapRover
                    </a>
                </div>
                <div class="result-item">
                    <strong>Container Port:</strong>
                    <span>${data.data.port}</span>
                </div>
                <div class="result-item">
                    <strong>Branch:</strong>
                    <span>${escapeHtml(data.data.branch)}</span>
                </div>

                <div class="result-item" style="flex-direction: column; align-items: flex-start; gap: 12px; margin-top: 16px; padding: 20px; background: var(--bg-secondary); border: 2px solid var(--primary-color); border-radius: 12px;">
                    <strong style="color: var(--primary-color); font-size: 1.1rem;">🤖 Discord Bot Setup (Required)</strong>
                    <ol style="margin: 0; padding-left: 18px; color: var(--text-secondary);">
                        <li>Open the Discord Developer Portal and create a new application.</li>
                        <li>Copy your <strong>Application ID</strong> and <strong>Public Key</strong> from “General Information”.</li>
                        <li>Go to “Bot” → create a bot (if needed) → <strong>Reset Token</strong> and copy the bot token.</li>
                        <li>Enable intents your bot needs (often “Message Content Intent” for prefix commands).</li>
                        <li>Invite the bot to your server: “OAuth2” → “URL Generator” → scopes: <strong>bot</strong> (+ <strong>applications.commands</strong> if you’ll use slash commands).</li>
                        <li>Paste the values below and click “Save to CapRover”.</li>
                    </ol>
                    <div style="display: flex; gap: 8px; flex-wrap: wrap;">
                        <a href="${discordPortalUrl}" target="_blank" class="modal-link-btn" style="cursor: pointer; border: none;">
                            Open Discord Developer Portal
                        </a>
                    </div>

                    <div class="form-group" style="width: 100%; margin: 0;">
                        <label for="discordSetupApplicationId">DISCORD_APPLICATION_ID *</label>
                        <input type="text" id="discordSetupApplicationId" placeholder="123456789012345678" autocomplete="off">
                        <small>Discord Developer Portal → your Application → General Information</small>
                    </div>
                    <div class="form-group" style="width: 100%; margin: 0;">
                        <label for="discordSetupSecret">DISCORD_SECRET (optional)</label>
                        <input type="password" id="discordSetupSecret" placeholder="(client secret)" autocomplete="off">
                        <small>Optional: needed if you build OAuth/dashboard features</small>
                    </div>
                    <div class="form-group" style="width: 100%; margin: 0;">
                        <label for="discordSetupPublicKey">DISCORD_PUBLIC_KEY *</label>
                        <input type="text" id="discordSetupPublicKey" placeholder="(public key)" autocomplete="off">
                        <small>Discord Developer Portal → your Application → General Information</small>
                    </div>
                    <div class="form-group" style="width: 100%; margin: 0;">
                        <label for="discordSetupBotToken">DISCORD_BOT_TOKEN *</label>
                        <div style="display: flex; gap: 10px; align-items: stretch; width: 100%;">
                            <input type="password" id="discordSetupBotToken" placeholder="(bot token)" autocomplete="off" style="flex: 1; min-width: 0;">
                            <button type="button" class="btn-secondary" style="width: auto; padding: 10px 14px; flex-shrink: 0;" onclick="toggleDiscordTokenVisibility()">
                                Show
                            </button>
                        </div>
                        <small>Discord Developer Portal → Bot → Reset Token</small>
                    </div>
                    <div class="form-group" style="width: 100%; margin: 0;">
                        <label for="discordSetupPrefix">DISCORD_PREFIX</label>
                        <input type="text" id="discordSetupPrefix" placeholder="!" autocomplete="off">
                        <small>Used for prefix commands (if enabled)</small>
                    </div>
                    <div class="form-group" style="width: 100%; margin: 0;">
                        <label for="discordSetupPrefixEnabled">DISCORD_PREFIX_ENABLED</label>
                        <select id="discordSetupPrefixEnabled" style="width: 100%; padding: 14px 18px; background: var(--bg-color); border: 2px solid var(--border-color); border-radius: 12px; color: var(--text-primary); font-size: 1rem; cursor: pointer;">
                            <option value="true" selected>True</option>
                            <option value="false">False</option>
                        </select>
                        <small>Enable/disable prefix command parsing</small>
                    </div>
                    <div class="form-group" style="width: 100%; margin: 0;">
                        <label for="discordSetupGuildId">DISCORD_GUILD_ID (optional)</label>
                        <input type="text" id="discordSetupGuildId" placeholder="(optional)" autocomplete="off">
                        <small>Optional: useful for dev-only commands or server-specific config</small>
                    </div>

                    <div style="width: 100%; margin-top: 8px; padding-top: 12px; border-top: 1px solid var(--border-color);">
                        <strong style="color: var(--text-primary); font-size: 0.95rem;">MongoDB (optional)</strong>
                    </div>
                    <div class="form-group" style="width: 100%; margin: 0;">
                        <label for="mongoDB_URI">mongoDB_URI</label>
                        <input type="text" id="mongoDB_URI" placeholder="mongodb://..." autocomplete="off">
                    </div>
                    <div class="form-group" style="width: 100%; margin: 0;">
                        <label for="mongoDB_DB">mongoDB_DB</label>
                        <input type="text" id="mongoDB_DB" placeholder="database name" autocomplete="off">
                    </div>
                    <div class="form-group" style="width: 100%; margin: 0;">
                        <label for="mongoDB_User">mongoDB_User</label>
                        <input type="text" id="mongoDB_User" placeholder="username" autocomplete="off">
                    </div>
                    <div class="form-group" style="width: 100%; margin: 0;">
                        <label for="mongoDB_Password">mongoDB_Password</label>
                        <input type="password" id="mongoDB_Password" placeholder="password" autocomplete="off">
                    </div>

                    <div style="width: 100%; margin-top: 8px; padding-top: 12px; border-top: 1px solid var(--border-color);">
                        <strong style="color: var(--text-primary); font-size: 0.95rem;">Role IDs (optional)</strong>
                    </div>
                    <div class="form-group" style="width: 100%; margin: 0;">
                        <label for="admin_role_ID">admin_role_ID</label>
                        <input type="text" id="admin_role_ID" placeholder="role id" autocomplete="off">
                    </div>
                    <div class="form-group" style="width: 100%; margin: 0;">
                        <label for="mod_role_ID">mod_role_ID</label>
                        <input type="text" id="mod_role_ID" placeholder="role id" autocomplete="off">
                    </div>
                    <div class="form-group" style="width: 100%; margin: 0;">
                        <label for="member_role_ID">member_role_ID</label>
                        <input type="text" id="member_role_ID" placeholder="role id" autocomplete="off">
                    </div>

                    <div style="width: 100%; margin-top: 8px; padding-top: 12px; border-top: 1px solid var(--border-color);">
                        <strong style="color: var(--text-primary); font-size: 0.95rem;">MongoDB Atlas (optional)</strong>
                    </div>
                    <div class="form-group" style="width: 100%; margin: 0;">
                        <label for="mongodb_atlas_email">mongodb_atlas_email</label>
                        <input type="text" id="mongodb_atlas_email" placeholder="email" autocomplete="off">
                    </div>
                    <div class="form-group" style="width: 100%; margin: 0;">
                        <label for="mongodb_atlas_password">mongodb_atlas_password</label>
                        <input type="password" id="mongodb_atlas_password" placeholder="password" autocomplete="off">
                    </div>
                    <div style="display: flex; gap: 10px; flex-wrap: wrap; width: 100%; margin-top: 4px;">
                        <button type="button" class="btn-primary" style="width: auto;" onclick="saveDiscordBotConfig()">
                            Save Discord Settings to CapRover
                        </button>
                        <button type="button" class="btn-secondary" style="width: auto;" onclick="copyDiscordEnvVarList()">
                            Copy Env Var Names
                        </button>
                    </div>
                    <small style="color: var(--text-muted);">
                        This will set CapRover env vars on <strong>${escapeHtml(caproverApp)}</strong>. Use “Copy Env Var Names” if you want the full list.
                    </small>
                </div>
            `;

            discordResultContent.innerHTML = resultHtml;
            discordResultCard.style.display = 'block';
            discordResultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (error) {
            discordErrorContent.textContent = error.message || 'Failed to create Discord bot. Please check your configuration.';
            discordErrorCard.style.display = 'block';
            discordErrorCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } finally {
            discordSubmitBtn.disabled = false;
            const btnText = discordSubmitBtn.querySelector('.btn-text');
            const btnLoader = discordSubmitBtn.querySelector('.btn-loader');
            btnText.style.display = 'inline-block';
            btnLoader.style.display = 'none';
        }
    });
}

function resetDiscordBotForm() {
    if (discordForm) discordForm.reset();
    const portInput = document.getElementById('discordPort');
    if (portInput) portInput.value = '';
    discordResultCard.style.display = 'none';
    discordErrorCard.style.display = 'none';
    lastCreatedDiscordBotApp = null;
    if (discordForm) discordForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function toggleDiscordTokenVisibility() {
    const tokenInput = document.getElementById('discordSetupBotToken');
    if (!tokenInput) return;
    tokenInput.type = tokenInput.type === 'password' ? 'text' : 'password';
    const btn = (typeof event !== 'undefined') ? (event.currentTarget || event.target) : null;
    if (btn && btn.textContent) {
        btn.textContent = tokenInput.type === 'password' ? 'Show' : 'Hide';
    }
}

function copyDiscordEnvVarList() {
    const envVarNames = [
        'DISCORD_APPLICATION_ID',
        'DISCORD_SECRET',
        'DISCORD_PUBLIC_KEY',
        'DISCORD_BOT_TOKEN',
        'DISCORD_PREFIX',
        'DISCORD_PREFIX_ENABLED',
        'DISCORD_GUILD_ID'
        ,
        'mongoDB_URI',
        'mongoDB_DB',
        'mongoDB_User',
        'mongoDB_Password',
        'admin_role_ID',
        'mod_role_ID',
        'member_role_ID',
        'mongodb_atlas_email',
        'mongodb_atlas_password'
    ].join('\n');
    copyToClipboard(envVarNames);
}

async function saveDiscordBotConfig() {
    if (!lastCreatedDiscordBotApp) {
        showErrorModal('No App Selected', 'Create a Discord bot first so we know which CapRover app to update.');
        return;
    }

    const applicationId = document.getElementById('discordSetupApplicationId')?.value?.trim() || '';
    const secret = document.getElementById('discordSetupSecret')?.value?.trim() || '';
    const publicKey = document.getElementById('discordSetupPublicKey')?.value?.trim() || '';
    const botToken = document.getElementById('discordSetupBotToken')?.value?.trim() || '';
    const prefix = document.getElementById('discordSetupPrefix')?.value?.trim() || '';
    const prefixEnabled = document.getElementById('discordSetupPrefixEnabled')?.value || 'true';
    const guildId = document.getElementById('discordSetupGuildId')?.value?.trim() || '';

    const mongoDB_URI = document.getElementById('mongoDB_URI')?.value?.trim() || '';
    const mongoDB_DB = document.getElementById('mongoDB_DB')?.value?.trim() || '';
    const mongoDB_User = document.getElementById('mongoDB_User')?.value?.trim() || '';
    const mongoDB_Password = document.getElementById('mongoDB_Password')?.value?.trim() || '';

    const admin_role_ID = document.getElementById('admin_role_ID')?.value?.trim() || '';
    const mod_role_ID = document.getElementById('mod_role_ID')?.value?.trim() || '';
    const member_role_ID = document.getElementById('member_role_ID')?.value?.trim() || '';

    const mongodb_atlas_email = document.getElementById('mongodb_atlas_email')?.value?.trim() || '';
    const mongodb_atlas_password = document.getElementById('mongodb_atlas_password')?.value?.trim() || '';

    if (!applicationId || !publicKey || !botToken) {
        showErrorModal('Missing Discord Values', 'DISCORD_APPLICATION_ID, DISCORD_PUBLIC_KEY, and DISCORD_BOT_TOKEN are required to run the bot.');
        return;
    }

    try {
        const response = await fetch(`/api/apps/${encodeURIComponent(lastCreatedDiscordBotApp)}/discord-bot-config`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({
                DISCORD_APPLICATION_ID: applicationId,
                DISCORD_SECRET: secret,
                DISCORD_PUBLIC_KEY: publicKey,
                DISCORD_BOT_TOKEN: botToken,
                DISCORD_PREFIX: prefix,
                DISCORD_PREFIX_ENABLED: prefixEnabled,
                DISCORD_GUILD_ID: guildId,
                mongoDB_URI,
                mongoDB_DB,
                mongoDB_User,
                mongoDB_Password,
                admin_role_ID,
                mod_role_ID,
                member_role_ID,
                mongodb_atlas_email,
                mongodb_atlas_password
            })
        });

        if (response.status === 401) {
            showLogin();
            throw new Error('Session expired. Please login again.');
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Failed to save Discord settings');
        }

        showToast('Saved Discord settings to CapRover', 'success');
    } catch (error) {
        showErrorModal('Save Failed', error.message || 'Failed to save Discord settings. Please try again.');
    }
}

// Generate an available port
async function generatePort(inputId = 'port', btnEl = null) {
    const portInput = document.getElementById(inputId);
    const generateBtn = btnEl || (typeof event !== 'undefined' ? (event.currentTarget || event.target) : null);
    const originalText = generateBtn ? generateBtn.textContent : null;
    
    if (generateBtn) {
        generateBtn.disabled = true;
        generateBtn.textContent = 'Generating...';
    }
    
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
            if (portInput) portInput.value = data.port;
            showToast(`Generated port: ${data.port}`, 'success');
        } else {
            throw new Error(data.error || 'Failed to generate port');
        }
    } catch (error) {
        showErrorModal('Port Generation Failed', error.message || 'Failed to generate an available port. Please try again.');
    } finally {
        if (generateBtn) {
            generateBtn.disabled = false;
            generateBtn.textContent = originalText;
        }
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
        const isValid = /^[a-z0-9-]+$/i.test(value) || value === '';
        
        if (value && !isValid) {
            e.target.setCustomValidity('Only letters, numbers, and hyphens allowed');
        } else {
            e.target.setCustomValidity('');
        }
    });
}

// Validate Discord project name format
const discordProjectNameInput = document.getElementById('discordProjectName');
if (discordProjectNameInput) {
    discordProjectNameInput.addEventListener('input', (e) => {
        const value = e.target.value;
        const isValid = /^[a-z0-9-]+$/i.test(value) || value === '';

        if (value && !isValid) {
            e.target.setCustomValidity('Only letters, numbers, and hyphens allowed');
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
        if (!buttonElement) {
            showToast('Copied to clipboard', 'success');
            return;
        }

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

// Wizard Functions
let wizardData = {
    wizardType: null, // 'website' | 'discordBot'
    projectName: '',
    githubRepo: '',
    darkMode: null,
    caproverApp: '',
    port: '',
    varsOnCapRover: null,
    selectedVars: [],
    customEnvVars: '',
    details: '',
    discordCommandStyle: null, // 'prefix' | 'slash' | 'both'
    discordPrefix: '!',
    discordDashboard: null,
    featuresToStart: ''
};

let currentWizardStep = 0;
let wizardRepos = [];
let wizardCaproverApps = [];
/** When true, the custom env var textarea is visible on the variables step */
let wizardCustomEnvVarsExpanded = false;

function getWizardMergedEnvVarNames() {
    const custom = (wizardData.customEnvVars || '')
        .split('\n')
        .map(s => s.trim())
        .filter(Boolean);
    const seen = new Set();
    const out = [];
    for (const v of [...wizardData.selectedVars, ...custom]) {
        if (!seen.has(v)) {
            seen.add(v);
            out.push(v);
        }
    }
    return out;
}

function getWizardSteps() {
    const repoOptions = wizardRepos.map(repo => ({
        value: repo.html_url,
        label: `${repo.name} (${repo.html_url})`
    }));

    const caproverAppOptions = wizardCaproverApps.map(app => ({
        value: app.appName,
        label: `${app.appName} — port ${app.containerHttpPort != null ? app.containerHttpPort : '?'}`
    }));

    const typeStep = {
        question: 'What are you creating?',
        type: 'choice',
        key: 'wizardType',
        required: true,
        options: [
            { value: 'website', label: 'Website', description: 'Generate a Cursor AI prompt for a web app.' },
            { value: 'discordBot', label: 'Discord Bot', description: 'Generate a Cursor AI prompt for a Discord bot (discord.js).' }
        ]
    };

    if (!wizardData.wizardType) {
        return [typeStep];
    }

    if (wizardData.wizardType === 'website') {
        return [
            typeStep,
            {
                question: 'What is the name of the website?',
                type: 'text',
                key: 'projectName',
                placeholder: 'my-awesome-website',
                required: true
            },
            {
                question: 'Select GitHub repository:',
                type: 'select',
                key: 'githubRepo',
                options: repoOptions,
                required: false
            },
            {
                question: 'Do you want dark mode?',
                type: 'yesno',
                key: 'darkMode'
            },
            {
                question: 'Select CapRover app (container HTTP port is taken from CapRover):',
                type: 'select',
                key: 'caproverApp',
                options: caproverAppOptions,
                required: false,
                selectKind: 'caprover'
            },
            {
                question: 'Are the variables stored on CapRover?',
                type: 'yesno',
                key: 'varsOnCapRover'
            },
            {
                question: 'Check all of the variables used:',
                type: 'checkboxes',
                key: 'selectedVars',
                options: [
                    'mongoDB_URI',
                    'SHIPENGINE_API_KEY',
                    'AFTERSHIP_API_KEY',
                    'OPENAI_API_KEY',
                    'EBAY_APP_ID',
                    'EBAY_CERT_ID',
                    'EBAY_DEV_ID',
                    'SMTP_HOST',
                    'SMTP_PORT',
                    'SMTP_SECURE',
                    'SMTP_USER',
                    'SMTP_PASS',
                    'MAIL_FROM_NAME',
                    'MAIL_FROM_EMAIL',
                    'MAIL_PWRESET_NAME',
                    'MAIL_PWRESET_EMAIL',
                    'STAXXIO_SSO_SECRET'
                ]
            },
            {
                question: 'Details on the website:',
                type: 'textarea',
                key: 'details',
                placeholder: 'Describe the website functionality, features, and requirements...',
                required: true
            },
            {
                question: 'Features to start with:',
                type: 'textarea',
                key: 'featuresToStart',
                placeholder: 'List the first features Cursor should implement (bullets are great).',
                required: true
            }
        ];
    }

    // Discord bot wizard
    const steps = [
        typeStep,
        {
            question: 'What is the name of the Discord bot project?',
            type: 'text',
            key: 'projectName',
            placeholder: 'my-discord-bot',
            required: true
        },
        {
            question: 'Select GitHub repository:',
            type: 'select',
            key: 'githubRepo',
            options: repoOptions,
            required: false
        },
        {
            question: 'Select CapRover app (container HTTP port is taken from CapRover):',
            type: 'select',
            key: 'caproverApp',
            options: caproverAppOptions,
            required: false,
            selectKind: 'caprover'
        },
        {
            question: 'What command style do you want?',
            type: 'choice',
            key: 'discordCommandStyle',
            required: true,
            options: [
                { value: 'prefix', label: 'Prefix commands', description: 'Example: !ping' },
                { value: 'slash', label: 'Slash commands', description: 'Example: /ping' },
                { value: 'both', label: 'Both', description: 'Support prefix + slash commands.' }
            ]
        }
    ];

    if (wizardData.discordCommandStyle && wizardData.discordCommandStyle !== 'slash') {
        steps.push({
            question: 'What prefix should the bot use?',
            type: 'text',
            key: 'discordPrefix',
            placeholder: '!',
            required: true
        });
    }

    steps.push(
        {
            question: 'Do you want to build a dashboard website for this Discord bot?',
            type: 'yesno',
            key: 'discordDashboard'
        },
        {
            question: 'Are the variables stored on CapRover?',
            type: 'yesno',
            key: 'varsOnCapRover'
        },
        {
            question: 'Check all of the variables used:',
            type: 'checkboxes',
            key: 'selectedVars',
            options: [
                'DISCORD_APPLICATION_ID',
                'DISCORD_SECRET',
                'DISCORD_PUBLIC_KEY',
                'DISCORD_BOT_TOKEN',
                'DISCORD_GUILD_ID',
                'DISCORD_PREFIX',
                'DISCORD_PREFIX_ENABLED',
                'mongoDB_URI',
                'mongoDB_DB',
                'mongoDB_User',
                'mongoDB_Password',
                'admin_role_ID',
                'mod_role_ID',
                'member_role_ID',
                'mongodb_atlas_email',
                'mongodb_atlas_password'
            ]
        },
        {
            question: 'Bot details / behavior:',
            type: 'textarea',
            key: 'details',
            placeholder: 'Describe what the bot should do, what commands it needs, and any rules/permissions.',
            required: true
        },
        {
            question: 'Features to start with:',
            type: 'textarea',
            key: 'featuresToStart',
            placeholder: 'List the first features Cursor should implement (bullets are great).',
            required: true
        }
    );

    return steps;
}

async function initWizard() {
    currentWizardStep = 0;
    wizardData = {
        wizardType: null,
        projectName: '',
        githubRepo: '',
        darkMode: null,
        caproverApp: '',
        port: '',
        varsOnCapRover: null,
        selectedVars: [],
        customEnvVars: '',
        details: '',
        discordCommandStyle: null,
        discordPrefix: '!',
        discordDashboard: null,
        featuresToStart: ''
    };
    
    // Load GitHub repos for the dropdown
    try {
        const reposResponse = await fetch('/api/repos', { credentials: 'include' });
        if (reposResponse.ok) {
            const reposData = await reposResponse.json();
            if (reposData.success) {
                wizardRepos = reposData.repos || [];
            }
        }
    } catch (error) {
        console.error('Failed to load repos for wizard:', error);
    }

    wizardCaproverApps = [];
    try {
        const appsResponse = await fetch('/api/apps', { credentials: 'include' });
        if (appsResponse.ok) {
            const appsData = await appsResponse.json();
            if (appsData.success && Array.isArray(appsData.apps)) {
                wizardCaproverApps = appsData.apps;
            }
        }
    } catch (error) {
        console.error('Failed to load CapRover apps for wizard:', error);
    }

    wizardCustomEnvVarsExpanded = false;
    
    renderWizardStep();
}

function renderWizardStep() {
    const wizardStepsEl = document.getElementById('wizardSteps');
    const wizardNav = document.querySelector('.wizard-navigation');
    const wizardResult = document.getElementById('wizardResult');
    const steps = getWizardSteps();
    
    if (currentWizardStep >= steps.length) {
        // Show result
        wizardStepsEl.style.display = 'none';
        wizardNav.style.display = 'none';
        wizardResult.style.display = 'block';
        generateWizardMessage();
        return;
    }
    
    wizardStepsEl.style.display = 'block';
    wizardNav.style.display = 'flex';
    wizardResult.style.display = 'none';
    
    const step = steps[currentWizardStep];
    let html = `
        <div class="wizard-step">
            <div class="wizard-progress" style="margin-bottom: 24px;">
                <div style="color: var(--text-secondary); font-size: 0.9rem;">
                    Step ${currentWizardStep + 1} of ${steps.length}
                </div>
                <div style="width: 100%; height: 4px; background: var(--bg-secondary); border-radius: 2px; margin-top: 8px;">
                    <div style="width: ${((currentWizardStep + 1) / steps.length) * 100}%; height: 100%; background: var(--primary-color); border-radius: 2px; transition: width 0.3s;"></div>
                </div>
            </div>
            <h3 style="margin-bottom: 24px; color: var(--text-primary);">${escapeHtml(step.question)}</h3>
    `;
    
    if (step.type === 'yesno') {
        const value = wizardData[step.key];
        html += `
            <div class="wizard-options" style="display: flex; gap: 16px; margin-bottom: 24px;">
                <button 
                    type="button" 
                    onclick="setWizardValue('${step.key}', true)" 
                    class="btn-secondary" 
                    style="flex: 1; padding: 16px; font-size: 1rem; ${value === true ? 'background: var(--primary-color); color: white; border-color: var(--primary-color);' : ''}"
                >
                    Yes
                </button>
                <button 
                    type="button" 
                    onclick="setWizardValue('${step.key}', false)" 
                    class="btn-secondary" 
                    style="flex: 1; padding: 16px; font-size: 1rem; ${value === false ? 'background: var(--primary-color); color: white; border-color: var(--primary-color);' : ''}"
                >
                    No
                </button>
            </div>
        `;
    } else if (step.type === 'choice') {
        const value = wizardData[step.key];
        html += `<div class="wizard-options" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; margin-bottom: 24px;">`;
        (step.options || []).forEach(opt => {
            const active = value === opt.value;
            html += `
                <button
                    type="button"
                    onclick="setWizardValue('${step.key}', '${escapeHtml(opt.value)}')"
                    class="btn-secondary"
                    style="text-align: left; align-items: flex-start; justify-content: flex-start; flex-direction: column; gap: 6px; padding: 16px; ${active ? 'background: var(--primary-color); color: white; border-color: var(--primary-color);' : ''}"
                >
                    <div style="font-size: 1.05rem; font-weight: 700;">${escapeHtml(opt.label)}</div>
                    ${opt.description ? `<div style="font-size: 0.9rem; opacity: 0.9;">${escapeHtml(opt.description)}</div>` : ''}
                </button>
            `;
        });
        html += `</div>`;
    } else if (step.type === 'text') {
        html += `
            <div class="form-group">
                <input 
                    type="text" 
                    id="wizardInput" 
                    class="form-input" 
                    placeholder="${step.placeholder || ''}"
                    value="${escapeHtml(wizardData[step.key] || '')}"
                    ${step.pattern ? `pattern="${step.pattern}"` : ''}
                    ${step.required ? 'required' : ''}
                    style="width: 100%; padding: 14px 18px; background: var(--bg-color); border: 2px solid var(--border-color); border-radius: 12px; color: var(--text-primary); font-size: 1rem;"
                    onkeypress="if(event.key === 'Enter') wizardNext()"
                >
            </div>
        `;
    } else if (step.type === 'number') {
        html += `
            <div class="form-group">
                <input 
                    type="number" 
                    id="wizardInput" 
                    class="form-input" 
                    placeholder="${step.placeholder || ''}"
                    value="${wizardData[step.key] || ''}"
                    min="${step.min || ''}"
                    max="${step.max || ''}"
                    style="width: 100%; padding: 14px 18px; background: var(--bg-color); border: 2px solid var(--border-color); border-radius: 12px; color: var(--text-primary); font-size: 1rem;"
                    onkeypress="if(event.key === 'Enter') wizardNext()"
                >
            </div>
        `;
    } else if (step.type === 'select') {
        const isCaprover = step.selectKind === 'caprover';
        const selectPlaceholder = isCaprover
            ? '-- Select a CapRover app (optional) --'
            : '-- Select a repository (optional) --';
        const selectHelp = isCaprover
            ? (wizardCaproverApps.length === 0
                ? 'No apps returned from CapRover. Check credentials or create an app first; you can still continue without selecting.'
                : 'The container HTTP port shown is read from CapRover and used in the generated prompt (listen on process.env.PORT in code).')
            : 'Select a GitHub repository to include in the Cursor AI message';
        html += `
            <div class="form-group">
                <select 
                    id="wizardInput" 
                    class="form-input" 
                    style="width: 100%; padding: 14px 18px; background: var(--bg-color); border: 2px solid var(--border-color); border-radius: 12px; color: var(--text-primary); font-size: 1rem; cursor: pointer;"
                    ${step.required ? 'required' : ''}
                >
                    <option value="">${escapeHtml(selectPlaceholder)}</option>
                    ${step.options.map(opt => `
                        <option value="${escapeHtml(opt.value)}" ${wizardData[step.key] === opt.value ? 'selected' : ''}>
                            ${escapeHtml(opt.label)}
                        </option>
                    `).join('')}
                </select>
                <small style="display: block; margin-top: 8px; color: var(--text-secondary);">
                    ${escapeHtml(selectHelp)}
                </small>
            </div>
        `;
    } else if (step.type === 'checkboxes') {
        const showCustomPanel = wizardCustomEnvVarsExpanded;
        html += '<div class="wizard-checkboxes" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 12px; margin-bottom: 16px;">';
        step.options.forEach(option => {
            const isChecked = wizardData[step.key].includes(option);
            html += `
                <label class="checkbox-label" style="padding: 12px; background: var(--bg-secondary); border-radius: 8px; border: 2px solid ${isChecked ? 'var(--primary-color)' : 'var(--border-color)'}; cursor: pointer; transition: all 0.2s;">
                    <input 
                        type="checkbox" 
                        value="${escapeHtml(option)}"
                        ${isChecked ? 'checked' : ''}
                        onchange="toggleWizardVar('${escapeHtml(option)}')"
                        style="margin-right: 8px;"
                    >
                    <span>${escapeHtml(option)}</span>
                </label>
            `;
        });
        html += '</div>';
        html += `
            <div style="display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 16px; align-items: center;">
                <button type="button" class="btn-secondary" onclick="wizardToggleCustomEnvVarsPanel()" style="display: inline-flex; align-items: center; gap: 8px;">
                    ${showCustomPanel ? 'Hide custom variables' : 'Add custom variables'}
                </button>
                <button type="button" class="btn-secondary" onclick="copyWizardEnvVarsForCapRover()" style="display: inline-flex; align-items: center; gap: 8px;">
                    Copy all for CapRover
                </button>
            </div>
            <small style="display: block; margin-bottom: 12px; color: var(--text-secondary);">
                Copy uses <code style="font-size: 0.85em;">KEY=</code> lines (empty values) so you can paste into CapRover or a <code style="font-size: 0.85em;">.env</code> file and fill in secrets.
            </small>
            <div id="wizardCustomEnvVarsWrap" style="display: ${showCustomPanel ? 'block' : 'none'};">
                <div class="form-group" style="margin-bottom: 0;">
                    <label for="wizardCustomEnvVarsInput" style="display: block; margin-bottom: 8px; color: var(--text-secondary); font-size: 0.9rem;">Custom names (one per line)</label>
                    <textarea
                        id="wizardCustomEnvVarsInput"
                        class="form-input"
                        placeholder="MY_CUSTOM_KEY\nANOTHER_SECRET"
                        oninput="wizardSyncCustomEnvVars()"
                        style="width: 100%; min-height: 120px; padding: 14px 18px; background: var(--bg-color); border: 2px solid var(--border-color); border-radius: 12px; color: var(--text-primary); font-size: 1rem; font-family: ui-monospace, monospace; resize: vertical;"
                    >${escapeHtml(wizardData.customEnvVars || '')}</textarea>
                </div>
            </div>
        `;
    } else if (step.type === 'textarea') {
        html += `
            <div class="form-group">
                <textarea 
                    id="wizardInput" 
                    class="form-input" 
                    placeholder="${step.placeholder || ''}"
                    ${step.required ? 'required' : ''}
                    style="width: 100%; min-height: 200px; padding: 14px 18px; background: var(--bg-color); border: 2px solid var(--border-color); border-radius: 12px; color: var(--text-primary); font-size: 1rem; font-family: inherit; resize: vertical;"
                >${escapeHtml(wizardData[step.key] || '')}</textarea>
            </div>
        `;
    }
    
    html += '</div>';
    wizardStepsEl.innerHTML = html;
    
    // Update navigation buttons
    const prevBtn = document.getElementById('wizardPrevBtn');
    const nextBtn = document.getElementById('wizardNextBtn');
    if (prevBtn) prevBtn.style.display = currentWizardStep === 0 ? 'none' : 'inline-flex';
    if (nextBtn) {
        if (currentWizardStep === steps.length - 1) {
            nextBtn.textContent = 'Generate Message →';
        } else {
            nextBtn.textContent = 'Next →';
        }
    }
    
    // Focus input if it exists
    const input = document.getElementById('wizardInput');
    if (input) {
        setTimeout(() => input.focus(), 100);
    }
}

function setWizardValue(key, value) {
    wizardData[key] = value;
    renderWizardStep();
}

function wizardSyncCustomEnvVars() {
    const el = document.getElementById('wizardCustomEnvVarsInput');
    if (el) wizardData.customEnvVars = el.value;
}

function wizardToggleCustomEnvVarsPanel() {
    wizardSyncCustomEnvVars();
    wizardCustomEnvVarsExpanded = !wizardCustomEnvVarsExpanded;
    renderWizardStep();
}

function copyWizardEnvVarsForCapRover() {
    wizardSyncCustomEnvVars();
    const names = getWizardMergedEnvVarNames();
    if (names.length === 0) {
        showToast('Select at least one variable or add a custom name', 'warning');
        return;
    }
    const text = names.map(n => `${n}=`).join('\n');
    navigator.clipboard.writeText(text).then(() => {
        showToast('Copied KEY= lines for CapRover', 'success');
    }).catch(() => {
        showToast('Failed to copy', 'error');
    });
}

function toggleWizardVar(varName) {
    wizardSyncCustomEnvVars();
    const index = wizardData.selectedVars.indexOf(varName);
    if (index > -1) {
        wizardData.selectedVars.splice(index, 1);
    } else {
        wizardData.selectedVars.push(varName);
    }
    renderWizardStep();
}

function wizardNext() {
    const steps = getWizardSteps();
    const step = steps[currentWizardStep];
    
    // Validate current step
    if (step.type === 'text' || step.type === 'number' || step.type === 'textarea' || step.type === 'select') {
        const input = document.getElementById('wizardInput');
        if (!input) return;
        
        if (step.required && !input.value.trim()) {
            showToast('Please fill in this field', 'warning');
            input.focus();
            return;
        }
        
        // Only validate pattern if it exists and value is provided
        if (step.pattern && input.value && !new RegExp(`^${step.pattern}$`).test(input.value)) {
            showToast('Invalid format', 'warning');
            input.focus();
            return;
        }
        
        wizardData[step.key] = input.value.trim();
        if (step.type === 'select' && step.selectKind === 'caprover') {
            const app = wizardCaproverApps.find(a => a.appName === wizardData.caproverApp);
            wizardData.port =
                app && app.containerHttpPort != null ? String(app.containerHttpPort) : '';
        }
    } else if (step.type === 'checkboxes') {
        wizardSyncCustomEnvVars();
    } else if ((step.type === 'yesno' || step.type === 'choice') && (wizardData[step.key] === null || wizardData[step.key] === '')) {
        showToast('Please select an option', 'warning');
        return;
    }
    
    currentWizardStep++;
    renderWizardStep();
}

function wizardPrevious() {
    if (currentWizardStep > 0) {
        currentWizardStep--;
        renderWizardStep();
    }
}

function generateWizardMessage() {
    const type = wizardData.wizardType || 'website';
    const name = wizardData.projectName || '(name not set)';
    const port = wizardData.port;
    const envVarNames = getWizardMergedEnvVarNames();
    const varsWhere = wizardData.varsOnCapRover ? 'Environment variables are stored on CapRover.' : 'Environment variables are stored locally.';

    let message = '';

    if (type === 'website') {
        message += `Create a website called "${name}".\n\n`;
        if (wizardData.githubRepo) {
            message += `GitHub Repository: ${wizardData.githubRepo}\n\n`;
        }

        message += `This application will be hosted on CapRover. Make sure to include all necessary files for CapRover deployment, including a Dockerfile and captain-definition file.\n\n`;
        message += `${wizardData.darkMode ? 'Use dark mode styling.' : 'Use light mode styling.'}\n\n`;
        if (wizardData.caproverApp && port) {
            message += `CapRover app: ${wizardData.caproverApp}. Container HTTP port ${port} comes from CapRover; listen on process.env.PORT in the app so it matches CapRover.\n\n`;
        } else if (wizardData.caproverApp) {
            message += `CapRover app: ${wizardData.caproverApp}. Set the container HTTP port in CapRover to match what the server listens on (process.env.PORT).\n\n`;
        } else {
            message += `Select a CapRover app in the deployment UI to align the container HTTP port, or configure it in CapRover; the server should use process.env.PORT.\n\n`;
        }
        message += `${varsWhere}\n\n`;

        if (envVarNames.length > 0) {
            message += `The following environment variables are used (CapRover env var names):\n${envVarNames.map(v => `- ${v}`).join('\n')}\n\n`;
        } else {
            message += `No specific environment variables are required.\n\n`;
        }

        message += `Website Details:\n${wizardData.details}\n\n`;
        message += `Features to start with:\n${wizardData.featuresToStart}\n\n`;
        message += `Also create a Windows batch file in the repo (e.g. push_to_github.bat) that can auto-push changes to GitHub (git add/commit/push). Include usage instructions in the README.\n\n`;
        message += `Important: This application needs to run npm install during the build process. Make sure the Dockerfile includes npm install commands.\n\n`;
        message += `Please create this website with all the necessary files, including server setup, frontend, and any required configurations.`;
    } else {
        // Discord Bot
        const commandStyle = wizardData.discordCommandStyle || 'prefix';
        const prefix = wizardData.discordPrefix || '!';
        const merged = getWizardMergedEnvVarNames();
        const selectedVars = merged.length > 0
            ? merged
            : [
                'DISCORD_APPLICATION_ID',
                'DISCORD_SECRET',
                'DISCORD_PUBLIC_KEY',
                'DISCORD_BOT_TOKEN',
                'DISCORD_PREFIX',
                'DISCORD_PREFIX_ENABLED',
                'DISCORD_GUILD_ID',
                'mongoDB_URI',
                'mongoDB_DB',
                'mongoDB_User',
                'mongoDB_Password',
                'admin_role_ID',
                'mod_role_ID',
                'member_role_ID',
                'mongodb_atlas_email',
                'mongodb_atlas_password'
            ];

        message += `Create a Discord bot called "${name}" using Node.js and discord.js.\n\n`;
        if (wizardData.githubRepo) {
            message += `GitHub Repository: ${wizardData.githubRepo}\n\n`;
        }

        message += `This bot will be hosted on CapRover. Include a Dockerfile and captain-definition for CapRover deployment.\n\n`;
        if (wizardData.caproverApp && port) {
            message += `CapRover app: ${wizardData.caproverApp}. Container HTTP port ${port} comes from CapRover; run the HTTP server on process.env.PORT with a health endpoint at /api/health.\n\n`;
        } else if (wizardData.caproverApp) {
            message += `CapRover app: ${wizardData.caproverApp}. Set the container HTTP port in CapRover; run the HTTP server on process.env.PORT with a health endpoint at /api/health.\n\n`;
        } else {
            message += `Run an HTTP server on process.env.PORT with a health endpoint at /api/health. Align the CapRover container HTTP port in the dashboard.\n\n`;
        }
        message += `${varsWhere}\n\n`;
        message += `CapRover environment variable names to use (include these EXACT names in the code and README):\n`;
        message += `- PORT\n${selectedVars.map(v => `- ${v}`).join('\n')}\n\n`;

        message += `Discord setup instructions to include in README:\n`;
        message += `- Create a Discord Application at https://discord.com/developers/applications\n`;
        message += `- Get Application ID + Public Key\n`;
        message += `- Create a Bot, copy the Bot Token\n`;
        message += `- Invite bot via OAuth2 URL generator (scopes: bot + applications.commands if using slash commands)\n\n`;

        message += `Command style:\n- ${commandStyle}\n`;
        if (commandStyle !== 'slash') {
            message += `- Prefix: ${prefix}\n`;
        }
        message += `\n`;

        if (wizardData.discordDashboard) {
            message += `Dashboard requirement:\n- Build a web-based dashboard website for this Discord bot to manage commands/data/tools/etc.\n- Include authentication and an admin/mod role based permission system.\n\n`;
        }

        message += `Bot Details / Behavior:\n${wizardData.details}\n\n`;
        message += `Features to start with:\n${wizardData.featuresToStart}\n\n`;

        message += `Also create a Windows batch file in the repo (e.g. push_to_github.bat) that can auto-push changes to GitHub (git add/commit/push). Include usage instructions in the README.\n\n`;
        message += `Important: This application needs to run npm install during the build process. Make sure the Dockerfile includes npm install commands.\n\n`;
        message += `Please create the bot with a clean project structure, clear README, and sane defaults.`;
    }

    document.getElementById('wizardMessage').value = message;
}

function copyWizardMessage() {
    const message = document.getElementById('wizardMessage').value;
    navigator.clipboard.writeText(message).then(() => {
        showToast('Message copied to clipboard!', 'success');
    }).catch(() => {
        showToast('Failed to copy message', 'error');
    });
}

function resetWizard() {
    initWizard();
}

// =========================
// Image Management
// =========================
async function loadImages() {
    console.log('[loadImages] Starting to load images...');
    const imagesLoading = document.getElementById('imagesLoading');
    const imagesList = document.getElementById('imagesList');
    const imagesError = document.getElementById('imagesError');
    const imagesErrorContent = document.getElementById('imagesErrorContent');
    const imagesContent = document.getElementById('imagesContent');

    imagesLoading.style.display = 'block';
    imagesList.style.display = 'none';
    imagesError.style.display = 'none';

    try {
        // First get apps list
        const appsResponse = await fetch('/api/apps', {
            credentials: 'include'
        });

        if (appsResponse.status === 401) {
            showLogin();
            return;
        }

        const appsData = await appsResponse.json();

        if (!appsData.success) {
            throw new Error(appsData.error || 'Failed to load apps');
        }

        const apps = appsData.apps || [];

        if (apps.length === 0) {
            imagesContent.innerHTML = '<div class="empty-state"><p>No CapRover apps found.</p></div>';
            imagesLoading.style.display = 'none';
            imagesList.style.display = 'block';
            return;
        }

        // Fetch image counts for all apps in parallel
        const appsWithCounts = await Promise.all(
            apps.map(async (app) => {
                try {
                    const countResponse = await fetch(`/api/apps/${encodeURIComponent(app.appName)}/images/count`, {
                        credentials: 'include'
                    });
                    if (countResponse.ok) {
                        const countData = await countResponse.json();
                        // Use null to indicate "unknown" vs 0 which means "no images"
                        const count = countData.imageCount !== undefined ? countData.imageCount : null;
                        return { ...app, imageCount: count };
                    }
                    return { ...app, imageCount: null }; // null = unknown
                } catch (error) {
                    console.warn(`Failed to get image count for ${app.appName}:`, error);
                    return { ...app, imageCount: null }; // null = unknown
                }
            })
        );

        let html = '<div style="display: grid; gap: 16px;">';
        appsWithCounts.forEach(app => {
            html += `
                <div class="manage-item-single" style="display: flex; justify-content: space-between; align-items: center; padding: 16px; background: var(--bg-color); border-radius: 12px; border: 1px solid var(--border-color);" data-app-name="${escapeHtml(app.appName)}">
                    <div style="flex: 1;">
                        <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">${escapeHtml(app.appName)}</div>
                        <div style="font-size: 0.85rem; color: var(--text-secondary);">
                            Port: ${app.containerHttpPort || 'N/A'} | Instances: ${app.instanceCount || 1} | Images: <span id="image-count-${escapeHtml(app.appName)}">${app.imageCount !== null && app.imageCount !== undefined ? app.imageCount : '?'}</span>
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        <a href="https://captain.kpanel.xyz/#/apps/details/${escapeHtml(app.appName)}" target="_blank" class="manage-app-link" title="Open in CapRover">
                            🔗 CapRover
                        </a>
                        <button onclick="deleteOldImages('${escapeHtml(app.appName)}')" class="btn-danger" style="width: auto; padding: 8px 16px; font-size: 0.9rem;">
                            Delete Old Images
                        </button>
                    </div>
                </div>
            `;
        });
        html += '</div>';

        imagesContent.innerHTML = html;
        imagesLoading.style.display = 'none';
        imagesList.style.display = 'block';
        console.log(`[loadImages] ✅ Successfully loaded ${appsWithCounts.length} apps with image counts`);
    } catch (error) {
        console.error('[loadImages] ❌ Error loading images:', error);
        imagesLoading.style.display = 'none';
        imagesErrorContent.textContent = error.message || 'Failed to load apps';
        imagesError.style.display = 'block';
    }
}

async function updateImageCount(appName) {
    try {
        const countResponse = await fetch(`/api/apps/${encodeURIComponent(appName)}/images/count`, {
            credentials: 'include'
        });
        if (countResponse.ok) {
            const countData = await countResponse.json();
            const countElement = document.getElementById(`image-count-${appName}`);
            if (countElement) {
                const count = countData.imageCount !== undefined ? countData.imageCount : null;
                countElement.textContent = count !== null ? count : '?';
            }
        }
    } catch (error) {
        console.warn(`Failed to update image count for ${appName}:`, error);
        const countElement = document.getElementById(`image-count-${appName}`);
        if (countElement) {
            countElement.textContent = '?';
        }
    }
}

function deleteOldImages(appName) {
    showConfirmModal(
        'Delete Old Images',
        `This will delete all Docker images for "${appName}" except the 5 most recent. This action cannot be undone. Continue?`,
        async () => {
            try {
                const response = await fetch(`/api/apps/${encodeURIComponent(appName)}/images/old`, {
                    method: 'DELETE',
                    credentials: 'include'
                });

                if (response.status === 401) {
                    showLogin();
                    throw new Error('Session expired. Please login again.');
                }

                const data = await response.json();

                if (!data.success) {
                    throw new Error(data.error || 'Failed to delete old images');
                }

                showToast(`Deleted ${data.deleted || 0} old image(s) for ${appName}. Kept ${data.kept || 5} most recent.`, 'success');

                // Update the image count for this app
                await updateImageCount(appName);
            } catch (error) {
                showErrorModal('Delete Failed', error.message || 'Failed to delete old images. Please try again.');
            }
        },
        'Delete',
        'danger'
    );
}

// ─── Reboot VPS recovery ─────────────────────────────────────────────────────

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// CapRover dashboard base for deep links (matches the Image Management page)
const CAPROVER_DASHBOARD = 'https://captain.kpanel.xyz';

async function loadReboot() {
    const loading = document.getElementById('rebootLoading');
    const main = document.getElementById('rebootMain');
    const errorCard = document.getElementById('rebootError');
    const errorContent = document.getElementById('rebootErrorContent');

    loading.style.display = 'block';
    main.style.display = 'none';
    errorCard.style.display = 'none';

    try {
        const [appsResponse, pinnedResponse] = await Promise.all([
            fetch('/api/apps', { credentials: 'include' }),
            fetch('/api/pinned-apps', { credentials: 'include' })
        ]);

        if (appsResponse.status === 401 || pinnedResponse.status === 401) {
            showLogin();
            return;
        }

        const appsData = await appsResponse.json();
        const pinnedData = await pinnedResponse.json();

        if (!appsData.success) {
            throw new Error(appsData.error || 'Failed to load apps');
        }
        if (!pinnedData.success) {
            throw new Error(pinnedData.error || 'Failed to load pinned services');
        }

        rebootApps = appsData.apps || [];
        pinnedApps = new Set(pinnedData.pinned || []);

        renderRebootLists();

        loading.style.display = 'none';
        main.style.display = 'block';
    } catch (error) {
        console.error('[loadReboot] Error:', error);
        loading.style.display = 'none';
        errorContent.textContent = error.message || 'Failed to load services';
        errorCard.style.display = 'block';
    }
}

function renderRebootLists() {
    const sortedApps = [...rebootApps].sort((a, b) => a.appName.localeCompare(b.appName));

    // Pinned services list
    const pinnedContainer = document.getElementById('pinnedServicesList');
    const pinnedList = sortedApps.filter(a => pinnedApps.has(a.appName));

    if (pinnedList.length === 0) {
        pinnedContainer.innerHTML = '<div class="empty-state"><p>No pinned services yet. Pin services from the list below.</p></div>';
    } else {
        let html = '<div style="display: grid; gap: 12px;">';
        pinnedList.forEach(app => {
            const name = escapeHtml(app.appName);
            html += `
                <div class="reboot-app-block">
                    <div class="manage-item-single reboot-item" data-app-name="${name}">
                        <div style="flex: 1;">
                            <div style="font-weight: 600; color: var(--text-primary); margin-bottom: 4px;">📌 ${name}</div>
                            <div style="font-size: 0.85rem; color: var(--text-secondary);">
                                Port: ${app.containerHttpPort || 'N/A'} | Instances: ${app.instanceCount || 1}
                            </div>
                        </div>
                        <div style="display: flex; gap: 8px; align-items: center;">
                            <a href="${CAPROVER_DASHBOARD}/#/apps/details/${name}" target="_blank" class="manage-app-link" title="Open in CapRover">🔗 CapRover</a>
                            <button onclick="forceBuildSingle('${name}')" class="btn-primary reboot-build-btn" style="width: auto; padding: 8px 16px; font-size: 0.9rem;" ${rebootBuilding ? 'disabled' : ''}>
                                Force Build
                            </button>
                            <button onclick="restartApp('${name}')" class="btn-secondary reboot-restart-btn" style="width: auto; padding: 8px 16px; font-size: 0.9rem;" ${rebootBuilding ? 'disabled' : ''}>
                                Restart
                            </button>
                            <button onclick="togglePin('${name}')" class="btn-secondary reboot-unpin-btn" style="width: auto; padding: 8px 16px; font-size: 0.9rem;" ${rebootBuilding ? 'disabled' : ''}>
                                Unpin
                            </button>
                        </div>
                    </div>
                    <div class="reboot-console-wrap reboot-inline-console" id="console-wrap-${name}" style="display: none;">
                        <div class="reboot-console-header">
                            <span>Build log — ${name}</span>
                            <button onclick="clearRebootConsole('${name}')" class="btn-secondary" style="width: auto; padding: 6px 12px; font-size: 0.85rem;">Clear</button>
                        </div>
                        <div class="reboot-console" id="console-${name}"></div>
                    </div>
                </div>
            `;
        });
        html += '</div>';
        pinnedContainer.innerHTML = html;
    }

    // All services list with pin toggles
    const allContainer = document.getElementById('allServicesList');
    if (sortedApps.length === 0) {
        allContainer.innerHTML = '<div class="empty-state"><p>No CapRover apps found.</p></div>';
    } else {
        let html = '<div style="display: grid; gap: 8px;">';
        sortedApps.forEach(app => {
            const name = escapeHtml(app.appName);
            const isPinned = pinnedApps.has(app.appName);
            html += `
                <div class="manage-item-single reboot-item" data-app-name="${name}">
                    <button onclick="togglePin('${name}')" class="pin-toggle ${isPinned ? 'pinned' : ''}" title="${isPinned ? 'Unpin' : 'Pin'}" ${rebootBuilding ? 'disabled' : ''}>
                        ${isPinned ? '★' : '☆'}
                    </button>
                    <div style="flex: 1;">
                        <div style="font-weight: 600; color: var(--text-primary);">${name}</div>
                        <div style="font-size: 0.85rem; color: var(--text-secondary);">
                            Port: ${app.containerHttpPort || 'N/A'} | Instances: ${app.instanceCount || 1}
                        </div>
                    </div>
                    <a href="${CAPROVER_DASHBOARD}/#/apps/details/${name}" target="_blank" class="manage-app-link" title="Open in CapRover">🔗 CapRover</a>
                </div>
            `;
        });
        html += '</div>';
        allContainer.innerHTML = html;
    }

    // Toggle the "Force Build All Pinned" button
    const allBtn = document.getElementById('forceBuildAllBtn');
    if (allBtn) {
        allBtn.disabled = rebootBuilding || pinnedApps.size === 0;
    }
}

async function togglePin(appName) {
    if (rebootBuilding) return;
    const isPinned = pinnedApps.has(appName);

    try {
        let response;
        if (isPinned) {
            response = await fetch(`/api/pinned-apps/${encodeURIComponent(appName)}`, {
                method: 'DELETE',
                credentials: 'include'
            });
        } else {
            response = await fetch('/api/pinned-apps', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ appName })
            });
        }

        if (response.status === 401) {
            showLogin();
            return;
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Failed to update pin');
        }

        if (isPinned) {
            pinnedApps.delete(appName);
            showToast(`Unpinned "${appName}"`, 'info');
        } else {
            pinnedApps.add(appName);
            showToast(`Pinned "${appName}"`, 'success');
        }

        renderRebootLists();
    } catch (error) {
        showErrorModal('Pin Failed', error.message || 'Failed to update pin. Please try again.');
    }
}

// ── Console helpers (each app has its own inline console under its row) ──

function rebootLog(message, type = 'info', appName = activeConsoleApp) {
    if (!appName) return;
    const consoleEl = document.getElementById(`console-${appName}`);
    if (!consoleEl) return;
    const line = document.createElement('div');
    line.className = `rc-line rc-${type}`;
    const time = new Date().toLocaleTimeString();
    line.textContent = `[${time}] ${message}`;
    consoleEl.appendChild(line);
    consoleEl.scrollTop = consoleEl.scrollHeight;
}

function clearRebootConsole(appName) {
    const consoleEl = document.getElementById(`console-${appName}`);
    if (consoleEl) consoleEl.innerHTML = '';
}

// Enable/disable the reboot controls without re-rendering (which would wipe live consoles).
function setRebootBusy(busy) {
    rebootBuilding = busy;
    const page = document.getElementById('page-reboot');
    if (page) {
        page.querySelectorAll('.reboot-build-btn, .reboot-unpin-btn, .reboot-restart-btn, .pin-toggle').forEach(b => {
            b.disabled = busy;
        });
    }
    const allBtn = document.getElementById('forceBuildAllBtn');
    if (allBtn) allBtn.disabled = busy || pinnedApps.size === 0;
}

// Force build one app, streaming its logs into that app's own inline console.
// Assumes buttons are already disabled by the caller (forceBuildSingle / forceBuildAllPinned).
async function forceBuildApp(appName) {
    // Route all logs for this run into this app's console, reveal it, and scroll to it.
    activeConsoleApp = appName;
    const wrap = document.getElementById(`console-wrap-${appName}`);
    if (wrap) {
        wrap.style.display = 'block';
        wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    clearRebootConsole(appName);

    rebootLog(`▶ Triggering force build for ${appName}...`, 'cmd');

    try {
        const response = await fetch(`/api/apps/${encodeURIComponent(appName)}/force-build`, {
            method: 'POST',
            credentials: 'include'
        });

        if (response.status === 401) {
            showLogin();
            throw new Error('Session expired. Please login again.');
        }

        const data = await response.json();
        if (!data.success) {
            throw new Error(data.error || 'Failed to trigger build');
        }

        rebootLog(`✓ Build triggered for ${appName}. Streaming logs...`, 'success');
        await pollBuildLogs(appName);
    } catch (error) {
        rebootLog(`✗ ${appName}: ${error.message}`, 'error');
    }
}

// Poll CapRover build logs and stream new lines until the build finishes.
async function pollBuildLogs(appName) {
    const maxAttempts = 120; // ~5 minutes at 2.5s intervals
    let lastPrintedAbs = null; // absolute line number printed so far (CapRover log buffer rolls)
    let sawBuilding = false;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        await sleep(2500);

        let data;
        try {
            const response = await fetch(`/api/apps/${encodeURIComponent(appName)}/build-logs`, {
                credentials: 'include'
            });
            if (response.status === 401) {
                showLogin();
                rebootLog(`✗ ${appName}: session expired`, 'error');
                return;
            }
            data = await response.json();
        } catch (error) {
            // Transient error (e.g. app briefly unreachable right after reboot) - keep trying
            rebootLog(`… ${appName}: waiting (${error.message})`, 'dim');
            continue;
        }

        if (!data.success) {
            rebootLog(`✗ ${appName}: ${data.error || 'failed to read build logs'}`, 'error');
            return;
        }

        // CapRover exposes a rolling buffer: logs.lines[] with logs.firstLineNumber = absolute
        // index of lines[0]. Print only lines we haven't printed yet, tolerating buffer rolls.
        const lines = (data.logs && Array.isArray(data.logs.lines)) ? data.logs.lines : [];
        const firstLineNumber = (data.logs && typeof data.logs.firstLineNumber === 'number') ? data.logs.firstLineNumber : 0;
        let startIdx;
        if (lastPrintedAbs === null) {
            startIdx = 0; // first poll: print whatever is currently buffered
        } else {
            startIdx = lastPrintedAbs - firstLineNumber;
            if (startIdx < 0) {
                rebootLog('  [[ …earlier build output truncated… ]]', 'dim');
                startIdx = 0;
            }
        }
        for (let i = startIdx; i < lines.length; i++) {
            const text = String(lines[i]).replace(/\s+$/, '');
            if (text) rebootLog(`  ${text}`, 'dim');
        }
        lastPrintedAbs = firstLineNumber + lines.length;

        if (data.isAppBuilding) {
            sawBuilding = true;
        } else if (sawBuilding || attempt > 3) {
            // Build finished (or never started because there was nothing to build)
            if (data.isBuildFailed) {
                rebootLog(`✗ Build failed for ${appName}`, 'error');
            } else {
                rebootLog(`✔ Build complete for ${appName}`, 'success');
            }
            return;
        }
    }

    rebootLog(`⏱ Timed out waiting for ${appName} build to finish (still building?)`, 'error');
}

// Force build a single pinned service (from its own "Force Build" button).
async function forceBuildSingle(appName) {
    if (rebootBuilding) return;
    setRebootBusy(true);
    try {
        await forceBuildApp(appName);
    } finally {
        setRebootBusy(false);
    }
}

// Force build every pinned service, one at a time (sequential). Each app's output
// streams into its own console as it becomes the one currently building.
async function forceBuildAllPinned() {
    if (rebootBuilding) return;

    const targets = [...rebootApps]
        .map(a => a.appName)
        .filter(name => pinnedApps.has(name))
        .sort((a, b) => a.localeCompare(b));

    if (targets.length === 0) {
        showToast('No pinned services to build', 'info');
        return;
    }

    setRebootBusy(true);
    try {
        for (const appName of targets) {
            await forceBuildApp(appName);
        }
    } finally {
        setRebootBusy(false);
    }

    showToast(`Force build run complete (${targets.length} service(s))`, 'success');
}

// ─── System / VPS overview + service health ──────────────────────────────────

let logsInterval = null;

function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return 'N/A';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1) return `${gb.toFixed(1)} GB`;
    const mb = bytes / (1024 * 1024);
    return `${mb.toFixed(0)} MB`;
}

async function loadSystem() {
    const loading = document.getElementById('systemLoading');
    const overview = document.getElementById('systemOverview');
    const errorCard = document.getElementById('systemError');
    const errorContent = document.getElementById('systemErrorContent');

    loading.style.display = 'block';
    overview.style.display = 'none';
    errorCard.style.display = 'none';

    try {
        const response = await fetch('/api/system/overview', { credentials: 'include' });
        if (response.status === 401) { showLogin(); return; }
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to load system overview');

        renderSystemOverview(data);
        loading.style.display = 'none';
        overview.style.display = 'block';
    } catch (error) {
        console.error('[loadSystem] Error:', error);
        loading.style.display = 'none';
        errorContent.textContent = error.message || 'Failed to load system info';
        errorCard.style.display = 'block';
    }

    // Kick off the health grid alongside the overview
    loadHealthGrid();
}

function renderSystemOverview(data) {
    const overview = document.getElementById('systemOverview');
    const v = data.version || {};
    const lb = data.loadBalancer || {};
    const nodes = data.nodes || [];

    let cards = '<div class="sys-grid">';

    // CapRover version
    const updateBadge = v.canUpdate
        ? `<span class="sys-badge sys-badge-warn">update available → ${escapeHtml(String(v.latestVersion || ''))}</span>`
        : `<span class="sys-badge sys-badge-ok">up to date</span>`;
    cards += `
        <div class="sys-card">
            <div class="sys-card-label">CapRover</div>
            <div class="sys-card-value">v${escapeHtml(String(v.currentVersion || '?'))}</div>
            <div>${v.currentVersion ? updateBadge : ''}</div>
        </div>`;

    // App / instance counts
    cards += `
        <div class="sys-card">
            <div class="sys-card-label">Services</div>
            <div class="sys-card-value">${data.appCount != null ? data.appCount : '?'}</div>
            <div class="sys-card-sub">${data.totalInstances != null ? data.totalInstances : '?'} running instance(s)</div>
        </div>`;

    // Load balancer / live traffic
    if (lb && (lb.activeConnections != null || lb.handled != null)) {
        cards += `
            <div class="sys-card">
                <div class="sys-card-label">Nginx (live)</div>
                <div class="sys-card-value">${lb.activeConnections != null ? lb.activeConnections : '?'}</div>
                <div class="sys-card-sub">active conns · ${lb.handled != null ? lb.handled : '?'} handled</div>
            </div>`;
    }

    cards += '</div>';

    // Nodes
    if (nodes.length) {
        cards += '<h3 style="margin: 20px 0 12px;">Nodes</h3><div class="sys-grid">';
        nodes.forEach(n => {
            const cores = n.nanoCpu ? (n.nanoCpu / 1e9).toFixed(0) : '?';
            const up = String(n.state).toLowerCase() === 'ready';
            cards += `
                <div class="sys-card">
                    <div class="sys-card-label">
                        <span class="status-dot ${up ? 'up' : 'down'}"></span>
                        ${escapeHtml(String(n.hostname || n.nodeId || 'node'))}${n.isLeader ? ' 👑' : ''}
                    </div>
                    <div class="sys-card-sub">State: ${escapeHtml(String(n.state || '?'))}</div>
                    <div class="sys-card-sub">CPU: ${cores} core(s) · RAM: ${formatBytes(n.memoryBytes)}</div>
                    <div class="sys-card-sub">Docker ${escapeHtml(String(n.dockerEngineVersion || '?'))} · ${escapeHtml(String(n.ip || ''))}</div>
                </div>`;
        });
        cards += '</div>';
    }

    overview.innerHTML = cards;
}

async function loadHealthGrid() {
    const grid = document.getElementById('healthGrid');
    grid.innerHTML = '<p style="color: var(--text-secondary);">Pinging services…</p>';
    document.getElementById('systemStatus').textContent = 'checking health…';

    try {
        const response = await fetch('/api/health-check', { credentials: 'include' });
        if (response.status === 401) { showLogin(); return; }
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Health check failed');

        const results = data.results || [];
        if (results.length === 0) {
            grid.innerHTML = '<div class="empty-state"><p>No web-exposed services found.</p></div>';
            document.getElementById('systemStatus').textContent = '';
            return;
        }

        const downCount = results.filter(r => !r.up).length;
        document.getElementById('systemStatus').textContent =
            downCount === 0 ? `all ${results.length} up` : `${downCount} of ${results.length} down`;

        let html = '<div style="display: grid; gap: 8px;">';
        results.forEach(r => {
            const name = escapeHtml(r.appName);
            const statusText = r.status != null ? `HTTP ${r.status}` : (r.error ? escapeHtml(String(r.error)) : 'no response');
            const latency = r.ms != null ? `${r.ms} ms` : '';
            html += `
                <div class="manage-item-single reboot-item" data-app-name="${name}">
                    <span class="status-dot ${r.up ? 'up' : 'down'}"></span>
                    <div style="flex: 1;">
                        <div style="font-weight: 600; color: var(--text-primary);">${name}</div>
                        <div style="font-size: 0.85rem; color: var(--text-secondary);">
                            ${r.up ? '🟢 Up' : '🔴 Down'} · ${statusText} ${latency ? '· ' + latency : ''}
                        </div>
                    </div>
                    <div style="display: flex; gap: 8px; align-items: center;">
                        ${r.url ? `<a href="${escapeHtml(r.url)}" target="_blank" class="manage-app-link" title="Open">🔗 Open</a>` : ''}
                        <button onclick="restartApp('${name}')" class="btn-secondary reboot-restart-btn" style="width: auto; padding: 8px 16px; font-size: 0.9rem;">
                            Restart
                        </button>
                    </div>
                </div>`;
        });
        html += '</div>';
        grid.innerHTML = html;
    } catch (error) {
        console.error('[loadHealthGrid] Error:', error);
        grid.innerHTML = `<div class="error-card" style="display:block;">${escapeHtml(error.message || 'Health check failed')}</div>`;
        document.getElementById('systemStatus').textContent = '';
    }
}

function restartApp(appName) {
    showConfirmModal(
        'Restart Service',
        `Restart "${appName}"? This scales it to 0 and back, so expect a few seconds of downtime.`,
        async () => {
            try {
                showToast(`Restarting "${appName}"…`, 'info');
                const response = await fetch(`/api/apps/${encodeURIComponent(appName)}/restart`, {
                    method: 'POST',
                    credentials: 'include'
                });
                if (response.status === 401) { showLogin(); throw new Error('Session expired. Please login again.'); }
                const data = await response.json();
                if (!data.success) throw new Error(data.error || 'Failed to restart');
                showToast(`Restarted "${appName}"`, 'success');
                // Re-check health after a moment to reflect the restart
                setTimeout(() => { if (currentPage === 'system') loadHealthGrid(); }, 4000);
            } catch (error) {
                showErrorModal('Restart Failed', error.message || 'Failed to restart the service.');
            }
        },
        'Restart',
        'danger'
    );
}

// ─── App runtime logs viewer ─────────────────────────────────────────────────

async function initLogsPage() {
    const select = document.getElementById('logsAppSelect');
    // Only (re)load the app list if empty, so we keep the current selection
    if (select.options.length > 0) return;

    try {
        const response = await fetch('/api/apps', { credentials: 'include' });
        if (response.status === 401) { showLogin(); return; }
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to load apps');

        const apps = (data.apps || []).slice().sort((a, b) => a.appName.localeCompare(b.appName));
        select.innerHTML = apps.map(a =>
            `<option value="${escapeHtml(a.appName)}">${escapeHtml(a.appName)}</option>`
        ).join('');
    } catch (error) {
        console.error('[initLogsPage] Error:', error);
        select.innerHTML = '';
        showToast(error.message || 'Failed to load apps', 'error');
    }
}

async function loadAppLogs() {
    const select = document.getElementById('logsAppSelect');
    const appName = select.value;
    if (!appName) { showToast('Select a service first', 'info'); return; }

    const consoleEl = document.getElementById('appLogsConsole');
    document.getElementById('logsHeader').textContent = `Runtime logs — ${appName}`;
    document.getElementById('logsStatus').textContent = 'loading…';

    try {
        const response = await fetch(`/api/apps/${encodeURIComponent(appName)}/logs`, { credentials: 'include' });
        if (response.status === 401) { showLogin(); return; }
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Failed to load logs');

        const text = (data.logs || '').trim();
        // Preserve scroll-at-bottom behaviour
        consoleEl.textContent = text || '(no logs returned)';
        consoleEl.scrollTop = consoleEl.scrollHeight;
        document.getElementById('logsStatus').textContent = `updated ${new Date().toLocaleTimeString()}`;
    } catch (error) {
        console.error('[loadAppLogs] Error:', error);
        document.getElementById('logsStatus').textContent = '';
        showErrorModal('Logs Failed', error.message || 'Failed to load logs.');
    }
}

function clearAppLogs() {
    document.getElementById('appLogsConsole').textContent = '';
}

function toggleLogsAutoRefresh() {
    const cb = document.getElementById('logsAutoRefresh');
    if (logsInterval) { clearInterval(logsInterval); logsInterval = null; }
    if (cb.checked) {
        loadAppLogs();
        logsInterval = setInterval(() => {
            if (currentPage === 'logs') loadAppLogs();
            else { clearInterval(logsInterval); logsInterval = null; }
        }, 5000);
    }
}
