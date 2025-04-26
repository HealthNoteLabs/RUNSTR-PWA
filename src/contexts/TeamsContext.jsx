import { createContext, useState, useEffect, useCallback, useContext } from 'react';
import PropTypes from 'prop-types';
import { NostrContext } from './NostrContext';
import { fetchUserGroupList, initializeNostr, setAmberUserPubkey } from '../utils/nostrClient';

// Create context
export const TeamsContext = createContext();

// Custom hook for using Teams context
export const useTeams = () => {
  const context = useContext(TeamsContext);
  if (!context) {
    throw new Error('useTeams must be used within a TeamsProvider');
  }
  return context;
};

export const TeamsProvider = ({ children }) => {
  // Get Nostr context
  const { publicKey: nostrPublicKey } = useContext(NostrContext);
  
  // State for Nostr groups
  const [myNostrGroups, setMyNostrGroups] = useState([]);
  const [loadingNostrGroups, setLoadingNostrGroups] = useState(false);
  const [nostrInitialized, setNostrInitialized] = useState(false);
  
  // General state
  const [error, setError] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);

  // Initialize Nostr when component mounts
  useEffect(() => {
    const initNostr = async () => {
      try {
        const initialized = await initializeNostr();
        setNostrInitialized(initialized);
        if (!initialized) {
          setError('Failed to connect to Nostr network');
        }
      } catch (err) {
        console.error('Error initializing Nostr:', err);
        setError('Failed to initialize Nostr connection');
      }
    };

    initNostr();
  }, []); // Run once on mount

  // Update currentUser and fetch groups when nostrPublicKey changes
  useEffect(() => {
    const fetchNostrGroups = async () => {
      if (!nostrPublicKey || !nostrInitialized) {
        setMyNostrGroups([]);
        return;
      }

      setLoadingNostrGroups(true);
      setError(null);
      
      try {
        // Set the pubkey in nostrClient for Amber authentication
        setAmberUserPubkey(nostrPublicKey);
        setCurrentUser(nostrPublicKey);
        
        // Fetch groups from all configured relays
        const groups = await fetchUserGroupList(nostrPublicKey);
        
        if (groups && Array.isArray(groups)) {
          setMyNostrGroups(groups);
        } else {
          setMyNostrGroups([]);
        }
      } catch (err) {
        console.error('Error loading Nostr clubs:', err);
        setError('Failed to load your Nostr clubs');
        setMyNostrGroups([]);
      } finally {
        setLoadingNostrGroups(false);
      }
    };

    fetchNostrGroups();
  }, [nostrPublicKey, nostrInitialized]);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Context value
  const value = {
    myNostrGroups,
    loadingNostrGroups,
    error,
    currentUser,
    clearError,
    nostrInitialized
  };

  return (
    <TeamsContext.Provider value={value}>
      {children}
    </TeamsContext.Provider>
  );
};

TeamsProvider.propTypes = {
  children: PropTypes.node.isRequired
}; 