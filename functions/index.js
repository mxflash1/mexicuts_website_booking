const functionsV1 = require('firebase-functions');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const { google } = require('googleapis');
const { defineSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentDeleted } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');

// Initialize Firebase Admin
admin.initializeApp();

const GMAIL_USER = defineSecret('GMAIL_USER');
const GMAIL_PASS = defineSecret('GMAIL_PASS');
const TWILIO_ACCOUNT_SID = defineSecret('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = defineSecret('TWILIO_AUTH_TOKEN');
const TWILIO_PHONE_NUMBER = defineSecret('TWILIO_PHONE_NUMBER');
const GOOGLE_SHEETS_CREDENTIALS = defineSecret('GOOGLE_SHEETS_CREDENTIALS');
const GOOGLE_SHEET_ID = defineSecret('GOOGLE_SHEET_ID');

function createTransporter() {
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_PASS;
  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user, pass }
  });
}

// Function to format Australian phone numbers for international SMS
function formatPhoneNumber(phone) {
  // Remove any non-digit characters
  const cleaned = phone.replace(/\D/g, '');
  
  // If it's a 10-digit Australian number starting with 0, convert to +61
  if (cleaned.length === 10 && cleaned.startsWith('0')) {
    return '+61' + cleaned.substring(1);
  }
  
  // If it's already in international format, return as is
  if (cleaned.startsWith('61') && cleaned.length === 11) {
    return '+' + cleaned;
  }
  
  // If it's already in +61 format, return as is
  if (phone.startsWith('+61')) {
    return phone;
  }
  
  // Default: assume it's Australian and add +61
  return '+61' + cleaned;
}

// Function to parse appointment time slot and create Date object
function parseAppointmentTime(timeSlot) {
  try {
    // timeSlot format: "2025-08-23 05:30 PM"
    const [datePart, timePart, ampm] = timeSlot.split(' ');
    const [year, month, day] = datePart.split('-');
    const [hour, minute] = timePart.split(':');
    
    let hour24 = parseInt(hour);
    if (ampm === 'PM' && hour24 !== 12) {
      hour24 += 12;
    } else if (ampm === 'AM' && hour24 === 12) {
      hour24 = 0;
    }
    
    // Create date in Australian timezone (Brisbane)
    // Note: JavaScript Date constructor interprets time as local time
    const appointmentDate = new Date(
      parseInt(year),
      parseInt(month) - 1, // Month is 0-indexed
      parseInt(day),
      hour24,
      parseInt(minute),
      0, // seconds
      0  // milliseconds
    );
    
    return appointmentDate;
  } catch (error) {
    console.error('Error parsing appointment time:', timeSlot, error);
    return null;
  }
}

// Function to format date in readable format (e.g., "24, August, Wednesday")
function formatReadableDate(timeSlot) {
  try {
    // timeSlot format: "2025-08-23 05:30 PM"
    const [datePart, timePart, ampm] = timeSlot.split(' ');
    const [year, month, day] = datePart.split('-');
    
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    
    const dayOfMonth = date.getDate();
    const monthName = date.toLocaleDateString('en-AU', { month: 'long' });
    const dayOfWeek = date.toLocaleDateString('en-AU', { weekday: 'long' });
    
    return `${dayOfMonth}, ${monthName}, ${dayOfWeek}`;
  } catch (error) {
    console.error('Error formatting date:', error);
    return timeSlot; // Fallback to original format if error
  }
}

// Function to check if appointment is exactly 24 hours away (within 15 minute window)
function isAppointmentTomorrow(appointmentDate) {
  const now = new Date();
  const timeDiff = appointmentDate.getTime() - now.getTime();
  const hoursDiff = timeDiff / (1000 * 60 * 60);
  
  console.log(`Current time: ${now.toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })}`);
  console.log(`Appointment time: ${appointmentDate.toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' })}`);
  console.log(`Hours difference: ${hoursDiff.toFixed(2)}`);
  
  // Check if appointment is exactly 24 hours away (±15 minutes for function timing)
  return hoursDiff >= 23.75 && hoursDiff <= 24.25;
}

