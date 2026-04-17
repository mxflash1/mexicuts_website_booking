document.addEventListener("DOMContentLoaded", function () {
  async function startAdminPanel() {
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

  // Load bookings and create events for calendar
  // Show only approved bookings in the calendar, but treat old bookings
  // without a status field as approved so history still appears.
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
          service: data.service || '',
          price: data.price || null,
          status: data.status || 'pending',
          timestamp: data.timestamp,
          lastRescheduleSms: data.lastRescheduleSms || null
        });

        // Only approved (or legacy with no status) go into the calendar view
        const status = data.status || 'approved';
        if (status !== 'approved') {
          return;
        }

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

    // Expose booking data globally so the search bar can access it
    window.allBookingData = bookingData;

    // ── Booking Search ────────────────────────────────────────────────────
    const searchInput = document.getElementById('bookingSearch');
    const searchResults = document.getElementById('bookingSearchResults');

    if (searchInput && searchResults) {
      searchInput.addEventListener('input', function () {
        const query = this.value.trim().toLowerCase();

        if (!query) {
          searchResults.style.display = 'none';
          searchResults.innerHTML = '';
          return;
        }

        const matches = [];
        window.allBookingData.forEach((booking, id) => {
          const haystack = [
            booking.name || '',
            booking.phone || '',
            booking.timeSlot || '',
            booking.notes || ''
          ].join(' ').toLowerCase();

          if (haystack.includes(query)) {
            matches.push({ id, ...booking });
          }
        });

        if (matches.length === 0) {
          searchResults.innerHTML = '<p style="color:#999; text-align:center; padding:12px;">No bookings found.</p>';
          searchResults.style.display = 'block';
          return;
        }

        // Sort by timeSlot descending (most recent first)
        matches.sort((a, b) => (b.timeSlot || '').localeCompare(a.timeSlot || ''));

        let html = `<p style="color:#777; font-size:12px; margin-bottom:8px;">${matches.length} result${matches.length === 1 ? '' : 's'} found</p>`;
        matches.forEach(b => {
          const statusColor = b.status === 'approved' ? '#4CAF50'
                            : b.status === 'rejected' ? '#f44336'
                            : '#FFC107';
          const statusLabel = (b.status || 'approved').toUpperCase();
          html += `
            <div onclick="window.showBookingModal('${b.id}', window.allBookingData.get('${b.id}'))"
                 style="background:#1a1a1a; border:1px solid #444; border-radius:8px; padding:12px 14px;
                        margin-bottom:8px; cursor:pointer; transition:border-color 0.2s;"
                 onmouseover="this.style.borderColor='#CE1126'"
                 onmouseout="this.style.borderColor='#444'">
              <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px;">
                <div style="flex:1; min-width:0;">
                  <div style="color:white; font-weight:bold; font-size:15px;">${b.name || 'Unknown'}</div>
                  <div style="color:#aaa; font-size:13px;">${b.phone || ''}</div>
                  <div style="color:#ccc; font-size:13px; margin-top:2px;">📅 ${b.timeSlot || ''}</div>
                  ${b.notes ? `<div style="color:#888; font-size:12px; margin-top:4px;">📝 ${b.notes}</div>` : ''}
                </div>
                <span style="color:${statusColor}; font-size:11px; font-weight:bold; flex-shrink:0;">${statusLabel}</span>
              </div>
            </div>
          `;
        });

        searchResults.innerHTML = html;
        searchResults.style.display = 'block';
      });
    }
    // ─────────────────────────────────────────────────────────────────────

    const calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: "timeGridWeek",
      slotDuration: "00:30:00",
      slotLabelInterval: "01:00",
      slotMinTime: "00:00:00",
      slotMaxTime: "24:00:00",
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
    console.error("Error fetching approved bookings:", error);
  });

  // Load PENDING bookings for separate list
  async function loadPendingBookings() {
    const container = document.getElementById('pendingBookingsList');
    if (!container) return;

    try {
      // Show both pending and rejected bookings in this list so a mistaken
      // reject can be corrected, and you can delete after rejecting.
      const snapshot = await window.db.collection('bookings')
        .where('status', 'in', ['pending', 'rejected'])
        .get();

      if (snapshot.empty) {
        container.innerHTML = `
          <p style="text-align:center; color:#999; padding:10px;">
            No pending bookings right now.
          </p>
        `;
        return;
      }

      let html = '';
      snapshot.forEach(doc => {
        const data = doc.data();
        const id = doc.id;
        const status = data.status || 'pending';
        const statusLabel = status.toUpperCase();
        const statusColor = status === 'approved' ? '#4CAF50'
                            : status === 'rejected' ? '#f44336'
                            : '#FFC107';
        html += `
          <div style="background:#1a1a1a; border:1px solid #555; border-radius:8px; padding:12px 14px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center; gap:10px;">
            <div style="flex:1; min-width:0;">
              <div style="color:white; font-weight:bold; font-size:14px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                ${data.name || 'Unknown'} (${data.phone || 'N/A'})
              </div>
              <div style="color:#ccc; font-size:13px; margin-top:2px;">
                ${data.timeSlot || ''}
              </div>
              ${data.service ? `<div style="color:#a0cfff; font-size:12px; margin-top:2px;">✂️ ${data.service}${data.price ? ` — $${data.price}` : ''}</div>` : ''}
              <div style="color:${statusColor}; font-size:11px; margin-top:2px; font-weight:bold;">
                ${statusLabel}
              </div>
            </div>
            <div style="display:flex; gap:6px; flex-shrink:0;">
              <button onclick="window.approvePendingBooking('${id}')" 
                      style="background:#4CAF50; color:white; border:none; padding:6px 10px; border-radius:6px; font-size:12px; cursor:pointer;">
                ✅ Accept
              </button>
              <button onclick="window.rejectPendingBooking('${id}')" 
                      style="background:#f0ad4e; color:white; border:none; padding:6px 10px; border-radius:6px; font-size:12px; cursor:pointer;">
                ❌ Reject
              </button>
              <button onclick="window.deletePendingBooking('${id}')" 
                      style="background:#CE1126; color:white; border:none; padding:6px 10px; border-radius:6px; font-size:12px; cursor:pointer;">
                🗑️ Delete
              </button>
            </div>
          </div>
        `;
      });

      container.innerHTML = html;
    } catch (err) {
      console.error('Error loading pending bookings:', err);
    }
  }

  // Expose so Pending tab can call it
  window.loadPendingBookings = loadPendingBookings;

  // Expose showBookingModal globally so search results can open it
  window.showBookingModal = function(bookingId, booking) {
    showBookingModal(bookingId, booking);
  };

  // Show booking management modal
  function showBookingModal(bookingId, booking) {
    const modal = document.getElementById("bookingModal");
    const form = document.getElementById("bookingForm");
    
    // Populate form with booking data
    document.getElementById("editName").value = booking.name;
    document.getElementById("editPhone").value = booking.phone;
    document.getElementById("editNotes").value = booking.notes;

    // Populate unrestricted date + time pickers
    const timeSelect = document.getElementById("editTimeSelect");
    if (timeSelect && !timeSelect.dataset.populated) {
      // Build a full day of 30-min slots (12:00 AM → 11:30 PM) so admin can pick any time
      timeSelect.innerHTML = '';
      for (let h = 0; h < 24; h++) {
        for (let m of [0, 30]) {
          const ampm = h < 12 ? 'AM' : 'PM';
          const h12 = h % 12 === 0 ? 12 : h % 12;
          const label = `${String(h12).padStart(2,'0')}:${m === 0 ? '00' : '30'} ${ampm}`;
          const opt = document.createElement('option');
          opt.value = label;
          opt.textContent = label;
          timeSelect.appendChild(opt);
        }
      }
      timeSelect.dataset.populated = 'true';
    }

    // Pre-select the existing date and time from the stored timeSlot
    if (booking.timeSlot) {
      const tsParts = booking.timeSlot.split(' '); // ["2026-03-21", "08:00", "AM"]
      if (tsParts.length >= 1) document.getElementById("editDate").value = tsParts[0];
      if (tsParts.length >= 3 && timeSelect) timeSelect.value = `${tsParts[1]} ${tsParts[2]}`;
    }
    document.getElementById("editTimeSlot").value = booking.timeSlot || '';

    const serviceLabelEl = document.getElementById("bookingServiceLabel");
    if (serviceLabelEl) {
      const svc = booking.service || '—';
      const prc = booking.price ? ` ($${booking.price})` : '';
      serviceLabelEl.textContent = svc + prc;
    }

    const statusLabelEl = document.getElementById("bookingStatusLabel");
    if (statusLabelEl) {
      const status = booking.status || 'pending';
      statusLabelEl.textContent = status.toUpperCase();
      statusLabelEl.style.color = status === 'approved' ? '#4CAF50' :
                                  status === 'rejected' ? '#f44336' : '#FFC107';
    }
    
    modal.style.display = "block";
    
    // Handle form submission (update booking)
    form.onsubmit = async function(e) {
      e.preventDefault();

      const editDate = document.getElementById("editDate").value;
      const editTimeVal = document.getElementById("editTimeSelect").value;
      const newTimeSlot = editDate && editTimeVal ? `${editDate} ${editTimeVal}` : booking.timeSlot;
      const oldTimeSlot = booking.timeSlot;

      const updatedData = {
        name: document.getElementById("editName").value,
        phone: document.getElementById("editPhone").value,
        timeSlot: newTimeSlot,
        notes: document.getElementById("editNotes").value,
        timestamp: booking.timestamp
      };

      try {
        await window.db.collection("bookings").doc(bookingId).update(updatedData);

        // If the time changed, update bookedSlots and notify the client via SMS
        if (newTimeSlot !== oldTimeSlot) {
          // Remove old slot, add new slot
          try {
            const oldSlotId = oldTimeSlot.replace(/[\s:]/g, '_');
            const newSlotId = newTimeSlot.replace(/[\s:]/g, '_');
            await window.db.collection('bookedSlots').doc(oldSlotId).delete();
            await window.db.collection('bookedSlots').doc(newSlotId).set({
              timeSlot: newTimeSlot,
              bookingId: bookingId,
              createdAt: firebase.firestore.FieldValue.serverTimestamp()
            });
          } catch (slotErr) {
            console.warn('Could not update bookedSlots:', slotErr);
          }

          // Send SMS to client
          try {
            const baseUrl = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net`;
            const smsResp = await fetch(`${baseUrl}/notifyReschedule`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                bookingId,
                newTimeSlot,
                phone: updatedData.phone,
                name: updatedData.name
              })
            });
            const smsResult = await smsResp.json().catch(() => ({}));
            if (smsResp.ok && smsResult.success) {
              // Record send time in Firestore so the modal can display it
              await window.db.collection('bookings').doc(bookingId).update({
                lastRescheduleSms: firebase.firestore.FieldValue.serverTimestamp()
              });
              showStatusMessage("✅ Booking updated & reschedule SMS sent!", "success");
            } else {
              console.warn('Reschedule SMS rejected by server:', smsResult);
              showStatusMessage(`✅ Booking updated! ⚠️ SMS failed: ${smsResult.message || 'check Twilio logs'}`, "success");
            }
          } catch (smsErr) {
            console.warn('Reschedule SMS network error (booking still saved):', smsErr);
            showStatusMessage("✅ Booking updated! ⚠️ SMS could not be sent.", "success");
          }
        } else {
          showStatusMessage("✅ Booking updated successfully!", "success");
        }

        modal.style.display = "none";
        setTimeout(() => location.reload(), 1200);
      } catch (error) {
        console.error("Error updating booking:", error);
        showStatusMessage("❌ Error updating booking. Please try again.", "error");
      }
    };
    
    // Handle status changes without sending extra emails
    const approveBtn = document.getElementById("approveBookingBtn");
    const rejectBtn = document.getElementById("rejectBookingBtn");

    if (approveBtn) {
      approveBtn.onclick = async function () {
        try {
          await window.db.collection("bookings").doc(bookingId).update({
            status: 'approved'
          });
          showStatusMessage("✅ Booking marked as approved", "success");
          if (statusLabelEl) {
            statusLabelEl.textContent = 'APPROVED';
            statusLabelEl.style.color = '#4CAF50';
          }
        } catch (err) {
          console.error("Error approving booking:", err);
          showStatusMessage("❌ Error approving booking", "error");
        }
      };
    }

    if (rejectBtn) {
      rejectBtn.onclick = async function () {
        try {
          await window.db.collection("bookings").doc(bookingId).update({
            status: 'rejected'
          });
          showStatusMessage("✅ Booking marked as rejected", "success");
          if (statusLabelEl) {
            statusLabelEl.textContent = 'REJECTED';
            statusLabelEl.style.color = '#f44336';
          }
        } catch (err) {
          console.error("Error rejecting booking:", err);
          showStatusMessage("❌ Error rejecting booking", "error");
        }
      };
    }

    // Handle delete button
    document.getElementById("deleteBooking").onclick = function() {
      showDeleteConfirmation(booking.name, () => deleteBooking(bookingId));
    };

    // ── Resend Reschedule SMS ────────────────────────────────────────────
    const resendBtn = document.getElementById("resendSmsBtn");
    const lastSmsLabel = document.getElementById("lastSmsSentLabel");

    // Show last-sent timestamp if recorded
    if (lastSmsLabel) {
      if (booking.lastRescheduleSms) {
        const sentAt = booking.lastRescheduleSms.toDate
          ? booking.lastRescheduleSms.toDate()
          : new Date(booking.lastRescheduleSms);
        lastSmsLabel.textContent = `Last sent: ${sentAt.toLocaleString('en-AU')}`;
      } else {
        lastSmsLabel.textContent = 'Not yet sent';
      }
    }

    if (resendBtn) {
      resendBtn.onclick = async function () {
        resendBtn.disabled = true;
        resendBtn.textContent = '⏳ Sending...';
        try {
          const currentPhone = document.getElementById("editPhone").value;
          const currentName  = document.getElementById("editName").value;
          const currentDate  = document.getElementById("editDate").value;
          const currentTime  = document.getElementById("editTimeSelect").value;
          const currentSlot  = currentDate && currentTime
            ? `${currentDate} ${currentTime}`
            : booking.timeSlot;

          const baseUrl = `https://us-central1-${firebaseConfig.projectId}.cloudfunctions.net`;
          const resp = await fetch(`${baseUrl}/notifyReschedule`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              bookingId,
              newTimeSlot: currentSlot,
              phone: currentPhone,
              name: currentName
            })
          });
          const result = await resp.json().catch(() => ({}));

          if (resp.ok && result.success) {
            // Record the send time in Firestore
            const sentNow = firebase.firestore.FieldValue.serverTimestamp();
            await window.db.collection('bookings').doc(bookingId).update({ lastRescheduleSms: sentNow });
            if (lastSmsLabel) lastSmsLabel.textContent = `Last sent: ${new Date().toLocaleString('en-AU')}`;
            showStatusMessage('✅ Reschedule SMS sent!', 'success');
          } else {
            showStatusMessage(`❌ SMS failed: ${result.message || 'Unknown error'}`, 'error');
          }
        } catch (err) {
          console.error('Resend SMS error:', err);
          showStatusMessage('❌ SMS send failed. Check Twilio logs.', 'error');
        } finally {
          resendBtn.disabled = false;
          resendBtn.textContent = '📱 Resend Reschedule SMS';
        }
      };
    }
    // ────────────────────────────────────────────────────────────────────
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
      service: 'Fade',   // default; admin can edit afterwards via the booking modal
      price: 20,
      timestamp: firebase.firestore.FieldValue.serverTimestamp(),
      status: 'approved', // admin-created bookings are confirmed
      adminCreated: true
    };

    // Add userId if user exists
    if (userId) {
      bookingData.userId = userId;
    }

    try {
      const newBookingRef = window.db.collection("bookings").doc();
      await newBookingRef.set(bookingData);

      // Mark the slot as taken so the customer site shows it as unavailable
      const slotId = timeSlot.replace(/[\s:]/g, '_');
      await window.db.collection('bookedSlots').doc(slotId).set({
        timeSlot: timeSlot,
        bookingId: newBookingRef.id,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      });
      
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
  // Helpers exposed for pending bookings list
  window.approvePendingBooking = async function (bookingId) {
    try {
      await window.db.collection('bookings').doc(bookingId).update({ status: 'approved' });
      showStatusMessage('✅ Booking approved', 'success');
      loadPendingBookings();
      setTimeout(() => location.reload(), 800);
    } catch (err) {
      console.error('Error approving pending booking:', err);
      showStatusMessage('❌ Error approving booking', 'error');
    }
  };

  window.rejectPendingBooking = async function (bookingId) {
    try {
      await window.db.collection('bookings').doc(bookingId).update({ status: 'rejected' });
      showStatusMessage('✅ Booking rejected', 'success');
      loadPendingBookings();
    } catch (err) {
      console.error('Error rejecting pending booking:', err);
      showStatusMessage('❌ Error rejecting booking', 'error');
    }
  };

  window.deletePendingBooking = async function (bookingId) {
    try {
      await window.db.collection('bookings').doc(bookingId).delete();
      showStatusMessage('✅ Booking deleted', 'success');
      loadPendingBookings();
    } catch (err) {
      console.error('Error deleting pending booking:', err);
      showStatusMessage('❌ Error deleting booking', 'error');
    }
  };
}

  if (window.isAdmin) {
    console.log('✅ Admin already authenticated, starting admin panel');
    startAdminPanel().catch(e => console.error('Admin panel init error:', e));
  } else {
    console.log('⏳ Waiting for admin authentication before loading admin panel...');
    window.__deferredAdminStart = function () {
      startAdminPanel().catch(e => console.error('Admin panel init error (deferred):', e));
    };
  }
}); 