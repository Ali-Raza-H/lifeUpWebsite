const API = {
    async request(endpoint, method = 'GET', data = null) {
        const session = window.LifeOSSession || {};
        if (session.is_guest && method !== 'GET') {
            const error = new Error('Guest access is read-only.');
            error.status = 403;
            throw error;
        }

        const options = {
            method,
            headers: {
                Accept: 'application/json'
            }
        };

        if (data instanceof FormData) {
            options.body = data;
        } else if (data) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(data);
        }

        try {
            const response = await fetch(endpoint, options);
            const isJson = response.headers.get('content-type')?.includes('application/json');
            const payload = isJson ? await response.json().catch(() => ({})) : null;
            if (!response.ok) {
                const message = payload?.error || `HTTP error ${response.status}`;
                const error = new Error(message);
                error.status = response.status;
                error.payload = payload;
                throw error;
            }
            return payload;
        } catch (error) {
            throw error;
        }
    },

    get(endpoint) {
        return this.request(endpoint, 'GET');
    },

    post(endpoint, data) {
        return this.request(endpoint, 'POST', data);
    },

    postForm(endpoint, formData) {
        return this.request(endpoint, 'POST', formData);
    },

    put(endpoint, data) {
        return this.request(endpoint, 'PUT', data);
    },

    delete(endpoint) {
        return this.request(endpoint, 'DELETE');
    }
};
