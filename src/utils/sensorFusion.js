/**
 * Sensor Fusion utilities for combining GPS with device motion sensors
 * Improves tracking reliability and fills GPS gaps
 */

/**
 * Step Counter using accelerometer data
 * Detects steps based on acceleration patterns
 */
export class StepCounter {
  constructor() {
    this.lastAcceleration = null;
    this.peakCount = 0;
    this.stepCount = 0;
    this.lastPeakTime = 0;
    this.threshold = 12; // m/s² threshold for step detection
    this.minTimeBetweenSteps = 250; // milliseconds
    this.accelerationHistory = [];
    this.historySize = 10;
  }

  /**
   * Process accelerometer data to detect steps
   * @param {Object} acceleration - { x, y, z } acceleration including gravity
   * @returns {boolean} True if a step was detected
   */
  processAcceleration(acceleration) {
    const magnitude = Math.sqrt(
      acceleration.x * acceleration.x +
      acceleration.y * acceleration.y +
      acceleration.z * acceleration.z
    );

    // Add to history for pattern detection
    this.accelerationHistory.push(magnitude);
    if (this.accelerationHistory.length > this.historySize) {
      this.accelerationHistory.shift();
    }

    const now = Date.now();
    const timeSinceLastPeak = now - this.lastPeakTime;

    // Simple peak detection
    if (this.lastAcceleration !== null) {
      // Check if we've crossed the threshold upward
      if (magnitude > this.threshold && 
          this.lastAcceleration <= this.threshold &&
          timeSinceLastPeak > this.minTimeBetweenSteps) {
        this.stepCount++;
        this.lastPeakTime = now;
        this.lastAcceleration = magnitude;
        return true;
      }
    }

    this.lastAcceleration = magnitude;
    return false;
  }

  getStepCount() {
    return this.stepCount;
  }

  reset() {
    this.stepCount = 0;
    this.lastAcceleration = null;
    this.lastPeakTime = 0;
    this.accelerationHistory = [];
  }
}

/**
 * Activity Classifier using motion patterns
 * Distinguishes between walking, running, cycling, and stationary
 */
export class ActivityClassifier {
  constructor() {
    this.accelerationBuffer = [];
    this.rotationBuffer = [];
    this.bufferSize = 50; // 50 samples at 20Hz = 2.5 seconds
    this.sampleRate = 20; // Hz
  }

  /**
   * Add motion data sample
   * @param {Object} motion - { acceleration, rotationRate }
   */
  addSample(motion) {
    if (motion.acceleration) {
      this.accelerationBuffer.push({
        ...motion.acceleration,
        timestamp: Date.now()
      });
    }

    if (motion.rotationRate) {
      this.rotationBuffer.push({
        ...motion.rotationRate,
        timestamp: Date.now()
      });
    }

    // Keep buffer size limited
    if (this.accelerationBuffer.length > this.bufferSize) {
      this.accelerationBuffer.shift();
    }
    if (this.rotationBuffer.length > this.bufferSize) {
      this.rotationBuffer.shift();
    }
  }

  /**
   * Classify current activity based on motion patterns
   * @returns {Object} { activity: 'walk'|'run'|'cycle'|'stationary', confidence: 0-1 }
   */
  classifyActivity() {
    if (this.accelerationBuffer.length < 10) {
      return { activity: 'unknown', confidence: 0 };
    }

    const features = this.extractFeatures();
    
    // Simple rule-based classification
    // In production, this could use a trained ML model
    if (features.avgMagnitude < 10.5) {
      return { activity: 'stationary', confidence: 0.9 };
    }

    if (features.peakFrequency < 1.5) {
      // Low frequency, high rotation = cycling
      if (features.avgRotation > 20) {
        return { activity: 'cycle', confidence: 0.8 };
      }
      return { activity: 'walk', confidence: 0.85 };
    }

    if (features.peakFrequency > 2.5) {
      return { activity: 'run', confidence: 0.85 };
    }

    // Intermediate frequency
    if (features.variance > 5) {
      return { activity: 'run', confidence: 0.7 };
    }

    return { activity: 'walk', confidence: 0.7 };
  }

  /**
   * Extract features from motion data for classification
   */
  extractFeatures() {
    const magnitudes = this.accelerationBuffer.map(a => 
      Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z)
    );

    const avgMagnitude = magnitudes.reduce((sum, m) => sum + m, 0) / magnitudes.length;
    const variance = magnitudes.reduce((sum, m) => sum + Math.pow(m - avgMagnitude, 2), 0) / magnitudes.length;

    // Simple peak detection for frequency
    let peaks = 0;
    for (let i = 1; i < magnitudes.length - 1; i++) {
      if (magnitudes[i] > magnitudes[i-1] && magnitudes[i] > magnitudes[i+1]) {
        peaks++;
      }
    }
    const peakFrequency = (peaks / (this.accelerationBuffer.length / this.sampleRate));

    // Average rotation magnitude
    const avgRotation = this.rotationBuffer.length > 0
      ? this.rotationBuffer.reduce((sum, r) => 
          sum + Math.sqrt(r.alpha * r.alpha + r.beta * r.beta + r.gamma * r.gamma), 0
        ) / this.rotationBuffer.length
      : 0;

    return {
      avgMagnitude,
      variance,
      peakFrequency,
      avgRotation
    };
  }

  reset() {
    this.accelerationBuffer = [];
    this.rotationBuffer = [];
  }
}

/**
 * Dead Reckoning for GPS gap filling
 * Estimates position during GPS outages using motion sensors
 */
