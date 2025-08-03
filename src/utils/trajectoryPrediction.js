/**
 * Trajectory Prediction for GPS gap filling
 * Implements simple machine learning-like patterns for movement prediction
 */

/**
 * Simple Linear Regression for trajectory prediction
 */
class LinearRegression {
  constructor() {
    this.slope = 0;
    this.intercept = 0;
    this.trained = false;
  }

  /**
   * Train the model with position data
   * @param {Array} data - Array of {x: time, y: value} points
   */
  train(data) {
    if (data.length < 2) return;

    const n = data.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

    for (const point of data) {
      sumX += point.x;
      sumY += point.y;
      sumXY += point.x * point.y;
      sumXX += point.x * point.x;
    }

    this.slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    this.intercept = (sumY - this.slope * sumX) / n;
    this.trained = true;
  }

  /**
   * Predict value at given time
   * @param {number} x - Time or input value
   * @returns {number} Predicted value
   */
  predict(x) {
    if (!this.trained) return null;
    return this.slope * x + this.intercept;
  }
}

/**
 * Movement Pattern Analyzer
 * Analyzes GPS history to understand movement patterns
 */
export class MovementPatternAnalyzer {
  constructor(historySize = 20) {
    this.historySize = historySize;
    this.positionHistory = [];
    this.velocityHistory = [];
    this.accelerationHistory = [];
    
    // Regression models for lat/lon prediction
    this.latModel = new LinearRegression();
    this.lonModel = new LinearRegression();
    this.speedModel = new LinearRegression();
    this.headingModel = new LinearRegression();
  }

  /**
   * Add GPS position to history and update models
   * @param {Object} position - { lat, lon, timestamp, speed, heading }
   */
  addPosition(position) {
    this.positionHistory.push(position);
    
    // Keep history size limited
    if (this.positionHistory.length > this.historySize) {
      this.positionHistory.shift();
    }

    // Calculate velocity and acceleration
    this.updateVelocityAndAcceleration();
    
    // Retrain models with new data
    this.trainModels();
  }

  /**
   * Update velocity and acceleration based on position history
   */
  updateVelocityAndAcceleration() {
    if (this.positionHistory.length < 2) return;

    const current = this.positionHistory[this.positionHistory.length - 1];
    const previous = this.positionHistory[this.positionHistory.length - 2];
    
    const dt = (current.timestamp - previous.timestamp) / 1000; // seconds
    if (dt <= 0) return;

    // Calculate velocity
    const latVel = (current.lat - previous.lat) / dt;
    const lonVel = (current.lon - previous.lon) / dt;
    
    const velocity = {
      lat: latVel,
      lon: lonVel,
      timestamp: current.timestamp
    };
    
    this.velocityHistory.push(velocity);
    if (this.velocityHistory.length > this.historySize) {
      this.velocityHistory.shift();
    }

    // Calculate acceleration
    if (this.velocityHistory.length >= 2) {
      const currVel = this.velocityHistory[this.velocityHistory.length - 1];
      const prevVel = this.velocityHistory[this.velocityHistory.length - 2];
      
      const accDt = (currVel.timestamp - prevVel.timestamp) / 1000;
      if (accDt > 0) {
        const acceleration = {
          lat: (currVel.lat - prevVel.lat) / accDt,
          lon: (currVel.lon - prevVel.lon) / accDt,
          timestamp: currVel.timestamp
        };
        
        this.accelerationHistory.push(acceleration);
        if (this.accelerationHistory.length > this.historySize) {
          this.accelerationHistory.shift();
        }
      }
    }
  }

  /**
   * Train regression models with current data
   */
  trainModels() {
    if (this.positionHistory.length < 3) return;

    // Prepare training data
    const latData = [];
    const lonData = [];
    const speedData = [];
    const headingData = [];
    
    const baseTime = this.positionHistory[0].timestamp;
    
    for (const pos of this.positionHistory) {
      const relativeTime = (pos.timestamp - baseTime) / 1000; // seconds
      
      latData.push({ x: relativeTime, y: pos.lat });
      lonData.push({ x: relativeTime, y: pos.lon });
      
      if (pos.speed !== undefined) {
        speedData.push({ x: relativeTime, y: pos.speed });
      }
      
      if (pos.heading !== undefined) {
        headingData.push({ x: relativeTime, y: pos.heading });
      }
    }

    // Train models
    this.latModel.train(latData);
    this.lonModel.train(lonData);
    
    if (speedData.length >= 2) {
      this.speedModel.train(speedData);
    }
    
    if (headingData.length >= 2) {
      this.headingModel.train(headingData);
    }
  }

  /**
   * Predict position at future time
   * @param {number} futureTimestamp - Timestamp to predict for
   * @returns {Object} Predicted position with confidence
   */
  predictPosition(futureTimestamp) {
    if (this.positionHistory.length < 3) {
      return null;
    }

    const baseTime = this.positionHistory[0].timestamp;
    const relativeFutureTime = (futureTimestamp - baseTime) / 1000;
    
    // Simple linear prediction
    const predictedLat = this.latModel.predict(relativeFutureTime);
    const predictedLon = this.lonModel.predict(relativeFutureTime);
    
    if (predictedLat === null || predictedLon === null) {
      return null;
    }

    // Calculate confidence based on prediction distance and time gap
    const lastPosition = this.positionHistory[this.positionHistory.length - 1];
    const timeGap = (futureTimestamp - lastPosition.timestamp) / 1000;
    
    // Confidence decreases with time gap and movement variability
    const baseConfidence = 0.9;
    const timeDecay = Math.exp(-timeGap / 30); // 30 second half-life
    const confidence = baseConfidence * timeDecay;
    
    return {
      lat: predictedLat,
      lon: predictedLon,
      timestamp: futureTimestamp,
      confidence: Math.max(0.1, confidence),
      isPredicted: true
    };
  }

