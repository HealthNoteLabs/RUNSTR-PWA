import { Suspense, lazy, useEffect, useState, useContext } from 'react';
import { BrowserRouter as Router } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { NostrProvider } from './contexts/NostrContext.jsx';
import { AuthProvider } from './components/AuthProvider';
import { AudioPlayerProvider } from './contexts/AudioPlayerProvider';
import { RunTrackerProvider } from './contexts/RunTrackerContext';
import { TeamsProvider } from './contexts/TeamsContext';
import { TeamChallengeProvider } from './contexts/TeamChallengeContext';
import { ActivityModeProvider } from './contexts/ActivityModeContext';
import { SettingsProvider } from './contexts/SettingsContext';
import { WalletProvider } from './contexts/WalletContext';
import { MenuBar } from './components/MenuBar';
import { initializeEvents } from './services/EventService';
import './App.css';
import ErrorFallback from './components/ErrorFallback';
import { directFetchRunningPosts } from './utils/feedFetcher';
import { lightweightProcessPosts } from './utils/feedProcessor';
import { storeFeedCache, isCacheFresh } from './utils/feedCache';
import { NostrContext } from './contexts/NostrContext.jsx';
import './utils/errorSilencer';
import { Toaster } from 'react-hot-toast';

console.log("App.jsx is loading");

// 🎉 SUCCESS: Browser loading issue fixed 2025-08-04
// Removed MenuBar → rewardsPayoutService dependency chain that caused 
// "process is not defined" errors during module loading

