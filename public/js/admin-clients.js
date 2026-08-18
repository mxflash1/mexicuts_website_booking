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
      <div class="loading-state"><span class="loading-state__spinner" aria-hidden="true"></span> Connecting…</div>
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
      <div class="empty-state">
        <svg class="empty-state__icon"><use href="#i-info"/></svg>
        <div class="empty-state__title">Couldn't load clients</div>
        <div class="empty-state__hint">Please refresh and try again.</div>
      </div>
    `;
  }
}

function escapeAttr(s) {
  return String(s == null ? '' : s).replace(/'/g, "\\'").replace(/"/g, '&quot;');
}

// Display clients in the list
function displayClients(clients) {
  const clientsList = document.getElementById('clientsList');

  if (clients.length === 0) {
    clientsList.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state__icon"><use href="#i-users"/></svg>
        <div class="empty-state__title">No registered clients yet</div>
        <div class="empty-state__hint">Bookings will appear here once customers create accounts.</div>
      </div>
    `;
    return;
  }

  let html = '';
  clients.forEach(client => {
    const joinDate = client.createdAt
      ? client.createdAt.toDate().toLocaleDateString('en-AU', { year:'numeric', month:'short', day:'numeric' })
      : 'Unknown';

    const isNew = client.createdAt && (new Date() - client.createdAt.toDate()) < (7 * 24 * 60 * 60 * 1000);
    const status = client.accountStatus || 'approved';
    const badgeClass = status === 'approved' ? 'badge--success'
                     : status === 'rejected' ? 'badge--danger'
                     : 'badge--warning';

    const safeId = escapeAttr(client.id);
    const safeName = escapeAttr(client.name || 'Unknown');

    html += `
      <div class="list-card">
        <div class="list-card__row">
          <div style="flex:1; min-width:0;">
            <div class="list-card__title">
              ${(client.name || 'Unknown').replace(/</g,'&lt;')}
              ${isNew ? '<span class="badge badge--brand">New</span>' : ''}
              <span class="badge ${badgeClass}">${status}</span>
            </div>
            <div class="list-card__meta">
              <div class="list-card__meta-row">
                <svg><use href="#i-phone"/></svg>${client.phone || 'No phone'}
              </div>
              <div class="list-card__meta-row">
                <svg><use href="#i-calendar"/></svg>Joined ${joinDate}
              </div>
              <div class="list-card__meta-row">
                <svg><use href="#i-list"/></svg>${client.bookingCount || 0} booking${(client.bookingCount || 0) === 1 ? '' : 's'}
              </div>
            </div>
          </div>
        </div>
        <div class="list-card__actions">
          <button class="btn btn-quiet btn-sm" type="button" onclick="viewClientDetails('${safeId}')">View</button>
          <button class="btn btn-ghost btn-sm" type="button" onclick="editClient('${safeId}')">Edit</button>
          ${status !== 'approved' ? `<button class="btn btn-success btn-sm" type="button" onclick="approveClient('${safeId}')">Approve</button>` : ''}
          ${status !== 'rejected' ? `<button class="btn btn-quiet btn-sm" type="button" onclick="rejectClient('${safeId}')">Reject</button>` : ''}
          <button class="btn btn-danger btn-sm" type="button" onclick="deleteClient('${safeId}', '${safeName}')">Delete</button>
        </div>
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

    // Query by both userId AND phone to catch all bookings for this person
    // (covers logged-in bookings, legacy bookings, and same-phone guest bookings).
    const [byUserId, byPhone] = await Promise.all([
      window.db.collection('bookings').where('userId', '==', clientId).get(),
      client.phone
        ? window.db.collection('bookings').where('phone', '==', client.phone).get()
        : Promise.resolve({ docs: [] })
    ]);

    // Merge and deduplicate by document ID
    const seen = new Set();
    const bookings = [];
    [...byUserId.docs, ...byPhone.docs].forEach(doc => {
      if (!seen.has(doc.id)) {
        seen.add(doc.id);
        bookings.push({ id: doc.id, ...doc.data() });
      }
    });

    // Sort bookings by date
    bookings.sort((a, b) => {
      return new Date(b.timeSlot) - new Date(a.timeSlot);
    });

    // Sync stored bookingCount to match live query so the card stays accurate
    if ((client.bookingCount || 0) !== bookings.length) {
      window.db.collection('users').doc(clientId).update({ bookingCount: bookings.length })
        .catch(err => console.warn('Could not sync bookingCount:', err));
      // Also update the local cache so the card reflects it immediately
      const cached = allClients.find(c => c.id === clientId);
      if (cached) cached.bookingCount = bookings.length;
    }

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

  // Format a single booking row
  function formatBooking(booking) {
    const [datePart, timePart, ampm] = booking.timeSlot.split(' ');
    const [year, month, day] = datePart.split('-');
    const bookingDate = new Date(year, month - 1, day);

    const dateStr = bookingDate.toLocaleDateString('en-AU', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });

    const service = booking.service
      ? `${booking.service}${booking.price ? ` · $${booking.price}` : ''}`
      : 'Haircut · $20';

    return `
      <div class="list-card">
        <div class="list-card__title">${dateStr}</div>
        <div class="list-card__meta">
          <div class="list-card__meta-row"><svg><use href="#i-clock"/></svg>${timePart} ${ampm}</div>
          <div class="list-card__meta-row"><svg><use href="#i-scissors"/></svg>${service}</div>
          <div class="list-card__meta-row text-tertiary">Peregian Springs, Sunshine Coast</div>
          ${booking.notes ? `<div class="list-card__meta-row text-tertiary">"${(booking.notes || '').replace(/</g,'&lt;')}"</div>` : ''}
        </div>
      </div>
    `;
  }

  const joined = client.createdAt
    ? client.createdAt.toDate().toLocaleDateString('en-AU', { year:'numeric', month:'short', day:'numeric' })
    : 'Unknown';

  const modalHTML = `
    <div id="clientDetailsModal" class="modal" style="display:block;" role="dialog" aria-modal="true">
      <div class="modal-content" style="max-width: 720px;">
        <div class="modal__head">
          <h3 class="modal__title">
            <svg><use href="#i-users"/></svg>
            ${(client.name || 'Client').replace(/</g,'&lt;')}
          </h3>
          <button type="button" class="modal__close" aria-label="Close" onclick="closeClientModal()">
            <svg><use href="#i-x"/></svg>
          </button>
        </div>

        <div class="stats-grid" style="margin-bottom: var(--space-5);">
          <div class="stat-card">
            <svg class="stat-card__icon"><use href="#i-phone"/></svg>
            <div class="stat-number" style="font-size: var(--text-md);">${client.phone || 'N/A'}</div>
            <div class="stat-label">Phone</div>
          </div>
          <div class="stat-card">
            <svg class="stat-card__icon"><use href="#i-calendar"/></svg>
            <div class="stat-number" style="font-size: var(--text-md);">${joined}</div>
            <div class="stat-label">Joined</div>
          </div>
          <div class="stat-card">
            <svg class="stat-card__icon"><use href="#i-list"/></svg>
            <div class="stat-number">${bookings.length}</div>
            <div class="stat-label">Total bookings</div>
          </div>
        </div>

        ${upcomingBookings.length > 0 ? `
          <div class="section-heading"><svg class="icon-leading"><use href="#i-calendar"/></svg> Upcoming · ${upcomingBookings.length}</div>
          ${upcomingBookings.map(formatBooking).join('')}
        ` : ''}

        <div class="section-heading" style="margin-top: var(--space-5);"><svg class="icon-leading"><use href="#i-clock"/></svg> Past · ${pastBookings.length}</div>
        ${pastBookings.length === 0
          ? `<div class="empty-state"><div class="empty-state__hint">No past appointments yet.</div></div>`
          : pastBookings.map(formatBooking).join('')}

        <button type="button" class="btn btn-block" style="margin-top: var(--space-5);" onclick="closeClientModal()">Close</button>
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
        <div class="empty-state">
          <svg class="empty-state__icon"><use href="#i-check"/></svg>
          <div class="empty-state__title">All caught up</div>
          <div class="empty-state__hint">No pending clients right now.</div>
        </div>
      `;
      return;
    }

    let html = '';
    snapshot.forEach(doc => {
      const client = { id: doc.id, ...doc.data() };
      const joinDate = client.createdAt
        ? client.createdAt.toDate().toLocaleDateString('en-AU', { year:'numeric', month:'short', day:'numeric' })
        : 'Unknown';
      const safeId = escapeAttr(client.id);
      const safeName = escapeAttr(client.name || 'Unknown');

      html += `
        <div class="list-card list-card--warning">
          <div class="list-card__row">
            <div style="flex:1; min-width:0;">
              <div class="list-card__title">
                ${(client.name || 'Unknown').replace(/</g,'&lt;')}
                <span class="badge badge--warning">Pending</span>
              </div>
              <div class="list-card__meta">
                <div class="list-card__meta-row"><svg><use href="#i-phone"/></svg>${client.phone || 'No phone'}</div>
                <div class="list-card__meta-row"><svg><use href="#i-calendar"/></svg>Joined ${joinDate}</div>
              </div>
            </div>
          </div>
          <div class="list-card__actions">
            <button class="btn btn-success btn-sm" type="button" onclick="approveClient('${safeId}')">Approve</button>
            <button class="btn btn-quiet btn-sm" type="button" onclick="rejectClient('${safeId}')">Reject</button>
            <button class="btn btn-danger btn-sm" type="button" onclick="deleteClient('${safeId}', '${safeName}')">Delete</button>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  } catch (error) {
    console.error('Error loading pending clients:', error);
    container.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state__icon"><use href="#i-info"/></svg>
        <div class="empty-state__title">Couldn't load pending clients</div>
      </div>
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
    const safeName = (client.name || '').replace(/"/g, '&quot;');
    const safePhone = (client.phone || '').replace(/"/g, '&quot;');
    const modalHTML = `
      <div id="editClientModal" class="modal" style="display:block;" role="dialog" aria-modal="true">
        <div class="modal-content">
          <div class="modal__head">
            <h3 class="modal__title">
              <svg><use href="#i-edit"/></svg>
              Edit client
            </h3>
            <button type="button" class="modal__close" aria-label="Close" onclick="closeEditClientModal()">
              <svg><use href="#i-x"/></svg>
            </button>
          </div>

          <form id="editClientForm" class="modal__form">
            <div class="field">
              <label for="editClientName" class="field__label">Name</label>
              <input type="text" id="editClientName" class="input" value="${safeName}" required>
            </div>

            <div class="field">
              <label for="editClientPhone" class="field__label">Phone</label>
              <input type="tel" id="editClientPhone" class="input" inputmode="tel" autocomplete="tel" value="${safePhone}" required>
              <span class="field__hint">Note: changing this number won't update their login credentials. They'll still sign in with their original phone.</span>
            </div>

            <div class="btn-row">
              <button type="submit" class="btn btn-secondary">
                <svg class="btn-icon"><use href="#i-save"/></svg>
                Save changes
              </button>
              <button type="button" class="btn btn-ghost" onclick="closeEditClientModal()">Cancel</button>
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

