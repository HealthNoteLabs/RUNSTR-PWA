import { registerPlugin, Capacitor } from '@capacitor/core';
import { EventEmitter } from 'tseep';
import runDataService, { ACTIVITY_TYPES } from './RunDataService';
import { filterLocation } from '../utils/runCalculations';
import { KalmanFilter1D, WeightedGPSFilter } from '../utils/kalmanFilter';
import { SensorFusionManager } from '../utils/sensorFusion';
import { GPSGapFiller } from '../utils/trajectoryPrediction';

// Browser-compatible fallback for Capacitor plugins
const BackgroundGeolocation = Capacitor.isNativePlatform() 
  ? registerPlugin('BackgroundGeolocation')
  : {
      // Mock implementation for browser development
      addListener: () => ({ remove: () => {} }),
      start: () => Promise.resolve(),
      stop: () => Promise.resolve(),
      getCurrentLocation: () => Promise.resolve({
        latitude: 37.7749,
        longitude: -122.4194,
        accuracy: 10,
        altitude: 0,
        bearing: 0,
        speed: 0,
        time: Date.now()
      })
    };

// Define average stride length for step estimation
const AVERAGE_STRIDE_LENGTH_METERS = 0.62; // meters (adjusted from 0.73)

// Helper function to estimate stride length based on height
const estimateStrideLength = (heightCm) => {
  if (!heightCm || heightCm < 100 || heightCm > 250) {
    // Return default if no height or unrealistic height
    return AVERAGE_STRIDE_LENGTH_METERS;
  }
  
  // Convert cm to inches
  const heightInches = heightCm / 2.54;
  
  // Use gender-neutral average formula (average of male and female factors)
  // Male: height × 0.415, Female: height × 0.413, Average: height × 0.414
  const strideLengthInches = heightInches * 0.414;
  
  // Convert inches to meters
  const strideLengthMeters = strideLengthInches * 0.0254;
  
  return strideLengthMeters;
};

class RunTracker extends EventEmitter {
  constructor() {
    super();

    this.distance = 0; // in meters
    this.duration = 0; // in seconds
    this.pace = 0; // in seconds per meter
    this.estimatedSteps = 0;
    this.currentSpeed = { value: 0, unit: 'km/h' }; // Default unit, will update based on preference
    this.splits = []; // Array to store split objects { km, time, pace }
    this.positions = [];
    
    // Add simple distance goal tracking
    this.distanceGoal = null; // Target distance in meters, null = no goal
    
    // Add stride length property that can be customized
    this.strideLength = this.getCustomStrideLength();
    
    // Add elevation tracking data
    this.elevation = {
      current: null,
      gain: 0,
      loss: 0,
      lastAltitude: null
    };

    this.isTracking = false;
    this.isPaused = false;
    this.startTime = 0;
    this.pausedTime = 0; // Total time paused in milliseconds
    this.lastPauseTime = 0; // Timestamp when the run was last paused
    this.lastSplitDistance = 0; // Track last split milestone
    this.activityType = localStorage.getItem('activityMode') || ACTIVITY_TYPES.RUN; // Get current activity type

    this.watchId = null; // For geolocation watch id
    this.timerInterval = null; // For updating duration every second
    this.paceInterval = null; // For calculating pace at regular intervals
    this.smoothedSpeedMps = 0; // For smoothing speed calculations in cycling mode
    
    // Initialize Kalman filters for GPS smoothing
    this.latFilter = new KalmanFilter1D({ Q: 3, R: 0.01 });
    this.lonFilter = new KalmanFilter1D({ Q: 3, R: 0.01 });
    this.altFilter = new KalmanFilter1D({ Q: 1, R: 0.05 }); // Altitude is less accurate
    
    // Alternative: Weighted GPS filter
    this.weightedFilter = new WeightedGPSFilter(5);
    
    // GPS filtering mode (can be configured via settings)
    this.gpsFilteringMode = localStorage.getItem('gpsFilteringMode') || 'kalman'; // 'kalman' or 'weighted'
    
    // Sensor fusion for improved tracking
    this.sensorFusion = new SensorFusionManager();
    this.lastGPSTime = 0;
    this.gpsOutageThreshold = 10000; // 10 seconds without GPS = outage
    
    // GPS gap filling with trajectory prediction
    this.gpsGapFiller = new GPSGapFiller();
  }

  // Helper method to get the current distance unit from localStorage
  getDistanceUnit() {
    return localStorage.getItem('distanceUnit') || 'km';
  }

