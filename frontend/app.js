/**
 * Higgsfield Local - Professional UI
 * Modern, clean interface for AI generation
 */

const API_BASE = '/api/v1';

// State
const state = {
    currentView: 'generate',
    currentModel: null,
    models: [],
    history: [],
    settings: {
        apiKey: '',
        apiUrl: 'https://api.higgsfield.ai/v1',
        maxJobs: 1,
        timeout: 300
    },
    isGenerating: false,
    currentJobId: null,
    pollInterval: null
};

// DOM Elements
const elements = {};

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    cacheElements();
    loadSettings();
    setupEventListeners();
    loadModels();
    loadHistory();
    startSystemStatsPolling();
    setupKeyboardShortcuts();
});

function cacheElements() {
    // Views
    elements.views = {
        generate: document.getElementById('view-generate'),
        models: document.getElementById('view-models'),
        history: document.getElementById('view-history')
    };

    // Navigation
    elements.navItems = document.querySelectorAll('.nav-item[data-view]');

    // Generate elements
    elements.promptInput = document.getElementById('promptInput');
    elements.negativePromptInput = document.getElementById('negativePromptInput');
    elements.widthInput = document.getElementById('widthInput');
    elements.heightInput = document.getElementById('heightInput');
    elements.generateBtn = document.getElementById('generateBtn');
    elements.previewArea = document.getElementById('previewArea');
    elements.previewInfo = document.getElementById('previewInfo');
    elements.infoModel = document.getElementById('infoModel');
    elements.infoTime = document.getElementById('infoTime');
    elements.infoResolution = document.getElementById('infoResolution');
    elements.downloadBtn = document.getElementById('downloadBtn');
    elements.copyPromptBtn = document.getElementById('copyPromptBtn');
    elements.currentModelBadge = document.getElementById('currentModelBadge');
    elements.backendSelect = document.getElementById('backendSelect');

    // Advanced
    elements.advancedToggle = document.getElementById('advancedToggle');
    elements.advancedPanel = document.getElementById('advancedPanel');
    elements.stepsSlider = document.getElementById('stepsSlider');
    elements.stepsValue = document.getElementById('stepsValue');
    elements.guidanceSlider = document.getElementById('guidanceSlider');
    elements.guidanceValue = document.getElementById('guidanceValue');
    elements.seedInput = document.getElementById('seedInput');
    elements.randomSeedBtn = document.getElementById('randomSeedBtn');
    elements.videoOptions = document.getElementById('videoOptions');
    elements.framesSlider = document.getElementById('framesSlider');
    elements.framesValue = document.getElementById('framesValue');
    elements.fpsSlider = document.getElementById('fpsSlider');
    elements.fpsValue = document.getElementById('fpsValue');

    // Ratio buttons
    elements.ratioButtons = document.querySelectorAll('.ratio-btn');

    // Models
    elements.modelsGrid = document.getElementById('modelsGrid');
    elements.filterButtons = document.querySelectorAll('.filter-btn');

    // History
    elements.historyGrid = document.getElementById('historyGrid');
    elements.clearHistoryBtn = document.getElementById('clearHistoryBtn');

    // Settings
    elements.settingsModal = document.getElementById('settingsModal');
    elements.settingsBtn = document.getElementById('settingsBtn');
    elements.closeSettings = document.getElementById('closeSettings');
    elements.cancelSettings = document.getElementById('cancelSettings');
    elements.saveSettings = document.getElementById('saveSettings');
    elements.settingApiKey = document.getElementById('settingApiKey');
    elements.settingApiUrl = document.getElementById('settingApiUrl');
    elements.settingMaxJobs = document.getElementById('settingMaxJobs');
    elements.settingTimeout = document.getElementById('settingTimeout');

    // System stats
    elements.cpuStat = document.getElementById('cpuStat');
    elements.memStat = document.getElementById('memStat');

    // Toast
    elements.toastContainer = document.getElementById('toastContainer');
}

