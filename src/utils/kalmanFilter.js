/**
 * Advanced Kalman filter implementation for GPS tracking
 * Supports 1D and 2D filtering with adaptive parameters
 * Based on cutting-edge PWA GPS tracking techniques
 */

/**
 * 1D Kalman Filter for single-dimension filtering (lat/lon/alt)
 * Lightweight implementation perfect for PWAs
 */
export class KalmanFilter1D {
  constructor(options = {}) {
    // Process noise covariance - how much we trust the process model
    this.Q = options.Q || 3; // Higher = trust measurements more
    // Measurement noise covariance - how much we trust measurements
    this.R = options.R || 0.01; // Lower = trust measurements more
    
    // Initial values
    this.x = null; // State estimate
    this.P = 1; // Estimation error covariance
    this.K = 0; // Kalman gain
  }

  /**
   * Filter a new measurement
   * @param {number} measurement - The measured value
   * @returns {number} The filtered value
   */
  filter(measurement) {
    // Initialize on first measurement
    if (this.x === null) {
      this.x = measurement;
      return measurement;
    }

    // Prediction step
    const x_pred = this.x;
    const P_pred = this.P + this.Q;

    // Update step
    // Calculate Kalman gain
    this.K = P_pred / (P_pred + this.R);
    
    // Update state estimate
    this.x = x_pred + this.K * (measurement - x_pred);
    
    // Update error covariance
    this.P = (1 - this.K) * P_pred;

    return this.x;
  }

  // Adjust filter parameters based on GPS accuracy
  adjustParameters(accuracy) {
    // Higher accuracy = lower measurement noise
    // Accuracy is in meters, typical range 5-50m
    this.R = Math.max(0.001, accuracy / 20);
  }

  reset() {
    this.x = null;
    this.P = 1;
    this.K = 0;
  }
}

/**
 * Original KalmanFilter class for backward compatibility
 * Enhanced with new features from KalmanFilter1D
 */
export class KalmanFilter {
  constructor() {
    // Use separate 1D filters for lat/lon
    this.latFilter = new KalmanFilter1D({ Q: 3, R: 0.01 });
    this.lonFilter = new KalmanFilter1D({ Q: 3, R: 0.01 });
    
    // State estimate for compatibility
    this.lat = 0;
    this.lng = 0;
    this.variance = 100; // Initial estimate of position variance
    this.lastTimestamp = 0;
    this.lastSpeed = 0;
    this.speedVariance = 1; // Initial speed variance

    // Kalman filter parameters - optimized for running
    this.Q = 0.0001; // Process noise - base value
    this.R_scale = 0.025; // Measurement noise scale
    this.maxSpeed = 18; // Maximum expected speed in m/s (~65 km/h) - increased for cycling
    this.maxAcceleration = 2.5; // Maximum expected acceleration in m/s²
    this.minVariance = 10; // Minimum position variance
  }

  /**
   * Update the filter with a new measurement
   * Enhanced to use 1D Kalman filters with adaptive parameters
   */
  update(lat, lng, accuracy, timestamp = Date.now()) {
    // Input validation
    if (
      typeof lat !== 'number' ||
      typeof lng !== 'number' ||
      typeof accuracy !== 'number'
    ) {
      console.warn('Invalid input to Kalman filter');
      return { lat, lng, accuracy };
    }

    // Initialize filter with first measurement
    if (this.lat === 0 && this.lng === 0) {
      this.lat = lat;
      this.lng = lng;
      this.variance = Math.max(accuracy * accuracy, this.minVariance);
      this.lastTimestamp = timestamp;
      return { lat, lng, accuracy };
    }

    // Adjust Kalman filter parameters based on GPS accuracy
    this.latFilter.adjustParameters(accuracy);
    this.lonFilter.adjustParameters(accuracy);

    // Calculate time difference
    const timeDiff = Math.max((timestamp - this.lastTimestamp) / 1000, 0.001);

    // Calculate current speed and distance
    const distance = this.calculateDistance(lat, lng);
    const currentSpeed = distance / timeDiff;

    // Check for reasonable acceleration
    const acceleration = Math.abs(currentSpeed - this.lastSpeed) / timeDiff;
    const isReasonableAcceleration = acceleration <= this.maxAcceleration;

    // Adjust process noise based on movement patterns
    if (currentSpeed < 0.5) {
      // Stationary - trust model more
      this.latFilter.Q = 0.1;
      this.lonFilter.Q = 0.1;
    } else if (currentSpeed > 10) {
      // Fast movement (cycling) - moderate trust
      this.latFilter.Q = 3;
      this.lonFilter.Q = 3;
    } else {
      // Normal movement - default settings
      this.latFilter.Q = 1;
      this.lonFilter.Q = 1;
    }

    // Apply Kalman filtering to lat/lon
    const filteredLat = this.latFilter.filter(lat);
    const filteredLon = this.lonFilter.filter(lng);

    // Velocity-based jump detection
    const filteredDistance = this.calculateDistanceToPoint(filteredLat, filteredLon);
    const filteredSpeed = filteredDistance / timeDiff;
    
    // If we detect a GPS jump (unrealistic speed), reject the update
    if (filteredSpeed > this.maxSpeed && !isReasonableAcceleration) {
      console.warn(`GPS jump detected: ${filteredSpeed.toFixed(2)} m/s`);
      // Return previous position
      return {
        lat: this.lat,
        lng: this.lng,
        accuracy: Math.sqrt(this.variance)
      };
    }

    // Update state with filtered values
    this.lat = filteredLat;
    this.lng = filteredLon;
    
    // Update variance based on Kalman filter state
    this.variance = Math.max(
      (this.latFilter.P + this.lonFilter.P) / 2 * accuracy * accuracy,
      this.minVariance
    );
    
    this.lastTimestamp = timestamp;
    this.lastSpeed = isReasonableAcceleration ? currentSpeed : this.lastSpeed;

    return {
      lat: this.lat,
      lng: this.lng,
      accuracy: Math.sqrt(this.variance)
    };
  }

