// Admin Clients Management
console.log('👥 Admin-clients.js loaded');

let allClients = [];

// Load clients from Firestore
async function loadClients() {
  const clientsList = document.getElementById('clientsList');
  const totalCount = document.getElementById('totalClientsCount');
  const newThisWeek = document.getElementById('newThisWeek');

  // Check if db is available
  if (!window.db) {
    console.error('Database not initialized yet');
    clientsList.innerHTML = `
      <p style="text-align: center; color: #f44336;">
        ⚠️ Database not ready. Retrying...
      </p>
    `;
    // Retry after 1 second
    setTimeout(loadClients, 1000);
    return;
  }

  try {
    console.log('📋 Loading clients from Firestore...');
    const usersSnapshot = await window.db.collection('users').get();
    
    allClients = [];
    usersSnapshot.forEach(doc => {
      allClients.push({
        id: doc.id,
        ...doc.data()
      });
    });

    // Sort by creation date (newest first)
    allClients.sort((a, b) => {
      const timeA = a.createdAt ? a.createdAt.toDate() : new Date(0);
      const timeB = b.createdAt ? b.createdAt.toDate() : new Date(0);
      return timeB - timeA;
    });

    // Calculate stats
    totalCount.textContent = allClients.length;

    // Count new clients this week
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
    const newClientsCount = allClients.filter(client => {
      if (!client.createdAt) return false;
      return client.createdAt.toDate() > oneWeekAgo;
    }).length;
    newThisWeek.textContent = newClientsCount;

    // Display clients
    displayClients(allClients);

  } catch (error) {
    console.error('Error loading clients:', error);
    clientsList.innerHTML = `
      <p style="text-align: center; color: #f44336;">
        ❌ Error loading clients. Please refresh.
      </p>
    `;
  }
}

// Display clients in the list
function displayClients(clients) {
  const clientsList = document.getElementById('clientsList');

  if (clients.length === 0) {
    clientsList.innerHTML = `
      <p style="text-align: center; color: #999; padding: 40px;">
        No registered clients yet
      </p>
    `;
    return;
  }

  let html = '';
  clients.forEach(client => {
    const joinDate = client.createdAt ? 
      client.createdAt.toDate().toLocaleDateString('en-AU', { 
        year: 'numeric', 
        month: 'short', 
        day: 'numeric' 
      }) : 
      'Unknown';

    const isNew = client.createdAt && 
      (new Date() - client.createdAt.toDate()) < (7 * 24 * 60 * 60 * 1000);

    const status = client.accountStatus || 'approved';
    const statusColor = status === 'approved' ? '#4CAF50' :
                        status === 'rejected' ? '#f44336' : '#FFC107';

    html += `
      <div class="client-card">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
          <h4>${client.name || 'Unknown'} ${isNew ? '<span style="background: #006847; color: white; font-size: 10px; padding: 2px 8px; border-radius: 12px; margin-left: 8px;">NEW</span>' : ''}</h4>
          <div style="display: flex; gap: 8px;">
            <span style="align-self:center; padding:3px 8px; border-radius:999px; border:1px solid ${statusColor}; color:${statusColor}; font-size:11px; font-weight:bold;">
              ${status.toUpperCase()}
            </span>
            <button onclick="editClient('${client.id}')" 
                    style="background: #006847; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">
              ✏️ Edit
            </button>
          <button onclick="viewClientDetails('${client.id}')" 
                  style="background: #555; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">
              👁️ View
            </button>
            <button onclick="approveClient('${client.id}')" 
                    style="background: #4CAF50; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">
              ✅ Approve
            </button>
            <button onclick="rejectClient('${client.id}')" 
                    style="background: #f44336; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">
              ❌ Reject
            </button>
            <button onclick="deleteClient('${client.id}', '${client.name || 'Unknown'}')" 
                    style="background: #CE1126; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">
              🗑️ Delete
            </button>
          </div>
        </div>
        <div class="client-info">📱 ${client.phone || 'No phone'}</div>
        <div class="client-info">📅 Joined: ${joinDate}</div>
        <div class="client-info">📋 Bookings: ${client.bookingCount || 0}</div>
      </div>
    `;
  });

  clientsList.innerHTML = html;
}

