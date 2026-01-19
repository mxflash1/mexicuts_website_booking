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
    
    // Get all bookings with pending payment status
    const bookingsSnapshot = await window.db.collection('bookings')
      .where('paymentStatus', '==', 'pending')
      .get();

    if (bookingsSnapshot.empty) {
      paymentsList.innerHTML = `
        <p style="text-align: center; color: #999; padding: 40px;">
          ✅ No pending payments!<br>
          <span style="font-size: 14px;">All haircuts have been paid for.</span>
        </p>
      `;
      return;
    }

    let html = '';
    const pendingPayments = [];

    bookingsSnapshot.forEach(doc => {
      pendingPayments.push({
        id: doc.id,
        ...doc.data()
      });
    });

    // Sort by date (most recent first)
    pendingPayments.sort((a, b) => {
      return new Date(b.timeSlot) - new Date(a.timeSlot);
    });

    pendingPayments.forEach(payment => {
      const hasPaymentMethod = payment.paymentMethod && payment.paymentMethod !== 'pending';
      const methodText = payment.paymentMethod === 'cash' ? '💵 Cash' : payment.paymentMethod === 'card' ? '💳 Card' : '';
      
      html += `
        <div class="payment-card" style="
          background: #1a1a1a;
          border: 2px solid ${hasPaymentMethod ? '#006847' : '#CE1126'};
          border-radius: 10px;
          padding: 20px;
          margin-bottom: 15px;
        ">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 15px;">
            <div>
              <h4 style="color: ${hasPaymentMethod ? '#006847' : '#CE1126'}; margin: 0 0 10px 0; font-size: 20px;">${payment.name}</h4>
              <div style="color: #ccc; font-size: 14px;">
                <div>📅 ${payment.timeSlot}</div>
                <div>📱 ${payment.phone}</div>
                <div>💵 $20</div>
                ${hasPaymentMethod ? `<div style="margin-top: 8px; color: #4CAF50; font-weight: bold;">✓ Method: ${methodText}</div>` : ''}
              </div>
            </div>
            <div style="background: rgba(${hasPaymentMethod ? '0, 104, 71' : '206, 17, 38'}, 0.2); padding: 8px 16px; border-radius: 6px;">
              <span style="color: ${hasPaymentMethod ? '#006847' : '#CE1126'}; font-weight: bold; font-size: 12px;">
                ${hasPaymentMethod ? 'METHOD SET' : 'PENDING'}
              </span>
            </div>
          </div>
          
          ${!hasPaymentMethod ? `
            <div style="margin-bottom: 10px; color: #999; font-size: 13px; font-style: italic;">
              Step 1: Select payment method
            </div>
            <div style="display: flex; gap: 10px; margin-top: 15px;">
              <button onclick="setPaymentMethod('${payment.id}', 'cash')" 
                      style="flex: 1; background: #006847; color: white; border: none; padding: 12px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 14px;">
                💵 Cash
              </button>
              <button onclick="setPaymentMethod('${payment.id}', 'card')" 
                      style="flex: 1; background: #4CAF50; color: white; border: none; padding: 12px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 14px;">
                💳 Card
              </button>
            </div>
          ` : `
            <div style="margin-bottom: 10px; color: #999; font-size: 13px; font-style: italic;">
              Step 2: Confirm when payment is received
            </div>
            <button onclick="confirmPaymentReceived('${payment.id}')" 
                    style="width: 100%; background: #4CAF50; color: white; border: none; padding: 15px; border-radius: 6px; cursor: pointer; font-weight: bold; font-size: 16px;">
              ✅ Mark as Paid
            </button>
            <button onclick="changePaymentMethod('${payment.id}')" 
                    style="width: 100%; background: transparent; color: #999; border: 1px solid #555; padding: 8px; border-radius: 6px; cursor: pointer; font-size: 12px; margin-top: 8px;">
              Change Method
            </button>
          `}
        </div>
      `;
    });

    paymentsList.innerHTML = html;
    
    // Update count
    const countElement = document.getElementById('pendingPaymentsCount');
    if (countElement) {
      countElement.textContent = pendingPayments.length;
    }

  } catch (error) {
    console.error('Error loading pending payments:', error);
    paymentsList.innerHTML = `
      <p style="text-align: center; color: #f44336;">
        ❌ Error loading payments. Please refresh.
      </p>
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
});

// Test payment sheet auto-add
async function testPaymentSheetAdd() {
  const bookingIdInput = document.getElementById('testBookingId');
  const bookingId = bookingIdInput.value.trim();
  const resultDiv = document.getElementById('testResult');
  
  if (!bookingId) {
    resultDiv.style.display = 'block';
    resultDiv.style.background = '#4a1a1a';
    resultDiv.style.border = '1px solid #f44336';
    resultDiv.style.color = '#f44336';
    resultDiv.textContent = '❌ Please enter a Booking ID';
    return;
  }
  
  // Show loading
  resultDiv.style.display = 'block';
  resultDiv.style.background = '#2a2a2a';
  resultDiv.style.border = '1px solid #666';
  resultDiv.style.color = '#ccc';
  resultDiv.textContent = '⏳ Testing... This may take a few seconds...';
  
  try {
    const response = await fetch(`https://testpaymentsheetadd-tktzr4t4nq-uc.a.run.app?bookingId=${bookingId}`);
    const text = await response.text();
    
    if (response.ok) {
      resultDiv.style.background = '#1a3a1a';
      resultDiv.style.border = '1px solid #4CAF50';
      resultDiv.style.color = '#4CAF50';
      resultDiv.innerHTML = `✅ ${text}<br><br>Check:<br>• Your Google Sheets for the new row<br>• Your email for the notification<br>• The Payments tab below for the pending payment`;
      
      // Reload pending payments
      setTimeout(() => {
        loadPendingPayments();
      }, 2000);
    } else {
      resultDiv.style.background = '#4a1a1a';
      resultDiv.style.border = '1px solid #f44336';
      resultDiv.style.color = '#f44336';
      resultDiv.textContent = `❌ ${text}`;
    }
  } catch (error) {
    resultDiv.style.background = '#4a1a1a';
    resultDiv.style.border = '1px solid #f44336';
    resultDiv.style.color = '#f44336';
    resultDiv.textContent = `❌ Error: ${error.message}`;
  }
}

// Export functions
window.loadPendingPayments = loadPendingPayments;
window.setPaymentMethod = setPaymentMethod;
window.confirmPaymentReceived = confirmPaymentReceived;
window.changePaymentMethod = changePaymentMethod;
window.testPaymentSheetAdd = testPaymentSheetAdd;

