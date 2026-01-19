// Firebase Configuration Manager
// This file handles loading Firebase configuration securely

class FirebaseConfigManager {
  constructor() {
    this.config = null;
  }

  // Load Firebase configuration
  async loadConfig() {
    // Try to load from environment variables first (for production)
    if (this.hasEnvironmentConfig()) {
      this.config = this.getEnvironmentConfig();
      console.log('🔒 Loaded Firebase config from environment variables');
      return this.config;
    }

    // Fallback to local config file (for development)
    try {
      const response = await fetch('./config/firebase-config.json');
      if (response.ok) {
        this.config = await response.json();
        console.log('🔒 Loaded Firebase config from local file');
        return this.config;
      }
    } catch (error) {
      console.warn('⚠️ Could not load firebase-config.json:', error.message);
    }

    // Final fallback - show error
    console.error('❌ No Firebase configuration found!');
    throw new Error('Firebase configuration not found. Please set up environment variables or create firebase-config.json');
  }

  // Check if environment variables are available
  hasEnvironmentConfig() {
    // In a real production environment, you'd check for actual environment variables
    // For now, we'll check if they're defined in window object (set by build process)
    return window.FIREBASE_CONFIG && 
           window.FIREBASE_CONFIG.apiKey && 
           window.FIREBASE_CONFIG.projectId;
  }

  // Get configuration from environment variables
  getEnvironmentConfig() {
    return {
      apiKey: window.FIREBASE_CONFIG.apiKey,
      authDomain: window.FIREBASE_CONFIG.authDomain,
      projectId: window.FIREBASE_CONFIG.projectId,
      storageBucket: window.FIREBASE_CONFIG.storageBucket,
      messagingSenderId: window.FIREBASE_CONFIG.messagingSenderId,
      appId: window.FIREBASE_CONFIG.appId,
      measurementId: window.FIREBASE_CONFIG.measurementId
    };
  }

  // Get the loaded configuration
  getConfig() {
    if (!this.config) {
      throw new Error('Firebase configuration not loaded. Call loadConfig() first.');
    }
    return this.config;
  }
}

// Create global instance
window.firebaseConfigManager = new FirebaseConfigManager();
