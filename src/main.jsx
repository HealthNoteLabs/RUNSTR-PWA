console.log('🎯 main.jsx starting...');

import './hideErrorOverlay.js'; // Must come first to suppress dev overlays
import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import './utils/nostrPolyfills.js'; // Shim SimplePool.list for nostr-tools v2
import App from './App.jsx';
import './App.css';

console.log('📦 All imports loaded, creating React root...');

const root = document.getElementById('root');
if (!root) {
  console.error('❌ Root element not found!');
} else {
  console.log('✅ Root element found, rendering app...');
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
  console.log('✅ React render called');
}
