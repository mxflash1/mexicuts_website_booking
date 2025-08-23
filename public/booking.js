
// Firebase configuration will be loaded securely
let firebaseConfig = null;

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
    
    console.log('✅ Firebase initialized successfully');
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

  const bulldogFrames = ["lil_logo_opened.png", "lil_logo_closed.png"];
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

  const frames = ["logo_open.png", "logo_closed.png"];
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
        return !enabledDays.includes(day);
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

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = form.querySelector('input[placeholder="Full Name"]').value;
    const phone = form.querySelector('input[placeholder="Phone Number"]').value;
    const notes = form.querySelector('textarea').value;
    const timeSlotField = document.getElementById("timeSlotHidden");
    const timeSlot = timeSlotField ? timeSlotField.value : "Not selected";

    const data = {
      name,
      phone,
      timeSlot,
      notes,
      timestamp: new Date()
    };

    try {
      await db.collection("bookings").add(data);
      confetti();
      showPopup("✅ Booking Confirmed!");
      form.reset();
      slotContainer.innerHTML = '';
    } catch (err) {
      alert("Something went wrong. Try again.");
      console.error(err);
    }
  });
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
