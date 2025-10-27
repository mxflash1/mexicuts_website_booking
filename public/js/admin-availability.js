// Admin Availability Management
class AdminAvailabilityManager {
  constructor(db) {
    this.db = db;
    this.config = null;
    this.defaultConfig = {
      businessHours: {
        Sunday: { enabled: false },
        Monday: { enabled: false },
        Tuesday: { enabled: true, startTime: "15:30", endTime: "16:30", slotDuration: 30 },
        Wednesday: { enabled: false },
        Thursday: { enabled: true, startTime: "15:30", endTime: "16:30", slotDuration: 30 },
        Friday: { enabled: false },
        Saturday: { enabled: true, startTime: "08:00", endTime: "18:00", slotDuration: 30 }
      },
      settings: {
        timeFormat: "12hour",
        bookingAdvanceDays: 30,
        minBookingNotice: 2
      },
      displayText: {
        availabilityDescription: "Each cut is $20. Times available:",
        scheduleText: {
          Saturday: "Saturdays: 8:00am – 6:00pm",
          Tuesday: "Tuesdays: 3:30pm – 4:30pm", 
          Thursday: "Thursdays: 3:30pm – 4:30pm"
        }
      },
      blockedDates: {} // Store blocked dates as { "2025-01-15": { reason: "Holiday", blockedAt: timestamp } }
    };
  }

  // Load configuration from Firebase
  async loadConfig() {
    try {
      const doc = await this.db.collection('settings').doc('availability').get();
      if (doc.exists) {
        this.config = doc.data();
        // Ensure blockedDates exists
        if (!this.config.blockedDates) {
          this.config.blockedDates = {};
        }
        console.log('Loaded config from Firebase:', this.config);
      } else {
        console.log('No config found, using default');
        this.config = this.defaultConfig;
      }
      return this.config;
    } catch (error) {
      console.error('Error loading config from Firebase:', error);
      this.config = this.defaultConfig;
      return this.config;
    }
  }

  // Save configuration to Firebase
  async saveConfig(config) {
    try {
      await this.db.collection('settings').doc('availability').set(config);
      this.config = config;
      console.log('Config saved to Firebase successfully');
      return true;
    } catch (error) {
      console.error('Error saving config to Firebase:', error);
      return false;
    }
  }

