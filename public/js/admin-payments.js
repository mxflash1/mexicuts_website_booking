// Admin Payment Management
console.log('💰 Admin-payments.js loaded');

// Custom confirm dialog (replaces browser confirm)
function customConfirm(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('customConfirmModal');
    const titleEl = document.getElementById('confirmTitle');
    const messageEl = document.getElementById('confirmMessage');
    const okBtn = document.getElementById('confirmOk');
    const cancelBtn = document.getElementById('confirmCancel');
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    modal.style.display = 'block';
    
    const handleOk = () => {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', handleOk);
      cancelBtn.removeEventListener('click', handleCancel);
      resolve(true);
    };
    
    const handleCancel = () => {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', handleOk);
      cancelBtn.removeEventListener('click', handleCancel);
      resolve(false);
    };
    
    okBtn.addEventListener('click', handleOk);
    cancelBtn.addEventListener('click', handleCancel);
  });
}

// Custom alert dialog (replaces browser alert)
function customAlert(title, message) {
  return new Promise((resolve) => {
    const modal = document.getElementById('customAlertModal');
    const titleEl = document.getElementById('alertTitle');
    const messageEl = document.getElementById('alertMessage');
    const okBtn = document.getElementById('alertOk');
    
    titleEl.textContent = title;
    messageEl.textContent = message;
    modal.style.display = 'block';
    
    const handleOk = () => {
      modal.style.display = 'none';
      okBtn.removeEventListener('click', handleOk);
      resolve();
    };
    
    okBtn.addEventListener('click', handleOk);
  });
}

