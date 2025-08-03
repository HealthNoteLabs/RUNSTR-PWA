const CACHE_NAME = 'nostr-run-club-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/src/App.css',
  '/src/index.css',
  '/vite.svg',
  '/icons/icon-192x192.png'
];

// Install Service Worker
self.addEventListener('install', (event) => {
  // In development on localhost, skip caching static assets to avoid cache quota issues
  if (self.location.hostname === 'localhost') {
    self.skipWaiting();
    return;
  }
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  // Skip waiting to activate immediately
  self.skipWaiting();
});

// Activate and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => {
      return self.clients.claim();
    })
  );
});

// Handle messages from clients
self.addEventListener('message', (event) => {
  if (event.data.type === 'START_TRACKING') {
    // Do not try to start tracking in background - handled by Capacitor plugin
    // Just acknowledge the message
    if (event.source && event.source.postMessage) {
      event.source.postMessage({ type: 'TRACKING_ACKNOWLEDGEMENT' });
    }
  } else if (event.data.type === 'STOP_TRACKING') {
    // Do not try to stop tracking in background - handled by Capacitor plugin
  } else if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data.type === 'SYNC_RUN_DATA') {
    // Queue run data for background sync
    event.waitUntil(queueRunDataForSync(event.data.payload));
  }
});

// Background Sync for run data
self.addEventListener('sync', (event) => {
  if (event.tag === 'run-data-sync') {
    event.waitUntil(syncQueuedRunData());
  } else if (event.tag === 'location-sync') {
    event.waitUntil(syncLocationData());
  }
});

// Periodic Background Sync (limited support)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'location-sync') {
    event.waitUntil(periodicLocationSync());
  }
});

// Queue run data for background sync
async function queueRunDataForSync(runData) {
  try {
    const cache = await caches.open('run-data-queue');
    const queueKey = `run-${Date.now()}-${Math.random()}`;
    await cache.put(queueKey, new Response(JSON.stringify(runData)));
    
    // Register for background sync
    await self.registration.sync.register('run-data-sync');
    console.log('Run data queued for background sync');
  } catch (error) {
    console.error('Failed to queue run data:', error);
  }
}

// Sync queued run data when connection is restored
async function syncQueuedRunData() {
  try {
    const cache = await caches.open('run-data-queue');
    const requests = await cache.keys();
    
    for (const request of requests) {
      try {
        const response = await cache.match(request);
        const runData = await response.json();
        
        // Attempt to publish run data to Nostr relays
        const success = await publishRunDataToNostr(runData);
        
        if (success) {
          // Remove from queue if successful
          await cache.delete(request);
          console.log('Run data synced successfully');
        }
      } catch (error) {
        console.error('Failed to sync run data:', error);
        // Keep in queue for retry
      }
    }
  } catch (error) {
    console.error('Background sync failed:', error);
  }
}

// Publish run data to Nostr (simplified for service worker context)
async function publishRunDataToNostr(runData) {
  // This would need to be a simplified version of the Nostr publishing logic
  // due to service worker limitations
  try {
    const response = await fetch('/api/sync-run', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(runData)
    });
    
    return response.ok;
  } catch (error) {
    console.error('Failed to publish run data:', error);
    return false;
  }
}

// Sync location data
async function syncLocationData() {
  try {
    if ('geolocation' in navigator) {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: false,
          timeout: 15000,
          maximumAge: 300000 // 5 minutes
        });
      });
      
      // Store location for when app resumes
      const cache = await caches.open('location-cache');
      await cache.put('last-location', new Response(JSON.stringify({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        timestamp: Date.now()
      })));
      
      console.log('Location synced in background');
      return true;
    }
  } catch (error) {
    console.error('Background location sync failed:', error);
    return false;
  }
}

// Periodic location sync (very limited browser support)
async function periodicLocationSync() {
  console.log('Periodic location sync triggered');
  return await syncLocationData();
}

// Improved fetch handler with cache strategies
self.addEventListener('fetch', (event) => {
  // Handle Vite HMR pings differently to prevent connection errors
  const url = new URL(event.request.url);
  
  // If this is a Vite HMR ping request, return a mock success response
  // This prevents the continuous ping errors in the console
  if (url.hostname === 'localhost' && 
      url.port === '5173' && 
      event.request.headers.get('Accept') === 'text/x-vite-ping') {
    event.respondWith(new Response('pong', { status: 200 }));
    return;
  }
  
  // Skip other cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }
  
  // Skip all runtime caching when developing locally to avoid quota issues
  if (self.location.hostname === 'localhost') {
    return;
  }
  
  // Cache-first for CSS files to ensure consistent UI
  if (event.request.url.endsWith('.css')) {
    event.respondWith(
      caches.match(event.request)
        .then(cachedResponse => {
          if (cachedResponse) {
            // Return cached response but update cache in background
            fetch(event.request).then(networkResponse => {
              const responseToCache = networkResponse.clone();
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, responseToCache);
              });
            }).catch(error => {
              console.log('Failed to update cached CSS:', error);
            });
            return cachedResponse;
          }
          
          // If not in cache, fetch from network and cache
          return fetch(event.request).then(response => {
            const responseToCache = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseToCache);
            });
            return response;
          });
        })
    );
    return;
  }
  
  // Network-first strategy for other requests
  event.respondWith(
    fetch(event.request)
      .catch(() => {
        return caches.match(event.request);
      })
  );
}); 