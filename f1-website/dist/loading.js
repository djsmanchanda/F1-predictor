// Preload critical data and optimize loading
(function() {
    // Add loading optimization
    const preloadData = () => {
        // Preload the API data as soon as possible
        const link = document.createElement('link');
        link.rel = 'preload';
        link.href = '/api/data';
        link.as = 'fetch';
        link.crossOrigin = 'anonymous';
        document.head.appendChild(link);
    };

    // Add CSS for instant loading feedback
    const addLoadingStyles = () => {
        const style = document.createElement('style');
        style.textContent = `
            .loading-fast { 
                opacity: 0.7; 
                pointer-events: none;
                transition: opacity 0.2s ease;
            }
            .loaded-fast { 
                opacity: 1; 
                pointer-events: auto;
            }
        `;
        document.head.appendChild(style);
    };

    // Run optimizations as early as possible
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            addLoadingStyles();
            preloadData();
        });
    } else {
        addLoadingStyles();
        preloadData();
    }
})();