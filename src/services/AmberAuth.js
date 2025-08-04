/**
 * AmberAuth.js
 * Service for Amber authentication and signing
 */

import { Platform, Linking, AppState } from '../utils/react-native-shim.js';

let _deepLinkListener = null;
const pendingRequests = new Map();

function processDeepLink(url) {
  if (!url || !url.startsWith('runstr://callback')) return;
  try {
    const urlObj = new URL(url);
    const id = urlObj.searchParams.get('id');
    const response = urlObj.searchParams.get('response');
    const req = id ? pendingRequests.get(id) : null;
    
    if (!req) return;

    if (response) {
      const decoded = decodeURIComponent(response);
      const parsed = JSON.parse(decoded);
      req.resolve(parsed);
    } else {
      req.reject(new Error('User rejected or a problem with Amber.'));
    }
    pendingRequests.delete(id);
  } catch (e) {
    console.error('Deep link processing error:', e);
    const id = new URL(url).searchParams.get('id');
    if (id && pendingRequests.has(id)) {
      pendingRequests.get(id).reject(e);
      pendingRequests.delete(id);
    }
  }
}

const setupDeepLinkHandling = () => {
  if (_deepLinkListener) _deepLinkListener.remove();
  
  // AppState check to avoid processing initial URL multiple times
  let appState = AppState.currentState;
  if (appState === 'active') {
      Linking.getInitialURL().then(url => {
        if (url) processDeepLink(url);
      }).catch(err => console.warn('RN-Linking an error occurred', err));
  }
  
  const handleAppStateChange = (nextAppState) => {
    if (appState.match(/inactive|background/) && nextAppState === 'active') {
      // App has come to the foreground
    }
    appState = nextAppState;
  };
  
  AppState.addEventListener('change', handleAppStateChange);
  _deepLinkListener = Linking.addEventListener('url', ({ url }) => processDeepLink(url));
};

const getPublicKey = () => {
  return new Promise(async (resolve, reject) => {
    if (Platform.OS !== 'android') return reject(new Error('Amber is Android-only'));
    const id = `pubkey_${Math.random()}`;
    
    pendingRequests.set(id, {
      resolve: (signedAuthEvent) => resolve(signedAuthEvent.pubkey),
      reject
    });

    const authEvent = {
      kind: 22242,
      created_at: Math.floor(Date.now() / 1000),
      content: 'Login to Runstr',
      tags: [['relay', 'wss://relay.damus.io']]
    };
    const encodedEvent = encodeURIComponent(JSON.stringify(authEvent));
    const callbackUrl = encodeURIComponent(`runstr://callback?id=${id}`);
    const amberUri = `nostrsigner:sign?event=${encodedEvent}&callback=${callbackUrl}`;
    
    try {
      await Linking.openURL(amberUri);
    } catch (e) {
      pendingRequests.delete(id);
      reject(e);
    }
  });
};

const signEvent = (event) => {
  return new Promise(async (resolve, reject) => {
    if (Platform.OS !== 'android') return reject(new Error('Amber is Android-only'));
    const id = `sign_${Math.random()}`;
    
    pendingRequests.set(id, { resolve, reject });

    if (!event.created_at) event.created_at = Math.floor(Date.now() / 1000);
    
    const encodedEvent = encodeURIComponent(JSON.stringify(event));
    const callbackUrl = encodeURIComponent(`runstr://callback?id=${id}`);
    const amberUri = `nostrsigner:sign?event=${encodedEvent}&callback=${callbackUrl}`;
    
    try {
      await Linking.openURL(amberUri);
    } catch (e) {
      pendingRequests.delete(id);
      reject(e);
    }
  });
};

// Check if Amber is installed (will only work in native context)
const isAmberInstalled = async () => {
  // Check if we're on Android AND in a native app (not browser)
  if (Platform.OS !== 'android' || (typeof window !== 'undefined' && !window.Capacitor?.isNativePlatform())) {
    return false;
  }
  
  try {
    // This will check if the app can handle the nostrsigner: URI scheme
    const canOpen = await Linking.canOpenURL('nostrsigner:');
    return canOpen;
  } catch (error) {
    console.error('Error checking if Amber is installed:', error);
    return false;
  }
};

/**
 * Request authentication using Amber
 * This will open Amber and prompt the user for authentication
 * @returns {Promise<boolean>} Success status
 */
const requestAuthentication = async () => {
  if (Platform.OS !== 'android') {
    console.warn('Amber authentication is only supported on Android');
    return false;
  }
  
  try {
    // Create an authentication request event
    const authEvent = {
      kind: 22242, // Auth event kind
      created_at: Math.floor(Date.now() / 1000),
      content: 'Login to Runstr',
      tags: [
        ['relay', 'wss://relay.damus.io'],
        ['relay', 'wss://nos.lol'],
        ['relay', 'wss://relay.nostr.band']
      ]
    };
    
    // Convert to JSON and encode for URL
    const eventJson = JSON.stringify(authEvent);
    const encodedEvent = encodeURIComponent(eventJson);
    
    // Create the URI with the nostrsigner scheme and add callback URL
    const callbackUrl = encodeURIComponent('runstr://callback');
    const amberUri = `nostrsigner:sign?event=${encodedEvent}&callback=${callbackUrl}`;
    
    console.log('Opening Amber with URI:', amberUri);
    
    // Open Amber using the URI
    await Linking.openURL(amberUri);
    
    // Authentication success will be handled by deep linking callback
    return true;
  } catch (error) {
    console.error('Error authenticating with Amber:', error);
    if (error.message && error.message.includes('Activity not found')) {
      console.error('Amber app not found or not responding');
      return false;
    }
    return false;
  }
};

// Simple stub of AmberAuth for diagnostic scripts running outside the mobile app.
export default {
  isLoggedIn: () => false,
  signEvent: async (ev) => ev,
  isAmberInstalled,
  requestAuthentication,
  setupDeepLinkHandling,
  getPublicKey,
  signEvent
}; 