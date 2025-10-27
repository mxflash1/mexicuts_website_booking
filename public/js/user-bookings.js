// User Bookings Management
// Displays and manages bookings for logged-in users

console.log('📅 User-bookings.js loaded');

// Load and display user's bookings
async function loadUserBookings(user) {
  if (!user || !user.uid) {
    console.error('No user provided to loadUserBookings');
    return;
  }

  console.log('📋 Loading bookings for user:', user.uid);

  try {
    // Get all bookings for this user
    const bookingsSnapshot = await db.collection('bookings')
      .where('userId', '==', user.uid)
      .get();

    console.log(`Found ${bookingsSnapshot.size} bookings for user`);

    // Separate into upcoming and past bookings
    const now = new Date();
    const upcomingBookings = [];
    const pastBookings = [];

    bookingsSnapshot.forEach(doc => {
      const booking = {
        id: doc.id,
        ...doc.data()
      };

      // Parse booking date
      const bookingDate = parseBookingDate(booking.timeSlot);
      
      if (bookingDate >= now) {
        upcomingBookings.push(booking);
      } else {
        pastBookings.push(booking);
      }
    });

    // Display bookings
    displayUserBookings(upcomingBookings, pastBookings);

  } catch (error) {
    console.error('Error loading user bookings:', error);
    
    // Show error message
    const section = document.getElementById('userBookingsSection');
    if (section) {
      section.innerHTML = `
        <div style="text-align: center; padding: 20px; color: #f44336;">
          <p>⚠️ Error loading your bookings. Please try again.</p>
          <p style="font-size: 12px; color: #999;">${error.message}</p>
        </div>
      `;
      section.style.display = 'block';
    }
  }
}

// Parse booking timeSlot to Date object
function parseBookingDate(timeSlot) {
  try {
    // Format: "2025-08-23 05:30 PM"
    const [datePart, timePart, ampm] = timeSlot.split(' ');
    const [year, month, day] = datePart.split('-');
    const [hour, minute] = timePart.split(':');
    
    let hour24 = parseInt(hour);
    if (ampm === 'PM' && hour24 !== 12) {
      hour24 += 12;
    } else if (ampm === 'AM' && hour24 === 12) {
      hour24 = 0;
    }
    
    return new Date(year, month - 1, day, hour24, parseInt(minute));
  } catch (error) {
    console.error('Error parsing booking date:', timeSlot, error);
    return new Date(0); // Return epoch if parsing fails
  }
}

