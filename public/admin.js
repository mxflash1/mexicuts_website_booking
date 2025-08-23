document.addEventListener("DOMContentLoaded", async function () {
  // Initialize Firebase with secure configuration
  let firebaseConfig = null;
  let db = null;

  try {
    // Load Firebase configuration securely
    firebaseConfig = await window.firebaseConfigManager.loadConfig();
    
    // Initialize Firebase
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    
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
  const adminAvailability = new AdminAvailabilityManager(db);
  await adminAvailability.loadConfig();
  
  // Generate and insert the availability form
  const formContainer = document.getElementById('availability-form');
  formContainer.innerHTML = adminAvailability.generateAdminForm();
  
  // Set up event listeners
  adminAvailability.setupEventListeners();

  const calendarEl = document.getElementById("calendar");
  const events = [];
  const bookingData = new Map(); // Store booking data for editing

  // Add availability background events
  function addAvailabilityEvents(events, availabilityManager) {
    if (!availabilityManager.config) return;

    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const today = new Date();
    const startOfWeek = new Date(today.setDate(today.getDate() - today.getDay()));
    
    for (let i = 0; i < 14; i++) { // Show 2 weeks
      const currentDate = new Date(startOfWeek);
      currentDate.setDate(startOfWeek.getDate() + i);
      
      const dayName = days[currentDate.getDay()];
      const dayConfig = availabilityManager.config.businessHours[dayName];
      
      if (dayConfig && dayConfig.enabled) {
        // Add open hours as background events
        const dateStr = currentDate.toISOString().split('T')[0];
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
  db.collection("bookings").get().then(snapshot => {
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
        await db.collection("bookings").doc(bookingId).update(updatedData);
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
      await db.collection("bookings").doc(bookingId).delete();
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
});