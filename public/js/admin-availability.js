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
        availabilityDescription: "Fade or Trim: $20 · Both: $25. Times available:",
        scheduleText: {
          Saturday: "Saturdays: 8:00am – 6:00pm",
          Tuesday: "Tuesdays: 3:30pm – 4:30pm", 
          Thursday: "Thursdays: 3:30pm – 4:30pm"
        }
      },
      blockedDates: {}, // Store blocked dates as { "2025-01-15": { reason: "Holiday", blockedAt: timestamp } }
      blockedTimes: {} // Store blocked time windows as { "2025-01-15": [{ startTime: "10:00", endTime: "12:00", reason: "Lunch", blockedAt: ts }] }
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
        // Ensure blockedTimes exists
        if (!this.config.blockedTimes) {
          this.config.blockedTimes = {};
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

    let formHTML = '';

    days.forEach(day => {
      const dayConfig = this.config.businessHours[day] || { enabled: false };
      const isEnabled = dayConfig.enabled;

      formHTML += `
        <div class="day-card" data-day="${day}" data-open="${isEnabled}">
          <div class="day-card__head">
            <label class="switch">
              <input type="checkbox" id="enabled-${day}" ${isEnabled ? 'checked' : ''} aria-label="${day} open">
              <span class="switch__track"><span class="switch__thumb"></span></span>
            </label>
            <div class="day-card__name"><label for="enabled-${day}">${day}</label></div>
            <div class="day-card__status" data-status>${isEnabled ? 'OPEN' : 'CLOSED'}</div>
          </div>

          <div id="times-${day}" class="day-card__body" data-hidden="${!isEnabled}">
            <div class="field-row field-row--3">
              <div class="field">
                <label class="field__label" for="start-${day}">Start time</label>
                <select id="start-${day}" class="select">
                  ${timeOptions.map(time =>
                    `<option value="${time}" ${dayConfig.startTime === time ? 'selected' : ''}>${this.formatTimeForDisplay(time)}</option>`
                  ).join('')}
                </select>
              </div>
              <div class="field">
                <label class="field__label" for="end-${day}">End time</label>
                <select id="end-${day}" class="select">
                  ${timeOptions.map(time =>
                    `<option value="${time}" ${dayConfig.endTime === time ? 'selected' : ''}>${this.formatTimeForDisplay(time)}</option>`
                  ).join('')}
                </select>
              </div>
              <div class="field">
                <label class="field__label" for="duration-${day}">Slot length</label>
                <select id="duration-${day}" class="select">
                  ${durationOptions.map(duration =>
                    `<option value="${duration}" ${(dayConfig.slotDuration || 30) === duration ? 'selected' : ''}>${duration} min</option>`
                  ).join('')}
                </select>
              </div>
            </div>

            <div class="day-card__preview">
              <span class="day-card__preview-label">Preview</span>
              <span id="preview-${day}">${isEnabled ? this.generatePreviewText(dayConfig) : 'Day is closed'}</span>
            </div>
          </div>

          <div id="closed-${day}" class="day-card__closed" data-hidden="${isEnabled}" style="display:${isEnabled ? 'none' : 'block'};">
            Closed. Toggle the switch to open this day for bookings.
          </div>
        </div>
      `;
    });

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
    // Start from 5:00 AM (hour = 5) and go to midnight (24:00 = 00:00)
    for (let hour = 5; hour <= 23; hour++) {
      for (let minute = 0; minute < 60; minute += 30) {
        const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        times.push(timeStr);
      }
    }
    // Add midnight as the final option
    times.push('00:00');
    return times;
  }

  // Format time for display
  formatTimeForDisplay(timeStr) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const period = hours >= 12 && hours !== 24 ? 'PM' : 'AM';
    const displayHours = hours === 0 || hours === 24 ? 12 : hours > 12 ? hours - 12 : hours;
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
      if (!checkbox) return;
      const timesDiv = document.getElementById(`times-${day}`);
      const closedDiv = document.getElementById(`closed-${day}`);
      const dayContainer = checkbox.closest('.day-card');
      const statusDiv = dayContainer ? dayContainer.querySelector('[data-status]') : null;

      // Handle checkbox changes
      checkbox.addEventListener('change', () => {
        const isEnabled = checkbox.checked;

        if (timesDiv) timesDiv.setAttribute('data-hidden', String(!isEnabled));
        if (closedDiv) {
          closedDiv.setAttribute('data-hidden', String(isEnabled));
          closedDiv.style.display = isEnabled ? 'none' : 'block';
        }
        if (dayContainer) dayContainer.setAttribute('data-open', String(isEnabled));
        if (statusDiv) statusDiv.textContent = isEnabled ? 'OPEN' : 'CLOSED';

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
      statusDiv.textContent = 'Saving…';
      statusDiv.setAttribute('data-state', 'info');

      try {
        const newConfig = this.collectFormData();
        const success = await this.saveConfig(newConfig);

        if (success) {
          statusDiv.textContent = 'Saved';
          statusDiv.setAttribute('data-state', 'success');
          setTimeout(() => {
            statusDiv.textContent = '';
            statusDiv.removeAttribute('data-state');
          }, 3000);
        } else {
          throw new Error('Save failed');
        }
      } catch (error) {
        statusDiv.textContent = 'Couldn’t save changes. Please try again.';
        statusDiv.setAttribute('data-state', 'error');
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
        <div class="empty-state">
          <svg class="empty-state__icon"><use href="#i-ban"/></svg>
          <div class="empty-state__title">No blocked dates</div>
          <div class="empty-state__hint">Add a date above to take that day off.</div>
        </div>
      `;
      return;
    }

    let html = '';
    dates.forEach(dateStr => {
      const dateInfo = blockedDates[dateStr];
      const formattedDate = this.formatDateForDisplay(dateStr);

      html += `
        <div class="list-card list-card--urgent">
          <div class="list-card__row">
            <div style="flex:1; min-width:0;">
              <div class="list-card__title">
                <svg width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" style="color: var(--mexi-red);"><use href="#i-ban"/></svg>
                ${formattedDate}
              </div>
              ${dateInfo.reason ? `<div class="list-card__meta"><div class="list-card__meta-row text-tertiary">${dateInfo.reason}</div></div>` : ''}
            </div>
            <button type="button" class="btn btn-ghost btn-sm" onclick="adminAvailability.removeBlockedDate('${dateStr}')">
              Unblock
            </button>
          </div>
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

    const setStatus = (text, state) => {
      statusDiv.textContent = text;
      if (state) statusDiv.setAttribute('data-state', state); else statusDiv.removeAttribute('data-state');
      setTimeout(() => { statusDiv.textContent = ''; statusDiv.removeAttribute('data-state'); }, 3000);
    };

    if (!dateStr) return setStatus('Please select a date.', 'error');

    // Check if date is in the past
    const selectedDate = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (selectedDate < today) return setStatus('You can’t block dates in the past.', 'error');

    if (!this.config.blockedDates) this.config.blockedDates = {};
    if (this.config.blockedDates[dateStr]) return setStatus('This date is already blocked.', 'error');

    this.config.blockedDates[dateStr] = {
      reason: reason || 'Blocked',
      blockedAt: new Date().toISOString()
    };

    this.renderBlockedDatesList();
    dateInput.value = '';
    reasonInput.value = '';
    setStatus('Date blocked.', 'success');
  }

  // Remove a blocked date
  async removeBlockedDate(dateStr) {
    const statusDiv = document.getElementById('blocked-dates-status');
    const setStatus = (text, state) => {
      if (!statusDiv) return;
      statusDiv.textContent = text;
      if (state) statusDiv.setAttribute('data-state', state); else statusDiv.removeAttribute('data-state');
      setTimeout(() => { statusDiv.textContent = ''; statusDiv.removeAttribute('data-state'); }, 3000);
    };

    if (!this.config.blockedDates[dateStr]) return setStatus('Date not found.', 'error');

    delete this.config.blockedDates[dateStr];
    this.renderBlockedDatesList();
    setStatus('Date unblocked.', 'success');
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

  // ── Blocked time windows (per-date partial blocks) ──────────────────────
  initializeBlockedTimes() {
    this.renderBlockedTimesList();
    this.setupBlockedTimesEventListeners();
  }

  renderBlockedTimesList() {
    const listContainer = document.getElementById('blockedTimesList');
    if (!listContainer) return;

    const blockedTimes = this.config.blockedTimes || {};
    const dates = Object.keys(blockedTimes).sort();

    const hasAny = dates.some(d => Array.isArray(blockedTimes[d]) && blockedTimes[d].length > 0);
    if (!hasAny) {
      listContainer.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state__icon"><use href="#i-clock-x"/></svg>
          <div class="empty-state__title">No blocked time windows</div>
          <div class="empty-state__hint">Use the form above to block part of a day.</div>
        </div>
      `;
      return;
    }

    let html = '';
    dates.forEach(dateStr => {
      const windows = blockedTimes[dateStr] || [];
      if (!Array.isArray(windows) || windows.length === 0) return;
      const formattedDate = this.formatDateForDisplay(dateStr);
      windows.forEach((win, idx) => {
        const startDisplay = this.formatTimeForDisplay(win.startTime || '00:00');
        const endDisplay = this.formatTimeForDisplay(win.endTime || '00:00');
        html += `
          <div class="list-card list-card--urgent">
            <div class="list-card__row">
              <div style="flex:1; min-width:0;">
                <div class="list-card__title">
                  <svg width="16" height="16" stroke="currentColor" stroke-width="2" fill="none" style="color: var(--mexi-red);"><use href="#i-clock-x"/></svg>
                  ${formattedDate}
                </div>
                <div class="list-card__meta">
                  <div class="list-card__meta-row">${startDisplay} – ${endDisplay}</div>
                  ${win.reason ? `<div class="list-card__meta-row text-tertiary">${win.reason}</div>` : ''}
                </div>
              </div>
              <button type="button" class="btn btn-ghost btn-sm" onclick="adminAvailability.removeBlockedTime('${dateStr}', ${idx})">
                Unblock
              </button>
            </div>
          </div>
        `;
      });
    });

    listContainer.innerHTML = html;
  }

  setupBlockedTimesEventListeners() {
    const addBtn = document.getElementById('addBlockedTimeBtn');
    if (addBtn) {
      addBtn.addEventListener('click', () => this.addBlockedTime());
    }
  }

  async addBlockedTime() {
    const dateInput = document.getElementById('blockTimeDateInput');
    const startInput = document.getElementById('blockTimeStartInput');
    const endInput = document.getElementById('blockTimeEndInput');
    const reasonInput = document.getElementById('blockTimeReasonInput');
    const statusDiv = document.getElementById('blocked-times-status');

    if (!dateInput || !startInput || !endInput || !statusDiv) return;

    const dateStr = dateInput.value.trim();
    const startTime = startInput.value.trim();
    const endTime = endInput.value.trim();
    const reason = reasonInput ? reasonInput.value.trim() : '';

    const setStatus = (msg, state) => {
      statusDiv.textContent = msg;
      if (state) statusDiv.setAttribute('data-state', state); else statusDiv.removeAttribute('data-state');
      setTimeout(() => { statusDiv.textContent = ''; statusDiv.removeAttribute('data-state'); }, 3000);
    };

    if (!dateStr) return setStatus('Please select a date.', 'error');
    if (!startTime || !endTime) return setStatus('Please select both start and end times.', 'error');

    const selectedDate = new Date(dateStr);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (selectedDate < today) return setStatus('You can’t block times in the past.', 'error');

    const toMin = (t) => {
      const [h, m] = t.split(':').map(Number);
      return h * 60 + m;
    };
    const startMin = toMin(startTime);
    const endMin = endTime === '00:00' ? 1440 : toMin(endTime);
    if (endMin <= startMin) return setStatus('End time must be after start time.', 'error');

    if (!this.config.blockedTimes) this.config.blockedTimes = {};
    if (!Array.isArray(this.config.blockedTimes[dateStr])) {
      this.config.blockedTimes[dateStr] = [];
    }

    const overlaps = this.config.blockedTimes[dateStr].some(w => {
      const ws = toMin(w.startTime || '00:00');
      const we = (w.endTime === '00:00') ? 1440 : toMin(w.endTime || '00:00');
      return startMin < we && endMin > ws;
    });
    if (overlaps) return setStatus('This window overlaps an existing blocked time.', 'error');

    this.config.blockedTimes[dateStr].push({
      startTime,
      endTime,
      reason: reason || 'Blocked',
      blockedAt: new Date().toISOString()
    });

    this.config.blockedTimes[dateStr].sort((a, b) =>
      toMin(a.startTime) - toMin(b.startTime)
    );

    this.renderBlockedTimesList();

    startInput.value = '';
    endInput.value = '';
    if (reasonInput) reasonInput.value = '';

    setStatus('Time window blocked.', 'success');
  }

  async removeBlockedTime(dateStr, index) {
    const statusDiv = document.getElementById('blocked-times-status');
    const setStatus = (msg, state) => {
      if (!statusDiv) return;
      statusDiv.textContent = msg;
      if (state) statusDiv.setAttribute('data-state', state); else statusDiv.removeAttribute('data-state');
      setTimeout(() => { statusDiv.textContent = ''; statusDiv.removeAttribute('data-state'); }, 3000);
    };

    const list = this.config.blockedTimes && this.config.blockedTimes[dateStr];
    if (!Array.isArray(list) || index < 0 || index >= list.length) {
      return setStatus('Time window not found.', 'error');
    }

    list.splice(index, 1);
    if (list.length === 0) delete this.config.blockedTimes[dateStr];

    this.renderBlockedTimesList();
    setStatus('Time window unblocked.', 'success');
  }
}

// Export for use in admin.js
window.AdminAvailabilityManager = AdminAvailabilityManager;