// Load pending payments
async function loadPendingPayments() {
  const paymentsList = document.getElementById('pendingPaymentsList');
  
  if (!paymentsList) {
    console.log('Payments list container not found');
    return;
  }

  // Check if db is available
  if (!window.db) {
    console.error('Database not initialized yet');
    setTimeout(loadPendingPayments, 1000);
    return;
  }

  try {
    console.log('💰 Loading pending payments...');

    // Show every approved booking from the past ~30 days that hasn't been
    // fully settled. This catches orphans whose Firestore record never got
    // `addedToPaymentSheet: true` — e.g. when the cron's sheet write
    // succeeded but the follow-up Firestore update failed.
    const bookingsSnapshot = await window.db.collection('bookings').get();

    let html = '';
    const pendingPayments = [];
    const now = new Date();
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const thirtyDaysAgo = new Date(now.getTime() - THIRTY_DAYS_MS);

    const parseTimeSlot = (ts) => {
      if (!ts || typeof ts !== 'string') return null;
      const m = ts.match(/^(\d{4}-\d{2}-\d{2}) (\d{1,2}):(\d{2}) (AM|PM)$/);
      if (!m) return null;
      let hour = parseInt(m[2], 10);
      const minute = parseInt(m[3], 10);
      if (m[4] === 'PM' && hour !== 12) hour += 12;
      if (m[4] === 'AM' && hour === 12) hour = 0;
      const [y, mo, d] = m[1].split('-').map(Number);
      return new Date(y, mo - 1, d, hour, minute);
    };

    bookingsSnapshot.forEach(doc => {
      const data = doc.data();
      const status = data.status || 'approved';
      if (status !== 'approved') return;
      const apptDate = parseTimeSlot(data.timeSlot);
      if (!apptDate) return;
      if (apptDate < thirtyDaysAgo || apptDate > now) return; // past 30 days, already-happened only

      const fullySettled =
        data.paymentStatus === 'paid' &&
        data.paymentMethod &&
        data.paymentMethod !== 'pending';
      if (fullySettled) return;
      pendingPayments.push({ id: doc.id, ...data });
    });

    if (pendingPayments.length === 0) {
      paymentsList.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state__icon"><use href="#i-check"/></svg>
          <div class="empty-state__title">All paid up</div>
          <div class="empty-state__hint">No pending payments — every booking has been settled.</div>
        </div>
      `;
      const countElement = document.getElementById('pendingPaymentsCount');
      if (countElement) countElement.textContent = '0';
      return;
    }

    pendingPayments.sort((a, b) => new Date(b.timeSlot) - new Date(a.timeSlot));

    pendingPayments.forEach(payment => {
      const hasPaymentMethod = payment.paymentMethod && payment.paymentMethod !== 'pending';
      const displayPrice = payment.price || 20;
      const service = payment.service || 'Haircut';
      const methodLabel = payment.paymentMethod === 'cash' ? 'Cash' : payment.paymentMethod === 'card' ? 'Card' : '';
      const variantClass = hasPaymentMethod ? 'list-card--success' : 'list-card--urgent';
      const badgeClass = hasPaymentMethod ? 'badge--success' : 'badge--warning';
      const badgeLabel = hasPaymentMethod ? 'Method set' : 'Pending';

      html += `
        <div class="list-card ${variantClass}">
          <div class="list-card__row">
            <div style="flex:1; min-width:0;">
              <div class="list-card__title">
                ${(payment.name || 'Unknown').replace(/</g,'&lt;')}
                <span class="badge ${badgeClass}">${badgeLabel}</span>
              </div>
              <div class="list-card__meta">
                <div class="list-card__meta-row"><svg><use href="#i-calendar"/></svg>${payment.timeSlot || '—'}</div>
                <div class="list-card__meta-row"><svg><use href="#i-phone"/></svg>${payment.phone || '—'}</div>
                <div class="list-card__meta-row"><svg><use href="#i-scissors"/></svg>${service}</div>
                <div class="list-card__meta-row" style="align-items:center;">
                  <svg><use href="#i-dollar"/></svg>
                  <span style="display:inline-flex; align-items:center; gap:6px;">
                    $
                    <input type="number"
                           id="price-${payment.id}"
                           value="${displayPrice}"
                           min="1"
                           style="width:64px; padding:6px 8px; border-radius:6px; border:1px solid var(--border); background: var(--surface-input); color: var(--text); font-size: var(--text-sm);"
                           onchange="updateBookingPrice('${payment.id}', this.value)"
                           aria-label="Edit price for ${(payment.name || 'booking').replace(/"/g,'&quot;')}">
                    <span class="text-tertiary" style="font-size: 11px;">editable</span>
                  </span>
                </div>
                ${hasPaymentMethod ? `<div class="list-card__meta-row text-success" style="font-weight:600;"><svg><use href="#i-check"/></svg>Method: ${methodLabel}</div>` : ''}
              </div>
            </div>
          </div>

          <div style="display:flex; justify-content:flex-end; margin-top: var(--space-2);">
            <button class="btn btn-ghost btn-sm" type="button" onclick="deleteBookingPayment('${payment.id}', '${(payment.name || '').replace(/'/g,"\\'")}')">
              <svg class="btn-icon"><use href="#i-trash"/></svg>Delete
            </button>
          </div>

          ${!hasPaymentMethod ? `
            <div class="text-tertiary" style="font-size: var(--text-sm); margin-top: var(--space-3); margin-bottom: var(--space-2);">Step 1 · Select payment method</div>
            <div class="btn-row">
              <button class="btn btn-secondary" type="button" onclick="setPaymentMethod('${payment.id}', 'cash')">
                <svg class="btn-icon"><use href="#i-cash"/></svg>
                Cash
              </button>
              <button class="btn btn-success" type="button" onclick="setPaymentMethod('${payment.id}', 'card')">
                <svg class="btn-icon"><use href="#i-credit-card"/></svg>
                Card
              </button>
            </div>
          ` : `
            <div class="text-tertiary" style="font-size: var(--text-sm); margin-top: var(--space-3); margin-bottom: var(--space-2);">Step 2 · Mark paid when received</div>
            <button class="btn btn-success btn-block" type="button" onclick="confirmPaymentReceived('${payment.id}')">
              <svg class="btn-icon"><use href="#i-check"/></svg>
              Mark as paid
            </button>
            <button class="btn btn-ghost btn-block btn-sm" type="button" style="margin-top: var(--space-2);" onclick="changePaymentMethod('${payment.id}')">
              Change method
            </button>
          `}
        </div>
      `;
    });

    paymentsList.innerHTML = html;

    const countElement = document.getElementById('pendingPaymentsCount');
    if (countElement) countElement.textContent = pendingPayments.length;

  } catch (error) {
    console.error('Error loading pending payments:', error);
    paymentsList.innerHTML = `
      <div class="empty-state">
        <svg class="empty-state__icon"><use href="#i-info"/></svg>
        <div class="empty-state__title">Couldn't load payments</div>
        <div class="empty-state__hint">Please refresh and try again.</div>
      </div>
    `;
  }
}

// Step 1: Set payment method (Cash or Card)
async function setPaymentMethod(bookingId, method) {
  try {
    console.log(`Setting payment method to ${method} for booking ${bookingId}`);
    
    // Update Firestore with payment method
    await window.db.collection('bookings').doc(bookingId).update({
      paymentMethod: method
    });

    // Call Cloud Function to update Google Sheets with method only (no payment date)
    const response = await fetch('https://updatepaymentstatus-tktzr4t4nq-uc.a.run.app', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bookingId: bookingId,
        paymentMethod: method,
        methodOnly: true  // Flag to indicate we're only setting the method
      })
    });

    if (!response.ok) {
      throw new Error('Failed to update payment method');
    }

    // Show success message
    await customAlert('✅ Method Set', `Payment method set to ${method === 'cash' ? 'Cash' : 'Card'}!\n\nNow click "Mark as Paid" when payment is received.`);

    // Reload payments list
    loadPendingPayments();

  } catch (error) {
    console.error('Error setting payment method:', error);
    await customAlert('❌ Error', 'Error setting payment method: ' + error.message);
  }
}

// Step 2: Confirm payment received (adds payment date)
async function confirmPaymentReceived(bookingId) {
  const confirmed = await customConfirm('💰 Confirm Payment', 'Confirm that payment has been received?');
  if (!confirmed) {
    return;
  }

  try {
    // Get today's date for payment date
    const now = new Date();
    const paymentDate = `${now.getDate()} ${getMonthName(now.getMonth())} ${now.getFullYear()}`;

    // Get the booking to retrieve payment method
    const bookingDoc = await window.db.collection('bookings').doc(bookingId).get();
    const booking = bookingDoc.data();

    // Call Cloud Function to update payment with date
    const response = await fetch('https://updatepaymentstatus-tktzr4t4nq-uc.a.run.app', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        bookingId: bookingId,
        paymentMethod: booking.paymentMethod,
        paymentDate: paymentDate,
        methodOnly: false  // Full payment confirmation
      })
    });

    if (!response.ok) {
      throw new Error('Failed to confirm payment');
    }

    // Show success message
    await customAlert('✅ Payment Confirmed', 'Payment confirmed and date added to Google Sheets!');

    // Reload payments list
    loadPendingPayments();

  } catch (error) {
    console.error('Error confirming payment:', error);
    await customAlert('❌ Error', 'Error confirming payment: ' + error.message);
  }
}

// Change payment method (reset to step 1)
async function changePaymentMethod(bookingId) {
  const confirmed = await customConfirm('🔄 Reset Method', 'Reset payment method?');
  if (!confirmed) {
    return;
  }

  try {
    await window.db.collection('bookings').doc(bookingId).update({
      paymentMethod: 'pending'
    });

    await customAlert('✅ Method Reset', 'Payment method reset. Please select a new method.');
    loadPendingPayments();

  } catch (error) {
    console.error('Error changing payment method:', error);
    await customAlert('❌ Error', 'Error changing payment method: ' + error.message);
  }
}

// Helper function to get month name
function getMonthName(monthNumber) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  return months[monthNumber];
}

// Initialize when DOM loads
document.addEventListener('DOMContentLoaded', () => {
  console.log('💰 Payment management initializing...');
  
  // Wait for database
  const checkDatabase = () => {
    if (window.db) {
      console.log('✅ Database ready, loading payments...');
      loadPendingPayments();
    } else {
      setTimeout(checkDatabase, 500);
    }
  };
  
  setTimeout(checkDatabase, 500);

  // Sheet-driven fallback: rows in Google Sheets that have no matching
  // Firestore booking. Loaded independently of Firestore readiness.
  loadUnmatchedSheetRows();
});

// ── Unmatched sheet rows (no Firestore counterpart) ────────────────────────
const LIST_SHEET_URL = 'https://us-central1-mexicuts-booking.cloudfunctions.net/listSheetUnsettledRows';
const CONFIRM_SHEET_ROW_URL = 'https://us-central1-mexicuts-booking.cloudfunctions.net/confirmSheetRow';
const DELETE_SHEET_ROW_URL = 'https://us-central1-mexicuts-booking.cloudfunctions.net/deletePaymentSheetRow';
const DELETE_PAYMENT_BOOKING_URL = 'https://us-central1-mexicuts-booking.cloudfunctions.net/deletePaymentBooking';

async function deleteSheetRowAction(rowIndex, name) {
  const confirmed = await customConfirm(
    '🗑️ Delete row',
    `Delete the sheet row for "${name || 'this customer'}"? This cannot be undone.`
  );
  if (!confirmed) return;
  try {
    const res = await fetch(DELETE_SHEET_ROW_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowIndex })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || 'Delete failed');
    await customAlert('✅ Deleted', 'Sheet row removed.');
    loadUnmatchedSheetRows();
  } catch (err) {
    console.error('Error deleting sheet row:', err);
    await customAlert('❌ Error', 'Could not delete row: ' + err.message);
  }
}

async function deleteBookingPayment(bookingId, name) {
  const confirmed = await customConfirm(
    '🗑️ Delete booking',
    `Delete "${name || 'this booking'}" and remove its sheet row? This cannot be undone.`
  );
  if (!confirmed) return;
  try {
    const res = await fetch(DELETE_PAYMENT_BOOKING_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bookingId })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || 'Delete failed');
    await customAlert('✅ Deleted', data.removedSheetRow ? 'Booking and sheet row removed.' : 'Booking removed (no matching sheet row found).');
    loadPendingPayments();
    loadUnmatchedSheetRows();
  } catch (err) {
    console.error('Error deleting booking:', err);
    await customAlert('❌ Error', 'Could not delete: ' + err.message);
  }
}

async function loadUnmatchedSheetRows() {
  const container = document.getElementById('unmatchedSheetRowsList');
  if (!container) return;

  try {
    const res = await fetch(LIST_SHEET_URL);
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.message || 'Failed to load sheet rows');

    const rows = Array.isArray(data.rows) ? data.rows : [];
    if (rows.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <svg class="empty-state__icon"><use href="#i-check"/></svg>
          <div class="empty-state__title">All sheet rows settled</div>
          <div class="empty-state__hint">Every row in the payment sheet has a When Paid date.</div>
        </div>
      `;
      return;
    }

    let html = '';
    rows.forEach(row => {
      const safeName = (row.who || 'Unknown').replace(/</g, '&lt;');
      const amountNumber = parseFloat(String(row.amount || '20').replace(/[^0-9.]/g, '')) || 20;
      html += `
        <div class="list-card list-card--urgent" data-row-index="${row.rowIndex}">
          <div class="list-card__row">
            <div style="flex:1; min-width:0;">
              <div class="list-card__title">
                ${safeName}
                <span class="badge badge--warning">Sheet only</span>
              </div>
              <div class="list-card__meta">
                <div class="list-card__meta-row"><svg><use href="#i-calendar"/></svg>${row.whenCut || '—'}</div>
                <div class="list-card__meta-row" style="align-items:center;">
                  <svg><use href="#i-dollar"/></svg>
                  <span style="display:inline-flex; align-items:center; gap:6px;">
                    $
                    <input type="number"
                           id="sheet-amount-${row.rowIndex}"
                           value="${amountNumber}"
                           min="1"
                           style="width:64px; padding:6px 8px; border-radius:6px; border:1px solid var(--border); background: var(--surface-input); color: var(--text); font-size: var(--text-sm);"
                           aria-label="Amount for ${safeName}">
                    <span class="text-tertiary" style="font-size: 11px;">editable</span>
                  </span>
                </div>
              </div>
            </div>
          </div>
          <div class="text-tertiary" style="font-size: var(--text-sm); margin-top: var(--space-3); margin-bottom: var(--space-2);">Confirm payment</div>
          <div class="btn-group">
            <button class="btn btn-secondary" type="button" onclick="confirmSheetRowAction(${row.rowIndex}, 'cash')">
              <svg class="btn-icon"><use href="#i-cash"/></svg>Cash
            </button>
            <button class="btn btn-success" type="button" onclick="confirmSheetRowAction(${row.rowIndex}, 'card')">
              <svg class="btn-icon"><use href="#i-credit-card"/></svg>Card
            </button>
          </div>
          <button class="btn btn-ghost btn-block btn-sm" type="button" style="margin-top: var(--space-2);" onclick="deleteSheetRowAction(${row.rowIndex}, '${safeName.replace(/'/g,"\\'")}')">
            <svg class="btn-icon"><use href="#i-trash"/></svg>Delete row
          </button>
        </div>
      `;
    });
    container.innerHTML = html;
  } catch (err) {
    console.error('Error loading unmatched sheet rows:', err);
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state__title">Couldn't load sheet rows</div>
        <div class="empty-state__hint">${err.message}</div>
      </div>
    `;
  }
}

async function confirmSheetRowAction(rowIndex, paymentMethod) {
  const amountInput = document.getElementById(`sheet-amount-${rowIndex}`);
  const amount = amountInput ? parseFloat(amountInput.value) : NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    await customAlert('❌ Invalid Price', 'Please enter a valid price greater than $0.');
    return;
  }

  const confirmed = await customConfirm(
    '💰 Confirm Payment',
    `Mark this row as paid by ${paymentMethod === 'cash' ? 'Cash' : 'Card'} for $${amount}?`
  );
  if (!confirmed) return;

  try {
    const now = new Date();
    const paymentDate = `${now.getDate()} ${getMonthName(now.getMonth())} ${now.getFullYear()}`;
    const res = await fetch(CONFIRM_SHEET_ROW_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rowIndex, paymentMethod, paymentDate, amount })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) throw new Error(data.message || 'Confirmation failed');
    await customAlert('✅ Payment Confirmed', 'Sheet row updated.');
    loadUnmatchedSheetRows();
  } catch (err) {
    console.error('Error confirming sheet row:', err);
    await customAlert('❌ Error', 'Could not confirm: ' + err.message);
  }
}

// Test payment sheet auto-add
async function testPaymentSheetAdd() {
  const bookingIdInput = document.getElementById('testBookingId');
  const bookingId = bookingIdInput.value.trim();
  const resultDiv = document.getElementById('testResult');
  
  const setResult = (state, html) => {
    resultDiv.style.display = 'block';
    resultDiv.innerHTML = html;
    if (state === 'error') {
      resultDiv.style.background = 'var(--danger-soft)';
      resultDiv.style.border = '1px solid rgba(239,68,68,0.4)';
      resultDiv.style.color = 'var(--danger)';
    } else if (state === 'success') {
      resultDiv.style.background = 'var(--success-soft)';
      resultDiv.style.border = '1px solid rgba(34,197,94,0.4)';
      resultDiv.style.color = 'var(--success)';
    } else {
      resultDiv.style.background = 'var(--surface-2)';
      resultDiv.style.border = '1px solid var(--border)';
      resultDiv.style.color = 'var(--text-secondary)';
    }
  };

  if (!bookingId) {
    setResult('error', 'Please enter a booking ID first.');
    return;
  }

  setResult('loading', 'Testing… this may take a few seconds.');

  try {
    const response = await fetch(`https://testpaymentsheetadd-tktzr4t4nq-uc.a.run.app?bookingId=${bookingId}`);
    const text = await response.text();

    if (response.ok) {
      setResult('success', `${text}<br><br><strong>Now check:</strong><br>• Your Google Sheet for the new row<br>• Your email inbox for the notification<br>• The Payments list above for the pending row`);
      setTimeout(() => loadPendingPayments(), 2000);
    } else {
      setResult('error', text);
    }
  } catch (error) {
    setResult('error', `Error: ${error.message}`);
  }
}

// Update the price for a booking directly from the payments page
async function updateBookingPrice(bookingId, newPrice) {
  const parsed = parseFloat(newPrice);
  if (isNaN(parsed) || parsed <= 0) {
    await customAlert('❌ Invalid Price', 'Please enter a valid price greater than $0.');
    return;
  }
  try {
    await window.db.collection('bookings').doc(bookingId).update({ price: parsed });
    console.log(`✅ Price updated to $${parsed} for booking ${bookingId}`);
  } catch (error) {
    console.error('Error updating price:', error);
    await customAlert('❌ Error', 'Could not update price: ' + error.message);
  }
}

// Export functions
window.loadPendingPayments = loadPendingPayments;
window.setPaymentMethod = setPaymentMethod;
window.confirmPaymentReceived = confirmPaymentReceived;
window.changePaymentMethod = changePaymentMethod;
window.testPaymentSheetAdd = testPaymentSheetAdd;
window.updateBookingPrice = updateBookingPrice;
window.loadUnmatchedSheetRows = loadUnmatchedSheetRows;
window.confirmSheetRowAction = confirmSheetRowAction;
window.deleteSheetRowAction = deleteSheetRowAction;
window.deleteBookingPayment = deleteBookingPayment;