function setupEventListeners() {
    // Navigation
    elements.navItems.forEach(item => {
        item.addEventListener('click', () => switchView(item.dataset.view));
    });

    // Generate
    elements.generateBtn.addEventListener('click', handleGenerate);
    elements.downloadBtn.addEventListener('click', handleDownload);
    elements.copyPromptBtn.addEventListener('click', handleCopyPrompt);

    // Advanced toggle
    elements.advancedToggle.addEventListener('click', toggleAdvanced);

    // Sliders
    setupSlider(elements.stepsSlider, elements.stepsValue);
    setupSlider(elements.guidanceSlider, elements.guidanceValue, v => parseFloat(v).toFixed(1));
    setupSlider(elements.framesSlider, elements.framesValue);
    setupSlider(elements.fpsSlider, elements.fpsValue);

    // Random seed
    elements.randomSeedBtn.addEventListener('click', () => {
        elements.seedInput.value = Math.floor(Math.random() * 4294967295);
    });

    // Ratio buttons
    elements.ratioButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            elements.ratioButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyRatio(btn.dataset.ratio);
        });
    });

    // Model filters
    elements.filterButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            elements.filterButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderModels(btn.dataset.filter);
        });
    });

    // Settings
    elements.settingsBtn.addEventListener('click', openSettings);
    elements.closeSettings.addEventListener('click', closeSettings);
    elements.cancelSettings.addEventListener('click', closeSettings);
    elements.saveSettings.addEventListener('click', saveSettings);

    // Clear history
    elements.clearHistoryBtn.addEventListener('click', clearHistory);

    // Close modal on overlay click
    elements.settingsModal.addEventListener('click', (e) => {
        if (e.target === elements.settingsModal) closeSettings();
    });
}

function setupKeyboardShortcuts() {
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeSettings();
        }
        if (e.ctrlKey && e.key === 'Enter' && state.currentView === 'generate') {
            handleGenerate();
        }
    });
}

// View Management
function switchView(viewName) {
    state.currentView = viewName;

    // Update nav
    elements.navItems.forEach(item => {
        item.classList.toggle('active', item.dataset.view === viewName);
    });

    // Update views
    Object.entries(elements.views).forEach(([name, view]) => {
        view.classList.toggle('active', name === viewName);
    });

    // Refresh data when switching to models/history
    if (viewName === 'models') loadModels();
    if (viewName === 'history') loadHistory();
}

// Slider Setup
function setupSlider(slider, valueDisplay, formatter = v => v) {
    slider.addEventListener('input', () => {
        valueDisplay.textContent = formatter(slider.value);
    });
}

// Ratio
function applyRatio(ratio) {
    const [w, h] = ratio.split(':').map(Number);
    const base = 512;
    if (w >= h) {
        elements.widthInput.value = base;
        elements.heightInput.value = Math.round(base * h / w);
    } else {
        elements.heightInput.value = base;
        elements.widthInput.value = Math.round(base * w / h);
    }
}

// Advanced Toggle
function toggleAdvanced() {
    elements.advancedToggle.classList.toggle('open');
    elements.advancedPanel.classList.toggle('open');
}

// API Helpers
async function apiRequest(endpoint, options = {}) {
    const url = `${API_BASE}${endpoint}`;
    const defaultOptions = {
        headers: { 'Content-Type': 'application/json' }
    };

    const response = await fetch(url, { ...defaultOptions, ...options });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
        throw new Error(error.detail || `HTTP ${response.status}`);
    }

    return response.json();
}

// Models
async function loadModels() {
    try {
        state.models = await apiRequest('/models');
        renderModels('all');
        updateModelBadge();
    } catch (e) {
        showToast('Failed to load models', 'error');
    }
}

function renderModels(filter = 'all') {
    let filtered = state.models;

    if (filter === 'image') filtered = state.models.filter(m => m.type === 'image');
    else if (filter === 'video') filtered = state.models.filter(m => m.type === 'video');
    else if (filter === 'downloaded') filtered = state.models.filter(m => m.downloaded);

    if (filtered.length === 0) {
        elements.modelsGrid.innerHTML = '<div class="models-loading">No models found</div>';
        return;
    }

    elements.modelsGrid.innerHTML = filtered.map(model => `
        <div class="model-card ${state.currentModel?.model_id === model.model_id ? 'selected' : ''}" data-model-id="${model.model_id}">
            <div class="model-card-header">
                <span class="model-card-name">${model.name}</span>
                <span class="model-card-type ${model.type}">${model.type}</span>
            </div>
            <div class="model-card-meta">
                <span>${model.size_gb} GB</span>
                <span>${model.backend}</span>
                <span>${model.min_ram_gb}GB min</span>
            </div>
            <div class="model-card-description">${model.description}</div>
            <div class="model-card-actions">
                <span class="model-status ${model.downloaded ? 'downloaded' : 'not-downloaded'}">
                    ${model.downloaded ? '✓ Downloaded' : '○ Not downloaded'}
                </span>
                ${!model.downloaded ? `<button class="btn-primary btn-sm download-btn" data-model-id="${model.model_id}">Download</button>` : ''}
            </div>
        </div>
    `).join('');

    // Add click handlers
    elements.modelsGrid.querySelectorAll('.model-card').forEach(card => {
        card.addEventListener('click', (e) => {
            if (e.target.closest('.download-btn')) return;
            selectModel(card.dataset.model-id);
        });
    });

    // Download buttons
    elements.modelsGrid.querySelectorAll('.download-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            downloadModel(btn.dataset.model-id);
        });
    });
}

