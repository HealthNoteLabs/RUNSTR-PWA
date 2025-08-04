import NDK from '@nostr-dev-kit/ndk';
// Assuming your relay configuration is exported from a dedicated file.
// Adjust the path if your relay config is located elsewhere.
import { relays } from '../config/relays';

// Use globalThis to ensure a single instance even with hot module replacement (HMR)
const g = globalThis as any;

if (!g.__RUNSTR_NDK_INSTANCE__) {
  console.log('[NDK Singleton] Creating new NDK instance...');
  g.__RUNSTR_NDK_INSTANCE__ = new NDK({
    explicitRelayUrls: relays,
    // You can add other NDK options here if needed, e.g., signer, cache, etc.
    debug: true, // Enable for more verbose NDK logging
  });

  g.__RUNSTR_NDK_READY_PROMISE__ = (async () => {
    try {
      const connectTimeoutMs = 5000; // Reduced timeout for better browser experience
      console.log(`[NDK Singleton] Attempting NDK.connect() with timeout: ${connectTimeoutMs}ms`);
      console.log(`[NDK Singleton] Using relays:`, relays);
      
      // Make connection non-blocking by catching timeout errors
      await Promise.race([
        g.__RUNSTR_NDK_INSTANCE__.connect(connectTimeoutMs),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('NDK connection timeout')), connectTimeoutMs)
        )
      ]).catch(err => {
        console.warn('[NDK Singleton] Connection timeout or error, continuing anyway:', err);
        // Don't throw, let the app continue loading
      });
      
      const connectedCount = g.__RUNSTR_NDK_INSTANCE__.pool?.stats()?.connected || 0;
      console.log(`[NDK Singleton] NDK.connect() completed. Connected relays: ${connectedCount}`);
      console.log(`[NDK Singleton] Pool stats:`, g.__RUNSTR_NDK_INSTANCE__.pool?.stats());

      if (connectedCount > 0) {
        console.log('[NDK Singleton] NDK is ready (at least 1 relay connected).');
        return true; // Resolve promise with true indicating readiness
      } else {
        console.warn('[NDK Singleton] No relays connected, but continuing app initialization.');
        // Return false but don't throw - let the app continue
        return false;
      }
    } catch (err) {
      // This catch block handles errors from new NDK(), g.__RUNSTR_NDK_INSTANCE__.connect(), or the explicit throw above.
      console.error('[NDK Singleton] Error during NDK initialization or connection:', err);
      return false; // Resolve promise with false indicating failure
    }
  })();
} else {
  console.log('[NDK Singleton] Reusing existing NDK instance.');
}

export const ndk: NDK = g.__RUNSTR_NDK_INSTANCE__;
export const ndkReadyPromise: Promise<boolean> = g.__RUNSTR_NDK_READY_PROMISE__;

export const awaitNDKReady = async (timeoutMs: number = 10000): Promise<boolean> => {
  try {
    const ready = await Promise.race([
      ndkReadyPromise,
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), timeoutMs)),
    ]);
    if (!ready) {
      throw new Error('NDK failed to become ready within timeout');
    }
    return true;
  } catch (err) {
    console.error('[NDK Singleton] awaitNDKReady error:', err);
    return false;
  }
}; 