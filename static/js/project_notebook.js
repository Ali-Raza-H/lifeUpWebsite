const NotebookUI = {
    projectId: PROJECT_ID,
    currentNoteId: null,
    editor: null,
    allNotes: [],
    saveTimeout: null,

    async init() {
        try {
            const project = await API.get(`/api/projects/${this.projectId}`);
            document.getElementById('notebook-page-title').innerHTML = `<span style="opacity: 0.5;">Notebook /</span> ${CoreUI.escapeHtml(project.name)}`;
            
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
        const filteredNotes = this.allNotes.filter(n => 
            n.title.toLowerCase().includes(filter.toLowerCase()) || 
            n.content.toLowerCase().includes(filter.toLowerCase())
        );

        listEl.innerHTML = filteredNotes.map(note => `
            <div class="note-item ${this.currentNoteId === note.id ? 'active' : ''}" 
                 onclick="NotebookUI.selectNote(${note.id})">
                <div class="note-title">${CoreUI.escapeHtml(note.title)}</div>
                <div class="note-meta">${this.formatDate(note.updated_at)}</div>
            </div>
        `).join('');

        if (filteredNotes.length === 0) {
            listEl.innerHTML = `<div class="empty-state-container" style="padding: 20px; text-align: center; font-size: 13px; color: var(--text-muted);">No notes found</div>`;
        }
    },

    async selectNote(noteId) {
        try {
            const note = await API.get(`/api/projects/${this.projectId}/notes/${noteId}`);
            this.currentNoteId = noteId;
            
            document.getElementById('notebook-empty-state').style.display = 'none';
            document.getElementById('editor-container').style.display = 'flex';
            
            document.getElementById('note-title-input').value = note.title;
            this.editor.value(note.content);
            
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
                title: 'New Note',
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
        if (!confirm('Are you sure you want to delete this note?')) return;

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
                title, 
                content 
            });
            
            statusEl.textContent = 'All changes saved';
            setTimeout(() => {
                statusEl.classList.remove('visible');
            }, 2000);
            
            // Update list without reloading everything if possible
            const note = this.allNotes.find(n => n.id === this.currentNoteId);
            if (note) {
                note.title = title;
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
});