// Function to backup booking data to Google Sheets
async function backupToGoogleSheets(bookingData, bookingId) {
  try {
    // Parse the Google Sheets credentials from environment variable
    const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
    const sheetId = process.env.GOOGLE_SHEET_ID;

    // Create Google Sheets client
    const auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Prepare the data row
    const timestamp = bookingData.timestamp ? 
      new Date(bookingData.timestamp.toDate()).toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' }) : 
      new Date().toLocaleString('en-AU', { timeZone: 'Australia/Brisbane' });
    const rowData = [
      timestamp,
      bookingData.name || '',
      bookingData.phone || '',
      bookingData.timeSlot || '',
      bookingData.notes || '',
      bookingId
    ];

    // Append the data to the sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'A:F', // Columns A to F
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: [rowData]
      }
    });

    console.log('✅ Booking data backed up to Google Sheets successfully');
  } catch (error) {
    console.error('❌ Error backing up to Google Sheets:', error);
  }
}

// Function to delete booking from Google Sheets
async function deleteFromGoogleSheets(bookingId) {
  try {
    // Parse the Google Sheets credentials from environment variable
    const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
    const sheetId = process.env.GOOGLE_SHEET_ID;

    // Create Google Sheets client
    const auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // First, get all data to find the row with the matching booking ID
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'A:F',
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      console.log('No data found in sheet');
      return;
    }

    // Find the row index that contains the booking ID (column F, index 5)
    let rowToDelete = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i][5] === bookingId) { // Column F (index 5) contains booking ID
        rowToDelete = i + 1; // Google Sheets uses 1-based indexing
        break;
      }
    }

    if (rowToDelete === -1) {
      console.log(`Booking ID ${bookingId} not found in Google Sheets`);
      return;
    }

    // Delete the row
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      resource: {
        requests: [
          {
            deleteDimension: {
              range: {
                sheetId: 0, // Assuming first sheet
                dimension: 'ROWS',
                startIndex: rowToDelete - 1, // Convert to 0-based for API
                endIndex: rowToDelete
              }
            }
          }
        ]
      }
    });

    console.log(`✅ Booking ${bookingId} deleted from Google Sheets successfully`);
  } catch (error) {
    console.error('❌ Error deleting from Google Sheets:', error);
  }
}

// This function automatically triggers when a new booking is added to the database (Gen 2)
exports.sendBookingNotification = onDocumentCreated(
  {
    region: 'us-central1',
    document: 'bookings/{bookingId}',
    secrets: [GMAIL_USER, GMAIL_PASS, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, GOOGLE_SHEETS_CREDENTIALS, GOOGLE_SHEET_ID]
  },
  async (event) => {
    try {
      const bookingData = event.data && event.data.data ? event.data.data() : {};
      const bookingId = event.data.id;

      // Send email notification to barber
      const transporter = createTransporter();

      const mailOptions = {
        from: process.env.GMAIL_USER,
        to: 'matias.oliverac@outlook.com',
        subject: '🎉 New Booking at Mexi Cuts! 🎉',
        html: `
          <h2>New Booking Received!</h2>
          <p><strong>Customer Name:</strong> ${bookingData.name || ''}</p>
          <p><strong>Phone Number:</strong> ${bookingData.phone || ''}</p>
          <p><strong>Appointment Time:</strong> ${bookingData.timeSlot || ''}</p>
          <p><strong>Special Notes:</strong> ${bookingData.notes || 'None'}</p>
          <p><strong>Booking Date:</strong> ${bookingData.timestamp ? new Date(bookingData.timestamp.toDate()).toLocaleString() : ''}</p>
          <br>
          <p>This booking has been automatically saved to your database and backed up to Google Sheets.</p>
        `
      };

      await transporter.sendMail(mailOptions);
      console.log('✅ Booking notification email sent successfully');

      // Send SMS confirmation to client
      if (bookingData.phone) {
        try {
          const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
          
          const formattedDate = formatReadableDate(bookingData.timeSlot);
          const smsMessage = `🎉 Your Mexi Cuts appointment is confirmed!\n\n📅 Date: ${formattedDate}\n⏰ Time: ${bookingData.timeSlot.split(' ')[1]} ${bookingData.timeSlot.split(' ')[2]}\n💇‍♂️ Service: Haircut\n💰 Price: $20\n\n📍 Location: 6 Rosella Tce, Peregian Springs\n📱 Contact: 0402098123\n📸 Instagram: @mexi_cuts\n\nPlease arrive 5 minutes early. Cancellations: 24hr notice required.\n\nDO NOT REPLY`;

          await client.messages.create({
            body: smsMessage,
            from: process.env.TWILIO_PHONE_NUMBER, // Use purchased Twilio phone number
            to: formatPhoneNumber(bookingData.phone) // Format phone number for international SMS
          });
          
          console.log('✅ SMS confirmation sent to client successfully');
        } catch (smsError) {
          console.error('❌ Error sending SMS (continuing with other notifications):', smsError.message);
        }
      }

      // Backup to Google Sheets
      await backupToGoogleSheets(bookingData, bookingId);

    } catch (error) {
      console.error('❌ Error sending notifications:', error);
    }
  }
);

