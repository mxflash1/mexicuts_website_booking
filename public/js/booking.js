
// Booking.js v5.0 - Authentication Integration
console.log('🚀 Booking.js v5.0 loaded - Authentication & user bookings enabled');

// Firebase configuration will be loaded securely
let firebaseConfig = null;
let authManager = null;



// ── Rate limiting helpers ──────────────────────────────────────────────────
// Generates (or retrieves) a persistent random device ID stored in localStorage.
// This is sent with every booking so the server can enforce per-device limits.
function getOrCreateDeviceId() {
  let id = localStorage.getItem('mexicuts_device_id');
  if (!id) {
    id = 'dev_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now().toString(36);
    localStorage.setItem('mexicuts_device_id', id);
  }
  return id;
}

// Records the timestamp of the last successful booking on this device.
function recordBookingTimestamp() {
  localStorage.setItem('mexicuts_last_booking', new Date().toISOString());
}

// Returns true (and shows a message) if this guest device booked within the last 10 minutes.
// Logged-in users bypass this check entirely — they can book for multiple people.
function isRateLimitedLocally() {
  const ts = localStorage.getItem('mexicuts_last_booking');
  if (!ts) return false;
  const elapsed = Date.now() - new Date(ts).getTime();
  const TEN_MIN = 10 * 60 * 1000;
  if (elapsed < TEN_MIN) {
    const minsLeft = Math.ceil((TEN_MIN - elapsed) / 60000);
    const plural = minsLeft === 1 ? 'minute' : 'minutes';
    showPopup(`⏳ Please wait ${minsLeft} more ${plural} before making another booking. To avoid this, make an account.`);
    return true;
  }
  return false;
}
// ─────────────────────────────────────────────────────────────────────────────

function showPopup(message) {
  let popup = document.getElementById("popupMessage");
  if (!popup) {
    popup = document.createElement("div");
    popup.id = "popupMessage";
    document.body.appendChild(popup);
  }
  popup.textContent = message;
  popup.classList.add("show");
  setTimeout(() => popup.classList.remove("show"), 6000);
}

function triggerConfetti(e) {
  e.preventDefault(); // stop jump
  confetti();         // launch
  setTimeout(() => {
    window.location.hash = "booking"; // scroll after effect
  }, 300);
}

function triggerConfettiThenScroll(e) {
  e.preventDefault();
  confetti();
  setTimeout(() => {
    document.querySelector('#booking').scrollIntoView({ behavior: 'smooth' });
  }, 300);
}



// Firebase will be initialized after config is loaded
// Make db global so other scripts (like leaderboard) can access it
window.db = null;
let db = null;

// Initialize availability manager (will be updated with db reference)
let availabilityManager;
let timeSlotsMap = {}; // Will be populated from config

let bookedSlots = [];

function getFunctionsBaseUrl() {
  // Public HTTPS functions endpoint
  // Example: https://us-central1-mexicuts-booking.cloudfunctions.net/<functionName>
  if (firebaseConfig && firebaseConfig.projectId) {
    return `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net`;
  }
  return null;
}

async function createGuestBooking(data) {
  const baseUrl = getFunctionsBaseUrl();
  if (!baseUrl) throw new Error('Missing projectId for functions URL');

  const res = await fetch(`${baseUrl}/createGuestBooking`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: data.name,
      phone: data.phone,
      timeSlot: data.timeSlot,
      notes: data.notes || '',
      service: data.service || '',
      price: data.price || 20,
      deviceId: getOrCreateDeviceId()
    })
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok || !payload.success) {
    const message = payload && payload.message ? payload.message : 'Failed to create booking';
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return payload;
}

// Initialize Firebase with secure configuration
async function initializeFirebase() {
  try {
    // Load Firebase configuration securely
    firebaseConfig = await window.firebaseConfigManager.loadConfig();
    
    // Initialize Firebase
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    window.db = db; // Make db globally accessible
    
    console.log('✅ Firebase initialized successfully');
    
    // Initialize Auth Manager
    window.authManager = new window.AuthManager(db);
    authManager = window.authManager;
    console.log('✅ Auth manager initialized');
    
    return true;
  } catch (error) {
    console.error('❌ Failed to initialize Firebase:', error);
    
    // Show user-friendly error message
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = `
      position: fixed;
      top: 20px;
      left: 20px;
      right: 20px;
      background: #f44336;
      color: white;
      padding: 15px;
      border-radius: 8px;
      z-index: 9999;
      text-align: center;
      font-weight: bold;
    `;
    errorDiv.innerHTML = '❌ Configuration Error: Unable to load booking system. Please contact support.';
    document.body.appendChild(errorDiv);
    
    return false;
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const navLogo = document.getElementById("navLogo");
  if (!navLogo) return;

  const bulldogFrames = ["images/lil_logo_opened.png?v=2", "images/lil_logo_closed.png?v=2"];
  let i = 0;

  setInterval(() => {
    i = (i + 1) % bulldogFrames.length;
    navLogo.src = bulldogFrames[i];
  }, 1000);
});