  // Generate the admin form HTML
  generateAdminForm() {
    if (!this.config) return '';

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const timeOptions = this.generateTimeOptions();
    const durationOptions = [15, 30, 45, 60];

    let formHTML = `
      <div style="display: grid; grid-template-columns: 1fr; gap: 15px; max-width: 100%;">
    `;

    days.forEach(day => {
      const dayConfig = this.config.businessHours[day] || { enabled: false };
      const isEnabled = dayConfig.enabled;
      
      formHTML += `
        <div style="
          border: 2px solid ${isEnabled ? '#CE1126' : '#555'}; 
          padding: 15px; 
          border-radius: 8px; 
          background: ${isEnabled ? '#3a1a1a' : '#1a1a1a'};
          transition: all 0.3s ease;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        ">
          <!-- Day Header -->
          <div style="display: flex; align-items: center; margin-bottom: 15px; padding-bottom: 10px; border-bottom: 1px solid #444;">
            <input type="checkbox" id="enabled-${day}" ${isEnabled ? 'checked' : ''} 
                   style="
                     margin-right: 12px; 
                     transform: scale(1.3); 
                     accent-color: #CE1126;
                     cursor: pointer;
                   ">
            <label for="enabled-${day}" style="
              font-weight: bold; 
              font-size: 16px; 
              color: ${isEnabled ? '#CE1126' : '#ccc'};
              cursor: pointer;
              user-select: none;
            ">${day}</label>
            <div style="margin-left: auto; font-size: 11px; color: ${isEnabled ? '#4CAF50' : '#999'};">
              ${isEnabled ? '✅ OPEN' : '❌ CLOSED'}
            </div>
          </div>
          
          <!-- Time Settings -->
          <div id="times-${day}" style="display: ${isEnabled ? 'block' : 'none'};">
            <div style="display: grid; gap: 15px;">
              
              <!-- Start Time -->
              <div>
                <label style="
                  display: block; 
                  margin-bottom: 6px; 
                  font-size: 12px; 
                  font-weight: 600;
                  color: #ccc;
                ">🕐 Start Time:</label>
                <select id="start-${day}" style="
                  width: 100%; 
                  padding: 8px; 
                  border: 1px solid #555;
                  border-radius: 4px;
                  font-size: 13px;
                  background: #333;
                  color: white;
                  cursor: pointer;
                ">
                  ${timeOptions.map(time => 
                    `<option value="${time}" ${dayConfig.startTime === time ? 'selected' : ''}>${this.formatTimeForDisplay(time)}</option>`
                  ).join('')}
                </select>
              </div>
              
              <!-- End Time -->
              <div>
                <label style="
                  display: block; 
                  margin-bottom: 6px; 
                  font-size: 12px; 
                  font-weight: 600;
                  color: #ccc;
                ">🕕 End Time:</label>
                <select id="end-${day}" style="
                  width: 100%; 
                  padding: 8px; 
                  border: 1px solid #555;
                  border-radius: 4px;
                  font-size: 13px;
                  background: #333;
                  color: white;
                  cursor: pointer;
                ">
                  ${timeOptions.map(time => 
                    `<option value="${time}" ${dayConfig.endTime === time ? 'selected' : ''}>${this.formatTimeForDisplay(time)}</option>`
                  ).join('')}
                </select>
              </div>
              
              <!-- Slot Duration -->
              <div>
                <label style="
                  display: block; 
                  margin-bottom: 6px; 
                  font-size: 12px; 
                  font-weight: 600;
                  color: #ccc;
                ">⏱️ Appointment Length:</label>
                <select id="duration-${day}" style="
                  width: 100%; 
                  padding: 8px; 
                  border: 1px solid #555;
                  border-radius: 4px;
                  font-size: 13px;
                  background: #333;
                  color: white;
                  cursor: pointer;
                ">
                  ${durationOptions.map(duration => 
                    `<option value="${duration}" ${(dayConfig.slotDuration || 30) === duration ? 'selected' : ''}>${duration} minutes</option>`
                  ).join('')}
                </select>
              </div>
              
              <!-- Preview -->
              <div style="
                background: #2a4a2a; 
                padding: 8px; 
                border-radius: 4px; 
                border-left: 3px solid #4CAF50;
                margin-top: 8px;
              ">
                <div style="font-size: 10px; color: #aaa; margin-bottom: 3px;">Preview:</div>
                <div style="font-weight: bold; color: #4CAF50; font-size: 12px;" id="preview-${day}">
                  ${isEnabled ? this.generatePreviewText(dayConfig) : 'Day is closed'}
                </div>
              </div>
              
            </div>
          </div>
          
          <!-- Closed Message -->
          <div id="closed-${day}" style="display: ${isEnabled ? 'none' : 'block'}; text-align: center; color: #666; font-style: italic; padding: 15px;">
            This day is currently closed.<br>
            <small style="color: #888;">Check the box above to open for business.</small>
          </div>
        </div>
      `;
    });

    formHTML += '</div>';
    return formHTML;
  }

  // Generate preview text for a day
  generatePreviewText(dayConfig) {
    if (!dayConfig.enabled) return 'Closed';
    
    const start = this.formatTimeForDisplay(dayConfig.startTime || '09:00');
    const end = this.formatTimeForDisplay(dayConfig.endTime || '17:00');
    const duration = dayConfig.slotDuration || 30;
    
    return `${start} - ${end} (${duration}min slots)`;
  }

