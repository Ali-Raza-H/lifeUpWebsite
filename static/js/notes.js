const NotesUI = {
    notes: [],
    currentNoteId: null,
    editor: null,
    filters: {
        query: '',
        pinnedOnly: false
    },

    init() {
        document.getElementById('notes-search')?.addEventListener('input', (event) => {
            this.filters.query = event.target.value.trim().toLowerCase();
            this.renderNotesList();
        });
        document.getElementById('notes-pinned-only')?.addEventListener('change', (event) => {
            this.filters.pinnedOnly = event.target.checked;
            this.renderNotesList();
        });
    },

    async loadNotes() {
        try {
            const notes = await API.get('/api/notes/');
            this.notes = notes;
            this.renderNotesList();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load notes.');
        }
    },

    getFilteredNotes() {
        return this.notes.filter((note) => {
            const haystack = `${note.title} ${note.content || ''} ${note.tags || ''}`.toLowerCase();
            if (this.filters.query && !haystack.includes(this.filters.query)) return false;
            if (this.filters.pinnedOnly && !note.is_pinned) return false;
            return true;
        });
    },

    renderNotesList() {
        const list = document.getElementById('notes-list');
        const count = document.getElementById('notes-results-count');
        if (!list) return;

        const notes = this.getFilteredNotes();
        if (count) count.textContent = `${notes.length} note${notes.length === 1 ? '' : 's'}`;
        list.innerHTML = '';

        if (notes.length === 0) {
            CoreUI.setEmptyState(list, 'No notes found.');
            return;
        }

        notes.forEach((note) => {
            const div = document.createElement('div');
            div.className = `compact-item note-list-item ${note.id === this.currentNoteId ? 'active' : ''}`;
            div.onclick = () => this.selectNote(note.id);
            const updated = new Date(note.updated_at).toLocaleDateString();
            div.innerHTML = `
                <div class="note-list-title-row">
                    <div class="item-title note-list-title">${CoreUI.escapeHtml(note.title)}</div>
                    ${note.is_pinned ? '<i class="ph-fill ph-push-pin note-list-pin"></i>' : ''}
                </div>
                ${note.tags ? `<div class="item-desc note-list-tags">${CoreUI.escapeHtml(note.tags)}</div>` : ''}
                <div class="item-desc note-list-meta-row"><span>Updated ${updated}</span></div>
            `;
            list.appendChild(div);
        });
    },

    initEditor() {
        if (this.editor) return;
        this.editor = new EasyMDE({
            element: document.getElementById('note-content'),
            spellChecker: false,
            autosave: { enabled: false },
            status: false,
            minHeight: '360px',
            toolbar: [
                'bold', 'italic', 'strikethrough', '|',
                'heading-1', 'heading-2', 'heading-3', '|',
                'quote', 'unordered-list', 'ordered-list', '|',
                'link', '|',
                'preview', 'side-by-side', 'fullscreen', '|',
                'guide'
            ]
        });
    },

    selectNote(id) {
        const note = this.notes.find((item) => item.id === id);
        if (!note) return;

        this.currentNoteId = id;
        this.renderNotesList();
        document.getElementById('note-empty-state').style.display = 'none';
        document.getElementById('note-editor-container').style.display = 'flex';
        document.getElementById('current-note-id').value = note.id;
        document.getElementById('note-title').value = note.title;
        document.getElementById('note-tags').value = note.tags || '';
        document.getElementById('note-pin-btn').innerHTML = note.is_pinned ? '<i class="ph-fill ph-push-pin"></i> Unpin' : '<i class="ph ph-push-pin"></i> Pin';
        this.initEditor();
        this.editor.value(note.content || '');
    },

    createNewNote() {
        this.currentNoteId = null;
        this.renderNotesList();
        document.getElementById('note-empty-state').style.display = 'none';
        document.getElementById('note-editor-container').style.display = 'flex';
        document.getElementById('current-note-id').value = '';
        document.getElementById('note-title').value = '';
        document.getElementById('note-tags').value = '';
        document.getElementById('note-pin-btn').innerHTML = '<i class="ph ph-push-pin"></i> Pin';
        this.initEditor();
        this.editor.value('');
        document.getElementById('note-title').focus();
    },

    async saveNote() {
        const id = document.getElementById('current-note-id').value;
        const existing = this.notes.find((note) => note.id === this.currentNoteId);
        const payload = {
            title: document.getElementById('note-title').value || 'Untitled Note',
            tags: document.getElementById('note-tags').value,
            is_pinned: existing?.is_pinned || 0,
            content: this.editor.value()
        };

        try {
            if (id) {
                await API.put(`/api/notes/${id}`, payload);
            } else {
                const response = await API.post('/api/notes/', payload);
                this.currentNoteId = response.note.id;
                document.getElementById('current-note-id').value = response.note.id;
            }
            await this.loadNotes();
            if (this.currentNoteId) this.selectNote(this.currentNoteId);
            CoreUI.showError('Note saved.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to save note.');
        }
    },

    async togglePinCurrentNote() {
        const id = document.getElementById('current-note-id').value;
        if (!id) return;
        const note = this.notes.find((item) => item.id === Number(id));
        if (!note) return;
        try {
            await API.put(`/api/notes/${id}`, { is_pinned: note.is_pinned ? 0 : 1 });
            await this.loadNotes();
            this.selectNote(Number(id));
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to update note.');
        }
    },

    async deleteCurrentNote() {
        const id = document.getElementById('current-note-id').value;
        if (!id || !(await CoreUI.confirm({
            title: 'Delete note?',
            message: 'This note will be removed permanently.',
            confirmText: 'Delete'
        }))) return;
        try {
            await API.delete(`/api/notes/${id}`);
            this.currentNoteId = null;
            document.getElementById('note-editor-container').style.display = 'none';
            document.getElementById('note-empty-state').style.display = 'flex';
            await this.loadNotes();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete note.');
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    NotesUI.init();
    NotesUI.loadNotes();
    document.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
            if (document.getElementById('note-editor-container').style.display === 'flex') {
                event.preventDefault();
                NotesUI.saveNote();
            }
        }
    });
});