document.addEventListener("DOMContentLoaded", async () => {
  // Initialize Firebase first
  const firebaseInitialized = await initializeFirebase();
  if (!firebaseInitialized) {
    console.error('❌ Cannot proceed without Firebase configuration');
    return;
  }

  const logo = document.getElementById("logoAnimated");
  if (!logo) return;

  const frames = ["images/logo_open.png", "images/logo_closed.png"];
  let index = 0;

  setInterval(() => {
    index = (index + 1) % frames.length;
    logo.src = frames[index];
  }, 1000); // 1 seconds

  // Initialize availability manager with Firebase db
  availabilityManager = new AvailabilityManager(db);
  
  // Load availability configuration
  await initializeAvailability();
  
  const form = document.getElementById("bookingForm");

  const bookingDateInput = document.createElement("input");
  bookingDateInput.setAttribute("type", "text");
  bookingDateInput.setAttribute("id", "bookingDate");
  bookingDateInput.setAttribute("placeholder", "Select a date");
  bookingDateInput.setAttribute("readonly", "true"); // Prevent keyboard on mobile
  bookingDateInput.required = true;
  
  // Add mobile-specific styling
  bookingDateInput.style.cursor = "pointer";
  bookingDateInput.style.userSelect = "none";

  const slotContainer = document.createElement("div");
  slotContainer.id = "timeSlots";

  const notesField = form.querySelector("textarea");
  form.insertBefore(bookingDateInput, notesField);
  form.insertBefore(slotContainer, notesField);

  // Fetch all booked slots once on load
  // IMPORTANT: Do not read the private `bookings` collection from the public website.
  // We read from `bookedSlots` instead (contains only timeSlot, no PII).
  db.collection("bookedSlots").onSnapshot(snapshot => {
    bookedSlots = snapshot.docs.map(doc => doc.data().timeSlot).filter(Boolean);
  });
  

  flatpickr(bookingDateInput, {
    dateFormat: "Y-m-d",
    minDate: "today",
    disableMobile: false, // Enable mobile-friendly calendar
    clickOpens: true,
    allowInput: false, // Prevent manual input to avoid issues
    disable: [
      function(date) {
        const day = date.toLocaleString('en-US', { weekday: 'long' });
        const enabledDays = availabilityManager.getEnabledDays();
        
        // Check if the day is enabled
        if (!enabledDays.includes(day)) {
          return true;
        }
        
        // Check if the date is today or earlier (mobile-friendly)
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // Start of today
        
        // Convert the date parameter to start of day for accurate comparison
        const selectedDateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        
        // If the selected date is today or earlier, disable it
        if (selectedDateStart <= today) {
          return true;
        }
        
        // Check if the date is blocked
        // Fix timezone issue - use local date instead of UTC
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const dayOfMonth = String(date.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${dayOfMonth}`;
        console.log('Checking date:', dateStr, 'Is blocked?', availabilityManager.isDateBlocked(dateStr));
        if (availabilityManager.isDateBlocked(dateStr)) {
          console.log('Date is blocked:', dateStr);
          return true;
        }
        
        return false;
      }
    ],
    onChange: function(selectedDates, dateStr) {
      const selectedDate = selectedDates[0];
      const weekday = selectedDate.toLocaleString('en-US', { weekday: 'long' });
      const slots = timeSlotsMap[weekday] || [];

      slotContainer.innerHTML = '';
      slotContainer.classList.add('active');

      slots.forEach(time => {
        const fullSlot = `${dateStr} ${time}`;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = time;

        if (bookedSlots.includes(fullSlot)) {
          btn.disabled = true;
          btn.style.backgroundColor = '#a00';
          btn.style.opacity = '0.5';
          btn.title = 'Already booked';
        } else {
          btn.onclick = () => {
            document.querySelectorAll("#timeSlots button").forEach(b => b.classList.remove("time-selected"));
            btn.classList.add("time-selected");
          
            let hidden = document.getElementById('timeSlotHidden');
            if (!hidden) {
              hidden = document.createElement('input');
              hidden.type = 'hidden';
              hidden.name = 'timeSlot';
              hidden.id = 'timeSlotHidden';
              form.appendChild(hidden);
            }
            hidden.value = fullSlot;
            showPopup("🎉 Your MexiCut date has been selected! 🎉");
          };
          
        }

        slotContainer.appendChild(btn);
      });
    }
  });

  // Add name validation to the name input field
  const nameInput = form.querySelector('input[placeholder="Full Name"]');
  if (nameInput) {
    nameInput.setAttribute('maxlength', NAME_MAX);
    nameInput.addEventListener('input', function() {
      const v = validateName(this.value);
      if (!v.isValid) showNameError(v.message); else removeNameError();
    });
    nameInput.addEventListener('blur', function() {
      const v = validateName(this.value);
      if (!v.isValid) showNameError(v.message);
    });
  }

  // Add phone number validation to the phone input field
  const phoneInput = form.querySelector('input[placeholder="Phone Number"]');
  if (phoneInput) {
    // Real-time validation as user types
    phoneInput.addEventListener('input', function() {
      const phone = this.value.trim();
      if (phone.length > 0) {
        const validation = validatePhoneNumber(phone);
        if (!validation.isValid) {
          showPhoneError(validation.message);
        } else {
          removePhoneError();
        }
      } else {
        removePhoneError();
      }
    });
    
    // Validation when user leaves the field
    phoneInput.addEventListener('blur', function() {
      const phone = this.value.trim();
      if (phone.length > 0) {
        const validation = validatePhoneNumber(phone);
        if (!validation.isValid) {
          showPhoneError(validation.message);
        }
      }
    });
  }

  // ── Service selector click handlers ──────────────────────────────────────
  document.querySelectorAll('.service-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.service-btn').forEach(b => b.classList.remove('service-selected'));
      btn.classList.add('service-selected');
      document.getElementById('selectedServiceHidden').value = btn.dataset.service;
      document.getElementById('selectedPriceHidden').value = btn.dataset.price;
    });
  });
  // ─────────────────────────────────────────────────────────────────────────

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = form.querySelector('input[placeholder="Full Name"]').value;
    const phone = form.querySelector('input[placeholder="Phone Number"]').value;
    const notes = form.querySelector('textarea').value;
    const timeSlotField = document.getElementById("timeSlotHidden");
    const timeSlot = timeSlotField ? timeSlotField.value : "";
    const service = (document.getElementById("selectedServiceHidden") || {}).value || "";
    const price = (document.getElementById("selectedPriceHidden") || {}).value || "";

    // Validate name
    const nameValidation = validateName(name);
    if (!nameValidation.isValid) {
      showNameError(nameValidation.message);
      return;
    }
    removeNameError();

    // Require a service to be selected
    if (!service) {
      showPopup("⚠️ Please select a service (Fade, Trim, or Both) before booking.");
      document.getElementById('serviceSelector').scrollIntoView({ behavior: 'smooth' });
      return;
    }

    // Require a selected date + time slot
    if (!timeSlot) {
      showPopup("⚠️ Please select a date and time before booking.");
      // Scroll booking section into view to make it obvious
      const bookingSection = document.getElementById('booking');
      if (bookingSection) {
        bookingSection.scrollIntoView({ behavior: 'smooth' });
      }
      return;
    }

    // Validate phone number before submitting
    const phoneValidation = validatePhoneNumber(phone);
    if (!phoneValidation.isValid) {
      showPhoneError(phoneValidation.message);
      return; // Stop the form submission
    }

    // Remove any error messages if phone is valid
    removePhoneError();

    // Layer 1: Device fingerprint check — guests only.
    // Logged-in clients are rate-limited separately (server-side, up to 4 bookings per 10 min).
    const isLoggedIn = authManager && authManager.isLoggedIn();
    if (!isLoggedIn && isRateLimitedLocally()) return;

    const data = {
      name,
      phone,
      timeSlot,
      notes,
      service,
      price: Number(price),
      timestamp: new Date(),
      status: 'pending' // awaiting barber approval
    };

    // Show loading state on submit button
    const submitBtn = form.querySelector('button[type="submit"]');
    const originalBtnText = submitBtn ? submitBtn.textContent : '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = '⏳ Booking...';
      submitBtn.style.opacity = '0.7';
    }

    try {
      // If logged in, create booking directly (rules require userId match).
      // If guest, create booking via Cloud Function (keeps bookings private + prevents public writes).
      if (authManager && authManager.isLoggedIn()) {
        const currentUser = authManager.getCurrentUser();
        if (currentUser) {
          data.userId = currentUser.uid;

          // Server-side rate limit for clients: max 4 bookings within 10 minutes.
          // Filter by timestamp in JS to avoid needing a Firestore composite index.
          const TEN_MIN_MS = 10 * 60 * 1000;
          const TEN_MIN_AGO = new Date(Date.now() - TEN_MIN_MS);
          const allUserSnap = await db.collection('bookings')
            .where('userId', '==', currentUser.uid)
            .get();
          const recentDocs = allUserSnap.docs.filter(d => {
            const ts = d.data().timestamp;
            if (!ts) return false;
            const t = ts.toDate ? ts.toDate() : new Date(ts);
            return t > TEN_MIN_AGO;
          });
          if (recentDocs.length >= 4) {
            const timestamps = recentDocs
              .map(d => d.data().timestamp)
              .map(t => (t.toDate ? t.toDate() : new Date(t)));
            timestamps.sort((a, b) => a - b);
            const oldest = timestamps[0];
            const minsLeft = oldest
              ? Math.ceil((TEN_MIN_MS - (Date.now() - oldest.getTime())) / 60000)
              : 10;
            const plural = minsLeft === 1 ? 'minute' : 'minutes';
            showPopup(`⏳ Please wait ${minsLeft} more ${plural} before making another booking.`);
            return;
          }
        }
        await db.collection("bookings").add(data);
      } else {
        await createGuestBooking(data);
      }
      
      // Update user's booking count if logged in
      if (data.userId) {
        try {
          const userBookingsSnapshot = await db.collection('bookings')
            .where('userId', '==', data.userId)
            .get();
          const newBookingCount = userBookingsSnapshot.size;
          await db.collection('users').doc(data.userId).update({
            bookingCount: newBookingCount
          });
          console.log(`✅ Updated booking count: ${newBookingCount}`);
        } catch (countError) {
          console.error('Error updating booking count:', countError);
        }
      }
      
      recordBookingTimestamp(); // start 10-minute cooldown on this device
      confetti();
      showPopup("✅ Booking Confirmed!");
      
      // Show calendar option after successful booking
      showCalendarOption(data);
      
      // Refresh user bookings if logged in
      if (authManager && authManager.isLoggedIn() && window.refreshUserBookings) {
        setTimeout(() => window.refreshUserBookings(), 1000);
      }
      
      form.reset();
      slotContainer.innerHTML = '';
      
      // Re-apply auto-fill if logged in (and not in guest mode)
      if (authManager && authManager.isLoggedIn() && !window.guestBookingMode) {
        setTimeout(() => authManager.autoFillBookingForm(), 100);
      }
    } catch (err) {
      console.error('Error saving booking:', err);
      showPopup(err.message && err.message !== 'Failed to fetch' ? err.message : 'Something went wrong. Please try again.');
    } finally {
      // Always restore the button regardless of success or error
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.textContent = originalBtnText;
        submitBtn.style.opacity = '1';
      }
    }
  });
  
  // Setup booking lookup functionality after everything is initialized
  setupBookingLookup();
});

// Initialize availability configuration
async function initializeAvailability() {
  try {
    const config = await availabilityManager.loadConfig();
    
    // Generate time slots for each enabled day
    const enabledDays = availabilityManager.getEnabledDays();
    enabledDays.forEach(day => {
      timeSlotsMap[day] = availabilityManager.generateTimeSlots(day);
    });

    // Update the display text on the page
    updateScheduleDisplay();
    
    console.log('Availability configuration loaded:', timeSlotsMap);
    console.log('Blocked dates:', availabilityManager.getBlockedDates());
    console.log('Full config:', config);
  } catch (error) {
    console.error('Failed to initialize availability:', error);
    // Fallback to hardcoded values
    timeSlotsMap = {
      'Saturday': ['08:00 AM','08:30 AM','09:00 AM','09:30 AM','10:00 AM','10:30 AM','11:00 AM','11:30 AM','12:00 PM','12:30 PM','01:00 PM','01:30 PM','02:00 PM','02:30 PM','03:00 PM','03:30 PM','04:00 PM','04:30 PM','05:00 PM','05:30 PM'],
      'Tuesday': ['03:30 PM', '04:00 PM'],
      'Thursday': ['03:30 PM', '04:00 PM']
    };
  }
}

// Update the schedule display text on the page
function updateScheduleDisplay() {
  const bookingSection = document.querySelector('#booking p');
  if (bookingSection && availabilityManager.config) {
    bookingSection.innerHTML = availabilityManager.getScheduleDisplayText();
  }
}

// Calendar integration functions

function showCalendarOption(bookingData) {
  // Wait a moment for the popup to show, then show calendar option
  setTimeout(() => {
    const calendarContainer = document.createElement('div');
    calendarContainer.id = 'calendarOption';
    calendarContainer.style.cssText = `
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      background-color: #006847;
      color: #fff;
      padding: 20px 30px;
      border-radius: 12px;
      font-size: 1.1rem;
      z-index: 99999;
      text-align: center;
      box-shadow: 0 8px 32px rgba(0,0,0,0.3);
      border: 2px solid #CE1126;
      max-width: 400px;
      width: 90%;
    `;
    
    calendarContainer.innerHTML = `
      <h3 style="margin: 0 0 15px 0; color: #CE1126;">📅 Add to Calendar</h3>
      <p style="margin: 0 0 20px 0;">Would you like to add this appointment to your calendar?</p>
      <div style="display: flex; gap: 15px; justify-content: center;">
        <button onclick="addToCalendar('${bookingData.timeSlot}', '${bookingData.name}', '${bookingData.service || ''}', ${bookingData.price || 20})" 
                style="background: #CE1126; color: white; border: none; padding: 12px 20px; border-radius: 6px; cursor: pointer; font-family: 'VT323', monospace; font-size: 16px;">
          ✅ Yes, Add to Calendar
        </button>
        <button onclick="closeCalendarOption()" 
                style="background: #666; color: white; border: none; padding: 12px 20px; border-radius: 6px; cursor: pointer; font-family: 'VT323', monospace; font-size: 16px;">
          ❌ No Thanks
        </button>
      </div>
    `;
    
    document.body.appendChild(calendarContainer);
  }, 1500); // Show after the confirmation popup
}

function closeCalendarOption() {
  const calendarOption = document.getElementById('calendarOption');
  if (calendarOption) {
    calendarOption.remove();
  }
}

function addToCalendar(timeSlot, customerName, serviceLabel, servicePrice) {
  try {
    // Parse the time slot (format: "2024-01-15 03:30 PM")
    const parts = timeSlot.split(' ');
    if (parts.length < 3) {
      throw new Error('Invalid time slot format');
    }
    
    const dateStr = parts[0];
    const timeStr = parts[1];
    const period = parts[2];
    
    const [year, month, day] = dateStr.split('-');
    const [hour, minute] = timeStr.split(':');
    
    // Convert to 24-hour format
    let hour24 = parseInt(hour);
    if (period === 'PM' && hour24 !== 12) {
      hour24 += 12;
    } else if (period === 'AM' && hour24 === 12) {
      hour24 = 0;
    }
    
    // Create start and end times (30 minute appointment)
    const startDate = new Date(year, month - 1, day, hour24, parseInt(minute));
    const endDate = new Date(startDate.getTime() + 30 * 60 * 1000); // Add 30 minutes
    
    // Format dates for calendar (ISO format)
    const formatDate = (date) => {
      return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
    };
    
    const startTime = formatDate(startDate);
    const endTime = formatDate(endDate);
    
    // Create calendar event details
    const svcName = serviceLabel || 'Haircut';
    const svcPrice = servicePrice ? `$${servicePrice}` : '$20';
    const eventDetails = {
      title: 'Mexi Cuts - Haircut Appointment',
      description: `Haircut appointment with Mexi Cuts\n\nService: ${svcName}\nPrice: ${svcPrice}\nLocation: 6 Rosella Tce, Peregian Springs, Sunshine Coast, QLD\nContact: 0402098123\nInstagram: @mexi_cuts\n\nPlease arrive 5 minutes early.`,
      location: '6 Rosella Tce, Peregian Springs, Sunshine Coast, QLD, Australia',
      startTime: startTime,
      endTime: endTime
    };
    
    // Create calendar URLs for different platforms
    const googleCalendarUrl = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(eventDetails.title)}&dates=${startTime}/${endTime}&details=${encodeURIComponent(eventDetails.description)}&location=${encodeURIComponent(eventDetails.location)}`;
    
    const outlookUrl = `https://outlook.live.com/calendar/0/deeplink/compose?subject=${encodeURIComponent(eventDetails.title)}&startdt=${startTime}&enddt=${endTime}&body=${encodeURIComponent(eventDetails.description)}&location=${encodeURIComponent(eventDetails.location)}`;
    
    // Show platform selection
    showCalendarPlatformSelection(googleCalendarUrl, outlookUrl);
    
  } catch (error) {
    console.error('Error creating calendar event:', error);
    alert('Sorry, there was an error creating the calendar event. Please try again.');
  }
}

function showCalendarPlatformSelection(googleUrl, outlookUrl) {
  const platformContainer = document.createElement('div');
  platformContainer.id = 'calendarPlatform';
  platformContainer.style.cssText = `
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background-color: #111;
    color: #fff;
    padding: 25px 30px;
    border-radius: 12px;
    font-size: 1rem;
    z-index: 10001;
    text-align: center;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
    border: 2px solid #CE1126;
  `;
  
  platformContainer.innerHTML = `
    <h3 style="margin: 0 0 20px 0; color: #CE1126;">📅 Choose Your Calendar</h3>
    <p style="margin: 0 0 20px 0;">Select your preferred calendar app:</p>
    <div style="display: flex; flex-direction: column; gap: 12px;">
      <a href="${googleUrl}" target="_blank" 
         style="background: #4285f4; color: white; text-decoration: none; padding: 12px 20px; border-radius: 6px; font-family: 'VT323', monospace; font-size: 16px;">
        📅 Google Calendar
      </a>
      <a href="${outlookUrl}" target="_blank" 
         style="background: #0078d4; color: white; text-decoration: none; padding: 12px 20px; border-radius: 6px; font-family: 'VT323', monospace; font-size: 16px;">
        📅 Outlook Calendar
      </a>
      <button onclick="closeCalendarPlatform()" 
              style="background: #666; color: white; border: none; padding: 12px 20px; border-radius: 6px; cursor: pointer; font-family: 'VT323', monospace; font-size: 16px;">
        ❌ Cancel
      </button>
    </div>
  `;
  
  // Close the first calendar option
  closeCalendarOption();
  
  document.body.appendChild(platformContainer);
}

function closeCalendarPlatform() {
  const calendarPlatform = document.getElementById('calendarPlatform');
  if (calendarPlatform) {
    calendarPlatform.remove();
  }
}

// Booking lookup functionality
function setupBookingLookup() {
  const lookupBtn = document.getElementById('lookupBookingBtn');
  const lookupPhone = document.getElementById('lookupPhone');
  const lookupResults = document.getElementById('lookupResults');
  
  if (!lookupBtn || !lookupPhone || !lookupResults) {
    console.error('Booking lookup elements not found');
    return;
  }
  
  console.log('✅ Booking lookup elements found, setting up click handler...');
  
  lookupBtn.addEventListener('click', async () => {
    const phone = lookupPhone.value.trim();
    
    if (!phone) {
      showPopup('Please enter your phone number.');
      return;
    }

    // Show loading state on lookup button
    const originalLookupText = lookupBtn.textContent;
    lookupBtn.disabled = true;
    lookupBtn.textContent = '⏳ Looking up...';
    lookupBtn.style.opacity = '0.7';
    
    try {
      const baseUrl = getFunctionsBaseUrl();
      if (!baseUrl) throw new Error('Functions URL unavailable');

      const res = await fetch(`${baseUrl}/lookupBookingByPhone`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });

      const payload = await res.json().catch(() => ({}));

      if (!res.ok || !payload.success) {
        throw new Error(payload.message || 'Lookup failed');
      }

      const bookings = payload.bookings || [];

      if (bookings.length === 0) {
        lookupResults.innerHTML = `
          <div style="text-align: center; padding: 20px; background: #2a2a2a; border-radius: 8px; border: 1px solid #555;">
            <p style="color: #ccc; margin: 0;">No bookings found for this phone number.</p>
          </div>
        `;
        lookupResults.style.display = 'block';
        return;
      }

      let resultsHTML = '<div style="text-align: center; margin-bottom: 20px;"><h4 style="color: #CE1126; margin: 0;">Your Bookings:</h4></div>';

      bookings.forEach(booking => {
        const timeSlot = booking.timeSlot;
        const [date, ...timeParts] = timeSlot.split(' ');
        const time = timeParts.join(' ');

        const formattedDate = new Date(date).toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });

        resultsHTML += `
          <div style="background: #2a2a2a; padding: 20px; border-radius: 8px; border: 1px solid #555; margin-bottom: 15px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
              <h5 style="color: #CE1126; margin: 0;">${booking.name}</h5>
              <span style="color: #ccc; font-size: 14px;">${formattedDate}</span>
            </div>
            <div style="margin-bottom: 15px;">
              <p style="color: #ccc; margin: 5px 0;"><strong>Time:</strong> ${time}</p>
              <p style="color: #ccc; margin: 5px 0;"><strong>Phone:</strong> ${booking.phone}</p>
              ${booking.notes ? `<p style="color: #ccc; margin: 5px 0;"><strong>Notes:</strong> ${booking.notes}</p>` : ''}
            </div>
            <button onclick="cancelBooking('${booking.bookingId}', '${booking.name}')" 
                    style="background: #f44336; color: white; border: none; padding: 10px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: bold;">
              🗑️ Cancel Booking
            </button>
          </div>
        `;
      });

      lookupResults.innerHTML = resultsHTML;
      lookupResults.style.display = 'block';

    } catch (error) {
      console.error('Error looking up booking:', error);
      showPopup('Sorry, there was an error looking up your booking. Please try again.');
    } finally {
      // Always restore the lookup button
      lookupBtn.disabled = false;
      lookupBtn.textContent = originalLookupText;
      lookupBtn.style.opacity = '1';
    }
  });
}

// Cancel booking function
async function cancelBooking(bookingId, customerName) {
  // Show custom cancellation modal instead of browser confirm
  showCancellationModal(bookingId, customerName);
}

// Show custom cancellation modal
function showCancellationModal(bookingId, customerName) {
  console.log('🔍 Showing cancellation modal for:', customerName);
  
  const modal = document.getElementById('cancellationModal');
  const message = document.getElementById('cancellationMessage');
  const cancelNoBtn = document.getElementById('cancelNoBtn');
  const cancelYesBtn = document.getElementById('cancelYesBtn');
  
  if (!modal || !message || !cancelNoBtn || !cancelYesBtn) {
    console.error('❌ Modal elements not found!');
    return;
  }
  
  // Update the message with customer name
  message.textContent = `Are you sure you want to cancel the booking for ${customerName}?`;
  
  // Show the modal with flex display
  modal.style.display = 'flex';
  console.log('✅ Modal displayed');
  
  // Remove any existing listeners to prevent duplicates
  cancelNoBtn.onclick = null;
  cancelYesBtn.onclick = null;
  
  // Keep booking button
  cancelNoBtn.onclick = () => {
    console.log('🚫 Keep booking clicked');
    modal.style.display = 'none';
  };
  
  // Confirm cancellation button
  cancelYesBtn.onclick = async () => {
    console.log('✅ Confirm cancellation clicked');
    modal.style.display = 'none';
    await performCancellation(bookingId, customerName);
  };
  
  console.log('✅ Event listeners attached');
}

// Perform the actual cancellation — routes through Cloud Function so guests can cancel
// without needing Firestore write access. Phone number is verified server-side.
async function performCancellation(bookingId, customerName) {
  try {
    const phone = document.getElementById('lookupPhone') ? document.getElementById('lookupPhone').value.trim() : '';
    const baseUrl = getFunctionsBaseUrl();

    if (baseUrl && phone) {
      // Use Cloud Function (works for both guests and logged-in users)
      const res = await fetch(`${baseUrl}/cancelGuestBooking`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookingId, phone })
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok || !payload.success) {
        throw new Error(payload.message || 'Cancellation failed');
      }
    } else if (authManager && authManager.isLoggedIn()) {
      // Fallback: logged-in user cancelling from their bookings panel (not lookup section)
      await db.collection("bookings").doc(bookingId).delete();
    } else {
      throw new Error('Unable to cancel — please enter your phone number in the lookup field first.');
    }

    // Lift the local rate limit so they can rebook immediately
    localStorage.removeItem('mexicuts_last_booking');

    showPopup("✅ Booking cancelled successfully!");

    // Hide lookup results
    const lookupResults = document.getElementById('lookupResults');
    const lookupPhone = document.getElementById('lookupPhone');
    if (lookupResults) lookupResults.style.display = 'none';
    if (lookupPhone) lookupPhone.value = '';

    // Refresh user bookings panel if logged in
    if (window.refreshUserBookings) {
      setTimeout(() => window.refreshUserBookings(), 500);
    }

  } catch (error) {
    console.error('Error cancelling booking:', error);
    showPopup(error.message || 'Sorry, there was an error cancelling your booking. Please try again.');
  }
}

