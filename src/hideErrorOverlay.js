// Utility to suppress every runtime error overlay in Vite + React Fast-Refresh
// This runs ONLY in the dev server (import.meta.env.DEV)
// and is a no-op in production / the built mobile bundle.

// Re-enabled after fixing critical browser compatibility issues
if (import.meta.env.DEV && typeof window !== 'undefined') {
  /* ------------------------------------------------------------------
     1. Block Vite's own overlay (just in case a plugin re-enables it)
  ------------------------------------------------------------------*/
  try {
    // The overlay client checks for this global to decide whether to show.
    // Replacing it with no-op functions disables it entirely.
    window.__vite_plugin_error_overlay__ = {
      show() {},
      clear() {},
    };
  } catch (_) {}

  /* ------------------------------------------------------------------
     2. Prevent React Fast-Refresh overlay (and any other default handler)
  ------------------------------------------------------------------*/
  const stopDefault = (e) => {
    // Prevent the overlay + avoid console noise
    if (e?.preventDefault) e.preventDefault();
  };
  window.addEventListener('error', stopDefault);
  window.addEventListener('unhandledrejection', stopDefault);

  /* ------------------------------------------------------------------
     3. As a safety-net, remove any overlay DOM nodes if they slip through
  ------------------------------------------------------------------*/
  const selectors = [
    '#vite-error-overlay', // Vite core
    '[data-react-refresh-overlay]', // React Fast-Refresh
    'vite-error-overlay', // legacy tag name
  ].join(',');

  const removeOverlayEls = () => {
    document.querySelectorAll(selectors).forEach((el) => el.remove());
  };

  // Run once now…
  removeOverlayEls();
  // …and keep watching the DOM for future inserts.
  new MutationObserver(removeOverlayEls).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
} 