  /**
   * Calculate maximum allowed distance based on speed and acceleration
   */
  calculateMaxDistance(timeDiff) {
    const maxSpeedIncrease = this.maxAcceleration * timeDiff;
    const maxPossibleSpeed = Math.min(
      this.maxSpeed,
      this.lastSpeed + maxSpeedIncrease
    );

    return Math.min(
      this.maxSpeed * timeDiff,
      (this.lastSpeed + maxPossibleSpeed) * 0.5 * timeDiff
    );
  }

  /**
   * Calculate distance to a new point in meters
   */
  calculateDistance(lat2, lng2) {
    const R = 6371000; // Earth's radius in meters
    const φ1 = (this.lat * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - this.lat) * Math.PI) / 180;
    const Δλ = ((lng2 - this.lng) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Calculate distance to a specific point in meters
   */
  calculateDistanceToPoint(lat2, lng2) {
    const R = 6371000; // Earth's radius in meters
    const φ1 = (this.lat * Math.PI) / 180;
    const φ2 = (lat2 * Math.PI) / 180;
    const Δφ = ((lat2 - this.lat) * Math.PI) / 180;
    const Δλ = ((lng2 - this.lng) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Reset the filter
   */
  reset() {
    this.latFilter.reset();
    this.lonFilter.reset();
    this.lat = 0;
    this.lng = 0;
    this.variance = 100;
    this.lastTimestamp = 0;
    this.lastSpeed = 0;
    this.speedVariance = 1;
  }
}

/**
 * Weighted average GPS filter based on accuracy values
 * Alternative to Kalman filtering for simpler use cases
 */
export class WeightedGPSFilter {
  constructor(windowSize = 5) {
    this.windowSize = windowSize;
    this.readings = [];
  }

  /**
   * Add a GPS reading and return weighted average position
   * @param {Object} reading - { lat, lon, accuracy, timestamp }
   * @returns {Object} Weighted average position
   */
  addReading(reading) {
    this.readings.push(reading);
    
    // Keep only recent readings
    if (this.readings.length > this.windowSize) {
      this.readings.shift();
    }

    return this.getWeightedAverage();
  }

  /**
   * Calculate weighted average based on accuracy
   * More accurate readings get higher weight
   */
  getWeightedAverage() {
    if (this.readings.length === 0) return null;
    
    let totalWeight = 0;
    let weightedLat = 0;
    let weightedLon = 0;
    
    this.readings.forEach(reading => {
      // Weight is inverse of accuracy squared
      const weight = 1 / (reading.accuracy * reading.accuracy);
      weightedLat += reading.lat * weight;
      weightedLon += reading.lon * weight;
      totalWeight += weight;
    });
    
    return {
      lat: weightedLat / totalWeight,
      lon: weightedLon / totalWeight,
      accuracy: this.getAverageAccuracy()
    };
  }

  getAverageAccuracy() {
    if (this.readings.length === 0) return 0;
    const sum = this.readings.reduce((acc, r) => acc + r.accuracy, 0);
    return sum / this.readings.length;
  }

  reset() {
    this.readings = [];
  }
}