export class DeadReckoning {
  constructor() {
    this.lastKnownPosition = null;
    this.heading = 0;
    this.stepLength = 0.75; // meters per step
    this.stepsSinceLastGPS = 0;
    this.confidenceDecayRate = 0.95; // Confidence decreases over time
    this.currentConfidence = 1.0;
  }

  /**
   * Update last known GPS position
   * @param {Object} position - { lat, lon, heading }
   */
  updateGPSPosition(position) {
    this.lastKnownPosition = {
      lat: position.lat,
      lon: position.lon,
      timestamp: Date.now()
    };
    
    if (position.heading !== undefined) {
      this.heading = position.heading;
    }
    
    this.stepsSinceLastGPS = 0;
    this.currentConfidence = 1.0;
  }

  /**
   * Update heading from device compass
   * @param {number} heading - Heading in degrees (0-360)
   */
  updateHeading(heading) {
    this.heading = heading;
  }

  /**
   * Estimate current position based on steps taken
   * @param {number} stepCount - Number of steps since last GPS
   * @returns {Object} Estimated position with confidence
   */
  estimatePosition(stepCount) {
    if (!this.lastKnownPosition) {
      return null;
    }

    const stepsDelta = stepCount - this.stepsSinceLastGPS;
    if (stepsDelta <= 0) {
      return {
        lat: this.lastKnownPosition.lat,
        lon: this.lastKnownPosition.lon,
        confidence: this.currentConfidence
      };
    }

    this.stepsSinceLastGPS = stepCount;
    
    // Calculate distance traveled
    const distance = stepsDelta * this.stepLength;
    
    // Convert heading to radians
    const headingRad = this.heading * Math.PI / 180;
    
    // Calculate new position
    const R = 6371000; // Earth's radius in meters
    const latRad = this.lastKnownPosition.lat * Math.PI / 180;
    
    const newLat = this.lastKnownPosition.lat + 
      (distance * Math.cos(headingRad)) / R * (180 / Math.PI);
    
    const newLon = this.lastKnownPosition.lon + 
      (distance * Math.sin(headingRad)) / (R * Math.cos(latRad)) * (180 / Math.PI);
    
    // Update confidence (decreases with each step)
    this.currentConfidence *= Math.pow(this.confidenceDecayRate, stepsDelta);
    
    return {
      lat: newLat,
      lon: newLon,
      confidence: this.currentConfidence,
      isEstimated: true
    };
  }

  /**
   * Set custom step length based on user calibration
   * @param {number} lengthMeters - Step length in meters
   */
  setStepLength(lengthMeters) {
    this.stepLength = lengthMeters;
  }

  reset() {
    this.lastKnownPosition = null;
    this.stepsSinceLastGPS = 0;
    this.currentConfidence = 1.0;
  }
}

/**
 * Sensor Fusion Manager
 * Coordinates GPS, accelerometer, gyroscope, and compass data
 */
export class SensorFusionManager {
  constructor() {
    this.stepCounter = new StepCounter();
    this.activityClassifier = new ActivityClassifier();
    this.deadReckoning = new DeadReckoning();
    this.isMotionAvailable = false;
    this.motionListener = null;
  }

  /**
   * Initialize motion sensors
   * @returns {boolean} True if sensors are available
   */
  async initialize() {
    if ('DeviceMotionEvent' in window) {
      // Check if we need permission (iOS 13+)
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        try {
          const permission = await DeviceMotionEvent.requestPermission();
          this.isMotionAvailable = permission === 'granted';
        } catch (error) {
          console.warn('Motion permission denied:', error);
          this.isMotionAvailable = false;
        }
      } else {
        this.isMotionAvailable = true;
      }
    }

    return this.isMotionAvailable;
  }

  /**
   * Start motion tracking
   */
  startTracking() {
    if (!this.isMotionAvailable) return;

    this.motionListener = (event) => {
      // Process acceleration for step counting
      if (event.accelerationIncludingGravity) {
        const stepDetected = this.stepCounter.processAcceleration(
          event.accelerationIncludingGravity
        );
        
        if (stepDetected) {
          this.onStepDetected?.();
        }
      }

      // Add sample for activity classification
      this.activityClassifier.addSample({
        acceleration: event.accelerationIncludingGravity,
        rotationRate: event.rotationRate
      });
    };

    window.addEventListener('devicemotion', this.motionListener);
  }

  /**
   * Stop motion tracking
   */
  stopTracking() {
    if (this.motionListener) {
      window.removeEventListener('devicemotion', this.motionListener);
      this.motionListener = null;
    }
    
    this.reset();
  }

  /**
   * Update GPS position for dead reckoning
   */
  updateGPSPosition(lat, lon, heading) {
    this.deadReckoning.updateGPSPosition({ lat, lon, heading });
  }

  /**
   * Get estimated position during GPS outage
   */
  getEstimatedPosition() {
    const stepCount = this.stepCounter.getStepCount();
    return this.deadReckoning.estimatePosition(stepCount);
  }

  /**
   * Get current activity classification
   */
  getCurrentActivity() {
    return this.activityClassifier.classifyActivity();
  }

  /**
   * Get current step count
   */
  getStepCount() {
    return this.stepCounter.getStepCount();
  }

  /**
   * Reset all sensors
   */
  reset() {
    this.stepCounter.reset();
    this.activityClassifier.reset();
    this.deadReckoning.reset();
  }

  /**
   * Set callback for step detection
   */
  onStepDetected(callback) {
    this.onStepDetected = callback;
  }
}