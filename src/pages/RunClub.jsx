import { useEffect, useContext, useState, useMemo, useCallback } from 'react';
import { NostrContext } from '../contexts/NostrContext';
import { WalletContext } from '../contexts/WalletContext.jsx';
import { useLeagueActivityFeed } from '../hooks/useLeagueActivityFeed';
import { LeagueMap } from '../components/LeagueMap';
import { Post } from '../components/Post';
import { handleAppBackground } from '../utils/nostr';
import '../components/RunClub.css';

export const RunClub = () => {
  const { defaultZapAmount } = useContext(NostrContext);
  const { wallet } = useContext(WalletContext);
  const [isRefreshing, setIsRefreshing] = useState(false);
  
  // Use the participant-first feed hook
  const {
    enhancedFeedEvents,
    isLoading: feedLoading,
    profilesLoading,
    error: feedError,
    refresh: refreshFeedData,
    activityMode,
    loadingProgress
  } = useLeagueActivityFeed();

  // Phase 7: Enhanced validation and error tracking
  const [validationErrors, setValidationErrors] = useState([]);
  const [retryCount, setRetryCount] = useState(0);
  const maxRetries = 3;

  // Transform enhanced feed events to Post-compatible format for WorkoutCard display
  const workoutPosts = useMemo(() => {
    if (!enhancedFeedEvents.length) return [];
    
    const validationErrors = [];
    
    const posts = enhancedFeedEvents.map((event, index) => {
      // Phase 7: Validate each event
      if (!event.id) {
        validationErrors.push(`Event ${index}: Missing ID`);
        return null;
      }
      
      if (!event.pubkey) {
        validationErrors.push(`Event ${event.id}: Missing pubkey`);
        return null;
      }
      
      if (!event.created_at) {
        validationErrors.push(`Event ${event.id}: Missing created_at timestamp`);
      }

      // Validate activity mode filtering
      if (activityMode && event.activityType && event.activityType !== activityMode) {
        validationErrors.push(`Event ${event.id}: Activity type mismatch (${event.activityType} vs ${activityMode})`);
      }

      return {
        // Core post data for WorkoutCard
        id: event.id,
        kind: 1301, // Always 1301 for workout records
        content: event.content || '',
        created_at: event.created_at || Math.floor(Date.now() / 1000),
        title: event.title || 'Workout Record',
        
        // Author information for WorkoutCard
        author: {
          pubkey: event.pubkey,
          profile: {
            name: event.displayName || `Runner ${event.pubkey.slice(0, 8)}`,
            display_name: event.displayName || `Runner ${event.pubkey.slice(0, 8)}`,
            picture: event.picture,
            about: event.about || '',
            nip05: event.nip05
          }
        },
        
        // Workout metrics for display - with validation
        metrics: (() => {
          const metrics = event.metrics || [];
          
          // Add fallback metrics if none processed
          if (metrics.length === 0) {
            const fallbackMetrics = [];
            
            // Remove distance fallback to avoid duplication with content text
            // if (event.distance) {
            //   fallbackMetrics.push({
            //     label: 'Distance',
            //     value: event.distance,
            //     unit: event.distanceUnit || 'km'
            //   });
            // }
            
            if (event.duration) {
              fallbackMetrics.push({
                label: 'Duration', 
                value: event.duration,
                unit: 'min'
              });
            }
            
            return fallbackMetrics;
          }
          
          // Validate existing metrics and filter out distance metrics
          return metrics.filter(metric => {
            if (!metric.label || !metric.value) {
              validationErrors.push(`Event ${event.id}: Invalid metric (missing label or value)`);
              return false;
            }
            // Remove distance metrics to avoid duplication
            const labelLower = metric.label?.toLowerCase() || '';
            if (labelLower.includes('dist')) {
              return false;
            }
            return true;
          });
        })(),
        
        // Tags for team/challenge display
        tags: event.tags || [],
        
        // Simple zap count (no complex social interactions)
        zaps: 0, // Keep simple - just for display
        
        // Activity metadata for validation
        activityType: event.activityType,
        
        // Raw event for any additional processing
        rawEvent: event.rawEvent
      };
    }).filter(Boolean); // Remove null entries
    
    // Update validation errors
    setValidationErrors(validationErrors);
    
    return posts;
  }, [enhancedFeedEvents, activityMode]);

  // Combined loading state
  const loading = feedLoading || profilesLoading;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      handleAppBackground();
    };
  }, []);

  // Phase 7: Enhanced refresh with retry logic
  const refreshFeed = useCallback(() => {
    if (loading || isRefreshing) return;
    
    setIsRefreshing(true);
    setValidationErrors([]);
    
    refreshFeedData()
      .then(() => {
        setRetryCount(0); // Reset retry count on success
      })
      .catch((error) => {
        console.error('Feed refresh failed:', error);
        if (retryCount < maxRetries) {
          setRetryCount(prev => prev + 1);
          // Retry after a delay
          setTimeout(() => {
            if (!isRefreshing) return; // Don't retry if user cancelled
            refreshFeedData();
          }, 2000 * (retryCount + 1)); // Exponential backoff
        }
      })
      .finally(() => {
        setTimeout(() => setIsRefreshing(false), 500);
      });
  }, [loading, isRefreshing, refreshFeedData, retryCount, maxRetries]);

  // Phase 7: Hard refresh with cache clearing and validation reset
  const hardRefresh = useCallback(() => {
    if (loading || isRefreshing) return;
    
    setIsRefreshing(true);
    setValidationErrors([]);
    setRetryCount(0);
    
    // Clear any cached data and refresh
    refreshFeedData();
    setTimeout(() => setIsRefreshing(false), 1000);
  }, [loading, isRefreshing, refreshFeedData]);

  // Phase 7: Enhanced zap handler with error handling
  const handleZap = useCallback(async (post, wallet) => {
    if (!post || !post.id) {
      console.error('Invalid post for zapping');
      return;
    }
    
    console.log('Zapping workout:', post.id);
    
    // Enhanced zap validation
    if (!wallet) {
      console.warn('No wallet connected for zapping');
      return;
    }
    
    if (!wallet.makePayment) {
      console.warn('Wallet does not support payments');
      return;
    }
    
    try {
      // Basic zap functionality - could be enhanced later if needed
      console.log(`Zapped ${defaultZapAmount} sats to workout ${post.id}`);
      // TODO: Implement actual zap if needed
    } catch (error) {
      console.error('Zap failed:', error);
    }
  }, [defaultZapAmount]);

  // Phase 7: Activity mode validation
  const activityModeDisplay = useMemo(() => {
    const modes = {
      'run': 'Running',
      'walk': 'Walking', 
      'cycle': 'Cycling'
    };
    return modes[activityMode] || activityMode || 'All';
  }, [activityMode]);

  // Phase 7: Error state classification
  const errorType = useMemo(() => {
    if (!feedError) return null;
    
    if (feedError.includes('connection') || feedError.includes('network')) {
      return 'network';
    }
    if (feedError.includes('participant')) {
      return 'participants';
    }
    if (feedError.includes('timeout')) {
      return 'timeout';
    }
    return 'unknown';
  }, [feedError]);

  return (
    <div className="runclub-container">
      {/* Phase 7: Enhanced development debug tools */}
      {(import.meta.env.DEV || (typeof process !== 'undefined' && process.env.NODE_ENV === 'development')) && (
        <div style={{ position: 'fixed', top: '80px', right: '10px', zIndex: 1000 }}>
          <button 
            onClick={hardRefresh}
            style={{
              background: '#ff4444',
              color: 'white',
              border: 'none',
              padding: '8px 12px',
              borderRadius: '4px',
              fontSize: '12px',
              cursor: 'pointer'
            }}
            disabled={loading || isRefreshing}
            title={`Participant-first workout feed (${activityModeDisplay} mode)`}
          >
            🗑️ Refresh Workouts
          </button>
          
          {/* Show loading progress */}
          {loading && (
            <div style={{
              position: 'fixed',
              top: '120px',
              right: '10px',
              background: 'rgba(0,0,0,0.8)',
              color: 'white',
              padding: '8px 12px',
              borderRadius: '4px',
              fontSize: '11px',
              maxWidth: '200px'
            }}>
              {loadingProgress.message}<br/>
              {loadingProgress.phase !== 'complete' && (
                <small>
                  {loadingProgress.processedEvents}/{loadingProgress.totalEvents} workouts
                </small>
              )}
              {retryCount > 0 && (
                <div style={{ marginTop: '4px', color: '#ffcc00' }}>
                  Retry {retryCount}/{maxRetries}
                </div>
              )}
            </div>
          )}
          
          {/* Enhanced error display */}
          {feedError && (
            <div style={{
              position: 'fixed',
              top: '180px',
              right: '10px',
              background: '#ff4444',
              color: 'white',
              padding: '8px 12px',
              borderRadius: '4px',
              fontSize: '11px',
              maxWidth: '200px'
            }}>
              Error ({errorType}): {feedError}
              {retryCount > 0 && <div>Retrying... ({retryCount}/{maxRetries})</div>}
            </div>
          )}
          
          {/* Validation errors */}
          {validationErrors.length > 0 && (
            <div style={{
              position: 'fixed',
              top: '240px',
              right: '10px',
              background: '#ff8800',
              color: 'white',
              padding: '8px 12px',
              borderRadius: '4px',
              fontSize: '10px',
              maxWidth: '200px',
              maxHeight: '100px',
              overflow: 'auto'
            }}>
              Validation Issues ({validationErrors.length}):
              {validationErrors.slice(0, 3).map((error, i) => (
                <div key={i}>{error}</div>
              ))}
              {validationErrors.length > 3 && <div>...and {validationErrors.length - 3} more</div>}
            </div>
          )}
        </div>
      )}
      
      {/* League Map Component */}
      <LeagueMap />
      
      {/* Workout Cards Feed */}
      <div className="workout-feed" style={{ padding: '1rem' }}>
        {/* Phase 7: Enhanced loading states */}
        {loading && workoutPosts.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
            Loading {activityModeDisplay.toLowerCase()} workouts from Season Pass participants...
            {loadingProgress.participantCount > 0 && (
              <div style={{ marginTop: '0.5rem', fontSize: '0.9em' }}>
                {loadingProgress.participantCount} participants • {loadingProgress.processedEvents} events processed
              </div>
            )}
          </div>
        )}
        
        {/* Phase 7: Enhanced error handling */}
        {feedError && workoutPosts.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem' }}>
            <div style={{ color: '#ff4444', marginBottom: '1rem' }}>
              {errorType === 'network' && '🌐 Network connection issue'}
              {errorType === 'participants' && '👥 Season Pass participant loading issue'} 
              {errorType === 'timeout' && '⏱️ Request timed out'}
              {errorType === 'unknown' && '❌ Error loading workouts'}
            </div>
            <div style={{ color: '#666', marginBottom: '1rem' }}>
              {feedError}
            </div>
            <button 
              onClick={refreshFeed}
              style={{
                background: '#ff4444',
                color: 'white',
                border: 'none',
                padding: '8px 16px',
                borderRadius: '4px',
                cursor: 'pointer',
                marginRight: '8px'
              }}
              disabled={isRefreshing}
            >
              {isRefreshing ? `Retrying... (${retryCount}/${maxRetries})` : 'Retry'}
            </button>
            {retryCount >= maxRetries && (
              <button 
                onClick={hardRefresh}
                style={{
                  background: '#0066cc',
                  color: 'white',
                  border: 'none',
                  padding: '8px 16px',
                  borderRadius: '4px',
                  cursor: 'pointer'
                }}
              >
                Hard Refresh
              </button>
            )}
          </div>
        )}
        
        {/* Phase 7: Enhanced empty state */}
        {!loading && !feedError && workoutPosts.length === 0 && (
          <div style={{ textAlign: 'center', padding: '2rem', color: '#666' }}>
            <div style={{ fontSize: '1.2em', marginBottom: '1rem' }}>
              🏃‍♂️ No {activityModeDisplay.toLowerCase()} workouts found
            </div>
            <div style={{ marginBottom: '1rem' }}>
              No Season Pass participants have posted {activityModeDisplay.toLowerCase()} workouts yet.
            </div>
            <div style={{ fontSize: '0.9em', color: '#999' }}>
              Activity mode: {activityModeDisplay} • Participants loaded: {loadingProgress.participantCount || 0}
            </div>
          </div>
        )}
        
        {/* Render workout posts using existing Post/WorkoutCard components */}
        {workoutPosts.map((post) => (
          <Post
            key={post.id}
            post={post}
            handleZap={handleZap}
            wallet={wallet}
          />
        ))}
        
        {/* Phase 7: Enhanced footer with stats */}
        {!loading && workoutPosts.length > 0 && (
          <div style={{ textAlign: 'center', padding: '1rem', color: '#666' }}>
            <div style={{ marginBottom: '1rem', fontSize: '0.9em' }}>
              Showing {workoutPosts.length} {activityModeDisplay.toLowerCase()} workout{workoutPosts.length !== 1 ? 's' : ''} from Season Pass participants
              {validationErrors.length > 0 && (
                <div style={{ color: '#ff8800', fontSize: '0.8em', marginTop: '0.5rem' }}>
                  ⚠️ {validationErrors.length} validation issue{validationErrors.length !== 1 ? 's' : ''} detected
                </div>
              )}
            </div>
            <button 
              onClick={refreshFeed}
              style={{
                background: 'transparent',
                border: '1px solid #ccc',
                padding: '8px 16px',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
              disabled={isRefreshing}
            >
              {isRefreshing ? 'Refreshing...' : 'Refresh Workouts'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};