// Format date for display
function formatBookingDate(timeSlot) {
  try {
    const date = parseBookingDate(timeSlot);
    
    return date.toLocaleDateString('en-AU', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  } catch (error) {
    return timeSlot;
  }
}

// Extract time from timeSlot
function extractTime(timeSlot) {
  try {
    const parts = timeSlot.split(' ');
    return `${parts[1]} ${parts[2]}`; // "05:30 PM"
  } catch (error) {
    return timeSlot;
  }
}

// Display user bookings in the UI
function displayUserBookings(upcomingBookings, pastBookings) {
  const section = document.getElementById('userBookingsSection');
  if (!section) {
    console.error('userBookingsSection not found in DOM');
    return;
  }

  let html = `
    <div style="padding: 30px 20px; background: #111; border-radius: 10px; margin-top: 30px;">
      <h3 style="color: #CE1126; text-align: center; margin-bottom: 25px; font-size: 24px;">
        📅 My Bookings
      </h3>
  `;

  // Upcoming Bookings Section
  html += `
    <div style="margin-bottom: 30px;">
      <h4 style="color: #4CAF50; margin-bottom: 15px; font-size: 18px; border-bottom: 2px solid #4CAF50; padding-bottom: 8px;">
        📍 Upcoming Appointments
      </h4>
  `;

  if (upcomingBookings.length === 0) {
    html += `
      <div style="text-align: center; padding: 30px; background: #1a1a1a; border-radius: 8px; border: 1px solid #333;">
        <p style="color: #999; font-size: 16px;">📭 No upcoming appointments</p>
        <p style="color: #666; font-size: 14px; margin-top: 10px;">Book your next haircut below!</p>
      </div>
    `;
  } else {
    upcomingBookings.forEach(booking => {
      html += createBookingCard(booking, true);
    });
  }

  html += '</div>';

  // Past Bookings Section
  html += `
    <div>
      <h4 style="color: #666; margin-bottom: 15px; font-size: 18px; border-bottom: 2px solid #666; padding-bottom: 8px;">
        📜 Past Appointments
      </h4>
  `;

  if (pastBookings.length === 0) {
    html += `
      <div style="text-align: center; padding: 30px; background: #1a1a1a; border-radius: 8px; border: 1px solid #333;">
        <p style="color: #999; font-size: 16px;">📭 No past appointments</p>
      </div>
    `;
  } else {
    // Show only last 5 past bookings
    const recentPast = pastBookings.slice(0, 5);
    recentPast.forEach(booking => {
      html += createBookingCard(booking, false);
    });
    
    if (pastBookings.length > 5) {
      html += `
        <p style="text-align: center; color: #666; font-size: 14px; margin-top: 15px;">
          Showing 5 most recent past appointments (${pastBookings.length} total)
        </p>
      `;
    }
  }

  html += '</div></div>';

  section.innerHTML = html;
  section.style.display = 'block';
}

// Create a booking card HTML
function createBookingCard(booking, isUpcoming) {
  const date = formatBookingDate(booking.timeSlot);
  const time = extractTime(booking.timeSlot);
  const backgroundColor = isUpcoming ? '#1a3a1a' : '#2a2a2a';
  const borderColor = isUpcoming ? '#4CAF50' : '#555';

  let card = `
    <div style="
      background: ${backgroundColor};
      border: 2px solid ${borderColor};
      border-radius: 8px;
      padding: 20px;
      margin-bottom: 15px;
      transition: transform 0.2s;
    " onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
      
      <!-- Date and Time -->
      <div style="margin-bottom: 15px;">
        <div style="color: #CE1126; font-weight: bold; font-size: 16px; margin-bottom: 5px;">
          📅 ${date}
        </div>
        <div style="color: #fff; font-size: 18px; font-weight: bold;">
          🕐 ${time}
        </div>
      </div>

      <!-- Booking Details -->
      <div style="margin-bottom: 15px; padding: 12px; background: #1a1a1a; border-radius: 6px; border-left: 3px solid ${borderColor};">
        <div style="color: #ccc; margin-bottom: 5px;">
          <strong>Service:</strong> Haircut ($20)
        </div>
        <div style="color: #ccc; margin-bottom: 5px;">
          <strong>Location:</strong> Peregian Springs, Sunshine Coast
        </div>
        ${booking.notes ? `
          <div style="color: #ccc; margin-top: 8px; padding-top: 8px; border-top: 1px solid #333;">
            <strong>Notes:</strong> ${booking.notes}
          </div>
        ` : ''}
      </div>

      <!-- Action Buttons -->
      <div style="display: flex; gap: 10px; flex-wrap: wrap;">
  `;

  if (isUpcoming) {
    // Upcoming booking actions
    card += `
        <button onclick="addBookingToCalendar('${booking.timeSlot}', '${booking.name}')" 
                style="flex: 1; min-width: 120px; background: #006847; color: white; border: none; padding: 12px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: bold; transition: background 0.2s;"
                onmouseover="this.style.background='#004f35'" onmouseout="this.style.background='#006847'">
          📅 Add to Calendar
        </button>
        <button onclick="cancelUserBooking('${booking.id}', '${booking.name}')" 
                style="flex: 1; min-width: 120px; background: #f44336; color: white; border: none; padding: 12px 20px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: bold; transition: background 0.2s;"
                onmouseover="this.style.background='#da190b'" onmouseout="this.style.background='#f44336'">
          🗑️ Cancel Booking
        </button>
    `;
  } else {
    // Past booking - view only
    card += `
        <div style="flex: 1; text-align: center; color: #666; font-size: 14px; padding: 12px;">
          ✅ Completed
        </div>
    `;
  }

  card += `
      </div>
    </div>
  `;

  return card;
}

// Cancel booking from user's view
async function cancelUserBooking(bookingId, customerName) {
  // Show custom cancellation modal
  showCancellationModal(bookingId, customerName);
}

// Add booking to calendar (reuse from booking.js)
function addBookingToCalendar(timeSlot, customerName) {
  // This function should already exist in booking.js
  if (window.addToCalendar) {
    window.addToCalendar(timeSlot, customerName);
  } else {
    console.error('addToCalendar function not found');
    alert('Calendar feature not available. Please check booking.js is loaded.');
  }
}

// Refresh user bookings after changes
async function refreshUserBookings() {
  const authManager = window.authManager;
  if (authManager && authManager.isLoggedIn()) {
    const user = authManager.getCurrentUser();
    await loadUserBookings(user);
  }
}

// Export functions
window.loadUserBookings = loadUserBookings;
window.cancelUserBooking = cancelUserBooking;
window.addBookingToCalendar = addBookingToCalendar;
window.refreshUserBookings = refreshUserBookings;