  toRadians(degrees) {
    return (degrees * Math.PI) / 180;
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = this.toRadians(lat2 - lat1); // Difference in latitude converted to radians
    const dLon = this.toRadians(lon2 - lon1); // Difference in longitude converted to radians

    // Calculate the square of half the chord length between the points
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) *
        Math.cos(this.toRadians(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    // Calculate the angular distance in radians using the arctan function
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    // Multiply by Earth's radius to get the distance in meters.
    return R * c; // Distance in meters
  }

  calculatePace(distance, duration) {
    // Use the centralized pace calculation method
    // This already considers distanceUnit for its output format (e.g. time for 1km or 1mi)
    return runDataService.calculatePace(distance, duration, this.getDistanceUnit());
  }

  /**
   * Calculate current speed from recent GPS positions using a time window
   * This provides more accurate instantaneous speed for cycling
   * @returns {number} Speed in m/s, or 0 if not enough data
   */
  calculateCurrentSpeed() {
    const SPEED_WINDOW = 10; // Use 10-second window for speed calculation
    
    if (this.positions.length < 2) {
      return 0;
    }

    const now = this.positions[this.positions.length - 1].timestamp;
    const windowStart = now - SPEED_WINDOW * 1000; // 10 seconds ago

    // Find positions within our time window
    const recentPositions = this.positions.filter(
      (pos) => pos.timestamp >= windowStart
    );

    if (recentPositions.length < 2) {
      // Fall back to total average if not enough recent data
      if (this.distance > 0 && this.duration > 0) {
        return this.distance / this.duration; // m/s
      }
      return 0;
    }

    let recentDistance = 0;
    let lastValidPosition = null;

    // Calculate distance traveled in the recent window
    for (const position of recentPositions) {
      if (lastValidPosition) {
        const segmentDistance = this.calculateDistance(
          lastValidPosition.coords.latitude,
          lastValidPosition.coords.longitude,
          position.coords.latitude,
          position.coords.longitude
        );

        const timeDiff = (position.timestamp - lastValidPosition.timestamp) / 1000;
        if (timeDiff > 0) {
          recentDistance += segmentDistance;
        }
      }
      lastValidPosition = position;
    }

    const recentDuration = (recentPositions[recentPositions.length - 1].timestamp - recentPositions[0].timestamp) / 1000;

    if (recentDuration > 0 && recentDistance > 0) {
      return recentDistance / recentDuration; // m/s
    }

    // Fall back to total average if calculation fails
    if (this.distance > 0 && this.duration > 0) {
      return this.distance / this.duration; // m/s
    }

    return 0;
  }

  updateElevation(altitude) {
    if (altitude === null || altitude === undefined || isNaN(altitude)) {
      return;
    }
    
    // Set current elevation
    this.elevation.current = altitude;
    
    // Calculate gain and loss if we have a previous altitude reading
    if (this.elevation.lastAltitude !== null) {
      const diff = altitude - this.elevation.lastAltitude;
      
      // Filter out small fluctuations (less than 1 meter)
      if (Math.abs(diff) >= 1) {
        if (diff > 0) {
          this.elevation.gain += diff;
        } else {
          this.elevation.loss += Math.abs(diff);
        }
      }
    }
    
    this.elevation.lastAltitude = altitude;
    
    // Emit elevation change
    this.emit('elevationChange', {...this.elevation});
  }

  addPosition(newPosition) {
    // Only process position updates if actively tracking (not paused and tracking is on)
    if (!this.isTracking || this.isPaused) {
      // Don't process position updates when not actively tracking
      return;
    }

    // Filter out positions with poor GPS accuracy (> 20 meters)
    const accuracy = newPosition.accuracy ?? newPosition.coords?.accuracy ?? 999;
    if (accuracy > 20) {
      console.log(`Position filtered: poor accuracy (${accuracy}m)`);
      return;
    }

    // Normalise the incoming position so it always has a `coords` object – this is
    // the shape expected by the shared helper utilities (runCalculations etc.)
    const standardise = (pos) => ({
      ...pos,
      timestamp: pos.timestamp || Date.now(),
      coords: {
        latitude: pos.latitude ?? pos.coords?.latitude ?? 0,
        longitude: pos.longitude ?? pos.coords?.longitude ?? 0,
        accuracy: pos.accuracy ?? pos.coords?.accuracy ?? 0,
        altitude: pos.altitude ?? pos.coords?.altitude ?? null,
      },
    });

    const currentPositionStd = standardise(newPosition);

    // Validate coordinates are within valid ranges
    const lat = currentPositionStd.coords.latitude;
    const lon = currentPositionStd.coords.longitude;
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      console.log(`Position filtered: invalid coordinates (${lat}, ${lon})`);
      return;
    }

    // Apply GPS filtering based on selected mode
    let filteredPosition = currentPositionStd;
    
    if (this.gpsFilteringMode === 'kalman') {
      // Adjust Kalman filter parameters based on GPS accuracy
      this.latFilter.adjustParameters(accuracy);
      this.lonFilter.adjustParameters(accuracy);
      
      // Adjust process noise based on activity type
      if (this.activityType === ACTIVITY_TYPES.WALK) {
        // Walking - lower process noise
        this.latFilter.Q = 0.5;
        this.lonFilter.Q = 0.5;
      } else if (this.activityType === ACTIVITY_TYPES.CYCLE) {
        // Cycling - higher process noise due to faster movement
        this.latFilter.Q = 5;
        this.lonFilter.Q = 5;
      } else {
        // Running - moderate process noise
        this.latFilter.Q = 3;
        this.lonFilter.Q = 3;
      }
      
      // Apply Kalman filtering
      const filteredLat = this.latFilter.filter(lat);
      const filteredLon = this.lonFilter.filter(lon);
      const filteredAlt = currentPositionStd.coords.altitude !== null && currentPositionStd.coords.altitude !== undefined
        ? this.altFilter.filter(currentPositionStd.coords.altitude)
        : null;
      
      filteredPosition = {
        ...currentPositionStd,
        coords: {
          ...currentPositionStd.coords,
          latitude: filteredLat,
          longitude: filteredLon,
          altitude: filteredAlt
        }
      };
    } else if (this.gpsFilteringMode === 'weighted') {
      // Use weighted average filter
      const weightedResult = this.weightedFilter.addReading({
        lat: lat,
        lon: lon,
        accuracy: accuracy,
        timestamp: currentPositionStd.timestamp
      });
      
      if (weightedResult) {
        filteredPosition = {
          ...currentPositionStd,
          coords: {
            ...currentPositionStd.coords,
            latitude: weightedResult.lat,
            longitude: weightedResult.lon,
            accuracy: weightedResult.accuracy
          }
        };
      }
    }

    // Keep duration accurate even when JS timers are throttled in background.
    // Uses GPS timestamp so splits don\'t get 0:00 durations.
    this.duration = (filteredPosition.timestamp - this.startTime - this.pausedTime) / 1000;
    this.emit('durationChange', this.duration);

    if (this.positions.length > 0) {
      const lastRawPosition = this.positions[this.positions.length - 1];
      const lastPositionStd = standardise(lastRawPosition);

      // Use the shared filtering logic to decide whether to accept the point.
      // If the point fails the quality checks, we ignore it entirely.
      if (!filterLocation(filteredPosition, lastPositionStd)) {
        console.log('[RunTracker] Position rejected by quality filter');
        return;
      }

      const distanceIncrement = this.calculateDistance(
        lastRawPosition.latitude,
        lastRawPosition.longitude,
        filteredPosition.coords.latitude,
        filteredPosition.coords.longitude
      );

      // Minimum threshold to additionally smooth out micro-jitter.
      const MOVEMENT_THRESHOLD = 0.5; // metres - reduced for cycling sensitivity
      if (distanceIncrement >= MOVEMENT_THRESHOLD) {
        this.distance += distanceIncrement;
        this.emit('distanceChange', this.distance); // Emit distance change

        // Check distance goal and auto-stop if reached
        if (this.distanceGoal && this.distance >= this.distanceGoal) {
          console.log(`Distance goal reached! Distance: ${this.distance}m, Goal: ${this.distanceGoal}m`);
          // Emit goal reached event for context to handle
          this.emit('goalReached', { distance: this.distance, goal: this.distanceGoal });
          return; // Exit early since run will be stopping
        }

        // If walking, calculate and emit steps
        if (this.activityType === ACTIVITY_TYPES.WALK) {
          this.estimatedSteps = this.distance > 0 ? Math.round(this.distance / this.strideLength) : 0;
          this.emit('stepsChange', this.estimatedSteps);
        }
      } else {
        console.log(`Filtered out small movement: ${distanceIncrement.toFixed(2)}m`);
      }

      // Check for altitude data and update elevation
      if (filteredPosition.coords.altitude !== undefined && filteredPosition.coords.altitude !== null) {
        this.updateElevation(filteredPosition.coords.altitude);
      }

      // Get current distance unit
      const distanceUnit = this.getDistanceUnit();
      
      // Define the split distance in meters based on selected unit
      const splitDistance = distanceUnit === 'km' ? 1000 : 1609.344; // 1km or 1mile in meters
      
      // Get the current distance in the selected unit (either km or miles)
      const currentDistanceInUnits = distanceUnit === 'km' 
        ? this.distance / 1000  // Convert meters to km
        : this.distance / 1609.344;  // Convert meters to miles
        
      // Get the last split distance in the selected unit
      const lastSplitDistanceInUnits = distanceUnit === 'km'
        ? this.lastSplitDistance / 1000
        : this.lastSplitDistance / 1609.344;
      
      // Check if a new full unit (km or mile) has been completed
      // Using Math.floor ensures we only trigger when a whole unit is completed
      if (Math.floor(currentDistanceInUnits) > Math.floor(lastSplitDistanceInUnits)) {
        // Calculate the current split number (1, 2, 3, etc.)
        const currentSplitNumber = Math.floor(currentDistanceInUnits);

        // Determine the elapsed time at the previous split (or 0 at start)
        const previousSplitTime = this.splits.length
          ? this.splits[this.splits.length - 1].time
          : 0;
        
        // Calculate the duration for this split (time difference)
        const splitDuration = this.duration - previousSplitTime;
        
        // Calculate pace for this split - pace is in time per distance unit
        // Pace should be in seconds per meter for proper formatting later
        const splitPace = splitDuration / splitDistance; 
        
        console.log(`Recording split at ${currentSplitNumber} ${distanceUnit}s with pace ${splitPace}`);

        // Record the split with the unit count, cumulative time, and split pace
        this.splits.push({
          km: currentSplitNumber, // We keep using 'km' field name for compatibility, but it represents the unit number (mile or km)
          time: this.duration,
          pace: splitPace,
          isPartial: false // This is a whole unit split
        });
        
        // Update lastSplitDistance to the whole unit completed (in meters)
        this.lastSplitDistance = currentSplitNumber * splitDistance;

        // Emit an event with updated splits array
        this.emit('splitRecorded', this.splits);
      }
    }

    // Store the filtered position
    this.positions.push({
      latitude: filteredPosition.coords.latitude,
      longitude: filteredPosition.coords.longitude,
      altitude: filteredPosition.coords.altitude,
      accuracy: filteredPosition.coords.accuracy,
      timestamp: filteredPosition.timestamp,
      coords: filteredPosition.coords
    });
    
    // Update sensor fusion with GPS position
    this.sensorFusion.updateGPSPosition(
      filteredPosition.coords.latitude,
      filteredPosition.coords.longitude,
      null // heading not available from GPS alone
    );
    
    // Update GPS gap filler with real position
    this.gpsGapFiller.processPosition({
      lat: filteredPosition.coords.latitude,
      lon: filteredPosition.coords.longitude,
      timestamp: filteredPosition.timestamp,
      accuracy: filteredPosition.coords.accuracy
    });
    
    this.lastGPSTime = filteredPosition.timestamp;
  }

