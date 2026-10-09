/**
 * Model Selector Component
 * Displays available models with download/quantization controls.
 */

class ModelSelector extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.models = [];
        this.currentTab = 'all';
    }

    connectedCallback() {
        this.render();
        this.setupEventListeners();

        // Listen for models loaded
        document.addEventListener('models-loaded', (e) => {
            this.models = e.detail;
            this.renderModelList();
        });
    }

    render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; height: 100%; }
                .panel { height: 100%; display: flex; flex-direction: column; }
                .model-tabs { display: flex; gap: 4px; margin-bottom: 16px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px; }
                .model-tab { padding: 8px 12px; background: transparent; border: none; color: var(--text-secondary); font-size: 0.75rem; font-weight: 500; border-radius: var(--radius-sm); cursor: pointer; }
                .model-tab:hover { color: var(--text-primary); background: var(--bg-hover); }
                .model-tab.active { color: var(--accent); background: var(--accent-dim); }
                .model-list { flex: 1; overflow-y: auto; }
                .model-card { padding: 12px; border: 1px solid var(--border-color); border-radius: var(--radius-md); margin-bottom: 8px; cursor: pointer; transition: all var(--transition); position: relative; }
                .model-card:hover { border-color: var(--accent); background: var(--bg-hover); }
                .model-card.selected { border-color: var(--accent); background: var(--accent-dim); }
                .model-card.downloaded .model-status::before { content: "✅"; margin-right: 6px; }
                .model-card-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px; }
                .model-card-name { font-weight: 600; font-size: 0.875rem; }
                .model-card-type { font-size: 0.65rem; text-transform: uppercase; padding: 2px 6px; border-radius: var(--radius-sm); font-weight: 600; }
                .model-card-type.image { background: rgba(0, 212, 170, 0.2); color: var(--accent); }
                .model-card-type.video { background: rgba(0, 180, 255, 0.2); color: #00b4ff; }
                .model-card-meta { display: flex; gap: 12px; font-size: 0.7rem; color: var(--text-muted); font-family: var(--font-mono); }
                .model-card-actions { display: flex; gap: 8px; margin-top: 10px; }
                .model-card-download { flex: 1; font-size: 0.75rem; padding: 6px; }
                .model-card-quantize { padding: 6px 10px; font-size: 0.7rem; }
                .empty-state { text-align: center; padding: 40px 20px; color: var(--text-muted); }
                .empty-state svg { width: 48px; height: 48px; margin-bottom: 12px; opacity: 0.5; }
            </style>
            <div class="panel">
                <div class="model-tabs">
                    <button class="model-tab active" data-tab="all">All</button>
                    <button class="model-tab" data-tab="image">Images</button>
                    <button class="model-tab" data-tab="video">Videos</button>
                    <button class="model-tab" data-tab="downloaded">Downloaded</button>
                </div>
                <div class="model-list" id="modelList">
                    <div class="empty-state">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M17 10l-5 5-5-5"/>
                        </svg>
                        <p>Loading models...</p>
                    </div>
                </div>
            </div>
        `;
    }

    setupEventListeners() {
        // Tab switching
        this.shadowRoot.querySelectorAll('.model-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                this.currentTab = tab.dataset.tab;
                this.shadowRoot.querySelectorAll('.model-tab').forEach(t =>
                    t.classList.toggle('active', t.dataset.tab === this.currentTab)
                );
                this.renderModelList();
            });
        });
    }

    renderModelList() {
        const list = this.shadowRoot.getElementById('modelList');
        let filtered = this.models;

        if (this.currentTab === 'image') filtered = filtered.filter(m => m.type === 'image');
        else if (this.currentTab === 'video') filtered = filtered.filter(m => m.type === 'video');
        else if (this.currentTab === 'downloaded') filtered = filtered.filter(m => m.downloaded);

        if (filtered.length === 0) {
            list.innerHTML = `
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M17 10l-5 5-5-5"/>
                    </svg>
                    <p>No models found</p>
                </div>
            `;
            return;
        }

        list.innerHTML = filtered.map(model => this.renderModelCard(model)).join('');

        // Add click listeners
        list.querySelectorAll('.model-card').forEach(card => {
            card.addEventListener('click', (e) => {
                if (e.target.closest('button')) return; // Ignore button clicks
                this.selectModel(card.dataset.modelId);
            });

            card.querySelector('.model-card-download')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.downloadModel(card.dataset.modelId);
            });

            card.querySelector('.model-card-quantize')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.quantizeModel(card.dataset.modelId);
            });
        });
    }

    renderModelCard(model) {
        const isSelected = window.AppState.currentModel?.model_id === model.model_id;
        const typeClass = model.type === 'image' ? 'image' : 'video';
        const downloaded = model.downloaded ? 'downloaded' : '';
        const quantized = model.quantized ? ` (${model.quantization})` : '';

        return `
            <div class="model-card ${isSelected ? 'selected' : ''} ${downloaded}" data-model-id="${model.model_id}">
                <div class="model-card-header">
                    <span class="model-card-name">${model.name}${model.is_default ? ' ⭐' : ''}</span>
                    <span class="model-card-type ${typeClass}">${model.type}</span>
                </div>
                <div class="model-card-meta">
                    <span>${model.size_gb} GB</span>
                    <span>${model.backend}</span>
                    <span>${model.min_ram_gb}GB min</span>
                </div>
                <div class="model-card-meta">
                    <span>${quantized ? 'Quantized: ' + model.quantization : 'Not quantized'}</span>
                </div>
                ${!model.downloaded ? `
                    <div class="model-card-actions">
                        <button class="btn btn-primary btn-sm model-card-download">Download</button>
                    </div>
                ` : model.quantization === 'none' && model.backend === 'diffusers' ? `
                    <div class="model-card-actions">
                        <button class="btn btn-secondary btn-sm model-card-quantize">Quantize</button>
                    </div>
                ` : ''}
            </div>
        `;
    }

    selectModel(modelId) {
        const model = this.models.find(m => m.model_id === modelId);
        if (!model) return;

        // Update UI
        this.shadowRoot.querySelectorAll('.model-card').forEach(card => {
            card.classList.toggle('selected', card.dataset.modelId === modelId);
        });

        // Notify generation panel
        window.AppState.currentModel = model;
        document.dispatchEvent(new CustomEvent('model-selected', { detail: model }));

        // Update status bar
        document.getElementById('currentModel').textContent = model.name;
    }

    async downloadModel(modelId) {
        const model = this.models.find(m => m.model_id === modelId);
        if (!model) return;

        const btn = this.shadowRoot.querySelector(`[data-model-id="${modelId}"] .model-card-download`);
        const originalText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Downloading...';

        try {
            const quantization = window.AppState.settings.quantization;
            const response = await window.apiRequest('/models/download', {
                method: 'POST',
                body: JSON.stringify({ model_id: modelId, quantization })
            });

            window.showToast(`Downloading ${model.name}...`, 'info');

            // Poll for completion (simplified - in reality would use WebSocket or SSE)
            const checkInterval = setInterval(async () => {
                try {
                    const updated = await window.apiRequest(`/models/${modelId}`);
                    if (updated.downloaded) {
                        clearInterval(checkInterval);
                        model.downloaded = true;
                        model.quantized = quantization !== 'none';
                        model.quantization = quantization;
                        this.renderModelList();
                        window.showToast(`${model.name} ready!`, 'success');
                    }
                } catch (e) {}
            }, 5000);

        } catch (e) {
            window.showToast(`Download failed: ${e.message}`, 'error');
            btn.disabled = false;
            btn.textContent = originalText;
        }
    }

    async quantizeModel(modelId) {
        const model = this.models.find(m => m.model_id === modelId);
        if (!model) return;

        const quantization = window.AppState.settings.quantization;

        try {
            await window.apiRequest(`/models/${modelId}/quantize`, {
                method: 'POST',
                body: JSON.stringify({ quantization })
            });

            window.showToast(`Quantizing ${model.name} to ${quantization}...`, 'info');

            // Poll for completion
            const checkInterval = setInterval(async () => {
                try {
                    const updated = await window.apiRequest(`/models/${modelId}`);
                    if (updated.quantized) {
                        clearInterval(checkInterval);
                        model.quantized = true;
                        model.quantization = quantization;
                        this.renderModelList();
                        window.showToast(`${model.name} quantized!`, 'success');
                    }
                } catch (e) {}
            }, 5000);

        } catch (e) {
            window.showToast(`Quantization failed: ${e.message}`, 'error');
        }
    }

    getDefaultModel() {
        return this.models.find(m => m.is_default) || this.models[0];
    }
}

customElements.define('model-selector', ModelSelector);