function selectModel(modelId) {
    const model = state.models.find(m => m.model_id === modelId);
    if (!model) return;

    state.currentModel = model;

    // Update UI
    elements.modelsGrid.querySelectorAll('.model-card').forEach(card => {
        card.classList.toggle('selected', card.dataset.modelId === modelId);
    });

    updateModelBadge();

    // Show/hide video options
    if (elements.videoOptions) {
        elements.videoOptions.style.display = model.type === 'video' ? 'flex' : 'none';
    }

    // Switch to generate view
    switchView('generate');
}

function updateModelBadge() {
    if (state.currentModel) {
        elements.currentModelBadge.textContent = state.currentModel.name;
    } else {
        elements.currentModelBadge.textContent = 'No model selected';
    }
}

async function downloadModel(modelId) {
    try {
        showToast('Downloading model...', 'success');
        await apiRequest('/models/download', {
            method: 'POST',
            body: JSON.stringify({ model_id: modelId, quantization: 'q4_k_m' })
        });

        // Poll for completion
        const checkInterval = setInterval(async () => {
            try {
                const updated = await apiRequest(`/models/${modelId}`);
                if (updated.downloaded) {
                    clearInterval(checkInterval);
                    showToast('Model downloaded!', 'success');
                    loadModels();
                }
            } catch (e) {}
        }, 3000);
    } catch (e) {
        showToast(`Download failed: ${e.message}`, 'error');
    }
}

// Generation
async function handleGenerate() {
    const prompt = elements.promptInput.value.trim();
    if (!prompt) {
        showToast('Please enter a prompt', 'error');
        return;
    }

    if (!state.currentModel) {
        showToast('Please select a model first', 'error');
        return;
    }

    if (state.isGenerating) return;

    state.isGenerating = true;
    elements.generateBtn.disabled = true;
    elements.generateBtn.classList.add('generating');
    elements.generateBtn.innerHTML = '<span>Generating...</span>';

    const request = {
        prompt,
        negative_prompt: elements.negativePromptInput.value.trim(),
        model_id: state.currentModel.model_id,
        width: parseInt(elements.widthInput.value),
        height: parseInt(elements.heightInput.value),
        num_inference_steps: parseInt(elements.stepsSlider.value),
        guidance_scale: parseFloat(elements.guidanceSlider.value),
        seed: elements.seedInput.value ? parseInt(elements.seedInput.value) : null,
        backend: elements.backendSelect.value
    };

    if (state.currentModel.type === 'video') {
        request.num_frames = parseInt(elements.framesSlider.value);
        request.fps = parseInt(elements.fpsSlider.value);
    }

    try {
        const endpoint = state.currentModel.type === 'video' ? '/generate/video' : '/generate/image';
        const response = await apiRequest(endpoint, {
            method: 'POST',
            body: JSON.stringify(request)
        });

        state.currentJobId = response.job_id;
        startPolling(state.currentJobId);
        showToast('Generation started', 'success');
    } catch (e) {
        showToast(`Generation failed: ${e.message}`, 'error');
        resetGenerateButton();
    }
}

function startPolling(jobId) {
    stopPolling();
    state.pollInterval = setInterval(async () => {
        try {
            const job = await apiRequest(`/jobs/${jobId}`);

            if (job.status === 'completed') {
                stopPolling();
                showResult(job);
                resetGenerateButton();
            } else if (job.status === 'failed') {
                stopPolling();
                showToast(`Generation failed: ${job.error}`, 'error');
                resetGenerateButton();
            }
        } catch (e) {
            console.error('Polling error:', e);
        }
    }, 1000);
}

function stopPolling() {
    if (state.pollInterval) {
        clearInterval(state.pollInterval);
        state.pollInterval = null;
    }
}