  startTimer() {
    this.timerInterval = setInterval(() => {
      if (this.isTracking && !this.isPaused) {
        const now = Date.now();
        this.duration = (now - this.startTime - this.pausedTime) / 1000; // Subtract paused time
        this.emit('durationChange', this.duration); // Emit duration change
      }
    }, 1000); // Update every second
  }

  startPaceCalculator() {
    this.paceInterval = setInterval(() => {
      if (this.isTracking && !this.isPaused) {
        if (this.activityType === ACTIVITY_TYPES.CYCLE) {
          // Use recent positions for more accurate current speed calculation
          const rawSpeedMps = this.calculateCurrentSpeed(); // m/s from recent GPS positions
          
          // Apply exponential smoothing to reduce GPS noise (similar to runCalculations.js)
          // Use 70% of previous smoothed speed + 30% of new reading for stability
          if (rawSpeedMps > 0) {
            this.smoothedSpeedMps = 0.7 * this.smoothedSpeedMps + 0.3 * rawSpeedMps;
          } else {
            // If no movement detected, gradually decay the smoothed speed
            this.smoothedSpeedMps = 0.8 * this.smoothedSpeedMps;
          }

          const unit = this.getDistanceUnit();
          let speedValue;
          let speedUnitString;
          
          if (this.smoothedSpeedMps > 0) {
            if (unit === 'km') {
              speedValue = (this.smoothedSpeedMps * 3.6); // km/h
              speedUnitString = 'km/h';
              // Apply minimum speed threshold - don't show speeds below 0.1 km/h
              if (speedValue < 0.1) {
                speedValue = 0.0;
              }
              speedValue = speedValue.toFixed(1);
            } else {
              speedValue = (this.smoothedSpeedMps * 2.23694); // mph
              speedUnitString = 'mph';
              // Apply minimum speed threshold - don't show speeds below 0.1 mph
              if (speedValue < 0.1) {
                speedValue = 0.0;
              }
              speedValue = speedValue.toFixed(1);
            }
          } else {
            // Reset speed if no valid calculation possible
            speedValue = '0.0';
            speedUnitString = unit === 'km' ? 'km/h' : 'mph';
          }
          
          this.currentSpeed = { value: speedValue, unit: speedUnitString };
          this.emit('speedChange', this.currentSpeed);
        } else {
          // For non-cycle activities, calculate and emit pace as before
          this.pace = this.calculatePace(this.distance, this.duration);
          this.emit('paceChange', this.pace);
        }
      }
    }, 1000); // Update pace/speed every 1 second for more responsive cycling
    
    // Start adaptive sampling updater
    this.startAdaptiveSampling();
    
    // Start GPS outage detection
    this.startGPSOutageDetection();
  }

