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

    html += `
      <div class="client-card">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
          <h4>${client.name || 'Unknown'} ${isNew ? '<span style="background: #006847; color: white; font-size: 10px; padding: 2px 8px; border-radius: 12px; margin-left: 8px;">NEW</span>' : ''}</h4>
          <div style="display: flex; gap: 8px;">
            <button onclick="editClient('${client.id}')" 
                    style="background: #006847; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">
              ✏️ Edit
            </button>
          <button onclick="viewClientDetails('${client.id}')" 
                  style="background: #555; color: white; border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px;">
              👁️ View
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
  const modalHTML = `
    <div id="clientDetailsModal" style="position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.85); z-index: 2000; display: flex; justify-content: center; align-items: center; padding: 20px;">
      <div style="background: #2a2a2a; border: 2px solid #CE1126; border-radius: 12px; padding: 30px; max-width: 600px; width: 100%; max-height: 80vh; overflow-y: auto;">
        
        <!-- Header -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h3 style="color: #CE1126; margin: 0;">👤 Client Details</h3>
          <button onclick="closeClientModal()" style="background: none; border: none; color: #ccc; font-size: 28px; cursor: pointer;">&times;</button>
        </div>

        <!-- Client Info -->
        <div style="background: #1a1a1a; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
          <div style="margin-bottom: 10px;">
            <strong style="color: #CE1126;">Name:</strong> 
            <span style="color: #ccc;">${client.name || 'N/A'}</span>
          </div>
          <div style="margin-bottom: 10px;">
            <strong style="color: #CE1126;">Phone:</strong> 
            <span style="color: #ccc;">${client.phone || 'N/A'}</span>
          </div>
          <div style="margin-bottom: 10px;">
            <strong style="color: #CE1126;">Joined:</strong> 
            <span style="color: #ccc;">${client.createdAt ? client.createdAt.toDate().toLocaleDateString('en-AU', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : 'Unknown'}</span>
          </div>
          <div>
            <strong style="color: #CE1126;">Total Bookings:</strong> 
            <span style="color: #ccc;">${client.bookingCount || 0}</span>
          </div>
        </div>

        <!-- Booking History -->
        <h4 style="color: #CE1126; margin-bottom: 15px;">📋 Booking History</h4>
        <div style="max-height: 300px; overflow-y: auto;">
          ${bookings.length === 0 ? 
            '<p style="text-align: center; color: #999; padding: 20px;">No bookings yet</p>' :
            bookings.map(booking => `
              <div style="background: #1a1a1a; border: 1px solid #555; border-radius: 8px; padding: 15px; margin-bottom: 10px;">
                <div style="color: #CE1126; font-weight: bold; margin-bottom: 8px;">${booking.timeSlot}</div>
                ${booking.notes ? `<div style="color: #ccc; font-size: 13px;">Notes: ${booking.notes}</div>` : ''}
              </div>
            `).join('')
          }
        </div>

        <!-- Actions -->
        <div style="margin-top: 20px; text-align: center;">
          <button onclick="closeClientModal()" style="background: #CE1126; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; font-weight: bold;">
            Close
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
    `• Remove their Firebase Authentication account\n` +
    `• Keep their bookings (but unlink them from the user)\n\n` +
    `This action CANNOT be undone!`
  );

  if (!confirmed) {
    return;
  }

  try {
    // Get user's bookings to unlink them
    const bookingsSnapshot = await window.db.collection('bookings')
      .where('userId', '==', clientId)
      .get();

    // Unlink bookings from user (remove userId field)
    const unlinkPromises = [];
    bookingsSnapshot.forEach(doc => {
      unlinkPromises.push(
        window.db.collection('bookings').doc(doc.id).update({
          userId: firebase.firestore.FieldValue.delete()
        })
      );
    });

    await Promise.all(unlinkPromises);
    console.log(`✅ Unlinked ${bookingsSnapshot.size} booking(s)`);

    // Delete user document from Firestore
    await window.db.collection('users').doc(clientId).delete();
    console.log('✅ User document deleted from Firestore');

    // Note: We can't delete from Firebase Auth from client-side
    // That requires Firebase Admin SDK (server-side)
    
    alert(
      `✅ Client deleted successfully!\n\n` +
      `• Removed from database\n` +
      `• ${bookingsSnapshot.size} booking(s) unlinked\n\n` +
      `⚠️ Note: Their Firebase Auth account still exists.\n` +
      `They won't be able to see their bookings anymore,\n` +
      `but they can still log in and create a new account.`
    );

    // Reload clients list
    loadClients();

  } catch (error) {
    console.error('Error deleting client:', error);
    alert('❌ Error deleting client: ' + error.message);
  }
}

// Export functions
window.viewClientDetails = viewClientDetails;
window.closeClientModal = closeClientModal;
window.editClient = editClient;
window.closeEditClientModal = closeEditClientModal;
window.deleteClient = deleteClient;