// This function automatically triggers when a booking is deleted from the database (Gen 2)
exports.deleteBookingNotification = onDocumentDeleted(
  {
    region: 'us-central1',
    document: 'bookings/{bookingId}',
    secrets: [GOOGLE_SHEETS_CREDENTIALS, GOOGLE_SHEET_ID]
  },
  async (event) => {
    try {
      const bookingId = event.data.id;
      console.log(`🗑️ Booking ${bookingId} was deleted from Firestore`);

      // Delete from Google Sheets
      await deleteFromGoogleSheets(bookingId);

      console.log(`✅ Successfully processed deletion of booking ${bookingId}`);
    } catch (error) {
      console.error('❌ Error processing booking deletion:', error);
    }
  }
);

// Scheduled function to send appointment reminders (runs every 15 minutes for precision)
exports.sendAppointmentReminders = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeZone: 'Australia/Brisbane',
    region: 'us-central1',
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER]
  },
  async (event) => {
    try {
      console.log('🔔 Checking for appointments that need reminders...');
      console.log('Current time:', new Date().toISOString());
      
      // Get all bookings from Firestore
      const bookingsSnapshot = await admin.firestore().collection('bookings').get();
      
      if (bookingsSnapshot.empty) {
        console.log('❌ No bookings found in database');
        return;
      }
      
      console.log(`📋 Found ${bookingsSnapshot.size} booking(s) in database`);
      
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      let remindersSent = 0;
      
      // Check each booking
      for (const doc of bookingsSnapshot.docs) {
        const booking = doc.data();
        const bookingId = doc.id;
        
        console.log(`\n--- Booking ${bookingId} ---`);
        console.log(`Name: ${booking.name || 'N/A'}`);
        console.log(`Phone: ${booking.phone || 'N/A'}`);
        console.log(`Time Slot: ${booking.timeSlot || 'N/A'}`);
        console.log(`Reminder Sent: ${booking.reminderSent || false}`);
        
        if (!booking.timeSlot || !booking.phone || !booking.name) {
          console.log('⚠️ Incomplete booking - skipping');
          continue; // Skip incomplete bookings
        }
        
        // Parse the appointment time
        const appointmentDate = parseAppointmentTime(booking.timeSlot);
        if (!appointmentDate) {
          console.log(`❌ Could not parse appointment time: ${booking.timeSlot}`);
          continue;
        }
        
        console.log(`Parsed appointment time: ${appointmentDate.toISOString()}`);
        
        const now = new Date();
        const timeDiff = appointmentDate.getTime() - now.getTime();
        const hoursDiff = timeDiff / (1000 * 60 * 60);
        console.log(`Hours until appointment: ${hoursDiff.toFixed(2)}`);
        console.log(`Should send reminder: ${hoursDiff >= 23.75 && hoursDiff <= 24.25}`);
        
        // Check if this appointment is exactly 24 hours away (±15 minutes)
        if (isAppointmentTomorrow(appointmentDate)) {
          // Check if we've already sent a reminder for this booking
          if (booking.reminderSent) {
            console.log(`Reminder already sent for booking ${bookingId}`);
            continue;
          }
          
          try {
            // Send reminder SMS
            const formattedDate = formatReadableDate(booking.timeSlot);
            const reminderMessage = `🔔 Reminder: Your Mexi Cuts appointment is tomorrow!\n\n📅 Date: ${formattedDate}\n⏰ Time: ${booking.timeSlot.split(' ')[1]} ${booking.timeSlot.split(' ')[2]}\n💇‍♂️ Service: Haircut ($20)\n📍 6 Rosella Tce, Peregian Springs\n\nPlease arrive 5 minutes early. Need to cancel? Call 0402098123\n\nDO NOT REPLY`;
            
            await client.messages.create({
              body: reminderMessage,
              from: process.env.TWILIO_PHONE_NUMBER,
              to: formatPhoneNumber(booking.phone)
            });
            
            // Mark reminder as sent in Firestore
            await admin.firestore().collection('bookings').doc(bookingId).update({
              reminderSent: true,
              reminderSentAt: admin.firestore.FieldValue.serverTimestamp()
            });
            
            remindersSent++;
            console.log(`✅ Reminder sent to ${booking.name} (${booking.phone}) for appointment ${booking.timeSlot}`);
            
          } catch (smsError) {
            console.error(`❌ Failed to send reminder to ${booking.phone}:`, smsError.message);
          }
        }
      }
      
      console.log(`🔔 Reminder check complete. Sent ${remindersSent} reminders.`);
      
    } catch (error) {
      console.error('❌ Error in appointment reminder function:', error);
    }
  }
);