// Enhanced loading fallback with debugging
const EnhancedLoadingFallback = () => {
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);
  const [debugInfo, setDebugInfo] = useState([]);
  
  useEffect(() => {
    console.log('🔄 EnhancedLoadingFallback mounted - App is waiting for AppRoutes to load');
    
    // Add initial debug info
    setDebugInfo(prev => [...prev, `${new Date().toLocaleTimeString()}: Loading fallback activated`]);
    
    // After 3 seconds, start showing debug info
    const debugTimeout = setTimeout(() => {
      console.log('🔍 Loading taking longer than expected, gathering debug info...');
      const info = [
        `NDK Ready: ${window.__RUNSTR_NDK_INSTANCE__?.pool?.stats()?.connected || 0} relays`,
        `nostr-login: ${window.nostrLogin ? 'loaded' : 'not loaded'}`,
        `Feed loading: ${window.__FEED_LOADING ? 'yes' : 'no'}`,
        `Current URL: ${window.location.pathname}`
      ];
      setDebugInfo(prev => [...prev, ...info]);
    }, 3000);
    
    // After 5 seconds of loading, show timeout warning
    const timeoutId = setTimeout(() => {
      console.warn('⚠️ App loading timeout - showing warning to user');
      setShowTimeoutWarning(true);
    }, 5000);
    
    return () => {
      clearTimeout(debugTimeout);
      clearTimeout(timeoutId);
    };
  }, []);
  
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-bg-primary p-4">
      <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary mb-4"></div>
      <p className="text-text-secondary mb-2">Loading RUNSTR...</p>
      
      {showTimeoutWarning && (
        <div className="mt-8 p-4 bg-warning-light border border-warning rounded-lg max-w-md">
          <p className="text-warning text-center mb-2">
            Loading is taking longer than expected.
          </p>
          <p className="text-warning text-sm text-center mb-3">
            Try hard refreshing (Ctrl+Shift+R) to clear cache.
          </p>
          
          {/* Debug information */}
          <details className="mt-4">
            <summary className="text-xs text-warning cursor-pointer">Debug Info</summary>
            <div className="mt-2 text-xs text-warning-light font-mono">
              {debugInfo.map((info, i) => (
                <div key={i}>{info}</div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  );
};

// Lazy load AppRoutes with enhanced error handling
const AppRoutes = lazy(() => {
  console.log('🚀 Starting AppRoutes import...');
  const startTime = Date.now();
  
  return import('./AppRoutes')
    .then(module => {
      const loadTime = Date.now() - startTime;
      console.log(`✅ AppRoutes module loaded successfully in ${loadTime}ms`);
      
      if (module.default) {
        console.log("📁 AppRoutes default export found");
        return { default: module.default };
      } else if (module.AppRoutes) {
        console.log("📁 AppRoutes named export found");
        return { default: module.AppRoutes };
      } else {
        console.error("❌ No valid AppRoutes export found in module:", Object.keys(module));
        throw new Error("AppRoutes module has no valid export");
      }
    })
    .catch(error => {
      console.error("💥 Error loading AppRoutes:", error.message, error.stack);
      return { 
        default: () => (
          <div className="p-4 bg-red-900/20 border border-red-800 rounded-lg m-4">
            <h2 className="text-xl font-bold mb-2 text-red-300">Failed to Load App</h2>
            <p className="text-red-300">Error: {error.message}</p>
            <p className="text-red-400 text-sm mt-2">Try refreshing the page</p>
          </div>
        )
      };
    });
});

const App = () => {
  const [hasError, setHasError] = useState(false);
  
  console.log('🚀 App component rendering...');
  
  // Remove the loading spinner once App mounts
  useEffect(() => {
    const spinner = document.querySelector('.loading-spinner');
    if (spinner) {
      console.log('🔄 Removing loading spinner...');
      spinner.remove();
    }
  }, []);
  
  // Initialize app services
  useEffect(() => {
    console.log('🔧 App useEffect running - initializing services...');
    console.log('📱 Platform:', window.navigator.userAgent);
    console.log('🌐 Is Native Platform:', Capacitor?.isNativePlatform() || false);
    
    const initializeApp = async () => {
      try {
        console.log('🔧 Initializing app services...');
        
        // Browser-specific initialization
        if (!Capacitor?.isNativePlatform()) {
          console.log('🌐 Running in browser - using browser-specific initialization');
          // Skip certain native-only features
        }
        
        // Initialize events with test event - moved higher in init sequence
        // and clearing any potential dismiss flags to ensure visibility
        localStorage.removeItem('eventBannerDismissedUntil');
        initializeEvents();
        console.log('📅 Events initialized');
        
        // REMOVE: await initializeNostr();
        // NDK initialization is now handled by the NDKSingleton and NostrProvider
        // The NostrProvider will await the ndkReadyPromise from the singleton.
        console.log('NDK initialization is managed by NDKSingleton and NostrProvider.');
        
        // First check if we have a fresh cache that can be used immediately
        // Note: We check for cache freshness but don't need to assign the variable if not using it
        isCacheFresh(30); // Check if cache is less than 30 minutes old
        
        // If cache isn't fresh enough, use optimized feed fetcher for fast initial load
        if (!isCacheFresh(5) && !window.__FEED_LOADING) {
          window.__FEED_LOADING = true;
          
          console.log('Starting background feed preload');
          // Use the new direct fetch with aggressive timeout
          directFetchRunningPosts(10, 7)
            .then(posts => {
              if (posts && posts.length > 0) {
                console.log(`Preloaded ${posts.length} posts, processing...`);
                
                // Use lightweight processor for fast processing
                const processedPosts = lightweightProcessPosts(posts);
                
                // Cache the results for immediate use when user navigates to feed
                storeFeedCache(processedPosts, 30);
                
                // Store in global context for immediate access
                window.__PRELOADED_FEED = processedPosts;
                
                // Now that we have basic data displayed, fetch supplementary data in background
                // We'll use dynamic import to avoid circular dependencies
                import('./utils/nostr').then(({ loadSupplementaryData, processPostsWithData }) => {
                  console.log('Loading supplementary data in background...');
                  loadSupplementaryData(posts)
                    .then(supplementaryData => {
                      // Process the full data
                      return processPostsWithData(posts, supplementaryData);
                    })
                    .then(enrichedPosts => {
                      // Cache the enriched posts
                      storeFeedCache(enrichedPosts, 60);
                      // Update the global reference
                      window.__PRELOADED_FEED = enrichedPosts;
                      console.log('Background feed enrichment completed');
                    })
                    .catch(err => console.error('Background enrichment error:', err))
                    .finally(() => {
                      window.__FEED_LOADING = false;
                    });
                });
              }
            })
            .catch(err => {
              console.error('Error preloading feed data:', err);
              window.__FEED_LOADING = false;
            });
        }
      } catch (error) {
        console.error('Error initializing app:', error);
      }
    };
    
    initializeApp();
  }, []);
  
  // Global error handler
  useEffect(() => {
    const handleGlobalError = (event) => {
      console.error('Global error:', event.error);
      // Don't show error fallback for minor errors, only critical ones
      if (event.error?.message?.includes('process is not defined')) {
        console.warn('Browser compatibility error detected and handled');
        return;
      }
      setHasError(true);
    };
    
    const handleUnhandledRejection = (event) => {
      console.error('Unhandled promise rejection:', event.reason);
      // Handle promise rejections gracefully in browser
      if (event.reason?.message?.includes('process is not defined')) {
        console.warn('Browser compatibility promise rejection handled');
        event.preventDefault();
        return;
      }
    };
    
    window.addEventListener('error', handleGlobalError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);
    return () => {
      window.removeEventListener('error', handleGlobalError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);
  
  if (hasError) {
    return <ErrorFallback />;
  }
  
  console.log('📦 App rendering with providers...');
  
  return (
    <Router>
      <NostrProvider>
        <AuthProvider>
          <AudioPlayerProvider>
            <SettingsProvider>
              <ActivityModeProvider>
                <RunTrackerProvider>
                  <TeamsProvider>
                    <TeamChallengeProvider>
                      <WalletProvider>
                        <div className="relative w-full min-h-screen bg-bg-primary text-text-primary">
                          <MenuBar />
                          <main className="pb-24 w-full mx-auto px-4 max-w-screen-md">
                            <Suspense fallback={<EnhancedLoadingFallback />}>
                              <AppRoutes />
                            </Suspense>
                          </main>
                          <Toaster 
                            position="top-center"
                            toastOptions={{
                              // Default styles for all toasts
                              style: {
                                background: '#000000',
                                color: '#ffffff',
                                border: '1px solid #ffffff',
                                borderRadius: '8px',
                                fontSize: '14px',
                                padding: '12px 16px',
                                boxShadow: '0 4px 12px rgba(255, 255, 255, 0.1)',
                              },
                              // Pure black/white theme - no colored icons
                              iconTheme: {
                                primary: '#ffffff',
                                secondary: '#000000',
                              },
                              duration: 3000,
                              // Override specific toast types to maintain black/white theme
                              success: {
                                style: {
                                  background: '#000000',
                                  color: '#ffffff',
                                  border: '1px solid #ffffff',
                                },
                                iconTheme: {
                                  primary: '#ffffff',
                                  secondary: '#000000',
                                },
                              },
                              error: {
                                style: {
                                  background: '#000000',
                                  color: '#ffffff',
                                  border: '1px solid #ffffff',
                                },
                                iconTheme: {
                                  primary: '#ffffff',
                                  secondary: '#000000',
                                },
                              },
                              loading: {
                                style: {
                                  background: '#000000',
                                  color: '#ffffff',
                                  border: '1px solid #ffffff',
                                },
                                iconTheme: {
                                  primary: '#ffffff',
                                  secondary: '#000000',
                                },
                              },
                            }}
                          />
                        </div>
                      </WalletProvider>
                    </TeamChallengeProvider>
                  </TeamsProvider>
                </RunTrackerProvider>
              </ActivityModeProvider>
            </SettingsProvider>
          </AudioPlayerProvider>
        </AuthProvider>
      </NostrProvider>
    </Router>
  );
};

export default App;
