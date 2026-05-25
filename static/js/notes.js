const NotesUI = {
    notes: [],
    currentNoteId: null,
    editor: null,

    async loadNotes() {
        try {
            const notes = await API.get('/api/notes/');
            this.notes = notes;
            this.renderNotesList();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load notes.');
        }
    },

    renderNotesList() {
        const list = document.getElementById('notes-list');
        list.innerHTML = '';
        
        if (this.notes.length === 0) {
            list.innerHTML = '<div class="item-desc" style="padding: var(--space-2);">No notes yet.</div>';
            return;
        }

        this.notes.forEach(note => {
            const div = document.createElement('div');
            div.className = `compact-item ${note.id === this.currentNoteId ? 'active' : ''}`;
            div.style.cursor = 'pointer';
            div.style.flexDirection = 'column';
            div.style.alignItems = 'flex-start';
            div.style.gap = '4px';
            div.style.padding = '12px';
            
            if (note.id === this.currentNoteId) {
                div.style.background = 'var(--bg-surface-hover)';
                div.style.borderLeft = '2px solid var(--primary)';
            }
            
            div.onclick = () => this.selectNote(note.id);
            
            const updated = new Date(note.updated_at).toLocaleDateString();
            
            div.innerHTML = `
                <div class="item-title" style="font-size: 14px; width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${CoreUI.escapeHtml(note.title)}</div>
                <div class="item-desc" style="font-size: 11px;">Updated ${updated}</div>
            `;
            list.appendChild(div);
        });
    },

    initEditor() {
        if (this.editor) return;
        this.editor = new EasyMDE({
            element: document.getElementById('note-content'),
            spellChecker: false,
            autosave: {
                enabled: false
            },
            status: false,
            minHeight: "400px",
            toolbar: ["bold", "italic", "heading", "|", "quote", "unordered-list", "ordered-list", "|", "link", "image", "|", "preview", "guide"]
        });
    },

    selectNote(id) {
        const note = this.notes.find(n => n.id === id);
        if (!note) return;
        
        this.currentNoteId = id;
        this.renderNotesList(); // update active state
        
        document.getElementById('note-empty-state').style.display = 'none';
        document.getElementById('note-editor-container').style.display = 'flex';
        
        document.getElementById('current-note-id').value = note.id;
        document.getElementById('note-title').value = note.title;
        
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
        
        this.initEditor();
        this.editor.value('');
        document.getElementById('note-title').focus();
    },

    async saveNote() {
        const id = document.getElementById('current-note-id').value;
        const title = document.getElementById('note-title').value || 'Untitled Note';
        const content = this.editor.value();
        
        const payload = { title, content };
        
        try {
            if (id) {
                await API.put(`/api/notes/${id}`, payload);
            } else {
                const response = await API.post('/api/notes/', payload);
                this.currentNoteId = response.note.id;
                document.getElementById('current-note-id').value = response.note.id;
            }
            await this.loadNotes();
            CoreUI.showError('Note saved.', true); // Show success in alert region (abusing showError slightly or add generic alert, but this works)
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to save note.');
        }
    },

    async deleteCurrentNote() {
        const id = document.getElementById('current-note-id').value;
        if (!id || !confirm('Delete this note forever?')) return;
        
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
    NotesUI.loadNotes();
    
    // Auto-save shortcut (Ctrl+S / Cmd+S)
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 's') {
            if (document.getElementById('note-editor-container').style.display === 'flex') {
                e.preventDefault();
                NotesUI.saveNote();
            }
        }
    });
});