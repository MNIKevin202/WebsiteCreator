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
