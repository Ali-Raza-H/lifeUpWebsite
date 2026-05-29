const NotebookUI = {
    projectId: PROJECT_ID,
    currentNoteId: null,
    editor: null,
    allNotes: [],
    saveTimeout: null,

    async init() {
        try {
            const project = await API.get(`/api/projects/${this.projectId}`);
            document.getElementById('notebook-page-title').innerHTML = `<span class="item-desc">Notebook /</span> ${CoreUI.escapeHtml(project.name)}`;
            
            this.initEditor();
            await this.loadNotes();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load project notebook.');
        }
    },

    initEditor() {
        this.editor = new EasyMDE({
            element: document.getElementById('project-notes-editor'),
            spellChecker: false,
            autosave: { enabled: false },
            status: ["lines", "words"],
            toolbar: [
                "bold", "italic", "strikethrough", "|", 
                "heading-1", "heading-2", "heading-3", "|", 
                "code", "quote", "|", 
                "unordered-list", "ordered-list", "|", 
                "link", "image", "|", 
                "preview", "side-by-side", "fullscreen", "|", 
                "guide"
            ],
        });

        // Handle content changes for autosave
        this.editor.codemirror.on('change', () => {
            if (this.currentNoteId) {
                this.triggerAutosave();
            }
        });
    },

    async loadNotes() {
        try {
            const notes = await API.get(`/api/projects/${this.projectId}/notes`);
            this.allNotes = notes;
            this.renderNotesList();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load notes.');
        }
    },

    renderNotesList(filter = '') {
        const listEl = document.getElementById('notes-list');
        const countEl = document.getElementById('notebook-note-count');
        const query = filter.trim().toLowerCase();
        const filteredNotes = this.allNotes.filter((note) => 
            (note.title || '').toLowerCase().includes(query) ||
            (note.content || '').toLowerCase().includes(query)
        );
        if (countEl) countEl.textContent = `${filteredNotes.length} note${filteredNotes.length === 1 ? '' : 's'}`;

        listEl.innerHTML = filteredNotes.map(note => `
            <div class="project-note-item ${this.currentNoteId === note.id ? 'active' : ''}" 
                 onclick="NotebookUI.selectNote(${note.id})">
                <div class="project-note-item-title">${CoreUI.escapeHtml(note.title || 'Untitled note')}</div>
                <div class="project-note-item-preview">${CoreUI.escapeHtml(this.getPreview(note.content))}</div>
                <div class="project-note-item-meta">${this.formatDate(note.updated_at)}</div>
            </div>
        `).join('');

        if (filteredNotes.length === 0) {
            listEl.innerHTML = '<div class="compact-item"><span class="item-desc">No notes found.</span></div>';
        }
    },

    async selectNote(noteId) {
        try {
            const note = await API.get(`/api/projects/${this.projectId}/notes/${noteId}`);
            this.currentNoteId = noteId;
            
            document.getElementById('notebook-empty-state').style.display = 'none';
            document.getElementById('editor-container').style.display = 'flex';
            
            document.getElementById('note-title-input').value = note.title || '';
            this.editor.value(note.content || '');
            
            this.renderNotesList();
            
            // Attach title change listener
            document.getElementById('note-title-input').oninput = () => this.triggerAutosave();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load note.');
        }
    },

    async createNewNote() {
        try {
            const newNote = {
                title: 'Untitled note',
                content: ''
            };
            const response = await API.post(`/api/projects/${this.projectId}/notes`, newNote);
            const note = response.note;
            
            await this.loadNotes();
            await this.selectNote(note.id);
            
            // Focus the title input for immediate editing
            document.getElementById('note-title-input').focus();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to create note.');
        }
    },

    async deleteCurrentNote() {
        if (!this.currentNoteId) return;
        if (!(await CoreUI.confirm({
            title: 'Delete project note?',
            message: 'This project note will be removed permanently.',
            confirmText: 'Delete'
        }))) return;

        try {
            await API.delete(`/api/projects/${this.projectId}/notes/${this.currentNoteId}`);
            this.currentNoteId = null;
            document.getElementById('editor-container').style.display = 'none';
            document.getElementById('notebook-empty-state').style.display = 'flex';
            await this.loadNotes();
            CoreUI.showError('Note deleted.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete note.');
        }
    },

    triggerAutosave() {
        const statusEl = document.getElementById('save-status');
        statusEl.textContent = 'Saving...';
        statusEl.classList.add('visible');

        clearTimeout(this.saveTimeout);
        this.saveTimeout = setTimeout(() => this.saveNote(), 1000);
    },

    async saveNote() {
        if (!this.currentNoteId) return;

        const title = document.getElementById('note-title-input').value;
        const content = this.editor.value();
        const statusEl = document.getElementById('save-status');

        try {
            await API.put(`/api/projects/${this.projectId}/notes/${this.currentNoteId}`, { 
                title: title || 'Untitled note', 
                content 
            });
            
            statusEl.textContent = 'All changes saved';
            setTimeout(() => {
                statusEl.classList.remove('visible');
            }, 2000);
            
            // Update list without reloading everything if possible
            const note = this.allNotes.find(n => n.id === this.currentNoteId);
            if (note) {
                note.title = title || 'Untitled note';
                note.content = content;
                note.updated_at = new Date().toISOString();
                this.renderNotesList(document.getElementById('notes-search').value);
            }
        } catch (error) {
            statusEl.textContent = 'Save failed';
            CoreUI.showError(error.message || 'Failed to autosave note.');
        }
    },

    filterNotes() {
        const term = document.getElementById('notes-search').value;
        this.renderNotesList(term);
    },

    getPreview(content) {
        const clean = String(content || '')
            .replace(/[#*_`>\-[\]()]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        return clean || 'No content yet.';
    },

    formatDate(dateString) {
        if (!dateString) return 'Never';
        return new Date(dateString).toLocaleDateString(undefined, { 
            month: 'short', 
            day: 'numeric', 
            year: 'numeric' 
        });
    }
};

document.addEventListener('DOMContentLoaded', () => {
    NotebookUI.init();
    document.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
            if (NotebookUI.currentNoteId) {
                event.preventDefault();
                NotebookUI.saveNote();
            }
        }
    });
});