// Search clients
function setupClientSearch() {
  const searchInput = document.getElementById('clientSearch');
  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase().trim();

    if (searchTerm === '') {
      displayClients(allClients);
      return;
    }

    const filtered = allClients.filter(client => {
      const name = (client.name || '').toLowerCase();
      const phone = (client.phone || '').toLowerCase();
      return name.includes(searchTerm) || phone.includes(searchTerm);
    });

    displayClients(filtered);
  });
}

// View client details
async function viewClientDetails(clientId) {
  try {
    // Get client data
    const clientDoc = await window.db.collection('users').doc(clientId).get();
    if (!clientDoc.exists) {
      alert('Client not found');
      return;
    }

    const client = clientDoc.data();

    // Get client's bookings
    const bookingsSnapshot = await window.db.collection('bookings')
      .where('userId', '==', clientId)
      .get();

    const bookings = [];
    bookingsSnapshot.forEach(doc => {
      bookings.push({
        id: doc.id,
        ...doc.data()
      });
    });

    // Sort bookings by date
    bookings.sort((a, b) => {
      return new Date(b.timeSlot) - new Date(a.timeSlot);
    });

    // Show modal with details
    showClientModal(client, bookings);

  } catch (error) {
    console.error('Error loading client details:', error);
    alert('Error loading client details');
  }
}