  /**
   * Start adaptive GPS sampling rate updates
   */
  startAdaptiveSampling() {
    // Update sampling rate every 30 seconds
    this.adaptiveSamplingInterval = setInterval(() => {
      if (this.isTracking && !this.isPaused) {
        this.updateGpsSamplingRate();
      }
    }, 30000);
  }

  /**
   * Start GPS outage detection and sensor fusion fallback
   */
  startGPSOutageDetection() {
    this.gpsOutageInterval = setInterval(() => {
      if (this.isTracking && !this.isPaused) {
        const now = Date.now();
        const timeSinceLastGPS = now - this.lastGPSTime;
        
        // Check if we're in a GPS outage
        if (timeSinceLastGPS > this.gpsOutageThreshold && this.lastGPSTime > 0) {
          console.log('GPS outage detected, using gap filling');
          
          // Try trajectory prediction first
          const predictedPosition = this.gpsGapFiller.fillGap();
          
          if (predictedPosition && predictedPosition.confidence > 0.5) {
            // Use trajectory prediction
            const syntheticPosition = {
              coords: {
                latitude: predictedPosition.lat,
                longitude: predictedPosition.lon,
                accuracy: 25 / predictedPosition.confidence,
                altitude: null
              },
              timestamp: now,
              isPredicted: true
            };
            
            this.addPosition(syntheticPosition);
            console.log(`Trajectory prediction: ${predictedPosition.lat.toFixed(6)}, ${predictedPosition.lon.toFixed(6)} (confidence: ${predictedPosition.confidence.toFixed(2)})`);
          } else {
            // Fall back to sensor fusion
            const estimatedPosition = this.sensorFusion.getEstimatedPosition();
            
            if (estimatedPosition && estimatedPosition.confidence > 0.3) {
              const syntheticPosition = {
                coords: {
                  latitude: estimatedPosition.lat,
                  longitude: estimatedPosition.lon,
                  accuracy: 50 / estimatedPosition.confidence,
                  altitude: null
                },
                timestamp: now,
                isEstimated: true
              };
              
              this.addPosition(syntheticPosition);
              console.log(`Sensor fusion fallback: ${estimatedPosition.lat.toFixed(6)}, ${estimatedPosition.lon.toFixed(6)} (confidence: ${estimatedPosition.confidence.toFixed(2)})`);
            }
          }
        }
        
        // Activity classification for adaptive behavior
        const activity = this.sensorFusion.getCurrentActivity();
        if (activity.confidence > 0.7 && activity.activity !== 'unknown') {
          // Could adjust tracking parameters based on detected activity
          console.log(`Detected activity: ${activity.activity} (${(activity.confidence * 100).toFixed(0)}% confidence)`);
        }
      }
    }, 5000); // Check every 5 seconds
  }

