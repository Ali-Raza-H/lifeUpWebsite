const WorkUI = {
    experiences: [],
    linkedinDrafts: [],
    linkedinConfig: null,
    generatingDraftIds: new Set(),
    autoGenerateAttemptedIds: new Set(),
    summary: null,

    init() {
        this.bindEvents();
        this.loadAll();
    },

    bindEvents() {
        document.getElementById('work-search')?.addEventListener('input', () => this.loadExperiences());
        document.getElementById('work-status-filter')?.addEventListener('change', () => this.loadExperiences());
        document.getElementById('work-type-filter')?.addEventListener('change', () => this.loadExperiences());

        const modal = document.getElementById('work-modal');
        modal?.addEventListener('click', (event) => {
            if (event.target === modal) this.closeModal();
        });
    },

    async loadAll() {
        await Promise.all([this.loadSummary(), this.loadExperiences(), this.loadLinkedInConfig()]);
        await this.loadLinkedInDrafts();
    },

    async loadLinkedInConfig() {
        try {
            this.linkedinConfig = await API.get('/api/linkedin/config');
            this.renderLinkedInConfig();
        } catch (error) {
            this.linkedinConfig = {
                generation_mode: 'client',
                ollama_base_url: 'http://127.0.0.1:11434',
                ollama_model: 'qwen2.5:7b-instruct',
                email_to: 'khadamalihussain@gmail.com'
            };
            this.renderLinkedInConfig();
        }
    },

    renderLinkedInConfig() {
        const description = document.getElementById('linkedin-outbox-description');
        if (!description || !this.linkedinConfig) return;

        const mode = this.linkedinConfig.generation_mode === 'client' ? 'your local Ollama' : 'server Ollama';
        description.textContent = `Generated when flagged tasks or projects are completed. Drafts use ${mode} (${this.linkedinConfig.ollama_model}) and email ${this.linkedinConfig.email_to} when SMTP is configured.`;
    },

    async loadSummary() {
        try {
            this.summary = await API.get('/api/work/summary');
            this.renderSummary();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load work summary.');
        }
    },

    async loadExperiences() {
        try {
            const params = new URLSearchParams();
            const query = document.getElementById('work-search')?.value.trim();
            const status = document.getElementById('work-status-filter')?.value;
            const type = document.getElementById('work-type-filter')?.value;
            if (query) params.set('q', query);
            if (status) params.set('status', status);
            if (type) params.set('type', type);

            const suffix = params.toString() ? `?${params.toString()}` : '';
            this.experiences = await API.get(`/api/work/experiences${suffix}`);
            this.renderExperiences();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load work records.');
        }
    },

    renderSummary() {
        const grid = document.getElementById('work-summary-grid');
        if (!grid || !this.summary) return;

        const metrics = [
            ['Total Records', this.summary.total || 0],
            ['Pipeline', this.summary.pipeline_count || 0],
            ['Active', this.summary.active_count || 0],
            ['Completed', this.summary.completed_count || 0]
        ];
        grid.innerHTML = metrics.map(([label, value]) => `
            <div class="compact-item metric-card">
                <span class="item-desc">${CoreUI.escapeHtml(label)}</span>
                <div class="stat-value">${value}</div>
            </div>
        `).join('');
    },

    renderExperiences() {
        const grid = document.getElementById('work-experience-grid');
        if (!grid) return;

        if (!this.experiences.length) {
            CoreUI.setEmptyState(grid, 'No jobs or work experience records match this view.');
            return;
        }

        grid.innerHTML = this.experiences.map((item) => `
            <article class="compact-item work-card">
                <div class="work-card-head">
                    <div class="item-main">
                        <div class="item-title">${CoreUI.escapeHtml(item.title)}</div>
                        <div class="item-desc">${CoreUI.escapeHtml(item.organization)}</div>
                    </div>
                    <span class="badge work-status-${CoreUI.escapeHtml(item.status)}">${CoreUI.escapeHtml(this.labelize(item.status))}</span>
                </div>
                <div class="work-card-meta">
                    <span><i class="ph ph-tag"></i> ${CoreUI.escapeHtml(this.labelize(item.experience_type))}</span>
                    ${item.location ? `<span><i class="ph ph-map-pin"></i> ${CoreUI.escapeHtml(item.location)}</span>` : ''}
                    ${this.formatPeriod(item) ? `<span><i class="ph ph-calendar"></i> ${CoreUI.escapeHtml(this.formatPeriod(item))}</span>` : ''}
                    ${item.hours_per_week !== null ? `<span><i class="ph ph-clock"></i> ${item.hours_per_week} hrs/week</span>` : ''}
                </div>
                ${item.skills ? `<div class="work-card-skills">${this.renderSkillChips(item.skills)}</div>` : ''}
                ${item.achievements ? `<p class="item-desc work-card-note">${CoreUI.escapeHtml(item.achievements)}</p>` : ''}
                <div class="work-card-actions">
                    ${item.application_url ? `<a class="btn btn-sm" href="${CoreUI.escapeHtml(item.application_url)}" target="_blank" rel="noopener"><i class="ph ph-arrow-square-out"></i> Link</a>` : ''}
                    <button type="button" class="btn btn-sm" onclick="WorkUI.openModal(${item.id})"><i class="ph ph-pencil-simple"></i> Edit</button>
                </div>
            </article>
        `).join('');
    },

    async loadLinkedInDrafts() {
        try {
            this.linkedinDrafts = await API.get('/api/linkedin/drafts');
            this.renderLinkedInDrafts();
            await this.processPendingLinkedInDrafts();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load LinkedIn drafts.');
        }
    },

    renderLinkedInDrafts() {
        const list = document.getElementById('linkedin-draft-list');
        if (!list) return;

        if (!this.linkedinDrafts.length) {
            CoreUI.setEmptyState(list, 'No LinkedIn drafts generated yet.');
            return;
        }

        list.innerHTML = this.linkedinDrafts.map((draft) => {
            const isGenerating = this.generatingDraftIds.has(draft.id);
            return `
            <article class="compact-item linkedin-draft-card">
                <div class="linkedin-draft-head">
                    <div class="item-main">
                        <div class="item-title">${CoreUI.escapeHtml(draft.title)}</div>
                        <div class="item-desc">${CoreUI.escapeHtml(this.labelize(draft.source_type))} #${draft.source_id} - ${CoreUI.escapeHtml(CoreUI.formatDate(draft.created_at))}</div>
                    </div>
                    <span class="badge linkedin-email-${CoreUI.escapeHtml(draft.email_status)}">${CoreUI.escapeHtml(this.labelize(draft.email_status))}</span>
                </div>
                <pre class="linkedin-draft-body">${CoreUI.escapeHtml(draft.post_body)}</pre>
                ${draft.email_error ? `<div class="item-desc linkedin-draft-error">${CoreUI.escapeHtml(draft.email_error)}</div>` : ''}
                <div class="linkedin-draft-actions">
                    <button type="button" class="btn btn-sm" onclick="WorkUI.copyLinkedInDraft(${draft.id})"><i class="ph ph-copy"></i> Copy</button>
                    ${draft.email_status === 'pending_generation'
                        ? `<button type="button" class="btn btn-sm btn-primary" onclick="WorkUI.generateLinkedInDraft(${draft.id})" ${isGenerating ? 'disabled' : ''}><i class="ph ph-magic-wand"></i> ${isGenerating ? 'Generating...' : 'Generate'}</button>`
                        : `<button type="button" class="btn btn-sm" onclick="WorkUI.resendLinkedInDraft(${draft.id})"><i class="ph ph-envelope-simple"></i> Email</button>`}
                </div>
            </article>
        `;
        }).join('');
    },

    async processPendingLinkedInDrafts() {
        if (this.linkedinConfig?.generation_mode !== 'client') return;

        const pendingDrafts = this.linkedinDrafts.filter((draft) => (
            draft.email_status === 'pending_generation'
            && !this.generatingDraftIds.has(draft.id)
            && !this.autoGenerateAttemptedIds.has(draft.id)
        ));
        for (const draft of pendingDrafts) {
            this.autoGenerateAttemptedIds.add(draft.id);
            await this.generateLinkedInDraft(draft.id, { silent: true });
        }
    },

    async generateLinkedInDraft(draftId, options = {}) {
        const draft = this.linkedinDrafts.find((item) => item.id === draftId);
        if (!draft || this.generatingDraftIds.has(draftId)) return;

        if (!this.linkedinConfig) {
            await this.loadLinkedInConfig();
        }

        this.generatingDraftIds.add(draftId);
        this.renderLinkedInDrafts();

        try {
            const generatedPost = await this.generateLinkedInPostWithOllama(draft);
            const response = await API.post(`/api/linkedin/drafts/${draftId}/generation`, {
                post_body: generatedPost
            });
            await this.loadLinkedInDrafts();
            if (!options.silent) {
                CoreUI.showError(response.message || 'LinkedIn draft generated.', true);
            }
        } catch (error) {
            if (!options.silent) {
                CoreUI.showError(error.message || 'Local Ollama generation failed.');
            } else {
                console.warn('Local Ollama generation failed:', error);
            }
        } finally {
            this.generatingDraftIds.delete(draftId);
            this.renderLinkedInDrafts();
        }
    },

    async generateLinkedInPostWithOllama(draft) {
        const config = this.linkedinConfig || {};
        const baseUrl = String(config.ollama_base_url || 'http://127.0.0.1:11434').replace(/\/+$/, '');
        const model = config.ollama_model || 'qwen2.5:7b-instruct';
        const response = await fetch(`${baseUrl}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model,
                prompt: this.buildLinkedInPrompt(draft),
                stream: false,
                options: {
                    temperature: 0.72,
                    top_p: 0.9,
                    num_predict: 420
                }
            })
        });

        if (!response.ok) {
            throw new Error(`Ollama returned ${response.status}. Check Ollama is running and allows this site origin.`);
        }

        const data = await response.json();
        const text = this.cleanGeneratedLinkedInPost(data.response || '');
        if (!text) {
            throw new Error('Ollama returned an empty LinkedIn draft.');
        }
        return text;
    },

    buildLinkedInPrompt(draft) {
        const isProject = draft.source_type === 'project';
        const wordLimit = isProject ? 200 : 180;
        const angle = isProject
            ? 'announcing a completed project'
            : 'sharing a completed task inside an active project';
        return [
            `Write a LinkedIn post for a student/developer ${angle}.`,
            'Use the context below. Make it specific, credible, and useful for building visibility.',
            'Mention what was built or completed, why it matters, and what skill signal it gives.',
            'Avoid inventing facts, fake metrics, cringe hype, and buzzword spam.',
            `Keep it under ${wordLimit} words and end with 2-4 relevant hashtags.`,
            '',
            `Context:\n${draft.context_summary || draft.post_body || ''}`,
            '',
            'Return only the post text.'
        ].join('\n');
    },

    cleanGeneratedLinkedInPost(text) {
        let cleaned = String(text || '').trim();
        if (cleaned.startsWith('```')) {
            cleaned = cleaned.replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim();
        }
        ['LinkedIn post:', 'Post:', 'Draft:'].forEach((prefix) => {
            if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
                cleaned = cleaned.slice(prefix.length).trim();
            }
        });
        return cleaned.slice(0, 2500);
    },

    async copyLinkedInDraft(draftId) {
        const draft = this.linkedinDrafts.find((item) => item.id === draftId);
        if (!draft) return;
        try {
            await navigator.clipboard.writeText(draft.post_body);
            CoreUI.showError('LinkedIn draft copied.', true);
        } catch (error) {
            CoreUI.showError('Copy failed. Select the draft text manually.');
        }
    },

    async resendLinkedInDraft(draftId) {
        try {
            const response = await API.post(`/api/linkedin/drafts/${draftId}/send`, {});
            await this.loadLinkedInDrafts();
            CoreUI.showError(response.message || 'LinkedIn draft email processed.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to email LinkedIn draft.');
        }
    },

    renderSkillChips(skills) {
        return String(skills)
            .split(',')
            .map((skill) => skill.trim())
            .filter(Boolean)
            .slice(0, 8)
            .map((skill) => `<span class="badge">${CoreUI.escapeHtml(skill)}</span>`)
            .join('');
    },

    openModal(experienceId = null) {
        const modal = document.getElementById('work-modal');
        const form = document.getElementById('work-form');
        const title = document.getElementById('work-modal-title');
        const deleteButton = document.getElementById('work-delete-btn');
        if (!modal || !form || !title || !deleteButton) return;

        form.reset();
        document.getElementById('work-id').value = '';
        document.getElementById('work-type').value = 'job';
        document.getElementById('work-status').value = 'saved';
        deleteButton.style.display = 'none';
        title.textContent = 'Add Experience';

        if (experienceId) {
            const item = this.experiences.find((entry) => entry.id === experienceId);
            if (!item) return;
            title.textContent = 'Edit Experience';
            deleteButton.style.display = 'inline-flex';
            document.getElementById('work-id').value = item.id;
            document.getElementById('work-title').value = item.title;
            document.getElementById('work-organization').value = item.organization;
            document.getElementById('work-type').value = item.experience_type;
            document.getElementById('work-status').value = item.status;
            document.getElementById('work-location').value = item.location || '';
            document.getElementById('work-hours').value = item.hours_per_week ?? '';
            document.getElementById('work-start').value = item.start_date || '';
            document.getElementById('work-end').value = item.end_date || '';
            document.getElementById('work-skills').value = item.skills || '';
            document.getElementById('work-responsibilities').value = item.responsibilities || '';
            document.getElementById('work-achievements').value = item.achievements || '';
            document.getElementById('work-url').value = item.application_url || '';
            document.getElementById('work-notes').value = item.notes || '';
        }

        modal.style.display = 'flex';
    },

    closeModal() {
        const modal = document.getElementById('work-modal');
        if (modal) modal.style.display = 'none';
    },

    async saveExperience(event) {
        event.preventDefault();
        const experienceId = document.getElementById('work-id').value;
        const payload = {
            title: document.getElementById('work-title').value,
            organization: document.getElementById('work-organization').value,
            experience_type: document.getElementById('work-type').value,
            status: document.getElementById('work-status').value,
            location: document.getElementById('work-location').value,
            start_date: document.getElementById('work-start').value,
            end_date: document.getElementById('work-end').value,
            hours_per_week: document.getElementById('work-hours').value || null,
            skills: document.getElementById('work-skills').value,
            responsibilities: document.getElementById('work-responsibilities').value,
            achievements: document.getElementById('work-achievements').value,
            application_url: document.getElementById('work-url').value,
            notes: document.getElementById('work-notes').value
        };

        try {
            if (experienceId) {
                await API.put(`/api/work/experiences/${experienceId}`, payload);
            } else {
                await API.post('/api/work/experiences', payload);
            }
            this.closeModal();
            await this.loadAll();
            CoreUI.showError('Work experience saved.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to save work experience.');
        }
    },

    async deleteCurrentExperience() {
        const experienceId = document.getElementById('work-id').value;
        if (!experienceId) return;

        const confirmed = await CoreUI.confirm({
            title: 'Delete work record?',
            message: 'This removes the job or work experience record permanently.',
            confirmText: 'Delete'
        });
        if (!confirmed) return;

        try {
            await API.delete(`/api/work/experiences/${experienceId}`);
            this.closeModal();
            await this.loadAll();
            CoreUI.showError('Work experience deleted.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete work experience.');
        }
    },

    formatPeriod(item) {
        if (!item.start_date && !item.end_date) return '';
        if (item.start_date && item.end_date) return `${this.formatDate(item.start_date)} - ${this.formatDate(item.end_date)}`;
        if (item.start_date) return `${this.formatDate(item.start_date)} - Present`;
        return `Until ${this.formatDate(item.end_date)}`;
    },

    formatDate(value) {
        if (!value) return '';
        const date = new Date(`${value}T00:00:00`);
        if (Number.isNaN(date.getTime())) return value;
        return date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
    },

    labelize(value) {
        return String(value || '')
            .replaceAll('_', ' ')
            .replace(/\b\w/g, (char) => char.toUpperCase());
    }
};

document.addEventListener('DOMContentLoaded', () => WorkUI.init());
