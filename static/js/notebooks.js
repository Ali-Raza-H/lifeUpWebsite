const NotebooksUI = {
    folders: [],
    currentFolder: null,
    currentNotebook: null,
    currentItem: null,
    currentItemType: null,
    isEditing: false,
    autosaveEnabled: false,
    saveInFlight: false,
    saveQueued: false,
    suppressInput: false,
    pageOverflowInFlight: false,
    pageOverflowQueued: false,
    pageOverflowSnapshot: null,
    actionModalResolver: null,

    async init() {
        document.getElementById('notebook-item-title')?.addEventListener('input', () => this.handleEditableInput());
        document.getElementById('notebook-editor')?.addEventListener('beforeinput', (event) => this.capturePageInputSnapshot(event));
        document.getElementById('notebook-editor')?.addEventListener('input', () => this.handleEditableInput());
        document.getElementById('notebook-action-modal')?.addEventListener('click', (event) => {
            if (event.target.id === 'notebook-action-modal') this.closeActionModal();
        });
        await this.loadWorkspace();
        this.openInitialTarget();
    },

    async loadWorkspace() {
        try {
            const payload = await API.get('/api/notebooks/workspace');
            this.folders = payload.folders || [];
            this.renderFolders();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to load notebooks.');
        }
    },

    openInitialTarget() {
        const params = new URLSearchParams(window.location.search);
        const projectId = Number(params.get('project_id') || 0);
        const folderId = Number(params.get('folder_id') || 0);
        const target = projectId
            ? this.folders.find((folder) => Number(folder.project_id) === projectId)
            : this.folders.find((folder) => Number(folder.id) === folderId);

        if (target) {
            this.selectFolder(target.id, { openMainNotebook: Boolean(projectId) });
        } else {
            this.showMenuView();
        }
    },

    setView(view) {
        document.getElementById('notebooks-menu-view').style.display = view === 'menu' ? 'flex' : 'none';
        document.getElementById('notebooks-folder-view').style.display = view === 'folder' ? 'flex' : 'none';
        document.getElementById('notebooks-editor-view').style.display = view === 'editor' ? 'grid' : 'none';
    },

    showMenuView() {
        this.setView('menu');
        this.renderFolders();
    },

    showFolderView() {
        if (!this.currentFolder) {
            this.showMenuView();
            return;
        }
        this.setView('folder');
        this.renderFolder();
    },

    renderFolders() {
        const list = document.getElementById('notebooks-folder-list');
        const query = (document.getElementById('notebooks-folder-search')?.value || '').trim().toLowerCase();
        if (!list) return;

        const folders = this.folders.filter((folder) => `${folder.name} ${folder.folder_type}`.toLowerCase().includes(query));
        if (!folders.length) {
            CoreUI.setEmptyState(list, 'No folders found.');
            return;
        }

        list.innerHTML = folders.map((folder) => `
            <button type="button" class="notebooks-folder-card ${this.currentFolder?.id === folder.id ? 'active' : ''}" onclick="NotebooksUI.selectFolder(${folder.id})">
                <span class="notebooks-folder-icon"><i class="${folder.project_id ? 'ph ph-kanban' : 'ph ph-folder'}"></i></span>
                <span class="notebooks-folder-main">
                    <span class="item-title">${CoreUI.escapeHtml(folder.name)}</span>
                    <span class="item-desc">${CoreUI.escapeHtml(folder.folder_type)} - ${folder.notebook_count || 0} notebooks - ${folder.note_count || 0} notes</span>
                </span>
            </button>
        `).join('');
    },

    async selectFolder(folderId, options = {}) {
        try {
            this.currentFolder = await API.get(`/api/notebooks/folders/${folderId}`);
            this.currentNotebook = null;
            this.currentItem = null;
            this.currentItemType = null;
            this.renderFolders();
            this.renderFolder();
            this.setView('folder');

            const mainNotebook = this.currentFolder.notebooks?.find((notebook) => notebook.is_main) || this.currentFolder.notebooks?.[0];
            if (options.openMainNotebook && mainNotebook) {
                await this.openNotebook(mainNotebook.id);
            }
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to open folder.');
        }
    },

    renderFolder() {
        const title = document.getElementById('notebooks-folder-title');
        const meta = document.getElementById('notebooks-folder-meta');
        const notesList = document.getElementById('folder-notes-list');
        const notebooksList = document.getElementById('folder-notebooks-list');
        if (!this.currentFolder) return;

        title.innerHTML = `<i class="${this.currentFolder.project_id ? 'ph ph-kanban' : 'ph ph-folder'}"></i> ${CoreUI.escapeHtml(this.currentFolder.name)}`;
        meta.textContent = `${this.currentFolder.folder_type}${this.currentFolder.project_id ? ' project folder' : ' folder'}`;

        notesList.innerHTML = (this.currentFolder.notes || []).map((note) => `
            <button type="button" class="notebooks-item-row ${this.currentItemType === 'note' && this.currentItem?.id === note.id ? 'active' : ''}" onclick="NotebooksUI.selectStandaloneNote(${note.id})">
                <i class="ph ph-note"></i>
                <span><span class="item-title">${CoreUI.escapeHtml(note.title)}</span><span class="item-desc">${CoreUI.escapeHtml(this.plainPreview(note.content))}</span></span>
            </button>
        `).join('') || '<div class="compact-item"><span class="item-desc">No standalone notes yet.</span></div>';

        notebooksList.innerHTML = (this.currentFolder.notebooks || []).map((notebook) => `
            <button type="button" class="notebooks-item-row ${this.currentNotebook?.id === notebook.id ? 'active' : ''}" onclick="NotebooksUI.openNotebook(${notebook.id})">
                <i class="ph ph-book-open"></i>
                <span><span class="item-title">${CoreUI.escapeHtml(notebook.title)}${notebook.is_main ? ' - Main' : ''}</span><span class="item-desc">${notebook.page_count || 0} pages</span></span>
            </button>
        `).join('') || '<div class="compact-item"><span class="item-desc">No notebooks yet.</span></div>';
    },

    async openNotebook(notebookId) {
        this.currentNotebook = (this.currentFolder?.notebooks || []).find((notebook) => notebook.id === notebookId);
        if (!this.currentNotebook) return;

        this.currentItem = null;
        this.currentItemType = null;
        document.getElementById('notebooks-editor-view').classList.remove('is-folder-note');
        document.getElementById('notebook-pages-panel').style.display = 'flex';
        this.setView('editor');
        this.setSidebarMode('pages');
        this.renderPages();

        const firstPage = this.currentNotebook.pages?.[0];
        if (firstPage) {
            await this.selectPage(firstPage.id);
        } else {
            this.openEditor(this.currentNotebook.title, '', 'No pages yet. Add a page to start writing.');
        }
    },

    renderPages() {
        const title = document.getElementById('notebook-pages-title');
        const meta = document.getElementById('notebook-pages-meta');
        const list = document.getElementById('notebook-pages-list');
        if (!this.currentNotebook) return;

        title.textContent = this.currentNotebook.title;
        meta.textContent = `${this.currentNotebook.page_count || 0} pages`;
        list.innerHTML = (this.currentNotebook.pages || []).map((page) => `
            <button type="button" class="notebooks-item-row ${this.currentItemType === 'page' && this.currentItem?.id === page.id ? 'active' : ''}" onclick="NotebooksUI.selectPage(${page.id})">
                <i class="ph ph-file-text"></i>
                <span><span class="item-title">${CoreUI.escapeHtml(page.title)}</span><span class="item-desc">Page ${page.page_number}</span></span>
            </button>
        `).join('') || '<div class="compact-item"><span class="item-desc">No pages yet.</span></div>';
    },

    renderStandaloneNotes() {
        const title = document.getElementById('notebook-pages-title');
        const meta = document.getElementById('notebook-pages-meta');
        const list = document.getElementById('notebook-pages-list');
        if (!this.currentFolder) return;

        const notes = this.currentFolder.notes || [];
        title.textContent = 'Standalone Notes';
        meta.textContent = `${notes.length} note${notes.length === 1 ? '' : 's'}`;
        list.innerHTML = notes.map((note) => `
            <button type="button" class="notebooks-item-row ${this.currentItemType === 'note' && this.currentItem?.id === note.id ? 'active' : ''}" onclick="NotebooksUI.selectStandaloneNote(${note.id})">
                <i class="ph ph-note"></i>
                <span><span class="item-title">${CoreUI.escapeHtml(note.title)}</span><span class="item-desc">${CoreUI.escapeHtml(this.plainPreview(note.content))}</span></span>
            </button>
        `).join('') || '<div class="compact-item"><span class="item-desc">No standalone notes yet.</span></div>';
    },

    selectStandaloneNote(noteId) {
        const note = (this.currentFolder?.notes || []).find((item) => item.id === noteId);
        if (!note) return;
        this.currentNotebook = null;
        this.currentItem = note;
        this.currentItemType = 'note';
        document.getElementById('notebooks-editor-view').classList.remove('is-folder-note');
        document.getElementById('notebook-pages-panel').style.display = 'flex';
        this.setSidebarMode('notes');
        this.renderStandaloneNotes();
        this.openEditor(note.title, note.content, 'Standalone folder note');
        this.renderFolder();
    },

    async selectPage(pageId) {
        try {
            const page = await API.get(`/api/notebooks/pages/${pageId}`);
            this.currentItem = page;
            this.currentItemType = 'page';
            this.openEditor(page.title, page.content, `${this.currentNotebook?.title || 'Notebook'} - Page ${page.page_number}`);
            this.renderPages();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to open page.');
        }
    },

    openEditor(title, markdown, context) {
        this.setView('editor');
        document.getElementById('notebook-item-title').value = title || '';
        document.getElementById('notebook-editor-context').textContent = context || '';
        this.setContentFromMarkdown(markdown || '');
        this.setEditing(false);
    },

    setSidebarMode(mode) {
        const deleteButton = document.getElementById('notebook-sidebar-delete-btn');
        const createButton = document.getElementById('notebook-sidebar-create-btn');
        const createLabel = document.getElementById('notebook-sidebar-create-label');
        if (!deleteButton || !createButton || !createLabel) return;

        if (mode === 'notes') {
            deleteButton.style.display = 'none';
            createButton.setAttribute('onclick', 'NotebooksUI.createStandaloneNote()');
            createLabel.textContent = 'Note';
            return;
        }

        deleteButton.style.display = 'inline-flex';
        createButton.setAttribute('onclick', 'NotebooksUI.createPage()');
        createLabel.textContent = 'Page';
    },

    async createFolder() {
        const values = await this.openActionModal({
            title: 'Create Folder',
            subtitle: 'Folders hold standalone notes and notebooks.',
            submitText: 'Create Folder',
            fields: [
                { id: 'name', label: 'Folder name', placeholder: 'Revision, Ideas, Work', required: true },
                { id: 'folder_type', label: 'Folder type', placeholder: 'Personal', value: 'Personal' }
            ]
        });
        if (!values) return;
        try {
            const response = await API.post('/api/notebooks/folders', {
                name: values.name,
                folder_type: values.folder_type || 'Personal'
            });
            await this.loadWorkspace();
            await this.selectFolder(response.folder.id);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to create folder.');
        }
    },

    async createStandaloneNote() {
        if (!this.currentFolder) return CoreUI.showError('Select a folder first.');
        const values = await this.openActionModal({
            title: 'Create Note',
            subtitle: `Add a standalone note to ${this.currentFolder.name}.`,
            submitText: 'Create Note',
            fields: [
                { id: 'title', label: 'Note title', placeholder: 'Untitled note', value: 'Untitled note', required: true }
            ]
        });
        if (!values) return;
        try {
            const response = await API.post(`/api/notebooks/folders/${this.currentFolder.id}/notes`, {
                title: values.title || 'Untitled note',
                content: ''
            });
            await this.selectFolder(this.currentFolder.id);
            this.selectStandaloneNote(response.note.id);
            this.setEditing(true);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to create note.');
        }
    },

    async deleteCurrentFolder() {
        if (!this.currentFolder) return CoreUI.showError('Select a folder first.');
        if (this.currentFolder.project_id) return CoreUI.showError('Project folders are deleted with their project.');
        const ok = await CoreUI.confirm({
            title: 'Delete folder?',
            message: 'This will delete every note, notebook, and page inside this folder.',
            confirmText: 'Delete'
        });
        if (!ok) return;
        try {
            await API.delete(`/api/notebooks/folders/${this.currentFolder.id}`);
            this.currentFolder = null;
            this.currentNotebook = null;
            this.currentItem = null;
            this.currentItemType = null;
            await this.loadWorkspace();
            this.showMenuView();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete folder.');
        }
    },

    async createNotebookInCurrentFolder() {
        if (!this.currentFolder) return CoreUI.showError('Select a folder first.');
        const values = await this.openActionModal({
            title: 'Create Notebook',
            subtitle: `Add a notebook inside ${this.currentFolder.name}.`,
            submitText: 'Create Notebook',
            fields: [
                { id: 'title', label: 'Notebook title', placeholder: 'New notebook', value: 'New notebook', required: true }
            ]
        });
        if (!values) return;
        try {
            const response = await API.post(`/api/notebooks/folders/${this.currentFolder.id}/notebooks`, {
                title: values.title || 'New notebook',
                is_main: this.currentFolder.notebooks?.length ? 0 : 1
            });
            await this.selectFolder(this.currentFolder.id);
            await this.openNotebook(response.notebook.id);
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to create notebook.');
        }
    },

    async createPage(options = {}) {
        if (!this.currentNotebook) return CoreUI.showError('Select a notebook first.');
        const notebookId = this.currentNotebook.id;
        const defaultTitle = `Page ${(this.currentNotebook.pages?.length || 0) + 1}`;
        let title = options.title || defaultTitle;
        if (!options.skipModal) {
            const values = await this.openActionModal({
                title: 'Create Page',
                subtitle: `Add a page to ${this.currentNotebook.title}.`,
                submitText: 'Create Page',
                fields: [
                    { id: 'title', label: 'Page title', placeholder: defaultTitle, value: defaultTitle, required: true }
                ]
            });
            if (!values) return null;
            title = values.title || defaultTitle;
        }
        try {
            const response = await API.post(`/api/notebooks/notebooks/${notebookId}/pages`, {
                title,
                content: options.content || ''
            });
            await this.selectFolder(this.currentFolder.id);
            this.currentNotebook = (this.currentFolder?.notebooks || []).find((notebook) => notebook.id === notebookId);
            document.getElementById('notebook-pages-panel').style.display = 'flex';
            this.setView('editor');
            this.renderPages();
            await this.selectPage(response.page.id);
            this.setEditing(true);
            this.focusEditorEnd();
            return response.page;
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to create page.');
            return null;
        }
    },

    async deleteCurrentNotebook() {
        if (!this.currentNotebook) return CoreUI.showError('Select a notebook first.');
        const ok = await CoreUI.confirm({
            title: 'Delete notebook?',
            message: 'This will delete every page in this notebook.',
            confirmText: 'Delete'
        });
        if (!ok) return;
        try {
            await API.delete(`/api/notebooks/notebooks/${this.currentNotebook.id}`);
            this.currentNotebook = null;
            this.currentItem = null;
            this.currentItemType = null;
            await this.selectFolder(this.currentFolder.id);
            this.showFolderView();
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete notebook.');
        }
    },

    async deleteCurrentItem() {
        if (!this.currentItem || !this.currentItemType) return;
        const ok = await CoreUI.confirm({ title: 'Delete item?', message: 'This will be removed permanently.', confirmText: 'Delete' });
        if (!ok) return;
        try {
            if (this.currentItemType === 'note') {
                await API.delete(`/api/notebooks/folder-notes/${this.currentItem.id}`);
                await this.selectFolder(this.currentFolder.id);
                this.showFolderView();
            } else {
                const notebookId = this.currentNotebook?.id;
                await API.delete(`/api/notebooks/pages/${this.currentItem.id}`);
                await this.selectFolder(this.currentFolder.id);
                this.currentNotebook = (this.currentFolder?.notebooks || []).find((notebook) => notebook.id === notebookId);
                if (this.currentNotebook?.pages?.[0]) {
                    await this.openNotebook(this.currentNotebook.id);
                } else {
                    this.showFolderView();
                }
            }
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to delete item.');
        }
    },

    setContentFromMarkdown(markdown) {
        const html = this.markdownToSafeHtml(markdown || '');
        this.suppressInput = true;
        document.getElementById('notebook-preview').innerHTML = html || '<p class="note-placeholder">No content yet.</p>';
        document.getElementById('notebook-editor').innerHTML = html || '<p><br></p>';
        this.suppressInput = false;
    },

    setEditing(enabled) {
        this.isEditing = enabled;
        document.getElementById('notebook-editor').style.display = enabled ? 'block' : 'none';
        document.getElementById('notebook-preview').style.display = enabled ? 'none' : 'block';
        document.getElementById('notebook-format-toolbar').style.display = enabled ? 'flex' : 'none';
        document.getElementById('notebook-item-title').readOnly = !enabled;
        const button = document.getElementById('notebook-edit-toggle');
        button.classList.toggle('active', enabled);
        button.innerHTML = enabled ? '<i class="ph ph-eye"></i> Preview' : '<i class="ph ph-pencil-simple"></i> Edit';
    },

    toggleEditing() {
        if (this.isEditing) {
            this.refreshPreviewFromEditor();
            this.setEditing(false);
            return;
        }
        this.setEditing(true);
        document.getElementById('notebook-editor').focus();
    },

    toggleAutosave() {
        this.autosaveEnabled = !this.autosaveEnabled;
        const button = document.getElementById('notebook-autosave-btn');
        button.classList.toggle('active', this.autosaveEnabled);
        button.innerHTML = this.autosaveEnabled ? '<i class="ph ph-floppy-disk-back"></i> Autosave On' : '<i class="ph ph-floppy-disk-back"></i> Autosave Off';
        if (this.autosaveEnabled) this.saveCurrentItem({ silent: true });
    },

    handleEditableInput() {
        if (this.suppressInput || !this.isEditing) return;
        if (this.isCurrentPageOverflowing()) {
            this.handlePageOverflow();
            return;
        }
        if (this.autosaveEnabled) this.saveCurrentItem({ silent: true });
    },

    capturePageInputSnapshot(event) {
        if (this.suppressInput || !this.isEditing || this.currentItemType !== 'page') return;
        const editor = document.getElementById('notebook-editor');
        if (!editor) return;
        this.pageOverflowSnapshot = {
            html: editor.innerHTML,
            data: event.data || '',
            insertedText: event.data || event.dataTransfer?.getData('text/plain') || '',
            inputType: event.inputType || ''
        };
    },

    isCurrentPageOverflowing() {
        const editor = document.getElementById('notebook-editor');
        return Boolean(
            this.currentItemType === 'page'
            && this.currentNotebook
            && editor
            && editor.clientHeight > 0
            && editor.scrollHeight > editor.clientHeight + 2
        );
    },

    async handlePageOverflow() {
        if (this.pageOverflowInFlight || !this.isCurrentPageOverflowing()) return;
        if (this.saveInFlight) {
            this.pageOverflowQueued = true;
            return;
        }

        const editor = document.getElementById('notebook-editor');
        const snapshot = this.pageOverflowSnapshot;
        const canMoveInsertedText = snapshot
            && ['insertText', 'insertFromPaste'].includes(snapshot.inputType)
            && snapshot.insertedText;
        this.pageOverflowInFlight = true;

        try {
            if (snapshot?.html) {
                this.suppressInput = true;
                editor.innerHTML = snapshot.html;
                this.suppressInput = false;
            }
            await this.saveCurrentItem({ silent: true });
            await this.createPage({
                title: `Page ${(this.currentNotebook?.pages?.length || 0) + 1}`,
                content: canMoveInsertedText ? snapshot.insertedText : '',
                skipModal: true
            });
        } catch (error) {
            CoreUI.showError(error.message || 'Failed to create the next page.');
        } finally {
            this.pageOverflowInFlight = false;
            this.pageOverflowQueued = false;
            this.pageOverflowSnapshot = null;
        }
    },

    async saveCurrentItem(options = {}) {
        if (!this.currentItem || !this.currentItemType) return;
        if (this.saveInFlight) {
            this.saveQueued = true;
            return;
        }

        this.saveInFlight = true;
        const status = document.getElementById('notebook-save-status');
        status.textContent = 'Saving...';
        status.classList.add('visible');
        const payload = {
            title: document.getElementById('notebook-item-title').value || 'Untitled',
            content: this.htmlToMarkdown(document.getElementById('notebook-editor').innerHTML)
        };

        try {
            const endpoint = this.currentItemType === 'note'
                ? `/api/notebooks/folder-notes/${this.currentItem.id}`
                : `/api/notebooks/pages/${this.currentItem.id}`;
            const response = await API.put(endpoint, payload);
            this.currentItem = this.currentItemType === 'note' ? response.note : response.page;
            this.refreshPreviewFromEditor();
            status.textContent = 'Saved';
            if (!options.silent) CoreUI.showError('Saved.', true);
            this.patchCurrentItemInMemory(payload);
            if (this.currentFolder) this.renderFolder();
            if (this.currentItemType === 'note') this.renderStandaloneNotes();
            if (this.currentNotebook) this.renderPages();
        } catch (error) {
            status.textContent = 'Save failed';
            CoreUI.showError(error.message || 'Failed to save.');
        } finally {
            this.saveInFlight = false;
            window.setTimeout(() => status.classList.remove('visible'), 1400);
            if (this.saveQueued) {
                this.saveQueued = false;
                this.saveCurrentItem({ silent: true });
                return;
            }
            if (this.pageOverflowQueued) {
                this.pageOverflowQueued = false;
                this.handlePageOverflow();
            }
        }
    },

    patchCurrentItemInMemory(payload) {
        if (!this.currentFolder || !this.currentItem) return;
        if (this.currentItemType === 'note') {
            const note = (this.currentFolder.notes || []).find((item) => item.id === this.currentItem.id);
            if (note) Object.assign(note, payload);
            return;
        }
        const page = (this.currentNotebook?.pages || []).find((item) => item.id === this.currentItem.id);
        if (page) page.title = payload.title;
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
        if (!selection || !selection.rangeCount) return;
        const text = selection.toString() || 'code';
        const code = document.createElement('code');
        code.textContent = text;
        const range = selection.getRangeAt(0);
        range.deleteContents();
        range.insertNode(code);
        this.handleEditableInput();
    },

    insertTaskListItem() {
        this.ensureEditing();
        document.execCommand('insertHTML', false, '<ul><li><input type="checkbox" disabled> Task item</li></ul>');
        this.handleEditableInput();
    },

    insertLink() {
        this.ensureEditing();
        const selectedText = window.getSelection()?.toString() || '';
        const range = this.getEditorSelectionRange();
        this.openActionModal({
            title: 'Insert Link',
            subtitle: 'Add a URL to the current selection.',
            submitText: 'Insert Link',
            fields: [
                { id: 'url', label: 'URL', placeholder: 'https://example.com', required: true },
                { id: 'text', label: 'Link text', placeholder: selectedText || 'Link text', value: selectedText }
            ]
        }).then((values) => {
            if (!values) return;
            const text = values.text || values.url;
            this.restoreEditorSelection(range);
            document.execCommand('insertHTML', false, `<a href="${CoreUI.escapeHtml(values.url)}">${CoreUI.escapeHtml(text)}</a>`);
            this.handleEditableInput();
        });
    },

    insertTable() {
        this.ensureEditing();
        document.execCommand('insertHTML', false, '<table><thead><tr><th>Column</th><th>Column</th></tr></thead><tbody><tr><td>Value</td><td>Value</td></tr></tbody></table>');
        this.handleEditableInput();
    },

    insertHorizontalRule() {
        this.ensureEditing();
        document.execCommand('insertHorizontalRule', false, null);
        this.handleEditableInput();
    },

    async convertClipboardMarkdown() {
        let markdown = '';
        const range = this.getEditorSelectionRange();
        try {
            markdown = await navigator.clipboard.readText();
        } catch (_error) {
            const values = await this.openActionModal({
                title: 'Paste Markdown',
                subtitle: 'Paste Markdown and insert it as formatted content.',
                submitText: 'Insert',
                fields: [
                    { id: 'markdown', label: 'Markdown', type: 'textarea', placeholder: '# Heading', required: true }
                ]
            });
            markdown = values?.markdown || '';
        }
        if (!markdown.trim()) return;
        this.ensureEditing();
        this.restoreEditorSelection(range);
        document.execCommand('insertHTML', false, this.markdownToSafeHtml(markdown));
        this.handleEditableInput();
    },

    getEditorSelectionRange() {
        const editor = document.getElementById('notebook-editor');
        const selection = window.getSelection();
        if (!editor || !selection || selection.rangeCount === 0) return null;
        const range = selection.getRangeAt(0);
        return editor.contains(range.commonAncestorContainer) ? range.cloneRange() : null;
    },

    restoreEditorSelection(range) {
        const editor = document.getElementById('notebook-editor');
        editor.focus();
        if (!range) return;
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    },

    openActionModal({ title, subtitle = '', submitText = 'Save', hint = '', fields = [] }) {
        const modal = document.getElementById('notebook-action-modal');
        const titleEl = document.getElementById('notebook-action-title');
        const subtitleEl = document.getElementById('notebook-action-subtitle');
        const fieldsEl = document.getElementById('notebook-action-fields');
        const hintEl = document.getElementById('notebook-action-hint');
        const submitEl = document.getElementById('notebook-action-submit');
        if (!modal || !titleEl || !fieldsEl || !submitEl) return Promise.resolve(null);

        titleEl.textContent = title;
        subtitleEl.textContent = subtitle;
        hintEl.textContent = hint;
        submitEl.textContent = submitText;
        fieldsEl.innerHTML = fields.map((field) => this.renderActionField(field)).join('');
        modal.style.display = 'flex';

        window.setTimeout(() => {
            const firstInput = fieldsEl.querySelector('input, textarea');
            firstInput?.focus();
            firstInput?.select?.();
        }, 0);

        return new Promise((resolve) => {
            this.actionModalResolver = resolve;
        });
    },

    renderActionField(field) {
        const tag = field.type === 'textarea' ? 'textarea' : 'input';
        const value = CoreUI.escapeHtml(field.value || '');
        const required = field.required ? 'required' : '';
        const placeholder = CoreUI.escapeHtml(field.placeholder || '');
        const baseAttrs = `id="notebook-action-${CoreUI.escapeHtml(field.id)}" data-field-id="${CoreUI.escapeHtml(field.id)}" class="form-control" placeholder="${placeholder}" ${required}`;
        const control = tag === 'textarea'
            ? `<textarea ${baseAttrs} rows="7">${value}</textarea>`
            : `<input ${baseAttrs} type="${CoreUI.escapeHtml(field.type || 'text')}" value="${value}">`;
        return `
            <label class="form-group">
                <span class="form-label">${CoreUI.escapeHtml(field.label)}</span>
                ${control}
            </label>
        `;
    },

    submitActionModal() {
        const modal = document.getElementById('notebook-action-modal');
        const fields = Array.from(document.querySelectorAll('#notebook-action-fields [data-field-id]'));
        const values = {};
        for (const field of fields) {
            if (!field.checkValidity()) {
                field.reportValidity();
                return;
            }
            values[field.dataset.fieldId] = field.value.trim();
        }
        modal.style.display = 'none';
        const resolver = this.actionModalResolver;
        this.actionModalResolver = null;
        resolver?.(values);
    },

    closeActionModal() {
        const modal = document.getElementById('notebook-action-modal');
        if (modal) modal.style.display = 'none';
        const resolver = this.actionModalResolver;
        this.actionModalResolver = null;
        resolver?.(null);
    },

    ensureEditing() {
        if (!this.isEditing) this.setEditing(true);
        document.getElementById('notebook-editor').focus();
    },

    focusEditorEnd() {
        const editor = document.getElementById('notebook-editor');
        if (!editor) return;
        editor.focus();
        const range = document.createRange();
        range.selectNodeContents(editor);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
    },

    refreshPreviewFromEditor() {
        document.getElementById('notebook-preview').innerHTML = this.sanitizeHtml(document.getElementById('notebook-editor').innerHTML) || '<p class="note-placeholder">No content yet.</p>';
    },

    markdownToSafeHtml(markdown) {
        if (!markdown.trim()) return '';
        if (window.marked) return this.sanitizeHtml(window.marked.parse(markdown, { breaks: true, gfm: true }));
        return `<p>${CoreUI.escapeHtml(markdown).replace(/\n/g, '<br>')}</p>`;
    },

    sanitizeHtml(html) {
        const template = document.createElement('template');
        template.innerHTML = html;
        const allowedTags = new Set(['A', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DEL', 'DIV', 'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'HR', 'I', 'IMG', 'INPUT', 'LI', 'OL', 'P', 'PRE', 'S', 'STRONG', 'TABLE', 'TBODY', 'TD', 'TH', 'THEAD', 'TR', 'UL']);
        [...template.content.querySelectorAll('*')].forEach((el) => {
            if (!allowedTags.has(el.tagName)) {
                el.replaceWith(document.createTextNode(el.textContent || ''));
                return;
            }
            [...el.attributes].forEach((attr) => {
                const ok = (el.tagName === 'A' && ['href', 'title'].includes(attr.name))
                    || (el.tagName === 'IMG' && ['src', 'alt', 'title'].includes(attr.name))
                    || (el.tagName === 'INPUT' && ['type', 'checked', 'disabled'].includes(attr.name));
                if (!ok) el.removeAttribute(attr.name);
            });
            if (el.tagName === 'INPUT') {
                el.setAttribute('type', 'checkbox');
                el.setAttribute('disabled', '');
            }
        });
        return template.innerHTML;
    },

    plainPreview(markdown) {
        const wrapper = document.createElement('div');
        wrapper.innerHTML = this.markdownToSafeHtml(markdown || '');
        const preview = (wrapper.textContent || 'No content yet.').replace(/\s+/g, ' ').trim();
        const maxLength = 90;
        return preview.length > maxLength ? `${preview.slice(0, maxLength - 3)}...` : preview;
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
        if (tag === 'HR') return '---\n\n';
        if (tag === 'UL' || tag === 'OL') return [...node.children].filter((child) => child.tagName === 'LI').map((li, index) => `${tag === 'OL' ? `${index + 1}.` : '-'} ${this.nodeToMarkdown(li)}`).join('\n') + '\n\n';
        if (tag === 'TABLE') return this.tableToMarkdown(node) + '\n\n';
        if (tag === 'INPUT' && node.getAttribute('type') === 'checkbox') return node.checked ? '[x] ' : '[ ] ';
        return content;
    },

    tableToMarkdown(table) {
        const rows = [...table.querySelectorAll('tr')].map((row) => [...row.children].map((cell) => this.nodesToMarkdown(cell).replace(/\|/g, '\\|').trim()));
        if (!rows.length) return '';
        return [rows[0], rows[0].map(() => '---'), ...rows.slice(1)].map((row) => `| ${row.join(' | ')} |`).join('\n');
    }
};

document.addEventListener('DOMContentLoaded', () => {
    NotebooksUI.init();
    document.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && event.key === 's') {
            event.preventDefault();
            NotebooksUI.saveCurrentItem();
        }
    });
});