  /**
   * Get movement characteristics for current pattern
   * @returns {Object} Movement analysis
   */
  getMovementCharacteristics() {
    if (this.positionHistory.length < 2) {
      return {
        averageSpeed: 0,
        direction: 0,
        consistency: 0,
        predictability: 0
      };
    }

    // Calculate average speed
    let totalSpeed = 0;
    let speedSamples = 0;
    
    for (let i = 1; i < this.positionHistory.length; i++) {
      const curr = this.positionHistory[i];
      const prev = this.positionHistory[i - 1];
      const dt = (curr.timestamp - prev.timestamp) / 1000;
      
      if (dt > 0) {
        const distance = this.calculateDistance(prev.lat, prev.lon, curr.lat, curr.lon);
        totalSpeed += distance / dt;
        speedSamples++;
      }
    }
    
    const averageSpeed = speedSamples > 0 ? totalSpeed / speedSamples : 0;

    // Calculate direction consistency
    const directions = [];
    for (let i = 1; i < this.positionHistory.length; i++) {
      const curr = this.positionHistory[i];
      const prev = this.positionHistory[i - 1];
      const direction = Math.atan2(curr.lon - prev.lon, curr.lat - prev.lat);
      directions.push(direction);
    }
    
    let directionConsistency = 1;
    if (directions.length > 1) {
      let varianceSum = 0;
      const avgDirection = directions.reduce((a, b) => a + b, 0) / directions.length;
      
      for (const dir of directions) {
        varianceSum += Math.pow(dir - avgDirection, 2);
      }
      
      const variance = varianceSum / directions.length;
      directionConsistency = Math.exp(-variance);
    }
    
    return {
      averageSpeed,
      direction: directions.length > 0 ? directions[directions.length - 1] : 0,
      consistency: directionConsistency,
      predictability: Math.min(directionConsistency, Math.exp(-averageSpeed / 10))
    };
  }

  /**
   * Calculate distance between two points in meters
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  }

  /**
   * Reset the analyzer
   */
  reset() {
    this.positionHistory = [];
    this.velocityHistory = [];
    this.accelerationHistory = [];
    this.latModel = new LinearRegression();
    this.lonModel = new LinearRegression();
    this.speedModel = new LinearRegression();
    this.headingModel = new LinearRegression();
  }
}

/**
 * GPS Gap Filler
 * Combines trajectory prediction with sensor fusion for intelligent gap filling
 */
export class GPSGapFiller {
  constructor() {
    this.patternAnalyzer = new MovementPatternAnalyzer();
    this.isInGap = false;
    this.gapStartTime = 0;
    this.lastKnownPosition = null;
    this.maxGapDuration = 60000; // 1 minute max gap
  }

  /**
   * Process GPS position
   * @param {Object} position - GPS position
   * @returns {Object} Position (real or predicted)
   */
  processPosition(position) {
    if (position && !position.isPredicted) {
      // Real GPS position received
      this.patternAnalyzer.addPosition({
        lat: position.lat || position.coords?.latitude,
        lon: position.lon || position.coords?.longitude,
        timestamp: position.timestamp || Date.now(),
        speed: position.speed,
        heading: position.heading
      });
      
      this.lastKnownPosition = position;
      this.isInGap = false;
      
      return position;
    }
    
    // No GPS position - we're in a gap
    if (!this.isInGap) {
      this.isInGap = true;
      this.gapStartTime = Date.now();
    }
    
    return this.fillGap();
  }

  /**
   * Fill GPS gap with predicted position
   * @returns {Object|null} Predicted position or null
   */
  fillGap() {
    const now = Date.now();
    const gapDuration = now - this.gapStartTime;
    
    // Don't fill gaps longer than max duration
    if (gapDuration > this.maxGapDuration) {
      return null;
    }
    
    // Try to predict position
    const predicted = this.patternAnalyzer.predictPosition(now);
    
    if (predicted && predicted.confidence > 0.3) {
      console.log(`GPS gap filled: ${predicted.lat.toFixed(6)}, ${predicted.lon.toFixed(6)} (confidence: ${predicted.confidence.toFixed(2)})`);
      return predicted;
    }
    
    return null;
  }

  /**
   * Get gap filling statistics
   * @returns {Object} Statistics about gap filling performance
   */
  getStatistics() {
    const characteristics = this.patternAnalyzer.getMovementCharacteristics();
    
    return {
      isInGap: this.isInGap,
      gapDuration: this.isInGap ? Date.now() - this.gapStartTime : 0,
      positionHistory: this.patternAnalyzer.positionHistory.length,
      ...characteristics
    };
  }

  /**
   * Reset the gap filler
   */
  reset() {
    this.patternAnalyzer.reset();
    this.isInGap = false;
    this.gapStartTime = 0;
    this.lastKnownPosition = null;
  }
}