  // Generate time options for dropdowns
  generateTimeOptions() {
    const times = [];
    // Start from 5:00 AM (hour = 5) instead of 6:00 AM
    for (let hour = 5; hour <= 22; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        times.push(timeStr);
      }
    }
    return times;
  }

  // Format time for display
  formatTimeForDisplay(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours === 0 ? 12 : hours > 12 ? hours - 12 : hours;
    return `${displayHours}:${minutes.toString().padStart(2, '0')} ${period}`;
  }

  // Collect form data and create config object
  collectFormData() {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const newConfig = JSON.parse(JSON.stringify(this.config)); // Deep clone

    days.forEach(day => {
      const enabled = document.getElementById(`enabled-${day}`).checked;
      
      if (enabled) {
        newConfig.businessHours[day] = {
          enabled: true,
          startTime: document.getElementById(`start-${day}`).value,
          endTime: document.getElementById(`end-${day}`).value,
          slotDuration: parseInt(document.getElementById(`duration-${day}`).value)
        };
      } else {
        newConfig.businessHours[day] = { enabled: false };
      }
    });

    // Update display text
    this.updateDisplayText(newConfig);
    
    return newConfig;
  }

  // Update display text based on enabled days
  updateDisplayText(config) {
    const enabledDays = Object.keys(config.businessHours)
      .filter(day => config.businessHours[day].enabled);

    config.displayText.scheduleText = {};
    
    enabledDays.forEach(day => {
      const dayConfig = config.businessHours[day];
      const startDisplay = this.formatTimeForDisplay(dayConfig.startTime);
      const endDisplay = this.formatTimeForDisplay(dayConfig.endTime);
      config.displayText.scheduleText[day] = `${day}s: ${startDisplay} – ${endDisplay}`;
    });
  }

  // Set up event listeners for the form
  setupEventListeners() {
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    
    days.forEach(day => {
      const checkbox = document.getElementById(`enabled-${day}`);
      const timesDiv = document.getElementById(`times-${day}`);
      const closedDiv = document.getElementById(`closed-${day}`);
      const dayContainer = checkbox.closest('div').closest('div');
      const dayLabel = document.querySelector(`label[for="enabled-${day}"]`);
      const statusDiv = dayContainer.querySelector('div[style*="margin-left: auto"]');
      
      // Handle checkbox changes
      checkbox.addEventListener('change', () => {
        const isEnabled = checkbox.checked;
        
        // Toggle visibility
        timesDiv.style.display = isEnabled ? 'block' : 'none';
        closedDiv.style.display = isEnabled ? 'none' : 'block';
        
        // Update styling
        dayContainer.style.border = `2px solid ${isEnabled ? '#CE1126' : '#555'}`;
        dayContainer.style.background = isEnabled ? '#3a1a1a' : '#1a1a1a';
        dayLabel.style.color = isEnabled ? '#CE1126' : '#ccc';
        statusDiv.innerHTML = isEnabled ? '✅ OPEN' : '❌ CLOSED';
        
        // Update preview
        this.updatePreview(day);
      });
      
      // Handle time/duration changes
      const startSelect = document.getElementById(`start-${day}`);
      const endSelect = document.getElementById(`end-${day}`);
      const durationSelect = document.getElementById(`duration-${day}`);
      
      [startSelect, endSelect, durationSelect].forEach(select => {
        if (select) {
          select.addEventListener('change', () => {
            this.updatePreview(day);
          });
        }
      });
    });

    // Save button
    document.getElementById('save-availability').addEventListener('click', async () => {
      const statusDiv = document.getElementById('save-status');
      statusDiv.innerHTML = '⏳ Saving...';
      statusDiv.style.color = '#CE1126';

      try {
        const newConfig = this.collectFormData();
        const success = await this.saveConfig(newConfig);
        
        if (success) {
          statusDiv.innerHTML = '✅ Saved successfully!';
          statusDiv.style.color = 'green';
          
          // Clear status after 3 seconds
          setTimeout(() => {
            statusDiv.innerHTML = '';
          }, 3000);
        } else {
          throw new Error('Save failed');
        }
      } catch (error) {
        statusDiv.innerHTML = '❌ Error saving changes';
        statusDiv.style.color = 'red';
              console.error('Save error:', error);
    }
  });
  }

  // Update preview text for a specific day
  updatePreview(day) {
    const previewDiv = document.getElementById(`preview-${day}`);
    const checkbox = document.getElementById(`enabled-${day}`);
    
    if (!checkbox.checked) {
      previewDiv.innerHTML = 'Day is closed';
      return;
    }
    
    const startTime = document.getElementById(`start-${day}`).value;
    const endTime = document.getElementById(`end-${day}`).value;
    const duration = document.getElementById(`duration-${day}`).value;
    
    const startDisplay = this.formatTimeForDisplay(startTime);
    const endDisplay = this.formatTimeForDisplay(endTime);
    
    previewDiv.innerHTML = `${startDisplay} - ${endDisplay} (${duration}min slots)`;
  }

  // Initialize blocked dates management
  initializeBlockedDates() {
    this.renderBlockedDatesList();
    this.setupBlockedDatesEventListeners();
  }

  // Render the blocked dates list
  renderBlockedDatesList() {
    const listContainer = document.getElementById('blockedDatesList');
    if (!listContainer) return;

    const blockedDates = this.config.blockedDates || {};
    const dates = Object.keys(blockedDates).sort();

    if (dates.length === 0) {
      listContainer.innerHTML = `
        <div style="text-align: center; color: #666; padding: 20px; font-style: italic;">
          No blocked dates set.<br>
          <small style="color: #888;">Add dates above to prevent bookings.</small>
        </div>
      `;
      return;
    }

    let html = '';
    dates.forEach(dateStr => {
      const dateInfo = blockedDates[dateStr];
      const formattedDate = this.formatDateForDisplay(dateStr);
      
      html += `
        <div style="
          background: #1a1a1a; 
          border: 1px solid #555; 
          border-radius: 6px; 
          padding: 12px; 
          margin-bottom: 8px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        ">
          <div>
            <div style="color: #f44336; font-weight: bold; font-size: 14px;">🚫 ${formattedDate}</div>
            ${dateInfo.reason ? `<div style="color: #ccc; font-size: 12px; margin-top: 2px;">${dateInfo.reason}</div>` : ''}
          </div>
          <button onclick="adminAvailability.removeBlockedDate('${dateStr}')" 
                  style="
                    background: #666; 
                    color: white; 
                    border: none; 
                    padding: 6px 10px; 
                    border-radius: 4px; 
                    cursor: pointer; 
                    font-size: 11px;
                    transition: background 0.2s;
                  "
                  onmouseover="this.style.background='#f44336'"
                  onmouseout="this.style.background='#666'">
            Remove
          </button>
        </div>
      `;
    });

    listContainer.innerHTML = html;
  }

  // Setup event listeners for blocked dates
  setupBlockedDatesEventListeners() {
    const addBtn = document.getElementById('addBlockedDateBtn');
    const dateInput = document.getElementById('blockDateInput');
    const reasonInput = document.getElementById('blockReasonInput');

    if (addBtn) {
      addBtn.addEventListener('click', () => this.addBlockedDate());
    }

    // Allow Enter key to add blocked date
    if (dateInput) {
      dateInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.addBlockedDate();
        }
      });
    }

    if (reasonInput) {
      reasonInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
          this.addBlockedDate();
        }
      });
    }
  }

  // Add a blocked date
  async addBlockedDate() {
    const dateInput = document.getElementById('blockDateInput');
    const reasonInput = document.getElementById('blockReasonInput');
    const statusDiv = document.getElementById('blocked-dates-status');

    if (!dateInput || !reasonInput || !statusDiv) return;

    const dateStr = dateInput.value.trim();
    const reason = reasonInput.value.trim();

    if (!dateStr) {
      statusDiv.innerHTML = '❌ Please select a date';
      statusDiv.style.color = '#f44336';
      setTimeout(() => { statusDiv.innerHTML = ''; }, 3000);
      return;
    }

    // Check if date is in the past
    const selectedDate = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    if (selectedDate < today) {
      statusDiv.innerHTML = '❌ Cannot block dates in the past';
      statusDiv.style.color = '#f44336';
      setTimeout(() => { statusDiv.innerHTML = ''; }, 3000);
      return;
    }

    // Ensure blockedDates exists
    if (!this.config.blockedDates) {
      this.config.blockedDates = {};
    }

    // Check if date is already blocked
    if (this.config.blockedDates[dateStr]) {
      statusDiv.innerHTML = '❌ This date is already blocked';
      statusDiv.style.color = '#f44336';
      setTimeout(() => { statusDiv.innerHTML = ''; }, 3000);
      return;
    }

    // Add to config
    this.config.blockedDates[dateStr] = {
      reason: reason || 'Blocked',
      blockedAt: new Date().toISOString()
    };

    // Update UI
    this.renderBlockedDatesList();
    
    // Clear inputs
    dateInput.value = '';
    reasonInput.value = '';

    // Show success message
    statusDiv.innerHTML = '✅ Date blocked successfully!';
    statusDiv.style.color = '#4CAF50';
    setTimeout(() => { statusDiv.innerHTML = ''; }, 3000);
  }

  // Remove a blocked date
  async removeBlockedDate(dateStr) {
    const statusDiv = document.getElementById('blocked-dates-status');

    if (!this.config.blockedDates[dateStr]) {
      statusDiv.innerHTML = '❌ Date not found';
      statusDiv.style.color = '#f44336';
      setTimeout(() => { statusDiv.innerHTML = ''; }, 3000);
      return;
    }

    // Remove from config
    delete this.config.blockedDates[dateStr];

    // Update UI
    this.renderBlockedDatesList();

    // Show success message
    statusDiv.innerHTML = '✅ Date unblocked successfully!';
    statusDiv.style.color = '#4CAF50';
    setTimeout(() => { statusDiv.innerHTML = ''; }, 3000);
  }

  // Format date for display
  formatDateForDisplay(dateStr) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  }

  // Check if a date is blocked
  isDateBlocked(dateStr) {
    return this.config.blockedDates && this.config.blockedDates[dateStr];
  }

  // Get all blocked dates
  getBlockedDates() {
    return Object.keys(this.config.blockedDates || {});
  }
}

// Export for use in admin.js
window.AdminAvailabilityManager = AdminAvailabilityManager;