// Show client details modal
function showClientModal(client, bookings) {
  // Separate upcoming and past bookings
  const now = new Date();
  const upcomingBookings = [];
  const pastBookings = [];

  bookings.forEach(booking => {
    if (booking.timeSlot) {
      const bookingDate = parseBookingDate(booking.timeSlot);
      if (bookingDate >= now) {
        upcomingBookings.push(booking);
      } else {
        pastBookings.push(booking);
      }
    }
  });

  // Sort upcoming bookings (earliest first)
  upcomingBookings.sort((a, b) => new Date(a.timeSlot) - new Date(b.timeSlot));
  
  // Sort past bookings (most recent first)
  pastBookings.sort((a, b) => new Date(b.timeSlot) - new Date(a.timeSlot));

  // Format booking display (matching main website style)
  function formatBooking(booking) {
    const [datePart, timePart, ampm] = booking.timeSlot.split(' ');
    const [year, month, day] = datePart.split('-');
    const bookingDate = new Date(year, month - 1, day);
    
    const dateStr = bookingDate.toLocaleDateString('en-AU', { 
      weekday: 'long', 
      year: 'numeric', 
      month: 'long', 
      day: 'numeric' 
    });

    return `
      <div style="background: #1a3a1a; border: 2px solid #006847; border-radius: 12px; padding: 20px; margin-bottom: 15px;">
        <div style="color: #CE1126; font-weight: bold; font-size: 16px; margin-bottom: 10px;">
          📅 ${dateStr}
        </div>
        <div style="color: white; font-size: 18px; font-weight: bold; margin-bottom: 12px;">
          🕐 ${timePart} ${ampm}
        </div>
        <div style="background: #0a0a0a; padding: 12px; border-radius: 8px; margin-bottom: 10px;">
          <div style="color: #ccc; font-size: 14px; margin-bottom: 5px;">
            <strong style="color: #006847;">Service:</strong> Haircut ($20)
          </div>
          <div style="color: #ccc; font-size: 14px;">
            <strong style="color: #006847;">Location:</strong> Peregian Springs, Sunshine Coast
          </div>
        </div>
        ${booking.notes ? `
          <div style="background: #2a2a2a; padding: 10px; border-radius: 6px; border-left: 3px solid #006847;">
            <div style="color: #999; font-size: 12px; margin-bottom: 3px;">Notes:</div>
            <div style="color: #ccc; font-size: 13px;">${booking.notes}</div>
          </div>
        ` : ''}
      </div>
    `;
  }

  const modalHTML = `
    <div id="clientDetailsModal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.9); z-index: 2000; overflow-y: auto; padding: 20px;">
      <div style="background: #1a1a1a; border: 3px solid #CE1126; border-radius: 12px; padding: 30px; max-width: 800px; margin: 0 auto;">
        
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 25px;">
          <h2 style="color: #CE1126; margin: 0; font-size: 28px;">👤 ${client.name || 'Client'}</h2>
          <button onclick="closeClientModal()" style="background: #CE1126; border: none; color: white; font-size: 24px; width: 40px; height: 40px; border-radius: 50%; cursor: pointer; display: flex; align-items: center; justify-content: center;">&times;</button>
        </div>

        <!-- Client Info Summary -->
        <div style="background: #2a2a2a; padding: 20px; border-radius: 12px; margin-bottom: 30px; border-left: 4px solid #006847;">
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px;">
            <div>
              <div style="color: #999; font-size: 13px; margin-bottom: 5px;">📱 Phone</div>
              <div style="color: white; font-size: 16px; font-weight: bold;">${client.phone || 'N/A'}</div>
          </div>
            <div>
              <div style="color: #999; font-size: 13px; margin-bottom: 5px;">📅 Joined</div>
              <div style="color: white; font-size: 16px; font-weight: bold;">${client.createdAt ? client.createdAt.toDate().toLocaleDateString('en-AU', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Unknown'}</div>
          </div>
          <div>
              <div style="color: #999; font-size: 13px; margin-bottom: 5px;">📋 Total Bookings</div>
              <div style="color: #4CAF50; font-size: 20px; font-weight: bold;">${bookings.length}</div>
            </div>
          </div>
        </div>

        <!-- Upcoming Appointments Section -->
        ${upcomingBookings.length > 0 ? `
          <div style="margin-bottom: 30px;">
            <h3 style="color: #006847; margin-bottom: 20px; font-size: 22px; display: flex; align-items: center; gap: 10px;">
              📅 Upcoming Appointments
              <span style="background: #006847; color: white; font-size: 14px; padding: 2px 10px; border-radius: 12px;">${upcomingBookings.length}</span>
            </h3>
            ${upcomingBookings.map(booking => formatBooking(booking)).join('')}
              </div>
        ` : ''}

        <!-- Past Appointments Section -->
        <div>
          <h3 style="color: #CE1126; margin-bottom: 20px; font-size: 22px; display: flex; align-items: center; gap: 10px;">
            📜 Past Appointments
            <span style="background: #CE1126; color: white; font-size: 14px; padding: 2px 10px; border-radius: 12px;">${pastBookings.length}</span>
          </h3>
          ${pastBookings.length === 0 ? 
            '<p style="text-align: center; color: #999; padding: 40px; background: #2a2a2a; border-radius: 8px;">No past appointments yet</p>' :
            pastBookings.map(booking => formatBooking(booking)).join('')
          }
        </div>

        <!-- Close Button -->
        <div style="margin-top: 30px; text-align: center;">
          <button onclick="closeClientModal()" style="background: #CE1126; color: white; border: none; padding: 14px 32px; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 16px;">
            ✖️ Close
          </button>
        </div>

      </div>
    </div>
  `;

  // Add to page
  const existingModal = document.getElementById('clientDetailsModal');
  if (existingModal) {
    existingModal.remove();
  }

  document.body.insertAdjacentHTML('beforeend', modalHTML);
}

// Helper function to parse booking date
function parseBookingDate(timeSlot) {
  try {
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
    console.error('Error parsing booking date:', timeSlot);
    return new Date(0);
  }
}

// Close client modal
function closeClientModal() {
  const modal = document.getElementById('clientDetailsModal');
  if (modal) {
    modal.remove();
  }
}

// Initialize when DOM loads
document.addEventListener('DOMContentLoaded', () => {
  console.log('👥 Admin clients page loaded, waiting for database...');
  
  // Wait for Firebase to initialize
  const checkDatabase = () => {
    if (window.db) {
      console.log('✅ Database ready, loading clients...');
      loadClients();
      setupClientSearch();
    } else {
      console.log('⏳ Waiting for database...');
      setTimeout(checkDatabase, 500);
    }
  };
  
  // Start checking after a short delay
  setTimeout(checkDatabase, 500);
});