function resetGenerateButton() {
    state.isGenerating = false;
    elements.generateBtn.disabled = false;
    elements.generateBtn.classList.remove('generating');
    elements.generateBtn.innerHTML = `
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
        <span>Generate</span>
    `;
}

function showResult(job) {
    if (!job.result?.output_paths?.length) return;

    const outputPath = job.result.output_paths[0];
    const filename = outputPath.split('/').pop();
    const isVideo = filename.endsWith('.mp4') || filename.endsWith('.webm');

    elements.previewArea.innerHTML = '';
    elements.previewArea.classList.add('has-content');

    if (isVideo) {
        const video = document.createElement('video');
        video.src = `/static/outputs/${filename}`;
        video.controls = true;
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        elements.previewArea.appendChild(video);
    } else {
        const img = document.createElement('img');
        img.src = `/static/outputs/${filename}`;
        img.alt = 'Generated image';
        elements.previewArea.appendChild(img);
    }

    elements.previewInfo.style.display = 'flex';
    elements.infoModel.textContent = state.currentModel?.name || 'Unknown';
    elements.infoTime.textContent = `${job.result.generation_time?.toFixed(1) || '--'}s`;
    elements.infoResolution.textContent = `${elements.widthInput.value}x${elements.heightInput.value}`;

    elements.downloadBtn.disabled = false;

    // Add to history
    loadHistory();
}

function handleDownload() {
    if (!state.currentJobId) return;
    // Download logic would go here
    showToast('Download started', 'success');
}

function handleCopyPrompt() {
    const prompt = elements.promptInput.value;
    if (prompt) {
        navigator.clipboard.writeText(prompt);
        showToast('Prompt copied', 'success');
    }
}

// History
async function loadHistory() {
    try {
        const jobs = await apiRequest('/jobs?limit=50');
        state.history = jobs.filter(j => j.status === 'completed');
        renderHistory();
    } catch (e) {
        console.error('Failed to load history:', e);
    }
}

function renderHistory() {
    if (state.history.length === 0) {
        elements.historyGrid.innerHTML = '<div class="history-empty">No generations yet</div>';
        return;
    }

    elements.historyGrid.innerHTML = state.history.map(job => {
        if (!job.result?.output_paths?.length) return '';
        const outputPath = job.result.output_paths[0];
        const filename = outputPath.split('/').pop();
        const isVideo = filename.endsWith('.mp4') || filename.endsWith('.webm');

        return `
            <div class="history-item" data-job-id="${job.id}">
                <img class="history-thumb" src="/static/outputs/${filename}" alt="">
                <div class="history-info">
                    <div class="history-prompt">${job.request?.prompt || 'Unknown'}</div>
                </div>
            </div>
        `;
    }).join('');
}

function clearHistory() {
    state.history = [];
    renderHistory();
    showToast('History cleared', 'success');
}

// Settings
function openSettings() {
    elements.settingApiKey.value = state.settings.apiKey;
    elements.settingApiUrl.value = state.settings.apiUrl;
    elements.settingMaxJobs.value = state.settings.maxJobs;
    elements.settingTimeout.value = state.settings.timeout;
    elements.settingsModal.classList.add('open');
}

function closeSettings() {
    elements.settingsModal.classList.remove('open');
}

function saveSettings() {
    state.settings = {
        apiKey: elements.settingApiKey.value,
        apiUrl: elements.settingApiUrl.value,
        maxJobs: parseInt(elements.settingMaxJobs.value) || 1,
        timeout: parseInt(elements.settingTimeout.value) || 300
    };
    localStorage.setItem('higgsfield-settings', JSON.stringify(state.settings));
    closeSettings();
    showToast('Settings saved', 'success');
}

function loadSettings() {
    const saved = localStorage.getItem('higgsfield-settings');
    if (saved) {
        try {
            state.settings = { ...state.settings, ...JSON.parse(saved) };
        } catch (e) {
            console.warn('Failed to load settings:', e);
        }
    }
}

// System Stats
async function startSystemStatsPolling() {
    async function fetchStats() {
        try {
            const stats = await apiRequest('/system/stats');
            elements.cpuStat.textContent = `${stats.cpu_percent.toFixed(0)}%`;
            elements.memStat.textContent = `${stats.memory_percent.toFixed(0)}%`;
        } catch (e) {
            // Silently fail
        }
    }

    await fetchStats();
    setInterval(fetchStats, 5000);
}

// Toast
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `<span class="toast-message">${message}</span>`;
    elements.toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.style.animation = 'slideIn 300ms ease reverse';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}
