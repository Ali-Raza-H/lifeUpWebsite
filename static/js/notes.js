const NotesUI = {
    notes: [],
    currentNoteId: null,
    isEditing: false,
    autosaveEnabled: false,
    saveInFlight: false,
    saveQueued: false,
    suppressInput: false,
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
        document.getElementById('note-title')?.addEventListener('input', () => this.handleEditableInput());
        document.getElementById('note-tags')?.addEventListener('input', () => this.handleEditableInput());
        document.getElementById('note-content')?.addEventListener('input', () => this.handleEditableInput());
        document.getElementById('note-content')?.addEventListener('paste', (event) => this.handlePaste(event));
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
            const preview = this.plainPreview(note.content || '');
            div.innerHTML = `
                <div class="note-list-title-row">
                    <div class="item-title note-list-title">${CoreUI.escapeHtml(note.title)}</div>
                    ${note.is_pinned ? '<i class="ph-fill ph-push-pin note-list-pin"></i>' : ''}
                </div>
                ${preview ? `<div class="item-desc note-list-excerpt">${CoreUI.escapeHtml(preview)}</div>` : ''}
                ${note.tags ? `<div class="item-desc note-list-tags">${CoreUI.escapeHtml(note.tags)}</div>` : ''}
                <div class="item-desc note-list-meta-row"><span>Updated ${updated}</span></div>
            `;
            list.appendChild(div);
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
        this.setContentFromMarkdown(note.content || '');
        this.setEditing(false);
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
        this.setContentFromMarkdown('');
        this.setEditing(true);
        document.getElementById('note-title').focus();
    },

    openQuickAdd() {
        this.createNewNote();
    },

    setContentFromMarkdown(markdown) {
        const preview = document.getElementById('note-preview');
        const editor = document.getElementById('note-content');
        const html = this.markdownToSafeHtml(markdown || '');
        this.suppressInput = true;
        preview.innerHTML = html || '<p class="note-placeholder">No content yet.</p>';
        editor.innerHTML = html || '<p><br></p>';
        this.suppressInput = false;
    },

    setEditing(enabled) {
        this.isEditing = enabled;
        const editor = document.getElementById('note-content');
        const preview = document.getElementById('note-preview');
        const toolbar = document.getElementById('note-format-toolbar');
        const title = document.getElementById('note-title');
        const tags = document.getElementById('note-tags');
        const editButton = document.getElementById('note-edit-toggle');

        editor.style.display = enabled ? 'block' : 'none';
        preview.style.display = enabled ? 'none' : 'block';
        toolbar.style.display = enabled ? 'flex' : 'none';
        editor.setAttribute('contenteditable', enabled ? 'true' : 'false');
        title.readOnly = !enabled;
        tags.readOnly = !enabled;
        editButton.innerHTML = enabled ? '<i class="ph ph-eye"></i> Preview' : '<i class="ph ph-pencil-simple"></i> Edit';
        editButton.classList.toggle('active', enabled);
    },

    toggleEditing() {
        if (this.isEditing) {
            this.refreshPreviewFromEditor();
            this.setEditing(false);
            return;
        }
        this.setEditing(true);
        document.getElementById('note-content').focus();
    },

    toggleAutosave() {
        this.autosaveEnabled = !this.autosaveEnabled;
        const button = document.getElementById('note-autosave-btn');
        button.classList.toggle('active', this.autosaveEnabled);
        button.innerHTML = this.autosaveEnabled
            ? '<i class="ph ph-floppy-disk-back"></i> Autosave On'
            : '<i class="ph ph-floppy-disk-back"></i> Autosave Off';
        if (this.autosaveEnabled) this.saveNote({ silent: true });
    },

    handleEditableInput() {
        if (this.suppressInput || !this.isEditing || !this.autosaveEnabled) return;
        this.saveNote({ silent: true });
    },

    handlePaste(event) {
        if (!this.isEditing) return;
        const markdown = event.clipboardData?.getData('text/markdown');
        if (!markdown) return;
        event.preventDefault();
        this.insertHtmlAtSelection(this.markdownToSafeHtml(markdown));
    },

    async convertClipboardMarkdown() {
        let markdown = '';
        try {
            markdown = await navigator.clipboard.readText();
        } catch (_error) {
            markdown = window.prompt('Paste Markdown to convert into formatted text:') || '';
        }
        if (!markdown.trim()) return;
        this.ensureEditing();
        this.insertHtmlAtSelection(this.markdownToSafeHtml(markdown));
        this.handleEditableInput();
    },

    ensureEditing() {
        if (!this.isEditing) this.setEditing(true);
        document.getElementById('note-content').focus();
    },

    applyInlineFormat(command) {
        this.ensureEditing();
        document.execCommand(command, false, null);
        this.handleEditableInput();
    },

    applyBlockFormat(tag) {
        this.ensureEditing();
        document.execCommand('formatBlock', false, tag);
        this.handleEditableInput();
    },

    applyInlineCode() {
        this.ensureEditing();
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const text = selection.toString() || 'code';
        const code = document.createElement('code');
        code.textContent = text;
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(code);
        selection.removeAllRanges();
        range.setStartAfter(code);
        range.collapse(true);
        selection.addRange(range);
        this.handleEditableInput();
    },

    insertTaskListItem() {
        this.ensureEditing();
        this.insertHtmlAtSelection('<ul><li><input type="checkbox" disabled> Task item</li></ul>');
        this.handleEditableInput();
    },

    insertLink() {
        this.ensureEditing();
        const url = window.prompt('Link URL');
        if (!url) return;
        const text = window.getSelection()?.toString() || url;
        this.insertHtmlAtSelection(`<a href="${CoreUI.escapeHtml(url)}">${CoreUI.escapeHtml(text)}</a>`);
        this.handleEditableInput();
    },

    insertImage() {
        this.ensureEditing();
        const url = window.prompt('Image URL');
        if (!url) return;
        const alt = window.prompt('Alt text') || '';
        this.insertHtmlAtSelection(`<img src="${CoreUI.escapeHtml(url)}" alt="${CoreUI.escapeHtml(alt)}">`);
        this.handleEditableInput();
    },

    insertTable() {
        this.ensureEditing();
        this.insertHtmlAtSelection(`
            <table>
                <thead><tr><th>Column</th><th>Column</th></tr></thead>
                <tbody><tr><td>Value</td><td>Value</td></tr></tbody>
            </table>
        `);
        this.handleEditableInput();
    },

    insertHorizontalRule() {
        this.ensureEditing();
        document.execCommand('insertHorizontalRule', false, null);
        this.handleEditableInput();
    },

    insertHtmlAtSelection(html) {
        const editor = document.getElementById('note-content');
        editor.focus();
        document.execCommand('insertHTML', false, html);
    },

    refreshPreviewFromEditor() {
        document.getElementById('note-preview').innerHTML = this.sanitizeHtml(document.getElementById('note-content').innerHTML) || '<p class="note-placeholder">No content yet.</p>';
    },

    buildPayload() {
        const existing = this.notes.find((note) => note.id === this.currentNoteId);
        const editor = document.getElementById('note-content');
        return {
            title: document.getElementById('note-title').value || 'Untitled Note',
            tags: document.getElementById('note-tags').value,
            is_pinned: existing?.is_pinned || 0,
            content: this.htmlToMarkdown(editor.innerHTML)
        };
    },

    async saveNote(options = {}) {
        if (this.saveInFlight) {
            this.saveQueued = true;
            return;
        }

        const id = document.getElementById('current-note-id').value;
        const payload = this.buildPayload();
        this.saveInFlight = true;

        try {
            if (id) {
                await API.put(`/api/notes/${id}`, payload);
            } else {
                const response = await API.post('/api/notes/', payload);
                this.currentNoteId = response.note.id;
                document.getElementById('current-note-id').value = response.note.id;
            }

            await this.loadNotes();
            const note = this.notes.find((item) => item.id === this.currentNoteId);
            if (note) {
                note.title = payload.title;
                note.tags = payload.tags;
                note.content = payload.content;
            }
            this.refreshPreviewFromEditor();
            if (!options.silent) CoreUI.showError('Note saved.', true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to save note.');
        } finally {
            this.saveInFlight = false;
            if (this.saveQueued) {
                this.saveQueued = false;
                this.saveNote({ silent: true });
            }
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
    },

    markdownToSafeHtml(markdown) {
        if (!markdown.trim()) return '';
        if (window.marked) {
            return this.sanitizeHtml(window.marked.parse(markdown, { breaks: true, gfm: true }));
        }
        return `<p>${CoreUI.escapeHtml(markdown).replace(/\n/g, '<br>')}</p>`;
    },

    sanitizeHtml(html) {
        const template = document.createElement('template');
        template.innerHTML = html;
        const allowedTags = new Set(['A', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DEL', 'DIV', 'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'IMG', 'INPUT', 'LI', 'OL', 'P', 'PRE', 'S', 'STRONG', 'TABLE', 'TBODY', 'TD', 'TH', 'THEAD', 'TR', 'UL']);
        const allowedAttrs = {
            A: ['href', 'title'],
            IMG: ['src', 'alt', 'title'],
            INPUT: ['type', 'checked', 'disabled']
        };
        const walk = (node) => {
            [...node.children].forEach((child) => {
                if (!allowedTags.has(child.tagName)) {
                    child.replaceWith(document.createTextNode(child.textContent || ''));
                    return;
                }
                [...child.attributes].forEach((attr) => {
                    const allowed = allowedAttrs[child.tagName]?.includes(attr.name);
                    if (!allowed) child.removeAttribute(attr.name);
                });
                if (child.tagName === 'A' && !this.isSafeUrl(child.getAttribute('href'))) child.removeAttribute('href');
                if (child.tagName === 'IMG' && !this.isSafeUrl(child.getAttribute('src'))) child.remove();
                if (child.tagName === 'INPUT') {
                    child.setAttribute('type', 'checkbox');
                    child.setAttribute('disabled', '');
                }
                walk(child);
            });
        };
        walk(template.content);
        return template.innerHTML;
    },

    isSafeUrl(url) {
        if (!url) return false;
        return /^(https?:|mailto:|tel:|\/|#)/i.test(url);
    },

    plainPreview(markdown) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = this.markdownToSafeHtml(markdown);
        return (wrapper.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 110);
    },

    htmlToMarkdown(html) {
        const template = document.createElement('template');
        template.innerHTML = this.sanitizeHtml(html);
        return this.nodesToMarkdown(template.content).replace(/\n{3,}/g, '\n\n').trim();
    },

    nodesToMarkdown(parent) {
        return [...parent.childNodes].map((node) => this.nodeToMarkdown(node)).join('').trim();
    },

    nodeToMarkdown(node) {
        if (node.nodeType === Node.TEXT_NODE) return node.textContent.replace(/\s+/g, ' ');
        if (node.nodeType !== Node.ELEMENT_NODE) return '';

        const tag = node.tagName;
        const content = [...node.childNodes].map((child) => this.nodeToMarkdown(child)).join('').trim();
        if (/^H[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag.slice(1)))} ${content}\n\n`;
        if (tag === 'P' || tag === 'DIV') return content ? `${content}\n\n` : '\n';
        if (tag === 'BR') return '\n';
        if (tag === 'STRONG' || tag === 'B') return `**${content}**`;
        if (tag === 'EM' || tag === 'I') return `*${content}*`;
        if (tag === 'DEL' || tag === 'S') return `~~${content}~~`;
        if (tag === 'CODE' && node.parentElement?.tagName !== 'PRE') return `\`${content}\``;
        if (tag === 'PRE') return `\`\`\`\n${node.textContent.trim()}\n\`\`\`\n\n`;
        if (tag === 'BLOCKQUOTE') return `${content.split('\n').filter(Boolean).map((line) => `> ${line}`).join('\n')}\n\n`;
        if (tag === 'A') return `[${content || node.href}](${node.getAttribute('href') || ''})`;
        if (tag === 'IMG') return `![${node.getAttribute('alt') || ''}](${node.getAttribute('src') || ''})\n\n`;
        if (tag === 'HR') return '---\n\n';
        if (tag === 'UL' || tag === 'OL') return this.listToMarkdown(node, tag === 'OL') + '\n';
        if (tag === 'LI') return content;
        if (tag === 'TABLE') return this.tableToMarkdown(node) + '\n\n';
        if (tag === 'THEAD' || tag === 'TBODY' || tag === 'TR' || tag === 'TH' || tag === 'TD') return content;
        if (tag === 'INPUT' && node.getAttribute('type') === 'checkbox') return node.checked ? '[x] ' : '[ ] ';
        return content;
    },

    listToMarkdown(list, ordered) {
        return [...list.children].filter((child) => child.tagName === 'LI').map((li, index) => {
            const marker = ordered ? `${index + 1}.` : '-';
            return `${marker} ${this.nodeToMarkdown(li).replace(/\n+$/g, '')}`;
        }).join('\n') + '\n';
    },

    tableToMarkdown(table) {
        const rows = [...table.querySelectorAll('tr')].map((row) => [...row.children].map((cell) => this.nodesToMarkdown(cell).replace(/\|/g, '\\|').trim()));
        if (!rows.length) return '';
        const header = rows[0];
        const divider = header.map(() => '---');
        const body = rows.slice(1);
        return [header, divider, ...body].map((row) => `| ${row.join(' | ')} |`).join('\n');
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
