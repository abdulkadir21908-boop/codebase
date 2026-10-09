/**
 * Job Queue Component
 * Displays active and recent generation jobs.
 */

class JobQueue extends HTMLElement {
    constructor() {
        super();
        this.attachShadow({ mode: 'open' });
        this.jobs = [];
    }

    connectedCallback() {
        this.render();
        this.loadJobs();
        this.startPolling();

        document.addEventListener('job-update', (e) => {
            this.updateJob(e.detail);
        });
    }

    disconnectedCallback() {
        this.stopPolling();
    }

    render() {
        this.shadowRoot.innerHTML = `
            <style>
                :host { display: block; height: 100%; }
                .job-queue { display: flex; flex-direction: column; gap: 8px; height: 100%; overflow-y: auto; }
                .job-item { padding: 12px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: var(--radius-md); display: flex; gap: 12px; align-items: center; }
                .job-thumbnail { width: 64px; height: 64px; border-radius: var(--radius-sm); background: var(--bg-primary); overflow: hidden; flex-shrink: 0; }
                .job-thumbnail img, .job-thumbnail video { width: 100%; height: 100%; object-fit: cover; }
                .job-thumbnail .placeholder { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); font-size: 0.7rem; }
                .job-info { flex: 1; min-width: 0; }
                .job-prompt { font-size: 0.8rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 4px; }
                .job-meta { display: flex; gap: 12px; font-size: 0.7rem; color: var(--text-muted); font-family: var(--font-mono); }
                .job-progress { width: 80px; height: 4px; background: var(--bg-primary); border-radius: 2px; overflow: hidden; }
                .job-progress-bar { height: 100%; background: var(--accent); border-radius: 2px; transition: width 300ms ease; }
                .job-status { font-size: 0.7rem; font-weight: 600; text-transform: uppercase; padding: 4px 8px; border-radius: var(--radius-sm); white-space: nowrap; }
                .job-status.pending { background: rgba(255, 184, 0, 0.2); color: var(--warning); }
                .job-status.processing { background: rgba(0, 180, 255, 0.2); color: #00b4ff; }
                .job-status.completed { background: rgba(0, 212, 170, 0.2); color: var(--success); }
                .job-status.failed { background: rgba(255, 71, 87, 0.2); color: var(--error); }
                .empty-queue { text-align: center; padding: 40px 20px; color: var(--text-muted); }
                .empty-queue svg { width: 48px; height: 48px; margin-bottom: 12px; opacity: 0.5; }
            </style>
            <div class="job-queue" id="jobQueue">
                <div class="empty-queue">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <path d="M9 9h6v6H9z"/>
                    </svg>
                    <p>No active jobs</p>
                    <p style="font-size: 0.75rem; margin-top: 4px;">Generate something to see it here</p>
                </div>
            </div>
        `;
    }

    async loadJobs() {
        try {
            const jobs = await window.apiRequest('/jobs?limit=20');
            this.jobs = jobs;
            this.renderJobs();
        } catch (e) {
            console.error('Failed to load jobs:', e);
        }
    }

    startPolling() {
        this.pollInterval = setInterval(() => this.loadJobs(), 2000);
    }

    stopPolling() {
        if (this.pollInterval) clearInterval(this.pollInterval);
    }

    updateJob(updatedJob) {
        const idx = this.jobs.findIndex(j => j.id === updatedJob.id);
        if (idx >= 0) {
            this.jobs[idx] = updatedJob;
        } else {
            this.jobs.unshift(updatedJob);
        }
        this.renderJobs();
    }

    renderJobs() {
        const container = this.shadowRoot.getElementById('jobQueue');

        // Filter active jobs
        const activeJobs = this.jobs.filter(j =>
            j.status === 'pending' || j.status === 'processing'
        );

        const completedJobs = this.jobs.filter(j => j.status === 'completed').slice(0, 5);
        const failedJobs = this.jobs.filter(j => j.status === 'failed').slice(0, 3);

        const displayJobs = [...activeJobs, ...completedJobs, ...failedJobs];

        if (displayJobs.length === 0) {
            container.innerHTML = `
                <div class="empty-queue">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2"/>
                        <path d="M9 9h6v6H9z"/>
                    </svg>
                    <p>No active jobs</p>
                </div>
            `;
            return;
        }

        container.innerHTML = displayJobs.map(job => this.renderJobItem(job)).join('');
    }

    renderJobItem(job) {
        const progress = job.progress ? (job.progress * 100).toFixed(0) : 0;
        const isVideo = job.type === 'video';
        const hasResult = job.result?.output_paths?.length;

        let thumbnail = '';
        if (hasResult) {
            const outputPath = job.result.output_paths[0];
            const filename = outputPath.split('/').pop();
            if (isVideo) {
                thumbnail = `<video class="job-thumbnail" src="/static/outputs/${filename}" muted loop playsinline></video>`;
            } else {
                thumbnail = `<img class="job-thumbnail" src="/static/outputs/${filename}" alt="">`;
            }
        } else {
            thumbnail = `<div class="job-thumbnail placeholder">${isVideo ? '🎬' : '🖼️'}</div>`;
        }

        const meta = [];
        if (job.request?.width) meta.push(`${job.request.width}×${job.request.height}`);
        if (job.request?.num_frames) meta.push(`${job.request.num_frames}f @ ${job.request.fps}fps`);
        if (job.request?.num_inference_steps) meta.push(`${job.request.num_inference_steps} steps`);

        return `
            <div class="job-item" data-job-id="${job.id}">
                ${thumbnail}
                <div class="job-info">
                    <div class="job-prompt">${this.escapeHtml(job.request?.prompt || 'Unknown')}</div>
                    <div class="job-meta">${meta.join(' • ')}</div>
                </div>
                <div class="job-progress">
                    <div class="job-progress-bar" style="width: ${progress}%"></div>
                </div>
                <span class="job-status ${job.status}">${job.status}</span>
            </div>
        `;
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

customElements.define('job-queue', JobQueue);
