/**
 * History Panel Component
 * Displays generation history with thumbnails.
 */

class HistoryPanel extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.history = [];
    }

    connectedCallback() {
        this.render();
        this.loadHistory();

        document.addEventListener('history-loaded', (e) => {
            this.history = e.detail;
            this.renderHistory();
        });
    }

    render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; height: 100%; }
                .history-list { display: flex; flex-direction: column; gap: 8px; height: 100%; overflow-y: auto; }
                .history-item { display: flex; gap: 12px; padding: 12px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: var(--radius-md); cursor: pointer; transition: all var(--transition); }
                .history-item:hover { border-color: var(--accent); }
                .history-thumb { width: 80px; height: 60px; border-radius: var(--radius-sm); overflow: hidden; flex-shrink: 0; }
                .history-thumb img, .history-thumb video { width: 100%; height: 100%; object-fit: cover; }
                .history-info { flex: 1; min-width: 0; }
                .history-prompt { font-size: 0.8rem; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
                .history-meta { display: flex; gap: 12px; font-size: 0.7rem; color: var(--text-muted); font-family: var(--font-mono); }
                .empty-history { text-align: center; padding: 40px 20px; color: var(--text-muted); }
                .empty-history svg { width: 48px; height: 48px; margin-bottom: 12px; opacity: 0.5; }
            </style>
            <div class="history-list" id="historyList">
                <div class="empty-history">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M12 6v6l4 2"/>
                    </svg>
                    <p>No history yet</p>
                    <p style="font-size: 0.75rem; margin-top: 4px;">Your generations will appear here</p>
                </div>
            </div>
        `;
    }

    async loadHistory() {
        try {
            const jobs = await window.apiRequest('/jobs?limit=50');
            this.history = jobs.filter(j => j.status === 'completed');
            this.renderHistory();
        } catch (e) {
            console.error('Failed to load history:', e);
        }
    }

    renderHistory() {
        const container = this.shadowRoot.getElementById('historyList');

        if (this.history.length === 0) {
            container.innerHTML = `
                <div class="empty-history">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <circle cx="12" cy="12" r="10"/>
                        <path d="M12 6v6l4 2"/>
                    </svg>
                    <p>No history yet</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.history.map(job => this.renderHistoryItem(job)).join('');

        // Add click handlers
        container.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => this.selectHistoryItem(item.dataset.jobId));
        });
    }

    renderHistoryItem(job) {
        if (!job.result?.output_paths?.length) return '';

        const outputPath = job.result.output_paths[0];
        const filename = outputPath.split('/').pop();
        const isVideo = filename.endsWith('.mp4') || filename.endsWith('.webm');
        const date = new Date(job.created_at || Date.now()).toLocaleString();

        let thumb = '';
        if (isVideo) {
            thumb = `<video class="history-thumb" src="/static/outputs/${filename}" muted loop playsinline></video>`;
        } else {
            thumb = `<img class="history-thumb" src="/static/outputs/${filename}" alt="">`;
        }

        const meta = [];
        if (job.request?.width) meta.push(`${job.request.width}×${job.request.height}`);
        if (job.request?.num_frames) meta.push(`${job.request.num_frames}f`);
        if (job.model_id) meta.push(job.model_id);
        meta.push(date);

        return `
            <div class="history-item" data-job-id="${job.id}">
                ${thumb}
                <div class="history-info">
                    <div class="history-prompt">${this.escapeHtml(job.request?.prompt || 'Unknown')}</div>
                    <div class="history-meta">${meta.join(' • ')}</div>
                </div>
            </div>
        `;
    }

    selectHistoryItem(jobId) {
        const job = this.history.find(j => j.id === jobId);
        if (!job || !job.result?.output_paths?.length) return;

        const outputPath = job.result.output_paths[0];
        const filename = outputPath.split('/').pop();
        const isVideo = filename.endsWith('.mp4') || filename.endsWith('.webm');

        const previewArea = document.getElementById('previewArea');
        const resultActions = document.getElementById('resultActions');
        const downloadBtn = document.getElementById('downloadBtn');

        previewArea.innerHTML = '';
        previewArea.classList.add('has-content');

        if (isVideo) {
            const video = document.createElement('video');
            video.src = `/static/outputs/${filename}`;
            video.controls = true;
            video.autoplay = true;
            video.loop = true;
            video.muted = true;
            previewArea.appendChild(video);
        } else {
            const img = document.createElement('img');
            img.src = `/static/outputs/${filename}`;
            img.alt = 'Generated image';
            previewArea.appendChild(img);
        }

        resultActions.style.display = 'flex';

        downloadBtn.onclick = () => {
            const a = document.createElement('a');
            a.href = `/static/outputs/${filename}`;
            a.download = filename;
            a.click();
        };

        // Switch to result view
        document.querySelector('.tab-btn[data-view="result"]')?.click();
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

customElements.define('history-panel', HistoryPanel);