// Load only pending clients for Pending tab
async function loadPendingClients() {
  const container = document.getElementById('pendingClientsList');
  if (!container || !window.db) return;

  try {
    const snapshot = await window.db.collection('users')
      .where('accountStatus', '==', 'pending')
      .get();

    if (snapshot.empty) {
      container.innerHTML = `
        <p style="text-align:center; color:#999; padding:10px;">
          No pending clients right now.
        </p>
      `;
      return;
    }

    let html = '';
    snapshot.forEach(doc => {
      const client = { id: doc.id, ...doc.data() };
      const joinDate = client.createdAt ?
        client.createdAt.toDate().toLocaleDateString('en-AU', {
          year: 'numeric',
          month: 'short',
          day: 'numeric'
        }) :
        'Unknown';

      html += `
        <div class="client-card">
          <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:10px;">
            <h4>${client.name || 'Unknown'}</h4>
            <div style="display:flex; gap:6px;">
              <button onclick="approveClient('${client.id}')" 
                      style="background:#4CAF50; color:white; border:none; padding:4px 8px; border-radius:6px; font-size:11px; cursor:pointer;">
                ✅ Approve
              </button>
              <button onclick="rejectClient('${client.id}')" 
                      style="background:#f0ad4e; color:white; border:none; padding:4px 8px; border-radius:6px; font-size:11px; cursor:pointer;">
                ❌ Reject
              </button>
              <button onclick="deleteClient('${client.id}', '${client.name || 'Unknown'}')" 
                      style="background:#CE1126; color:white; border:none; padding:4px 8px; border-radius:6px; font-size:11px; cursor:pointer;">
                🗑️ Delete
              </button>
            </div>
          </div>
          <div class="client-info">📱 ${client.phone || 'No phone'}</div>
          <div class="client-info">📅 Joined: ${joinDate}</div>
        </div>
      `;
    });

    container.innerHTML = html;
  } catch (error) {
    console.error('Error loading pending clients:', error);
    container.innerHTML = `
      <p style="text-align:center; color:#f44336; padding:10px;">
        Error loading pending clients.
      </p>
    `;
  }
}

// Edit client function
async function editClient(clientId) {
  try {
    // Get client data
    const clientDoc = await window.db.collection('users').doc(clientId).get();
    if (!clientDoc.exists) {
      alert('Client not found');
      return;
    }

    const client = clientDoc.data();

    // Show edit modal
    const modalHTML = `
      <div id="editClientModal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); z-index: 2000; display: flex; justify-content: center; align-items: center; padding: 20px;">
        <div style="background: #2a2a2a; border: 2px solid #006847; border-radius: 12px; padding: 30px; max-width: 500px; width: 100%;">
          
          <!-- Header -->
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <h3 style="color: #006847; margin: 0;">✏️ Edit Client</h3>
            <button onclick="closeEditClientModal()" style="background: none; border: none; color: #ccc; font-size: 28px; cursor: pointer;">&times;</button>
          </div>

          <!-- Edit Form -->
          <form id="editClientForm" style="display: flex; flex-direction: column; gap: 15px;">
            <div>
              <label style="display: block; color: #ccc; margin-bottom: 5px; font-size: 14px;">Name:</label>
              <input type="text" id="editClientName" value="${client.name || ''}" required
                     style="width: 100%; padding: 12px; border: 1px solid #555; border-radius: 6px; background: #1a1a1a; color: white; font-size: 16px; box-sizing: border-box;">
            </div>
            
            <div>
              <label style="display: block; color: #ccc; margin-bottom: 5px; font-size: 14px;">Phone:</label>
              <input type="tel" id="editClientPhone" value="${client.phone || ''}" required
                     style="width: 100%; padding: 12px; border: 1px solid #555; border-radius: 6px; background: #1a1a1a; color: white; font-size: 16px; box-sizing: border-box;">
            </div>

            <div style="background: #1a1a1a; padding: 15px; border-radius: 8px; margin-top: 10px;">
              <div style="color: #999; font-size: 13px; margin-bottom: 8px;">
                <strong style="color: #CE1126;">⚠️ Note:</strong>
              </div>
              <div style="color: #ccc; font-size: 13px;">
                • Changing the phone number won't update their login credentials<br>
                • User will still log in with their original phone number<br>
                • This only updates the display information
              </div>
            </div>

            <div style="display: flex; gap: 10px; margin-top: 10px;">
              <button type="submit" style="flex: 1; background: #006847; color: white; border: none; padding: 14px; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 16px;">
                💾 Save Changes
              </button>
              <button type="button" onclick="closeEditClientModal()" style="flex: 1; background: #666; color: white; border: none; padding: 14px; border-radius: 8px; cursor: pointer; font-weight: bold; font-size: 16px;">
                ❌ Cancel
              </button>
            </div>
          </form>

        </div>
      </div>
    `;

    // Add to page
    const existingModal = document.getElementById('editClientModal');
    if (existingModal) {
      existingModal.remove();
    }

    document.body.insertAdjacentHTML('beforeend', modalHTML);

    // Handle form submission
    document.getElementById('editClientForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const newName = document.getElementById('editClientName').value.trim();
      const newPhone = document.getElementById('editClientPhone').value.trim();

      if (!newName || !newPhone) {
        alert('Please fill in all fields');
        return;
      }

      try {
        // Update user in Firestore
        await window.db.collection('users').doc(clientId).update({
          name: newName,
          phone: newPhone
        });

        alert('✅ Client updated successfully!');
        closeEditClientModal();
        
        // Reload clients list
        loadClients();
      } catch (error) {
        console.error('Error updating client:', error);
        alert('❌ Error updating client: ' + error.message);
      }
    });

  } catch (error) {
    console.error('Error loading client for edit:', error);
    alert('Error loading client details');
  }
}

