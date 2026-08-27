/**
 * Shahrkavi - API URL Configuration
 * Auto-detects environment and sets base URL
 */
(function() {
    const host = window.location.hostname;
    const protocol = window.location.protocol;
    if (host.endsWith('github.io') || host === 'pages.github.com') {
        window.API_BASE = 'https://shahrkavi.onrender.com';
    } else if (host === 'localhost' || host === '127.0.0.1') {
        window.API_BASE = 'http://127.0.0.1:8000';
    } else if (protocol === 'file:') {
        // Page opened directly from disk -> local dev server
        window.API_BASE = 'http://127.0.0.1:8000';
    } else {
        window.API_BASE = window.location.origin;
    }
    // Allow override via URL parameter
    const params = new URLSearchParams(window.location.search);
    if (params.get('api')) {
        window.API_BASE = params.get('api');
    }
})();