  /**
   * Get GPS configuration optimized for the current activity type
   * @returns {Object} GPS configuration object
   */
  getGpsConfig() {
    const baseConfig = {
      highAccuracy: true,
      staleLocationThreshold: 30000,
      interval: 5000,
      fastestInterval: 5000,
      activitiesInterval: 10000,
      locationProvider: 3,
      saveBatteryOnBackground: false,
      stopOnTerminate: false,
      startOnBoot: false,
      debug: false
    };

    // Activity-specific optimizations
    if (this.activityType === ACTIVITY_TYPES.CYCLE) {
      return {
        ...baseConfig,
        distanceFilter: 2, // More frequent updates for cycling (vs 5m default)
        interval: 3000,    // More frequent intervals for better cycling tracking
        fastestInterval: 3000,
      };
    } else {
      // Running and walking use more conservative settings
      return {
        ...baseConfig,
        distanceFilter: 5, // Standard distance filter for running/walking
      };
    }
  }

  /**
   * Calculate optimal GPS sampling interval based on multiple factors
   * Implements adaptive sampling for battery optimization
   * @returns {number} Interval in milliseconds
   */
  calculateOptimalSamplingInterval() {
    // Base intervals by activity type
    let baseInterval;
    if (this.activityType === ACTIVITY_TYPES.WALK) {
      baseInterval = 15000; // 15 seconds for walking
    } else if (this.activityType === ACTIVITY_TYPES.CYCLE) {
      baseInterval = 5000; // 5 seconds for cycling
    } else {
      baseInterval = 10000; // 10 seconds for running
    }

    // Speed-based adjustment
    const speedMps = this.calculateCurrentSpeed();
    if (speedMps > 15) {
      // High speed (>54 km/h) - more frequent updates
      baseInterval = Math.min(baseInterval, 5000);
    } else if (speedMps > 8) {
      // Medium speed (>28.8 km/h) - moderate frequency
      baseInterval = Math.min(baseInterval, 10000);
    } else if (speedMps < 0.5) {
      // Nearly stationary - reduce frequency
      baseInterval = Math.max(baseInterval, 30000);
    }

    // Battery level adjustment
    const batteryLevel = this.getBatteryLevel();
    if (batteryLevel !== null && batteryLevel < 30) {
      // Low battery - increase interval by 50%
      baseInterval = baseInterval * 1.5;
    } else if (batteryLevel !== null && batteryLevel < 15) {
      // Critical battery - double interval
      baseInterval = baseInterval * 2;
    }

    // Distance to goal adjustment
    if (this.distanceGoal) {
      const remainingDistance = this.distanceGoal - this.distance;
      if (remainingDistance < 1000) {
        // Within 1km of goal - more frequent updates
        baseInterval = Math.min(baseInterval, 5000);
      }
    }

    // Screen state adjustment (PWA can detect if page is visible)
    if (typeof document !== 'undefined' && document.hidden) {
      // App is in background - reduce frequency
      baseInterval = Math.max(baseInterval, 30000);
    }

    // Return clamped interval (min 3s, max 60s)
    return Math.max(3000, Math.min(60000, baseInterval));
  }

  /**
   * Get current battery level (0-100)
   * @returns {number|null} Battery percentage or null if unavailable
   */
  getBatteryLevel() {
    // Check if Battery API is available
    if ('getBattery' in navigator) {
      return navigator.getBattery().then(battery => {
        return Math.round(battery.level * 100);
      }).catch(() => null);
    }
    return null;
  }

  /**
   * Update GPS sampling configuration dynamically
   */
  async updateGpsSamplingRate() {
    if (!this.watchId || !this.isTracking) return;

    const optimalInterval = this.calculateOptimalSamplingInterval();
    
    try {
      // Update the existing watcher with new interval
      await BackgroundGeolocation.configure({
        id: this.watchId,
        interval: optimalInterval,
        fastestInterval: optimalInterval
      });
      
      console.log(`GPS sampling interval updated to ${optimalInterval}ms`);
    } catch (error) {
      console.warn('Failed to update GPS sampling rate:', error);
    }
  }