// Close edit client modal
function closeEditClientModal() {
  const modal = document.getElementById('editClientModal');
  if (modal) {
    modal.remove();
  }
}

// Delete client function
async function deleteClient(clientId, clientName) {
  // Confirm deletion
  const confirmed = confirm(
    `⚠️ Are you sure you want to delete ${clientName}?\n\n` +
    `This will:\n` +
    `• Delete their user account from Firestore\n` +
    `• Delete their Firebase Authentication account\n` +
    `• Remove them from the public leaderboard\n` +
    `• Keep their bookings (but unlink them from the user)\n\n` +
    `This action CANNOT be undone!`
  );

  if (!confirmed) {
    return;
  }

  try {
    const auth = firebase.auth();
    const currentUser = auth.currentUser;
    if (!currentUser) {
      alert('❌ You must be logged in as admin to delete clients.');
      return;
    }

    const idToken = await currentUser.getIdToken(true);
    const response = await fetch('https://us-central1-mexicuts-booking.cloudfunctions.net/deleteUserCompletely', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        idToken,
        userId: clientId
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) {
      console.error('Error from deleteUserCompletely:', data);
      alert('❌ Error deleting client: ' + (data.message || 'Unknown error'));
      return;
    }

    alert(
      `✅ Client deleted successfully!\n\n` +
      `• Unlinked ${data.unlinkedBookings || 0} booking(s)\n` +
      `• User profile removed\n` +
      `• Auth account removed\n` +
      `• Leaderboard entry removed`
    );

    // Reload clients list
    loadClients();

  } catch (error) {
    console.error('Error deleting client:', error);
    alert('❌ Error deleting client: ' + error.message);
  }
}

// Approve / reject client account (status only, no emails)
async function approveClient(clientId) {
  try {
    await window.db.collection('users').doc(clientId).update({
      accountStatus: 'approved'
    });
    alert('✅ Client approved');
    loadClients();
  } catch (error) {
    console.error('Error approving client:', error);
    alert('❌ Error approving client: ' + error.message);
  }
}

async function rejectClient(clientId) {
  try {
    await window.db.collection('users').doc(clientId).update({
      accountStatus: 'rejected'
    });
    alert('✅ Client rejected');
    loadClients();
  } catch (error) {
    console.error('Error rejecting client:', error);
    alert('❌ Error rejecting client: ' + error.message);
  }
}

// Export functions
window.viewClientDetails = viewClientDetails;
window.closeClientModal = closeClientModal;
window.editClient = editClient;
window.closeEditClientModal = closeEditClientModal;
window.deleteClient = deleteClient;
window.approveClient = approveClient;
window.rejectClient = rejectClient;
window.loadPendingClients = loadPendingClients;

