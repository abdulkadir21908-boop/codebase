/**
 * Generation Panel Component
 * Handles prompt input, parameters, and generation trigger.
 */

class GenerationPanel extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.currentJobId = null;
        this.pollInterval = null;
    }

    connectedCallback() {
        this.render();
        this.setupEventListeners();
        this.loadDefaultModel();

        // Listen for model selection changes
        document.addEventListener('model-selected', (e) => {
            this.updateModelInfo(e.detail);
        });

        // Listen for settings changes
        document.addEventListener('settings-changed', (e) => {
            this.settings = e.detail;
        });
    }

    disconnectedCallback() {
        this.stopPolling();
    }

    render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; height: 100%; }
                .panel { height: 100%; display: flex; flex-direction: column; }
                .form-group { margin-bottom: 16px; }
                .form-label { display: block; font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-secondary); margin-bottom: 6px; }
                .form-input, .form-textarea, .form-select { width: 100%; padding: 10px 12px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: var(--radius-md); color: var(--text-primary); font-family: inherit; font-size: 0.875rem; transition: all var(--transition); }
                .form-input:focus, .form-textarea:focus, .form-select:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-dim); }
                .form-textarea { min-height: 80px; resize: vertical; font-family: var(--font-ui); }
                .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
                .slider-container { display: flex; align-items: center; gap: 12px; }
                .slider-container input[type="range"] { flex: 1; accent-color: var(--accent); }
                .slider-value { font-family: var(--font-mono); font-size: 0.875rem; color: var(--accent); min-width: 40px; text-align: right; }
                .model-info { display: flex; align-items: center; gap: 8px; padding: 10px; background: var(--bg-tertiary); border-radius: var(--radius-md); margin-bottom: 16px; font-size: 0.8rem; }
                .model-info .model-name { font-weight: 600; color: var(--text-primary); }
                .model-info .model-type { background: var(--accent-dim); color: var(--accent); padding: 2px 6px; border-radius: var(--radius-sm); font-size: 0.65rem; text-transform: uppercase; }
                .advanced-toggle { display: flex; align-items: center; gap: 8px; color: var(--text-secondary); font-size: 0.8rem; cursor: pointer; margin-top: 12px; }
                .advanced-options { display: none; margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border-color); }
                .advanced-options.open { display: block; }
                .generate-btn { width: 100%; margin-top: auto; padding: 14px; font-size: 1rem; }
                .generate-btn:disabled { opacity: 0.6; cursor: not-allowed; }
                .generate-btn.generating { background: var(--warning); color: var(--bg-primary); }
            </style>
            <div class="panel">
                <div class="generation-form">
                    <div class="model-info" id="modelInfo">
                        <span class="model-type" id="modelTypeBadge">IMAGE</span>
                        <span class="model-name" id="modelName">Select a model</span>
                    </div>

                    <div class="form-group">
                        <label class="form-label">Prompt</label>
                        <textarea class="form-textarea" id="promptInput" placeholder="Describe what you want to generate..."></textarea>
                    </div>

                    <div class="form-group">
                        <label class="form-label">Negative Prompt</label>
                        <textarea class="form-textarea" id="negativePromptInput" placeholder="What to avoid (optional)"></textarea>
                    </div>

                    <div class="form-row">
                        <div class="form-group">
                            <label class="form-label">Width <span class="slider-value" id="widthValue">512</span></label>
                            <div class="slider-container">
                                <input type="range" id="widthSlider" min="64" max="2048" value="512" step="64">
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Height <span class="slider-value" id="heightValue">512</span></label>
                            <div class="slider-container">
                                <input type="range" id="heightSlider" min="64" max="2048" value="512" step="64">
                            </div>
                        </div>
                    </div>

                    <div class="advanced-toggle" id="advancedToggle">
                        <span>▼ Advanced</span>
                    </div>

                    <div class="advanced-options" id="advancedOptions">
                        <div class="form-row">
                            <div class="form-group">
                                <label class="form-label">Steps <span class="slider-value" id="stepsValue">20</span></label>
                                <div class="slider-container">
                                    <input type="range" id="stepsSlider" min="1" max="100" value="20">
                                </div>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Guidance <span class="slider-value" id="guidanceValue">7.5</span></label>
                                <div class="slider-container">
                                    <input type="range" id="guidanceSlider" min="0" max="20" value="7.5" step="0.5">
                                </div>
                            </div>
                        </div>
                        <div class="form-group">
                            <label class="form-label">Seed <span class="slider-value" id="seedValue">Random</span></label>
                            <div class="slider-container">
                                <input type="range" id="seedSlider" min="0" max="4294967295" value="0">
                                <input type="checkbox" id="randomSeed" checked style="width: auto;">
                                <label for="randomSeed" style="font-size: 0.75rem;">Random</label>
                            </div>
                        </div>

                        <!-- Video-specific options (hidden by default) -->
                        <div class="video-options" id="videoOptions" style="display: none;">
                            <div class="form-row">
                                <div class="form-group">
                                    <label class="form-label">Frames <span class="slider-value" id="framesValue">16</span></label>
                                    <div class="slider-container">
                                        <input type="range" id="framesSlider" min="1" max="128" value="16">
                                    </div>
                                </div>
                                <div class="form-group">
                                    <label class="form-label">FPS <span class="slider-value" id="fpsValue">8</span></label>
                                    <div class="slider-container">
                                        <input type="range" id="fpsSlider" min="1" max="30" value="8">
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <button class="btn btn-primary generate-btn" id="generateBtn">
                        <span class="btn-text">Generate</span>
                        <span class="btn-loading" style="display: none;">⏳ Generating...</span>
                    </button>
                </div>
            </div>
        `;
    }

    setupEventListeners() {
        // Sliders
        this.setupSlider('widthSlider', 'widthValue');
        this.setupSlider('heightSlider', 'heightValue');
        this.setupSlider('stepsSlider', 'stepsValue');
        this.setupSlider('guidanceSlider', 'guidanceValue', (v) => parseFloat(v).toFixed(1));
        this.setupSlider('framesSlider', 'framesValue');
        this.setupSlider('fpsSlider', 'fpsValue');

        // Seed handling
        const seedSlider = this.shadowRoot.getElementById('seedSlider');
        const randomSeed = this.shadowRoot.getElementById('randomSeed');
        const seedValue = this.shadowRoot.getElementById('seedValue');

        randomSeed.addEventListener('change', () => {
            seedSlider.disabled = randomSeed.checked;
            seedValue.textContent = randomSeed.checked ? 'Random' : seedSlider.value;
        });

        seedSlider.addEventListener('input', () => {
            if (!randomSeed.checked) {
                seedValue.textContent = seedSlider.value;
            }
        });

        // Advanced toggle
        const advancedToggle = this.shadowRoot.getElementById('advancedToggle');
        const advancedOptions = this.shadowRoot.getElementById('advancedOptions');

        advancedToggle.addEventListener('click', () => {
            advancedOptions.classList.toggle('open');
            advancedToggle.querySelector('span').textContent =
                advancedOptions.classList.contains('open') ? '▲ Advanced' : '▼ Advanced';
        });

        // Generate button
        this.shadowRoot.getElementById('generateBtn').addEventListener('click', () => this.generate());

        // Enter key in prompt (with Ctrl)
        this.shadowRoot.getElementById('promptInput').addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                this.generate();
            }
        });
    }

    setupSlider(sliderId, valueId, formatter = (v) => v) {
        const slider = this.shadowRoot.getElementById(sliderId);
        const value = this.shadowRoot.getElementById(valueId);
        slider.addEventListener('input', () => {
            value.textContent = formatter(slider.value);
        });
    }

    async loadDefaultModel() {
        // Request default model from model selector
        const modelSelector = document.querySelector('model-selector');
        if (modelSelector && modelSelector.getDefaultModel) {
            const model = modelSelector.getDefaultModel();
            if (model) this.updateModelInfo(model);
        }
    }

    updateModelInfo(model) {
        this.currentModel = model;
        const badge = this.shadowRoot.getElementById('modelTypeBadge');
        const name = this.shadowRoot.getElementById('modelName');

        badge.textContent = model.type.toUpperCase();
        badge.className = 'model-type ' + model.type;
        name.textContent = model.name;

        // Show/hide video options
        const videoOptions = this.shadowRoot.getElementById('videoOptions');
        videoOptions.style.display = model.type === 'video' ? 'block' : 'none';
    }

    async generate() {
        const prompt = this.shadowRoot.getElementById('promptInput').value.trim();
        if (!prompt) {
            window.showToast('Please enter a prompt', 'error');
            return;
        }

        if (!this.currentModel) {
            window.showToast('Please select a model first', 'error');
            return;
        }

        const btn = this.shadowRoot.getElementById('generateBtn');
        const btnText = btn.querySelector('.btn-text');
        const btnLoading = btn.querySelector('.btn-loading');

        // UI loading state
        btn.disabled = true;
        btn.classList.add('generating');
        btnText.style.display = 'none';
        btnLoading.style.display = 'inline';

        // Build request
        const request = {
            prompt,
            negative_prompt: this.shadowRoot.getElementById('negativePromptInput').value.trim(),
            model_id: this.currentModel.model_id,
            width: parseInt(this.shadowRoot.getElementById('widthSlider').value),
            height: parseInt(this.shadowRoot.getElementById('heightSlider').value),
            num_inference_steps: parseInt(this.shadowRoot.getElementById('stepsSlider').value),
            guidance_scale: parseFloat(this.shadowRoot.getElementById('guidanceSlider').value),
            seed: this.shadowRoot.getElementById('randomSeed').checked ? null : parseInt(this.shadowRoot.getElementById('seedSlider').value),
            backend: window.AppState.settings.backend,
            quantization: window.AppState.settings.quantization
        };

        // Add video params if video model
        if (this.currentModel.type === 'video') {
            request.num_frames = parseInt(this.shadowRoot.getElementById('framesSlider').value);
            request.fps = parseInt(this.shadowRoot.getElementById('fpsSlider').value);
        }

        try {
            const endpoint = this.currentModel.type === 'video' ? '/generate/video' : '/generate/image';
            const response = await window.apiRequest(endpoint, {
                method: 'POST',
                body: JSON.stringify(request)
            });

            this.currentJobId = response.job_id;
            this.startPolling(response.job_id);
            window.showToast('Generation started', 'success');

            // Switch to queue view
            document.querySelector('.tab-btn[data-view="queue"]')?.click();

        } catch (e) {
            window.showToast(`Generation failed: ${e.message}`, 'error');
        } finally {
            btn.disabled = false;
            btn.classList.remove('generating');
            btnText.style.display = 'inline';
            btnLoading.style.display = 'none';
        }
    }

    startPolling(jobId) {
        this.stopPolling();
        this.pollInterval = setInterval(async () => {
            try {
                const job = await window.apiRequest(`/jobs/${jobId}`);
                this.updateJobInQueue(job);

                if (job.status === 'completed' || job.status === 'failed') {
                    this.stopPolling();
                    if (job.status === 'completed') {
                        this.showResult(job);
                    }
                }
            } catch (e) {
                console.error('Polling error:', e);
            }
        }, 1000);
    }

    stopPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
    }

    updateJobInQueue(job) {
        // Dispatch event for job queue component
        document.dispatchEvent(new CustomEvent('job-update', { detail: job }));
    }

    showResult(job) {
        if (!job.result?.output_paths?.length) return;

        const outputPath = job.result.output_paths[0];
        const previewArea = document.getElementById('previewArea');
        const resultActions = document.getElementById('resultActions');
        const downloadBtn = document.getElementById('downloadBtn');

        // Determine if image or video
        const isVideo = outputPath.endsWith('.mp4') || outputPath.endsWith('.webm');

        previewArea.innerHTML = '';
        previewArea.classList.add('has-content');

        if (isVideo) {
            const video = document.createElement('video');
            video.src = `/static/outputs/${outputPath.split('/').pop()}`;
            video.controls = true;
            video.autoplay = true;
            video.loop = true;
            video.muted = true;
            previewArea.appendChild(video);
        } else {
            const img = document.createElement('img');
            img.src = `/static/outputs/${outputPath.split('/').pop()}`;
            img.alt = 'Generated image';
            previewArea.appendChild(img);
        }

        resultActions.style.display = 'flex';

        // Setup download
        downloadBtn.onclick = () => {
            const a = document.createElement('a');
            a.href = `/static/outputs/${outputPath.split('/').pop()}`;
            a.download = outputPath.split('/').pop();
            a.click();
        };
    }
}

customElements.define('generation-panel', GenerationPanel);