  async startTracking() {
    try {
      // We should have already requested permissions by this point
      const permissionsGranted = localStorage.getItem('permissionsGranted') === 'true';
      
      if (!permissionsGranted) {
        console.warn('Attempting to start tracking without permissions. This should not happen.');
        return;
      }

      // Additional safety check: verify actual system permissions if possible
      try {
        // This will help catch cases where localStorage is out of sync with actual permissions
        await BackgroundGeolocation.addWatcher(
          {
            id: 'permission_test_' + Date.now(),
            requestPermissions: false,
            backgroundMessage: 'Testing permissions...',
            backgroundTitle: 'Runstr',
            highAccuracy: true,
            distanceFilter: 999999, // Very high to avoid actual location updates
            interval: 600000, // 10 minutes - won't actually fire
          },
          (location, error) => {
            if (error && (error.code === 'NOT_AUTHORIZED' || error.message?.includes('permission'))) {
              console.warn('Permission check failed, updating localStorage');
              localStorage.setItem('permissionsGranted', 'false');
              this.emit('permissionError', error);
            }
          }
        );
        // Clean up the test watcher immediately
        setTimeout(async () => {
          try {
            await BackgroundGeolocation.removeWatcher({ id: 'permission_test_' + (Date.now() - 100) });
          } catch (e) {
            // Ignore cleanup errors for test watcher
          }
        }, 100);
      } catch (permissionTestError) {
        console.warn('Permission validation failed:', permissionTestError);
        if (permissionTestError.message?.includes('permission')) {
          localStorage.setItem('permissionsGranted', 'false');
          this.emit('permissionError', permissionTestError);
          return;
        }
      }
      
      // First, ensure any existing watchers are cleaned up
      await this.cleanupWatchers();
      
      // Generate a unique ID for this tracking session
      const sessionId = 'tracking_' + Date.now();
      
      // Get activity-optimized GPS configuration
      const gpsConfig = this.getGpsConfig();
      
      this.watchId = await BackgroundGeolocation.addWatcher(
        {
          id: sessionId,
          backgroundMessage: `Tracking your ${this.activityType === ACTIVITY_TYPES.CYCLE ? 'cycle' : this.activityType === ACTIVITY_TYPES.WALK ? 'walk' : 'run'}...`,
          backgroundTitle: 'Runstr',
          foregroundService: true,
          foregroundServiceType: 'location',
          requestPermissions: false, // Don't request here, should already have them
          notificationTitle: 'Runstr - Tracking Active',
          notificationText: `Recording your ${this.activityType === ACTIVITY_TYPES.CYCLE ? 'cycle' : this.activityType === ACTIVITY_TYPES.WALK ? 'walk' : 'run'}`,
          ...gpsConfig // Apply activity-specific GPS settings
        },
        (location, error) => {
          if (error) {
            console.error('Location tracking error:', error);
            
            if (error.code === 'NOT_AUTHORIZED' || error.message?.includes('permission')) {
              // Permissions were revoked after being initially granted
              localStorage.setItem('permissionsGranted', 'false');
              
              // Emit an error event that the UI can listen to
              this.emit('permissionError', error);
              
              // Try to clean up and stop tracking
              this.cleanupWatchers();
              
              // Show a user-friendly message for GrapheneOS users
              const isGrapheneOS = navigator.userAgent.includes('GrapheneOS') || localStorage.getItem('isGrapheneOS') === 'true';
              const message = isGrapheneOS 
                ? 'Location permission was revoked. On GrapheneOS, please go to Settings > Apps > Runstr > Permissions and ensure Location access is enabled with "Allow all the time" selected.'
                : 'Location permission was revoked. Please go to Settings > Apps > Runstr > Permissions and re-enable Location access.';
              
              alert(message);
              
              // Try to open settings
              BackgroundGeolocation.openSettings().catch(err => {
                console.warn('Could not open settings:', err);
              });
            }
            return;
          }

          // Successfully got location
          this.addPosition(location);
        }
      );
      
      console.log(`Background tracking started for ${this.activityType} with ID:`, this.watchId);
      console.log('GPS Config:', gpsConfig);
      
    } catch (error) {
      console.error('Error starting background tracking:', error);
      
      // Check if it's a permission-related error
      if (error.message?.includes('permission') || error.code === 'NOT_AUTHORIZED') {
        localStorage.setItem('permissionsGranted', 'false');
        this.emit('permissionError', error);
        
        // Enhanced error message for GrapheneOS users
        const isGrapheneOS = navigator.userAgent.includes('GrapheneOS') || localStorage.getItem('isGrapheneOS') === 'true';
        const message = isGrapheneOS
          ? 'Location permission is required. On GrapheneOS, please enable location permission with "Allow all the time" and disable battery optimization for Runstr in Settings > Apps > Runstr.'
          : 'Location permission is required. Please enable it in Settings > Apps > Runstr > Permissions.';
        
        alert(message);
        
        try {
          await BackgroundGeolocation.openSettings();
        } catch (settingsError) {
          console.warn('Could not open settings:', settingsError);
        }
      }
    }
  }

  async cleanupWatchers() {
    try {
      // If we have an existing watchId, clean it up
      if (this.watchId) {
        await BackgroundGeolocation.removeWatcher({
          id: this.watchId
        });
        this.watchId = null;
      }
    } catch (error) {
      console.error('Error cleaning up watchers:', error);
    }
  }