// HTTP test endpoint (Gen 2)
exports.sendBookingEmail = onRequest(
  {
    region: 'us-central1',
    secrets: [GMAIL_USER, GMAIL_PASS],
    invoker: 'public'
  },
  (req, res) => {
    const transporter = createTransporter();
    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: 'matias.oliverac@outlook.com',
      subject: '📬 Test Email from Mexi Cuts',
      text: 'This is a test email to confirm Firebase email functionality.'
    };

    transporter.sendMail(mailOptions)
      .then(() => {
        console.log("✅ Test email sent");
        res.send("Test email sent");
      })
      .catch(err => {
        console.error("❌ Failed to send email:", err);
        res.status(500).send("Failed to send email");
      });
  }
);

// HTTP test endpoint for SMS (Gen 2)
exports.sendTestSMS = onRequest(
  {
    region: 'us-central1',
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER],
    invoker: 'public'
  },
  async (req, res) => {
    try {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      
      const testMessage = `🧪 Test SMS from Mexi Cuts!\n\nThis is a test message to confirm SMS functionality is working.`;
      
      await client.messages.create({
        body: testMessage,
        from: process.env.TWILIO_PHONE_NUMBER, // Use purchased Twilio phone number
        to: formatPhoneNumber(req.query.phone || '0402098123') // Format phone number for international SMS
      });
      
      console.log("✅ Test SMS sent");
      res.send("Test SMS sent successfully");
    } catch (err) {
      console.error("❌ Failed to send SMS:", err);
      res.status(500).send("Failed to send SMS: " + err.message);
    }
  }
);

// HTTP test endpoint for Google Sheets backup (Gen 2)
exports.testGoogleSheetsBackup = onRequest(
  {
    region: 'us-central1',
    secrets: [GOOGLE_SHEETS_CREDENTIALS, GOOGLE_SHEET_ID],
    invoker: 'public'
  },
  async (req, res) => {
    try {
      const testBookingData = {
        name: 'Test Customer',
        phone: '0402098123',
        timeSlot: 'Test Time Slot',
        notes: 'This is a test booking for Google Sheets backup',
        timestamp: admin.firestore.Timestamp.now()
      };

      await backupToGoogleSheets(testBookingData, 'test-booking-id');
      
      console.log("✅ Test Google Sheets backup completed");
      res.send("Test Google Sheets backup completed successfully");
    } catch (err) {
      console.error("❌ Failed to test Google Sheets backup:", err);
      res.status(500).send("Failed to test Google Sheets backup: " + err.message);
    }
  }
);
