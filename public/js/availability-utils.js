// Availability Configuration Utilities
class AvailabilityManager {
  constructor(db = null) {
    this.config = null;
    this.db = db;
  }

  // Load configuration from Firebase or JSON file
  async loadConfig() {
    // Try Firebase first if db is available
    if (this.db) {
      try {
        const doc = await this.db.collection('settings').doc('availability').get();
        if (doc.exists) {
          this.config = doc.data();
          console.log('Loaded config from Firebase:', this.config);
          return this.config;
        }
      } catch (error) {
        console.error('Error loading from Firebase, trying JSON fallback:', error);
      }
    }

    // Fallback to JSON file
    try {
      const response = await fetch('config/availability-config.json');
      this.config = await response.json();
      return this.config;
    } catch (error) {
      console.error('Error loading availability config:', error);
      // Fallback to hardcoded config if everything fails
      return this.getFallbackConfig();
    }
  }

  // Fallback configuration (your current setup)
  getFallbackConfig() {
    return {
      businessHours: {
        Saturday: { enabled: true, startTime: "08:00", endTime: "18:00", slotDuration: 30 },
        Tuesday: { enabled: true, startTime: "15:30", endTime: "16:30", slotDuration: 30 },
        Thursday: { enabled: true, startTime: "15:30", endTime: "16:30", slotDuration: 30 }
      },
      settings: { timeFormat: "12hour" },
      blockedDates: {} // Empty blocked dates for fallback
    };
  }

  // Generate time slots for a specific day
  generateTimeSlots(dayName) {
    if (!this.config) {
      console.error('Config not loaded');
      return [];
    }

    const dayConfig = this.config.businessHours[dayName];
    if (!dayConfig || !dayConfig.enabled) {
      return [];
    }

    const slots = [];
    const startTime = this.parseTime(dayConfig.startTime);
    const endTime = this.parseTime(dayConfig.endTime);
    const duration = dayConfig.slotDuration || 30;

    let currentTime = startTime;
    while (currentTime < endTime) {
      const timeString = this.formatTime(currentTime, this.config.settings.timeFormat);
      slots.push(timeString);
      currentTime += duration;
    }

    return slots;
  }

  // Parse time string (HH:MM) to minutes since midnight
  parseTime(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }

  // Format minutes since midnight to time string
  formatTime(minutes, format = '12hour') {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    if (format === '24hour') {
      return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
    } else {
      // 12-hour format
      const period = hours >= 12 ? 'PM' : 'AM';
      const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
      const displayMins = mins.toString().padStart(2, '0');
      return `${displayHours.toString().padStart(2, '0')}:${displayMins} ${period}`;
    }
  }

  // Get enabled days
  getEnabledDays() {
    if (!this.config) return [];
    
    return Object.keys(this.config.businessHours)
      .filter(day => this.config.businessHours[day].enabled);
  }

  // Get display text for schedule
  getScheduleDisplayText() {
    if (!this.config || !this.config.displayText) {
      return "Times available: Check calendar for availability";
    }

    const enabledDays = this.getEnabledDays();
    const scheduleLines = enabledDays.map(day => 
      this.config.displayText.scheduleText[day] || `${day}: Check calendar`
    );

    return `${this.config.displayText.availabilityDescription}<br>${scheduleLines.join('<br>')}`;
  }

  // Check if a specific date is blocked
  isDateBlocked(dateStr) {
    if (!this.config || !this.config.blockedDates) {
      return false;
    }
    return !!this.config.blockedDates[dateStr]; // Convert to boolean
  }

  // Get all blocked dates
  getBlockedDates() {
    if (!this.config || !this.config.blockedDates) {
      return [];
    }
    return Object.keys(this.config.blockedDates);
  }

  // Check if a date should be available for booking
  isDateAvailable(dateStr) {
    // Check if date is blocked
    if (this.isDateBlocked(dateStr)) {
      return false;
    }

    // Check if the day of week is enabled
    const date = new Date(dateStr);
    const dayName = date.toLocaleString('en-US', { weekday: 'long' });
    const dayConfig = this.config.businessHours[dayName];
    
    return dayConfig && dayConfig.enabled;
  }
}

// Export for use in other files
window.AvailabilityManager = AvailabilityManager;