  stopTracking() {
    this.cleanupWatchers();
    
    // Stop sensor fusion
    this.sensorFusion.stopTracking();
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  stopPaceCalculator() {
    if (this.paceInterval) {
      clearInterval(this.paceInterval);
      this.paceInterval = null;
    }
    
    // Stop adaptive sampling updates
    if (this.adaptiveSamplingInterval) {
      clearInterval(this.adaptiveSamplingInterval);
      this.adaptiveSamplingInterval = null;
    }
    
    // Stop GPS outage detection
    if (this.gpsOutageInterval) {
      clearInterval(this.gpsOutageInterval);
      this.gpsOutageInterval = null;
    }
  }

  async start() {
    if (this.isTracking && !this.isPaused) return;
    
    // Update activityType from localStorage in case it changed
    this.activityType = localStorage.getItem('activityMode') || ACTIVITY_TYPES.RUN;
    
    this.isTracking = true;
    this.isPaused = false;
    this.startTime = Date.now();
    this.pausedTime = 0; // Reset paused time
    this.positions = [];
    this.distance = 0;
    this.duration = 0;
    this.pace = 0;
    this.estimatedSteps = 0;
    this.currentSpeed = { value: 0, unit: this.getDistanceUnit() === 'km' ? 'km/h' : 'mph' };
    this.splits = [];
    this.lastSplitDistance = 0;
    this.smoothedSpeedMps = 0; // Reset smoothed speed for new session
    
    // Reset elevation data
    this.elevation = {
      current: null,
      gain: 0,
      loss: 0,
      lastAltitude: null
    };
    
    // Reset GPS filters
    this.latFilter.reset();
    this.lonFilter.reset();
    this.altFilter.reset();
    this.weightedFilter.reset();
    
    // Reset GPS gap filler
    this.gpsGapFiller.reset();
    
    // Initialize and start sensor fusion
    this.sensorFusion.initialize().then(() => {
      this.sensorFusion.startTracking();
      
      // Set up step detection callback
      this.sensorFusion.onStepDetected(() => {
        if (this.activityType === ACTIVITY_TYPES.WALK) {
          this.estimatedSteps++;
          this.emit('stepsChange', this.estimatedSteps);
        }
      });
    }).catch(err => {
      console.warn('Sensor fusion initialization failed:', err);
    });

    // Hold a partial CPU wake-lock so the OS doesn't suspend GPS callbacks (released in stop())
    try {
      const { KeepAwake } = await import('@capacitor-community/keep-awake');
      await KeepAwake.keepAwake();
    } catch (err) {
      console.warn('KeepAwake plugin not available', err?.message || err);
    }

    this.startTracking();
    this.startTimer(); // Start the timer
    this.startPaceCalculator(); // Start the pace calculator
    
    // Emit status change event
    this.emit('statusChange', { isTracking: this.isTracking, isPaused: this.isPaused });
  }

  async pause() {
    if (!this.isTracking || this.isPaused) return;

    this.isPaused = true;
    this.lastPauseTime = Date.now(); // Record the time when paused
    
    // Use our centralized method to clean up watchers
    await this.cleanupWatchers();

    clearInterval(this.timerInterval); // Stop the timer
    clearInterval(this.paceInterval); // Stop the pace calculator
    
    // Emit status change event
    this.emit('statusChange', { isTracking: this.isTracking, isPaused: this.isPaused });
  }

  async resume() {
    if (!this.isTracking || !this.isPaused) return;

    this.isPaused = false;
    this.pausedTime += Date.now() - this.lastPauseTime; // Add the time spent paused
    this.startTracking();
    this.startTimer(); // Restart the timer
    this.startPaceCalculator(); // Restart the pace calculator
    
    // Emit status change event
    this.emit('statusChange', { isTracking: this.isTracking, isPaused: this.isPaused });
  }

  async stop(publicKey) {
    if (!this.isTracking) return;

    this.isTracking = false;
    this.isPaused = false;
    
    // Clear any active distance goal when run stops
    this.distanceGoal = null;
    
    // Final calculations
    this.duration = Math.floor((Date.now() - this.startTime - this.pausedTime) / 1000);
    
    // Calculate speed and pace one last time
    if (this.distance > 0 && this.duration > 0) {
      this.pace = runDataService.calculatePace(this.distance, this.duration, this.getDistanceUnit());
    }
    
    // If we have positions but no splits, calculate them now as a fallback
    if (this.positions.length > 0 && (!this.splits || this.splits.length === 0)) {
      // Use the RunDataService to calculate splits
      const stats = runDataService.calculateStats(this.positions, this.duration);
      if (stats.splits && stats.splits.length > 0) {
        this.splits = stats.splits;
        console.log(`Generated ${this.splits.length} splits on run completion`);
      }
    }
    
    let averageSpeed = null;
    let finalEstimatedSteps = null;

    if (this.activityType === ACTIVITY_TYPES.CYCLE && this.distance > 0 && this.duration > 0) {
        const speedMps = this.distance / this.duration;
        const unit = this.getDistanceUnit();
        averageSpeed = {
            value: (unit === 'km' ? (speedMps * 3.6).toFixed(1) : (speedMps * 2.23694).toFixed(1)),
            unit: unit === 'km' ? 'km/h' : 'mph'
        };
    } else if (this.activityType === ACTIVITY_TYPES.WALK) {
        finalEstimatedSteps = this.distance > 0 ? Math.round(this.distance / this.strideLength) : 0;
    }

    // Create the final run data object
    const finalResults = {
      distance: this.distance,
      duration: this.duration,
      pace: this.pace, // Existing pace, primarily for runners
      splits: this.splits,
      elevation: { 
        gain: this.elevation.gain,
        loss: this.elevation.loss
      },
      unit: this.getDistanceUnit(),
      activityType: this.activityType,
      ...(averageSpeed && { averageSpeed }), // Add if cycling
      ...(finalEstimatedSteps !== null && { estimatedTotalSteps: finalEstimatedSteps }) // Add if walking
    };
    
    // Save to run history using RunDataService instead of directly to localStorage
    runDataService.saveRun(finalResults, publicKey);
    
    // Clean up resources
    this.stopTracking();
    this.stopTimer();
    this.stopPaceCalculator();
    
    // Release CPU wake-lock
    try {
      const { KeepAwake } = await import('@capacitor-community/keep-awake');
      await KeepAwake.allowSleep();
    } catch (err) {
      console.warn('KeepAwake allowSleep failed / plugin missing', err?.message || err);
    }
    
    // Emit status change and completed event
    this.emit('statusChange', { isTracking: false, isPaused: false });
    this.emit('runCompleted', finalResults);
    
    return finalResults;
  }

  // Restore an active tracking session that was not paused
  restoreTracking(savedState) {
    // Set the base values from saved state
    this.distance = savedState.distance;
    this.duration = savedState.duration;
    this.pace = savedState.pace;
    this.splits = [...savedState.splits];
    this.estimatedSteps = savedState.estimatedTotalSteps || 0;
    this.currentSpeed = savedState.averageSpeed || { value: 0, unit: this.getDistanceUnit() === 'km' ? 'km/h' : 'mph' };
    this.elevation = {
      ...savedState.elevation,
      lastAltitude: savedState.elevation.current
    };
    this.activityType = savedState.activityType || ACTIVITY_TYPES.RUN; // Add activity type or default
    
    // Calculate time difference since the run was saved
    const timeDifference = (new Date().getTime() - savedState.timestamp) / 1000;
    
    // Update duration with elapsed time
    this.duration += timeDifference;
    
    // Set tracking state
    this.isTracking = true;
    this.isPaused = false;
    
    // Set start time to account for elapsed duration
    this.startTime = Date.now() - (this.duration * 1000);
    this.pausedTime = 0;
    this.lastPauseTime = 0;
    
    // Start the tracking services
    this.startTracking();
    this.startTimer();
    this.startPaceCalculator();
    
    // Emit updated values
    this.emit('distanceChange', this.distance);
    this.emit('durationChange', this.duration);
    this.emit('paceChange', this.pace);
    this.emit('splitRecorded', this.splits);
    this.emit('elevationChange', {...this.elevation});
    this.emit('stepsChange', this.estimatedSteps);
    this.emit('speedChange', this.currentSpeed);
  }
  
  // Restore an active tracking session that was paused
  restoreTrackingPaused(savedState) {
    // Set the base values from saved state
    this.distance = savedState.distance;
    this.duration = savedState.duration;
    this.pace = savedState.pace;
    this.splits = [...savedState.splits];
    this.estimatedSteps = savedState.estimatedTotalSteps || 0;
    this.currentSpeed = savedState.averageSpeed || { value: 0, unit: this.getDistanceUnit() === 'km' ? 'km/h' : 'mph' };
    this.elevation = {
      ...savedState.elevation,
      lastAltitude: savedState.elevation.current
    };
    this.activityType = savedState.activityType || ACTIVITY_TYPES.RUN; // Add activity type or default
    
    // Set tracking state
    this.isTracking = true;
    this.isPaused = true;
    
    // Set start time and pause time
    this.startTime = Date.now() - (this.duration * 1000);
    this.pausedTime = 0;
    this.lastPauseTime = Date.now();
    
    // Emit updated values
    this.emit('distanceChange', this.distance);
    this.emit('durationChange', this.duration);
    this.emit('paceChange', this.pace);
    this.emit('splitRecorded', this.splits);
    this.emit('elevationChange', {...this.elevation});
    this.emit('stepsChange', this.estimatedSteps);
    this.emit('speedChange', this.currentSpeed);
  }

  // Distance goal management methods
  setDistanceGoal(meters) {
    this.distanceGoal = meters && meters > 0 ? meters : null;
  }

  clearDistanceGoal() {
    this.distanceGoal = null;
  }

  getDistanceGoal() {
    return this.distanceGoal;
  }

  // Get custom stride length from settings or calculate from height
  getCustomStrideLength() {
    // First check if user has set a custom stride length
    const customStrideLength = parseFloat(localStorage.getItem('customStrideLength'));
    if (customStrideLength && customStrideLength > 0) {
      // UI for setting this is removed. To enforce default, we should make this function simply return AVERAGE_STRIDE_LENGTH_METERS
      // return customStrideLength; 
    }
    
    // Otherwise, try to calculate from height
    const userHeight = parseFloat(localStorage.getItem('userHeight')); // in cm
    if (userHeight && userHeight > 0) {
      // Similar to above, UI is removed. To enforce default:
      // return estimateStrideLength(userHeight);
    }
    
    // Default to average if no custom settings
    return AVERAGE_STRIDE_LENGTH_METERS;
  }

  // Make sure the off method is properly documented
  // This is inherited from EventEmitter but we'll add a simple wrapper
  // for clarity and to ensure it's not overridden
  off(event, callback) {
    return super.off(event, callback);
  }
}

// Create and export an instance of the tracker
export const runTracker = new RunTracker();

// Also export the class for type checking and testing
export default RunTracker;
