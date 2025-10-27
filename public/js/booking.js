
// Booking.js v5.0 - Authentication Integration
console.log('🚀 Booking.js v5.0 loaded - Authentication & user bookings enabled');

// Firebase configuration will be loaded securely
let firebaseConfig = null;
let authManager = null;



function showPopup(message) {
  let popup = document.getElementById("popupMessage");
  if (!popup) {
    popup = document.createElement("div");
    popup.id = "popupMessage";
    document.body.appendChild(popup);
  }
  popup.textContent = message;
  popup.classList.add("show");
  setTimeout(() => popup.classList.remove("show"), 2000);
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

  const bulldogFrames = ["images/lil_logo_opened.png", "images/lil_logo_closed.png"];
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
  db.collection("bookings").onSnapshot(snapshot => {
    bookedSlots = snapshot.docs.map(doc => doc.data().timeSlot);
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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = form.querySelector('input[placeholder="Full Name"]').value;
    const phone = form.querySelector('input[placeholder="Phone Number"]').value;
    const notes = form.querySelector('textarea').value;
    const timeSlotField = document.getElementById("timeSlotHidden");
    const timeSlot = timeSlotField ? timeSlotField.value : "Not selected";

    // Validate phone number before submitting
    const phoneValidation = validatePhoneNumber(phone);
    if (!phoneValidation.isValid) {
      showPhoneError(phoneValidation.message);
      return; // Stop the form submission
    }

    // Remove any error messages if phone is valid
    removePhoneError();

    const data = {
      name,
      phone,
      timeSlot,
      notes,
      timestamp: new Date()
    };

    // Add userId if user is logged in
    if (authManager && authManager.isLoggedIn()) {
      const currentUser = authManager.getCurrentUser();
      if (currentUser) {
        data.userId = currentUser.uid;
        console.log('Adding userId to booking:', currentUser.uid);
      }
    }

    try {
      await db.collection("bookings").add(data);
      confetti();
      showPopup("✅ Booking Confirmed!");
      
      // Show calendar option after successful booking
      showCalendarOption(data);
      
      // Refresh user bookings if logged in
      if (authManager && authManager.isLoggedIn() && window.refreshUserBookings) {
        setTimeout(() => {
          window.refreshUserBookings();
        }, 1000);
      }
      
      form.reset();
      slotContainer.innerHTML = '';
      
      // Re-apply auto-fill if logged in (and not in guest mode)
      if (authManager && authManager.isLoggedIn() && !window.guestBookingMode) {
        setTimeout(() => {
          authManager.autoFillBookingForm();
        }, 100);
      }
    } catch (err) {
      console.error('Error saving booking:', err);
      alert("Something went wrong. Try again.");
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
        <button onclick="addToCalendar('${bookingData.timeSlot}', '${bookingData.name}')" 
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

function addToCalendar(timeSlot, customerName) {
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
    const eventDetails = {
      title: 'Mexi Cuts - Haircut Appointment',
      description: `Haircut appointment with Mexi Cuts\n\nService: Haircut\nPrice: $20\nLocation: 6 Rosella Tce, Peregian Springs, Sunshine Coast, QLD\nContact: 0402098123\nInstagram: @mexi_cuts\n\nPlease arrive 5 minutes early.`,
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
    console.log('🔍 Look Up button clicked!');
    const phone = lookupPhone.value.trim();
    
    if (!phone) {
      alert('Please enter your phone number.');
      return;
    }
    
    console.log('Looking up booking for phone:', phone);
    
    try {
      // Format phone number for search
      const formattedPhone = formatPhoneNumber(phone);
      console.log('Formatted phone:', formattedPhone);
      
      // Search for bookings with this phone number (simplified query to avoid index requirement)
      let bookingsSnapshot = await db.collection("bookings")
        .where("phone", "==", formattedPhone)
        .get();
      
      // If no results with formatted phone, try with original phone number
      if (bookingsSnapshot.empty) {
        console.log('No results with formatted phone, trying original...');
        bookingsSnapshot = await db.collection("bookings")
          .where("phone", "==", phone)
          .get();
      }
      
      // If still no results, let's get ALL bookings to see what phone formats exist
      if (bookingsSnapshot.empty) {
        console.log('No results with either format, getting all bookings to debug...');
        const allBookings = await db.collection("bookings").get();
        console.log('All bookings in database:', allBookings.docs.map(doc => ({
          id: doc.id,
          phone: doc.data().phone,
          name: doc.data().name,
          timeSlot: doc.data().timeSlot
        })));
        
        lookupResults.innerHTML = `
          <div style="text-align: center; padding: 20px; background: #2a2a2a; border-radius: 8px; border: 1px solid #555;">
            <p style="color: #ccc; margin: 0;">No bookings found for this phone number.</p>
            <p style="color: #666; margin: 5px 0; font-size: 12px;">Debug: Check console for database contents</p>
            <p style="color: #666; margin: 5px 0; font-size: 12px;">Searched for: "${phone}" and "${formattedPhone}"</p>
          </div>
        `;
        lookupResults.style.display = 'block';
        return;
      }
      
      console.log('Found bookings:', bookingsSnapshot.size);
      
      if (bookingsSnapshot.empty) {
        lookupResults.innerHTML = `
          <div style="text-align: center; padding: 20px; background: #2a2a2a; border-radius: 8px; border: 1px solid #555;">
            <p style="color: #ccc; margin: 0;">No bookings found for this phone number.</p>
          </div>
        `;
        lookupResults.style.display = 'block';
        return;
      }
      
      // Display bookings
      let resultsHTML = '<div style="text-align: center; margin-bottom: 20px;"><h4 style="color: #CE1126; margin: 0;">Your Bookings:</h4></div>';
      
      bookingsSnapshot.forEach(doc => {
        const booking = doc.data();
        console.log('Booking data:', booking);
        
        const timeSlot = booking.timeSlot;
        const [date, time] = timeSlot.split(' ');
        
        // Format date for display
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
            <button onclick="cancelBooking('${doc.id}', '${booking.name}')" 
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
      alert('Sorry, there was an error looking up your booking. Please try again.');
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

// Perform the actual cancellation
async function performCancellation(bookingId, customerName) {
  try {
    await db.collection("bookings").doc(bookingId).delete();
    
    // Show success message
    showPopup("✅ Booking cancelled successfully!");
    
    // Refresh the lookup results
    document.getElementById('lookupResults').style.display = 'none';
    document.getElementById('lookupPhone').value = '';
    
    // Refresh user bookings if logged in
    if (window.refreshUserBookings) {
      setTimeout(() => {
        window.refreshUserBookings();
      }, 500);
    }
    
  } catch (error) {
    console.error('Error cancelling booking:', error);
    alert('Sorry, there was an error cancelling your booking. Please try again.');
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
