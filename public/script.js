const form = document.getElementById('createForm');
const submitBtn = document.getElementById('submitBtn');
const resultCard = document.getElementById('result');
const errorCard = document.getElementById('error');
const resultContent = document.getElementById('resultContent');
const errorContent = document.getElementById('errorContent');

// Admin form elements
const adminFormCard = document.getElementById('adminFormCard');
const adminForm = document.getElementById('adminForm');
const adminSubmitBtn = document.getElementById('adminSubmitBtn');
const adminError = document.getElementById('adminError');
const adminErrorContent = document.getElementById('adminErrorContent');

// Check if admin exists on page load
async function checkAdminExists() {
    try {
        const response = await fetch('/api/check-admin');
        const data = await response.json();
        
        if (!data.mongoConfigured) {
            console.warn('MongoDB not configured');
            adminFormCard.style.display = 'none';
            return;
        }
        
        if (!data.adminExists) {
            // Show admin creation form
            adminFormCard.style.display = 'block';
            form.style.display = 'none';
        } else {
            // Show main form
            adminFormCard.style.display = 'none';
            form.style.display = 'block';
        }
    } catch (error) {
        console.error('Error checking admin:', error);
        // Show main form if check fails
        adminFormCard.style.display = 'none';
        form.style.display = 'block';
    }
}

// Admin form submission
adminForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    adminError.style.display = 'none';
    adminSubmitBtn.disabled = true;
    const btnText = adminSubmitBtn.querySelector('.btn-text');
    const btnLoader = adminSubmitBtn.querySelector('.btn-loader');
    btnText.style.display = 'none';
    btnLoader.style.display = 'inline-block';
    
    const formData = {
        username: document.getElementById('adminUsername').value.trim(),
        password: document.getElementById('adminPassword').value.trim()
    };
    
    try {
        const response = await fetch('/api/create-admin', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
        const data = await response.json();
        
        if (data.success) {
            // Hide admin form and show main form
            adminFormCard.style.display = 'none';
            form.style.display = 'block';
            alert('Admin account created successfully!');
        } else {
            throw new Error(data.error || 'Failed to create admin account');
        }
    } catch (error) {
        adminErrorContent.textContent = error.message || 'Failed to create admin account. Please try again.';
        adminError.style.display = 'block';
    } finally {
        adminSubmitBtn.disabled = false;
        btnText.style.display = 'inline-block';
        btnLoader.style.display = 'none';
    }
});

// Check admin on page load
checkAdminExists();

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
        githubUsername: document.getElementById('githubUsername').value.trim(),
        githubPassword: document.getElementById('githubPassword').value.trim()
    };
    
    try {
        const response = await fetch('/api/create-website', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(formData)
        });
        
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
projectNameInput.addEventListener('input', (e) => {
    const value = e.target.value;
    const isValid = /^[a-z0-9-]+$/.test(value) || value === '';
    
    if (value && !isValid) {
        e.target.setCustomValidity('Only lowercase letters, numbers, and hyphens allowed');
    } else {
        e.target.setCustomValidity('');
    }
});
