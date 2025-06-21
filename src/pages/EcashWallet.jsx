import { useState } from 'react';
import { useNip60Wallet } from '../hooks/useNip60Wallet';

export const EcashWallet = () => {
  const {
    loading,
    error,
    hasWallet,
    balance,
    currentMint,
    tokenEvents,
    createWallet,
    refreshWallet,
    SUPPORTED_MINTS
  } = useNip60Wallet();

  const [selectedMint, setSelectedMint] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateWallet = async () => {
    if (!selectedMint) return;
    
    setIsCreating(true);
    try {
      console.log('[EcashWallet] User requested wallet creation, will prompt Amber...');
      const success = await createWallet(selectedMint);
      if (!success) {
        // Error is already set by the hook
        console.log('[EcashWallet] Wallet creation failed, error shown to user');
      }
    } catch (error) {
      console.error('Failed to create wallet:', error);
      // Error is handled by the hook
    } finally {
      setIsCreating(false);
    }
  };

  if (loading && !hasWallet) {
    return (
      <div className="ecash-wallet-page">
        <div className="loading-state">
          <h2>🔍 Discovering NIP-60 Wallet...</h2>
          <p>Querying relays for existing wallet events (no signing required)...</p>
          <div className="loading-spinner">⏳</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="ecash-wallet-page">
        <div className="error-state">
          <h2>❌ Wallet Error</h2>
          <p>{error}</p>
          <button onClick={refreshWallet} className="retry-button">
            Retry Discovery
          </button>
        </div>
      </div>
    );
  }

  if (!hasWallet) {
    return (
      <div className="ecash-wallet-page">
        <div className="wallet-creation">
          <h2>🆕 Create NIP-60 Wallet</h2>
          <p>No existing wallet found. Create a new ecash wallet by selecting a mint:</p>
          
          <div className="mint-selection">
            {SUPPORTED_MINTS.map(mint => (
              <div 
                key={mint.url}
                className={`mint-option ${selectedMint === mint.url ? 'selected' : ''}`}
                onClick={() => setSelectedMint(mint.url)}
              >
                <h3>{mint.name}</h3>
                <p>{mint.description}</p>
                <small>{mint.url}</small>
              </div>
            ))}
          </div>

          {error && (
            <div className="error-message" style={{ 
              background: 'rgba(255, 99, 99, 0.2)', 
              color: '#ff6363', 
              padding: '12px', 
              borderRadius: '8px', 
              margin: '16px 0',
              textAlign: 'center'
            }}>
              {error}
            </div>
          )}

          <button 
            onClick={handleCreateWallet}
            disabled={!selectedMint || isCreating}
            className="create-wallet-btn"
          >
            {isCreating ? (
              selectedMint ? '🔐 Requesting Amber Signature...' : '⏳ Creating Wallet...'
            ) : (
              '🔒 Create Wallet'
            )}
          </button>
          
          {isCreating && (
            <p style={{ 
              color: 'var(--text-secondary)', 
              fontSize: '0.9rem', 
              marginTop: '12px',
              textAlign: 'center'
            }}>
              📱 Check Amber for signing prompts. You'll need to approve 2 signatures to create your wallet.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="ecash-wallet-page">
      <div className="wallet-header">
        <h2>🔒 NIP-60 Ecash Wallet</h2>
        <div className="wallet-info">
          <div className="balance-display">
            <span className="balance-label">Balance:</span>
            <span className="balance-amount">{balance} sats</span>
          </div>
          <div className="mint-info">
            <span className="mint-label">Mint:</span>
            <span className="mint-name">{currentMint?.name || 'Unknown'}</span>
          </div>
        </div>
        <div className="wallet-description">
          <p>Event-based ecash wallet using pure NIP-60 implementation. Balance calculated from {tokenEvents.length} token events.</p>
        </div>
      </div>

      <div className="wallet-actions">
        <button onClick={refreshWallet} disabled={loading} className="refresh-button">
          {loading ? '⏳ Refreshing...' : '🔄 Refresh'}
        </button>
      </div>

      <div className="transaction-history">
        <h3>📝 Event History</h3>
        {tokenEvents.length === 0 ? (
          <div className="no-events">
            <p>🎉 Wallet created successfully!</p>
            <p>No token events found yet. Your wallet is ready to receive ecash tokens.</p>
          </div>
        ) : (
          <div className="event-list">
            <p className="events-summary">Found {tokenEvents.length} token events</p>
            {tokenEvents.slice(0, 10).map(event => (
              <div key={event.id} className="event-item">
                <span className={`event-type ${event.content?.type || 'unknown'}`}>
                  {event.content?.type === 'send' ? '📤 Send' : 
                   event.content?.type === 'receive' ? '📥 Receive' : '❓ Unknown'}
                </span>
                <span className="event-amount">
                  {event.content?.type === 'send' ? '-' : '+'}{event.content?.amount || 0} sats
                </span>
                <span className="event-date">
                  {new Date(event.created_at * 1000).toLocaleDateString()}
                </span>
              </div>
            ))}
            {tokenEvents.length > 10 && (
              <p className="more-events">... and {tokenEvents.length - 10} more events</p>
            )}
          </div>
        )}
      </div>

      <div className="debug-info">
        <details>
          <summary>🔧 Debug: Raw Event Data</summary>
          <pre>{JSON.stringify({ 
            hasWallet, 
            balance, 
            eventCount: tokenEvents.length,
            currentMint: currentMint?.url,
            walletEventId: hasWallet ? 'present' : 'none',
            mintEventId: currentMint ? 'present' : 'none'
          }, null, 2)}</pre>
        </details>
      </div>
    </div>
  );
}; 