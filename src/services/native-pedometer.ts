import { registerPlugin, PluginListenerHandle, Capacitor } from '@capacitor/core';
import type { PedometerData, PedometerSensorInfo } from './PedometerService'; // Import interfaces

export interface PedometerPlugin {
  start(): Promise<void>;
  stop(): Promise<void>;
  getCurrentStepCount(): Promise<PedometerData>;
  getSensorInfo(): Promise<PedometerSensorInfo>;
  addListener(eventName: 'step', listenerFunc: (data: PedometerData) => void): Promise<PluginListenerHandle> & PluginListenerHandle;
  removeAllListeners(): Promise<void>;
}

// Browser-compatible fallback for Capacitor plugins
const Pedometer = Capacitor.isNativePlatform() 
  ? registerPlugin<PedometerPlugin>('Pedometer')
  : {
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      getCurrentStepCount: () => Promise.resolve({ count: 0 }),
      getSensorInfo: () => Promise.resolve({ stepCounterAvailable: false, stepDetectorAvailable: false }),
      addListener: () => Promise.resolve({ remove: () => {} }) as any,
      removeAllListeners: () => Promise.resolve()
    } as PedometerPlugin;

export { Pedometer }; 