// Helper function to format phone numbers (reuse from admin)
function formatPhoneNumber(phone) {
  // Remove all non-digit characters
  const cleaned = phone.replace(/\D/g, '');
  
  // If it's an Australian number starting with 0, convert to +61
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    return '+61' + cleaned.substring(1);
  }
  
  // If it's already in international format, return as is
  if (cleaned.startsWith('61') && cleaned.length === 10) {
    return '+' + cleaned;
  }
  
  // If it's a 10-digit number, assume it's Australian
  if (cleaned.length === 10) {
    return '+61' + cleaned.substring(1);
  }
  
  // Return as is if it doesn't match patterns
  return phone;
}

// Phone number validation function
// ── Name validation ───────────────────────────────────────────────────────
const NAME_MAX = 75;
// Allow letters (including accented), spaces, hyphens, apostrophes and periods.
const NAME_REGEX = /^[a-zA-ZÀ-ÿ\s'\-.]+$/;

function validateName(name) {
  const trimmed = name.trim();
  if (!trimmed) return { isValid: false, message: 'Name is required.' };
  if (trimmed.length > NAME_MAX) return { isValid: false, message: `Name must be ${NAME_MAX} characters or fewer.` };
  if (!NAME_REGEX.test(trimmed)) return { isValid: false, message: 'Name can only contain letters, spaces, hyphens, apostrophes and periods.' };
  return { isValid: true };
}

function showNameError(message) {
  removeNameError();
  const errorDiv = document.createElement('div');
  errorDiv.id = 'nameError';
  errorDiv.style.cssText = `
    color: #f44336;
    font-size: 14px;
    margin-top: 5px;
    padding: 8px;
    background: rgba(244, 67, 54, 0.1);
    border: 1px solid #f44336;
    border-radius: 4px;
    font-family: 'VT323', monospace;
  `;
  errorDiv.textContent = message;
  const nameInput = document.querySelector('input[placeholder="Full Name"]');
  if (nameInput) nameInput.parentNode.insertBefore(errorDiv, nameInput.nextSibling);
}

function removeNameError() {
  const existing = document.getElementById('nameError');
  if (existing) existing.remove();
}
// ─────────────────────────────────────────────────────────────────────────────

function validatePhoneNumber(phone) {
  // Remove all non-digit characters for validation
  const cleaned = phone.replace(/\D/g, '');
  
  // Check if it's empty
  if (!cleaned) {
    return { isValid: false, message: "Phone number is required" };
  }
  
  // Check if it contains only digits and is reasonable length
  if (!/^\d+$/.test(cleaned)) {
    return { isValid: false, message: "Phone number can only contain numbers" };
  }
  
  // Check for Australian mobile numbers (10 digits starting with 0)
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    return { isValid: true, message: "Valid Australian mobile number" };
  }
  
  // Check for Australian mobile numbers with country code (11 digits starting with 61)
  if (cleaned.startsWith('61') && cleaned.length === 11) {
    return { isValid: true, message: "Valid Australian mobile number" };
  }
  
  // Check for international numbers (7-15 digits)
  if (cleaned.length >= 7 && cleaned.length <= 15) {
    return { isValid: true, message: "Valid international number" };
  }
  
  // If none of the above patterns match
  return { isValid: false, message: "Please enter a valid phone number (10 digits for Australian numbers)" };
}

// Function to show phone validation error
function showPhoneError(message) {
  // Remove any existing error message
  const existingError = document.getElementById('phoneError');
  if (existingError) {
    existingError.remove();
  }
  
  // Create error message element
  const errorDiv = document.createElement('div');
  errorDiv.id = 'phoneError';
  errorDiv.style.cssText = `
    color: #f44336;
    font-size: 14px;
    margin-top: 5px;
    padding: 8px;
    background: rgba(244, 67, 54, 0.1);
    border: 1px solid #f44336;
    border-radius: 4px;
    font-family: 'VT323', monospace;
  `;
  errorDiv.textContent = message;
  
  // Insert after the phone input field
  const phoneInput = document.querySelector('input[placeholder="Phone Number"]');
  if (phoneInput) {
    phoneInput.parentNode.insertBefore(errorDiv, phoneInput.nextSibling);
  }
}

// Function to remove phone validation error
function removePhoneError() {
  const existingError = document.getElementById('phoneError');
  if (existingError) {
    existingError.remove();
  }
}
