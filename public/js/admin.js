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
      <div style="display:flex; align-items:center; justify-content:center; min-height:100vh; background: var(--bg, #0E1014); color: var(--text, #F2F4F7); font-family: -apple-system, BlinkMacSystemFont, sans-serif; padding: 24px;">
        <div style="background: var(--surface-1, #161A21); border:1px solid rgba(239,68,68,0.4); border-radius: 14px; padding: 32px; max-width: 440px; text-align:center;">
          <h2 style="font-size: 20px; font-weight: 700; margin-bottom: 12px; color: #EF4444;">Configuration error</h2>
          <p style="font-size: 14px; line-height: 1.55; color: #B4BCCB; margin-bottom: 20px;">
            Couldn't load the admin panel configuration. Please check your Firebase setup and try again.
          </p>
          <button onclick="location.reload()" style="background: #E63247; color: #fff; padding: 12px 24px; border: 0; border-radius: 10px; cursor: pointer; font-weight: 600; font-size: 15px;">Reload</button>
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

  // Initialize blocked time-window management
  adminAvailability.initializeBlockedTimes();

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

    // Overlay blocked time windows (per-date partial blocks) so the admin
    // calendar visually reflects what clients can't book.
    const blockedTimes = availabilityManager.config.blockedTimes || {};
    Object.keys(blockedTimes).forEach(dateStr => {
      const windows = blockedTimes[dateStr];
      if (!Array.isArray(windows)) return;
      windows.forEach(win => {
        if (!win || !win.startTime || !win.endTime) return;
        const endTimeIso = win.endTime === '00:00'
          ? `${dateStr}T23:59:59`
          : `${dateStr}T${win.endTime}:00`;
        events.push({
          start: `${dateStr}T${win.startTime}:00`,
          end: endTimeIso,
          display: 'background',
          color: '#4a1a1a', // Dark red — matches full-day blocks
          title: `Blocked: ${win.reason || 'Unavailable'}`
        });
      });
    });
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
          searchResults.innerHTML = `
            <div class="empty-state" style="padding: var(--space-5);">
              <div class="empty-state__title">No bookings found</div>
              <div class="empty-state__hint">Try a different name, phone, or date.</div>
            </div>`;
          searchResults.style.display = 'block';
          return;
        }

        // Sort by timeSlot descending (most recent first)
        matches.sort((a, b) => (b.timeSlot || '').localeCompare(a.timeSlot || ''));

        let html = `<p class="text-tertiary" style="font-size: var(--text-xs); margin-bottom: var(--space-2); text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600;">${matches.length} result${matches.length === 1 ? '' : 's'}</p>`;
        matches.forEach(b => {
          const status = (b.status || 'approved');
          const badgeClass = status === 'approved' ? 'badge--success'
                          : status === 'rejected' ? 'badge--danger'
                          : 'badge--warning';
          html += `
            <div class="list-card" role="button" tabindex="0" style="cursor: pointer;"
                 onclick="window.showBookingModal('${b.id}', window.allBookingData.get('${b.id}'))"
                 onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault(); window.showBookingModal('${b.id}', window.allBookingData.get('${b.id}'));}">
              <div class="list-card__row">
                <div style="flex:1; min-width:0;">
                  <div class="list-card__title">
                    ${(b.name || 'Unknown').replace(/</g,'&lt;')}
                    <span class="badge ${badgeClass}">${status}</span>
                  </div>
                  <div class="list-card__meta">
                    <div class="list-card__meta-row"><svg><use href="#i-phone"/></svg>${b.phone || ''}</div>
                    <div class="list-card__meta-row"><svg><use href="#i-calendar"/></svg>${b.timeSlot || ''}</div>
                    ${b.notes ? `<div class="list-card__meta-row text-tertiary">"${(b.notes || '').replace(/</g,'&lt;')}"</div>` : ''}
                  </div>
                </div>
              </div>
            </div>
          `;
        });

        searchResults.innerHTML = html;
        searchResults.style.display = 'block';
      });
    }
    // ─────────────────────────────────────────────────────────────────────

    // Find the next day with at least one booking (today or later)
    const todayMidnight = new Date();
    todayMidnight.setHours(0, 0, 0, 0);
    const futureBookingStarts = events
      .filter(e => e.id && e.start)
      .map(e => (e.start instanceof Date ? e.start : new Date(e.start)))
      .filter(d => !isNaN(d) && d >= todayMidnight)
      .sort((a, b) => a - b);
    const initialDate = futureBookingStarts.length > 0 ? futureBookingStarts[0] : new Date();

    const calendarShell = document.querySelector('.calendar-shell');
    const computeCalendarHeight = () => {
      const shell = document.querySelector('.calendar-shell');
      if (shell && shell.clientHeight > 100) return shell.clientHeight - 24;
      // Fallback: full viewport minus chrome
      return Math.max(400, window.innerHeight - 220);
    };

    const calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: "timeGridDay",
      initialDate: initialDate,
      slotDuration: "00:30:00",
      slotLabelInterval: "01:00",
      slotMinTime: "07:00:00",
      slotMaxTime: "19:00:00",
      events: events,
      themeSystem: "standard",
      height: computeCalendarHeight(),
      nowIndicator: true,
      allDaySlot: false,
      expandRows: true,
      slotEventOverlap: false,
      displayEventEnd: false,
      eventDisplay: "block",
      eventTimeFormat: { hour: 'numeric', minute: '2-digit', meridiem: 'short' },
      slotLabelFormat: { hour: 'numeric', meridiem: 'short' },
      headerToolbar: {
        left: 'prev,next today',
        center: 'title',
        right: 'timeGridDay,timeGridWeek'
      },
      eventContent: function(arg) {
        if (arg.event.display === 'background' || arg.event.display === 'inverse-background') {
          return { html: `<div class="fc-bg-label">${(arg.event.title || '').replace(/</g,'&lt;')}</div>` };
        }
        const name = arg.event.extendedProps.customerName || arg.event.title || 'Booking';
        const phone = arg.event.extendedProps.customerPhone || '';
        const time = arg.timeText || '';
        return {
          html: `
            <div class="fc-booking">
              <div class="fc-booking__time">${time}</div>
              <div class="fc-booking__name">${name.replace(/</g,'&lt;')}</div>
              ${phone ? `<div class="fc-booking__phone">${phone}</div>` : ''}
            </div>
          `
        };
      },
      eventClick: function(info) {
        if (info.event.extendedProps.bookingId) {
          showBookingModal(info.event.extendedProps.bookingId, bookingData.get(info.event.extendedProps.bookingId));
        }
      }
    });

    calendar.render();

    // Keep the calendar matched to the available viewport space
    let resizeTimer = null;
    const refit = () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        calendar.setOption('height', computeCalendarHeight());
        calendar.updateSize();
      }, 80);
    };
    window.addEventListener('resize', refit);
    window.addEventListener('orientationchange', refit);

    // When user switches back to the Bookings tab, ask FC to recompute (it may
    // have rendered while hidden and got a 0-height container).
    window.refitAdminCalendar = refit;

    // Initial fit after layout settles
    requestAnimationFrame(refit);
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
          <div class="empty-state">
            <svg class="empty-state__icon"><use href="#i-check"/></svg>
            <div class="empty-state__title">All caught up</div>
            <div class="empty-state__hint">No pending bookings right now.</div>
          </div>
        `;
        return;
      }

      let html = '';
      snapshot.forEach(doc => {
        const data = doc.data();
        const id = doc.id;
        const status = data.status || 'pending';
        const variantClass = status === 'rejected' ? 'list-card--muted' : 'list-card--warning';
        const badgeClass = status === 'rejected' ? 'badge--danger' : 'badge--warning';
        const safeName = (data.name || 'Unknown').replace(/</g, '&lt;');
        html += `
          <div class="list-card ${variantClass}">
            <div class="list-card__row">
              <div style="flex:1; min-width:0;">
                <div class="list-card__title">
                  ${safeName}
                  <span class="badge ${badgeClass}">${status}</span>
                </div>
                <div class="list-card__meta">
                  <div class="list-card__meta-row"><svg><use href="#i-phone"/></svg>${data.phone || 'N/A'}</div>
                  <div class="list-card__meta-row"><svg><use href="#i-calendar"/></svg>${data.timeSlot || '—'}</div>
                  ${data.service ? `<div class="list-card__meta-row"><svg><use href="#i-scissors"/></svg>${data.service}${data.price ? ` · $${data.price}` : ''}</div>` : ''}
                </div>
              </div>
            </div>
            <div class="list-card__actions">
              <button class="btn btn-success btn-sm" type="button" onclick="window.approvePendingBooking('${id}')">Accept</button>
              <button class="btn btn-quiet btn-sm" type="button" onclick="window.rejectPendingBooking('${id}')">Reject</button>
              <button class="btn btn-danger btn-sm" type="button" onclick="window.deletePendingBooking('${id}')">Delete</button>
            </div>
          </div>
        `;
      });

      container.innerHTML = html;
    } catch (err) {
      console.error('Error loading pending bookings:', err);
      container.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state__icon"><use href="#i-info"/></svg>
          <div class="empty-state__title">Couldn't load pending bookings</div>
        </div>`;
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
      // Build a full day of 15-min slots (12:00 AM → 11:45 PM) so admin can pick any time
      timeSelect.innerHTML = '';
      for (let h = 0; h < 24; h++) {
        for (const m of [0, 15, 30, 45]) {
          const ampm = h < 12 ? 'AM' : 'PM';
          const h12 = h % 12 === 0 ? 12 : h % 12;
          const label = `${String(h12).padStart(2,'0')}:${String(m).padStart(2,'0')} ${ampm}`;
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

      if (newTimeSlot !== oldTimeSlot) {
        updatedData.reminderSent = false;
        updatedData.reminderSentAt = firebase.firestore.FieldValue.delete();
      }

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

  // Manual bookings can be placed on quarter-hour boundaries, independently
  // of the customer-facing availability slot duration.
  const manualTimeSelect = document.getElementById("manualTime");
  manualTimeSelect.innerHTML = '<option value="">Select time…</option>';

  for (let totalMinutes = 0; totalMinutes < 24 * 60; totalMinutes += 15) {
    const hour24 = Math.floor(totalMinutes / 60);
    const minute = totalMinutes % 60;
    const period = hour24 >= 12 ? "PM" : "AM";
    const hour12 = hour24 % 12 || 12;
    const option = document.createElement("option");

    option.value = `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${period}`;
    option.textContent = `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
    manualTimeSelect.appendChild(option);
  }

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
