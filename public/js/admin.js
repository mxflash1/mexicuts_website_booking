document.addEventListener("DOMContentLoaded", async function () {
  // Initialize Firebase with secure configuration
  let firebaseConfig = null;
  
  // Make db global so other scripts can access it
  window.db = null;

  try {
    // Load Firebase configuration securely
    firebaseConfig = await window.firebaseConfigManager.loadConfig();
    
    // Initialize Firebase
    firebase.initializeApp(firebaseConfig);
    window.db = firebase.firestore();
    
    console.log('✅ Firebase initialized successfully in admin panel');
  } catch (error) {
    console.error('❌ Failed to initialize Firebase in admin panel:', error);
    
    // Show user-friendly error message
    document.body.innerHTML = `
      <div style="
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        background: #1a1a1a;
        color: white;
        font-family: Arial, sans-serif;
        text-align: center;
        padding: 20px;
      ">
        <div style="
          background: #2a2a2a;
          padding: 40px;
          border-radius: 12px;
          border: 2px solid #f44336;
          max-width: 500px;
        ">
          <h2 style="color: #f44336; margin-bottom: 20px;">❌ Configuration Error</h2>
          <p style="margin-bottom: 20px; line-height: 1.6;">
            Unable to load admin panel configuration.<br>
            Please check your Firebase setup.
          </p>
          <button onclick="location.reload()" style="
            background: #CE1126;
            color: white;
            padding: 12px 24px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 16px;
          ">Retry</button>
        </div>
      </div>
    `;
    return;
  }

  // Initialize availability management
  const adminAvailability = new AdminAvailabilityManager(window.db);
  await adminAvailability.loadConfig();
  
  // Make adminAvailability globally available for blocked dates functions
  window.adminAvailability = adminAvailability;
  
  // Generate and insert the availability form
  const formContainer = document.getElementById('availability-form');
  formContainer.innerHTML = adminAvailability.generateAdminForm();
  
  // Set up event listeners
  adminAvailability.setupEventListeners();
  
  // Initialize blocked dates management
  adminAvailability.initializeBlockedDates();

  const calendarEl = document.getElementById("calendar");
  const events = [];
  const bookingData = new Map(); // Store booking data for editing

  // Add availability background events
  function addAvailabilityEvents(events, availabilityManager) {
    if (!availabilityManager.config) return;

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today = new Date();
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay());
    
    for (let i = 0; i < 14; i++) { // Show 2 weeks
      const currentDate = new Date(startOfWeek);
      currentDate.setDate(startOfWeek.getDate() + i);
      
      const dayName = days[currentDate.getDay()];
      const dayConfig = availabilityManager.config.businessHours[dayName];
      // Use local date formatting instead of UTC to avoid timezone issues
      const year = currentDate.getFullYear();
      const month = String(currentDate.getMonth() + 1).padStart(2, '0');
      const day = String(currentDate.getDate()).padStart(2, '0');
      const dateStr = `${year}-${month}-${day}`;
      
      // Check if this date is blocked
      const isBlocked = availabilityManager.isDateBlocked(dateStr);
      
      if (isBlocked) {
        // Add blocked date as background event
        events.push({
          start: `${dateStr}T00:00:00`,
          end: `${dateStr}T23:59:59`,
          display: 'background',
          color: '#4a1a1a', // Dark red for blocked dates
          title: `Blocked: ${isBlocked.reason || 'No reason provided'}`
        });
      } else if (dayConfig && dayConfig.enabled) {
        // Add open hours as background events
        const startTime = `${dateStr}T${dayConfig.startTime}:00`;
        const endTime = `${dateStr}T${dayConfig.endTime}:00`;
        
        events.push({
          start: startTime,
          end: endTime,
          display: 'background',
          color: '#1a4a1a', // Dark green for open hours
          title: 'Open Hours'
        });
      }
    }
  }

  // Load bookings and create events
  window.db.collection("bookings").get().then(snapshot => {
    snapshot.forEach(doc => {
      const data = doc.data();

      if (data.timeSlot) {
        const match = data.timeSlot.match(/^(\d{4}-\d{2}-\d{2}) (\d{1,2}):(\d{2}) (AM|PM)$/);
        if (!match) {
          console.warn("Skipping malformed timeSlot:", data.timeSlot);
          return;
        }

        const [, datePart, rawHour, rawMinute, ampm] = match;
        let hour = parseInt(rawHour, 10);
        const minute = parseInt(rawMinute, 10);

        if (ampm === "PM" && hour !== 12) hour += 12;
        if (ampm === "AM" && hour === 12) hour = 0;

        const isoTime = `${datePart}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
        const endTime = new Date(new Date(isoTime).getTime() + 30 * 60000).toISOString();

        // Store booking data for editing
        bookingData.set(doc.id, {
          id: doc.id,
          name: data.name,
          phone: data.phone,
          timeSlot: data.timeSlot,
          notes: data.notes || '',
          timestamp: data.timestamp
        });

        events.push({
          id: doc.id,
          title: `${data.name}`,
          start: isoTime,
          end: endTime,
          allDay: false,
          backgroundColor: '#CE1126',
          borderColor: '#CE1126',
          textColor: 'white',
          extendedProps: {
            bookingId: doc.id,
            customerName: data.name,
            customerPhone: data.phone,
            appointmentTime: data.timeSlot,
            notes: data.notes || 'None'
          }
        });
      } else {
        console.warn("Missing timeSlot on doc:", doc.id);
      }
    });

    // Add availability background events
    addAvailabilityEvents(events, adminAvailability);

    const calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: "timeGridWeek",
      slotDuration: "00:30:00",
      slotLabelInterval: "01:00",
      slotMinTime: "06:00:00",
      slotMaxTime: "22:00:00",
      events: events,
      themeSystem: "standard",
      height: "auto",
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'timeGridWeek,timeGridDay'
      },
      eventClick: function(info) {
        // Only handle booking events (not background availability events)
        if (info.event.extendedProps.bookingId) {
          showBookingModal(info.event.extendedProps.bookingId, bookingData.get(info.event.extendedProps.bookingId));
        }
      }
    });

    calendar.render();
  }).catch(error => {
    console.error("Error fetching bookings:", error);
  });

  // Show booking management modal
  function showBookingModal(bookingId, booking) {
    const modal = document.getElementById("bookingModal");
    const form = document.getElementById("bookingForm");
    
    // Populate form with booking data
    document.getElementById("editName").value = booking.name;
    document.getElementById("editPhone").value = booking.phone;
    document.getElementById("editTimeSlot").value = booking.timeSlot;
    document.getElementById("editNotes").value = booking.notes;
    
    modal.style.display = "block";
    
    // Handle form submission (update booking)
    form.onsubmit = async function(e) {
      e.preventDefault();
      
      const updatedData = {
        name: document.getElementById("editName").value,
        phone: document.getElementById("editPhone").value,
        timeSlot: document.getElementById("editTimeSlot").value,
        notes: document.getElementById("editNotes").value,
        timestamp: booking.timestamp // Keep original timestamp
      };
      
      try {
        await window.db.collection("bookings").doc(bookingId).update(updatedData);
        showStatusMessage("✅ Booking updated successfully!", "success");
        modal.style.display = "none";
        setTimeout(() => location.reload(), 1000); // Refresh after showing success
      } catch (error) {
        console.error("Error updating booking:", error);
        showStatusMessage("❌ Error updating booking. Please try again.", "error");
      }
    };
    
    // Handle delete button
    document.getElementById("deleteBooking").onclick = function() {
      showDeleteConfirmation(booking.name, () => deleteBooking(bookingId));
    };
  }

  // Delete booking function
  async function deleteBooking(bookingId) {
    try {
      await window.db.collection("bookings").doc(bookingId).delete();
      showStatusMessage("✅ Booking deleted successfully!", "success");
      document.getElementById("bookingModal").style.display = "none";
      setTimeout(() => location.reload(), 1000); // Refresh after showing success
    } catch (error) {
      console.error("Error deleting booking:", error);
      showStatusMessage("❌ Error deleting booking. Please try again.", "error");
    }
  }

  // Show status message instead of alerts
  function showStatusMessage(message, type) {
    // Remove any existing status messages
    const existingStatus = document.getElementById("statusMessage");
    if (existingStatus) {
      existingStatus.remove();
    }

    // Create status message
    const statusDiv = document.createElement("div");
    statusDiv.id = "statusMessage";
    statusDiv.innerHTML = message;
    // Check if mobile
    const isMobile = window.innerWidth <= 768;
    
    statusDiv.style.cssText = `
      position: fixed;
      ${isMobile ? 
        'top: 10px; right: 10px; left: 10px; transform: translateY(-100px);' : 
        'top: 20px; right: 20px; transform: translateX(400px);'
      }
      z-index: 2000;
      padding: ${isMobile ? '12px 15px' : '15px 25px'};
      border-radius: 8px;
      font-weight: bold;
      font-size: ${isMobile ? '14px' : '16px'};
      box-shadow: 0 4px 20px rgba(0,0,0,0.3);
      transition: transform 0.3s ease;
      ${type === 'success' ? 
        'background: #4CAF50; color: white; border: 2px solid #45a049;' : 
        'background: #f44336; color: white; border: 2px solid #da190b;'
      }
    `;

    document.body.appendChild(statusDiv);

    // Animate in
    setTimeout(() => {
      statusDiv.style.transform = isMobile ? "translateY(0)" : "translateX(0)";
    }, 100);

    // Auto remove after 3 seconds
    setTimeout(() => {
      statusDiv.style.transform = isMobile ? "translateY(-100px)" : "translateX(400px)";
      setTimeout(() => {
        if (statusDiv.parentNode) {
          statusDiv.remove();
        }
      }, 300);
    }, 3000);
  }

  // Show custom delete confirmation
  function showDeleteConfirmation(customerName, onConfirm) {
    // Remove any existing confirmation
    const existingConfirm = document.getElementById("deleteConfirmation");
    if (existingConfirm) {
      existingConfirm.remove();
    }

    // Create confirmation modal
    const confirmDiv = document.createElement("div");
    confirmDiv.id = "deleteConfirmation";
    confirmDiv.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0,0,0,0.8);
      z-index: 2000;
      display: flex;
      align-items: center;
      justify-content: center;
    `;

    confirmDiv.innerHTML = `
      <div style="
        background: #2a2a2a;
        padding: 30px;
        border-radius: 12px;
        border: 2px solid #f44336;
        color: white;
        text-align: center;
        max-width: 400px;
        margin: 20px;
      ">
        <h3 style="color: #f44336; margin-bottom: 20px; font-size: 20px;">🗑️ Delete Booking</h3>
        <p style="margin-bottom: 25px; color: #ccc; line-height: 1.5;">
          Are you sure you want to delete the booking for<br>
          <strong style="color: white;">${customerName}</strong>?
        </p>
        <div style="display: flex; gap: 15px;">
          <button id="confirmDelete" style="
            flex: 1;
            background: #f44336;
            color: white;
            padding: 12px 20px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 15px;
            font-weight: bold;
          ">Yes, Delete</button>
          <button id="cancelDelete" style="
            flex: 1;
            background: #555;
            color: white;
            padding: 12px 20px;
            border: none;
            border-radius: 6px;
            cursor: pointer;
            font-size: 15px;
            font-weight: bold;
          ">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(confirmDiv);

    // Handle buttons
    document.getElementById("confirmDelete").onclick = () => {
      confirmDiv.remove();
      onConfirm();
    };

    document.getElementById("cancelDelete").onclick = () => {
      confirmDiv.remove();
    };

    // Close on background click
    confirmDiv.onclick = (e) => {
      if (e.target === confirmDiv) {
        confirmDiv.remove();
      }
    };
  }

  // Close modal when clicking outside or on close button
  window.onclick = function(event) {
    const modal = document.getElementById("bookingModal");
    if (event.target === modal) {
      modal.style.display = "none";
    }
  };

  document.querySelector(".close-booking-modal").onclick = function() {
    document.getElementById("bookingModal").style.display = "none";
  };

  // ===========================================================================
  // MANUAL BOOKING FUNCTIONALITY
  // ===========================================================================

  // Open manual booking modal
  document.getElementById("addManualBookingBtn").onclick = function() {
    document.getElementById("manualBookingModal").style.display = "block";
    // Set default date to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById("manualDate").value = today;
  };

  // Close manual booking modal
  document.querySelector(".close-manual-booking-modal").onclick = function() {
    document.getElementById("manualBookingModal").style.display = "none";
  };

  // Close manual booking modal on background click
  window.onclick = function(event) {
    const manualModal = document.getElementById("manualBookingModal");
    const bookingModal = document.getElementById("bookingModal");
    
    if (event.target === manualModal) {
      manualModal.style.display = "none";
    }
    if (event.target === bookingModal) {
      bookingModal.style.display = "none";
    }
  };

  // Global function to close manual booking modal
  window.closeManualBookingModal = function() {
    document.getElementById("manualBookingModal").style.display = "none";
  };

  // Handle manual booking form submission
  document.getElementById("manualBookingForm").onsubmit = async function(e) {
    e.preventDefault();

    const name = document.getElementById("manualName").value;
    const phone = document.getElementById("manualPhone").value;
    const date = document.getElementById("manualDate").value; // YYYY-MM-DD
    const time = document.getElementById("manualTime").value; // "08:00 AM"
    const notes = document.getElementById("manualNotes").value;

    // Format timeSlot: "2026-01-17 08:00 AM"
    const timeSlot = `${date} ${time}`;

    // Check if this phone number belongs to an existing user
    let userId = null;
    try {
      const usersSnapshot = await window.db.collection('users')
        .where('phone', '==', phone)
        .get();

      if (!usersSnapshot.empty) {
        // User exists - get their userId
        userId = usersSnapshot.docs[0].id;
        const userData = usersSnapshot.docs[0].data();
        console.log(`Found existing user: ${userData.name} (${userId})`);
      } else {
        console.log('No user account found for this phone number - booking as guest');
      }
    } catch (error) {
      console.error('Error checking for existing user:', error);
    }

    // Create booking data
    const bookingData = {
      name: name,
      phone: phone,
      timeSlot: timeSlot,
      notes: notes,
      timestamp: firebase.firestore.FieldValue.serverTimestamp()
    };

    // Add userId if user exists
    if (userId) {
      bookingData.userId = userId;
    }

    try {
      await window.db.collection("bookings").add(bookingData);
      
      // Update user's booking count if linked to account
      if (userId) {
        try {
          // Get current booking count
          const userBookingsSnapshot = await window.db.collection('bookings')
            .where('userId', '==', userId)
            .get();
          
          const newBookingCount = userBookingsSnapshot.size;
          
          // Update user document
          await window.db.collection('users').doc(userId).update({
            bookingCount: newBookingCount
          });
          
          console.log(`✅ Updated booking count for user: ${newBookingCount}`);
        } catch (countError) {
          console.error('Error updating booking count:', countError);
        }
      }
      
      showStatusMessage(`✅ Booking created successfully!${userId ? ' (Linked to user account)' : ' (Guest booking)'}`, "success");
      document.getElementById("manualBookingModal").style.display = "none";
      document.getElementById("manualBookingForm").reset();
      
      // Reload calendar to show new booking
      setTimeout(() => location.reload(), 1000);
    } catch (error) {
      console.error("Error creating booking:", error);
      showStatusMessage("❌ Error creating booking. Please try again.", "error");
    }
  };
});