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

// Get Auth instance
const auth = admin.auth();

const GMAIL_USER = defineSecret('GMAIL_USER');
const GMAIL_PASS = defineSecret('GMAIL_PASS');
const TWILIO_ACCOUNT_SID = defineSecret('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = defineSecret('TWILIO_AUTH_TOKEN');
const TWILIO_PHONE_NUMBER = defineSecret('TWILIO_PHONE_NUMBER');
const GOOGLE_SHEETS_CREDENTIALS = defineSecret('GOOGLE_SHEETS_CREDENTIALS');
const GOOGLE_SHEET_ID = defineSecret('GOOGLE_SHEET_ID');
const PAYMENT_SHEET_ID = defineSecret('PAYMENT_SHEET_ID');

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
    
    // Create date string in ISO format for Brisbane timezone (UTC+10)
    // Cloud Functions run in UTC, so we need to explicitly handle Brisbane timezone
    const dateString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+10:00`;
    const appointmentDate = new Date(dateString);
    
    return appointmentDate;
  } catch (error) {
    console.error('Error parsing appointment time:', timeSlot, error);
    return null;
  }
}

function slotDocIdFromTimeSlot(timeSlot) {
  // Deterministic doc id so a time slot can be locked uniquely.
  // Firestore doc IDs allow most characters, but we keep it conservative.
  return String(timeSlot || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_:+-]/g, '_')
    .slice(0, 200);
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

// Public endpoint: create a guest booking securely (no direct public writes to bookings).
exports.createGuestBooking = onRequest(
  {
    region: 'us-central1',
    invoker: 'public',
    cors: true
  },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }

    try {
      const { name, phone, timeSlot, notes } = req.body || {};

      if (!name || !phone || !timeSlot) {
        res.status(400).json({ success: false, message: 'Missing required fields' });
        return;
      }

      if (typeof name !== 'string' || typeof phone !== 'string' || typeof timeSlot !== 'string') {
        res.status(400).json({ success: false, message: 'Invalid field types' });
        return;
      }

      const slotId = slotDocIdFromTimeSlot(timeSlot);
      if (!slotId) {
        res.status(400).json({ success: false, message: 'Invalid time slot' });
        return;
      }

      const db = admin.firestore();
      const slotRef = db.collection('bookedSlots').doc(slotId);
      const bookingRef = db.collection('bookings').doc(); // auto id

      await db.runTransaction(async (tx) => {
        const slotDoc = await tx.get(slotRef);
        if (slotDoc.exists) {
          throw new Error('SLOT_TAKEN');
        }

        tx.set(slotRef, {
          timeSlot,
          bookingId: bookingRef.id,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        tx.set(bookingRef, {
          name: name.trim(),
          phone: phone.trim(),
          timeSlot: timeSlot.trim(),
          notes: typeof notes === 'string' ? notes.trim() : '',
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          guest: true
        });
      });

      res.json({ success: true, bookingId: bookingRef.id });
    } catch (err) {
      if (err && err.message === 'SLOT_TAKEN') {
        res.status(409).json({ success: false, message: 'That time slot was just booked. Please choose another.' });
        return;
      }
      console.error('❌ createGuestBooking error:', err);
      res.status(500).json({ success: false, message: 'Failed to create booking' });
    }
  }
);

// This function triggers when a new user signs up (Gen 2)
exports.sendNewUserNotification = onDocumentCreated(
  {
    region: 'us-central1',
    document: 'users/{userId}',
    secrets: [GMAIL_USER, GMAIL_PASS]
  },
  async (event) => {
    try {
      const userData = event.data && event.data.data ? event.data.data() : {};
      const userId = event.data.id;

      console.log('New user signed up:', userId);

      // Send email notification
      const transporter = createTransporter();

      const mailOptions = {
        from: process.env.GMAIL_USER,
        to: 'matias.oliverac@outlook.com',
        subject: '🎉 New User Signed Up - Mexi Cuts',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
            <div style="background-color: #006847; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
              <h1 style="margin: 0; font-size: 24px;">🎉 New User Signed Up!</h1>
            </div>
            
            <div style="background-color: white; padding: 20px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <h2 style="color: #006847; margin-top: 0;">New Customer Account Created</h2>
              
              <div style="background-color: #f8f8f8; padding: 15px; border-radius: 6px; margin: 15px 0;">
                <p><strong>Name:</strong> ${userData.name || 'N/A'}</p>
                <p><strong>Phone Number:</strong> ${userData.phone || 'N/A'}</p>
                <p><strong>User ID:</strong> ${userId}</p>
                <p><strong>Sign Up Time:</strong> ${new Date().toLocaleString()}</p>
                <p><strong>Bookings Linked:</strong> ${userData.bookingCount || 0}</p>
              </div>
              
              <p style="color: #666; font-size: 14px; margin-top: 20px;">
                This customer now has an account and will have their info auto-filled for future bookings.
              </p>
              
              <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; text-align: center;">
                <p style="color: #999; font-size: 12px;">
                  Mexi Cuts User Management System<br>
                  New User Notification
                </p>
              </div>
            </div>
          </div>
        `
      };

      await transporter.sendMail(mailOptions);
      console.log('✅ New user notification email sent');

    } catch (error) {
      console.error('❌ Error sending new user notification:', error);
    }
  }
);

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

      // Create/refresh public-safe slot document for availability UI
      // (Contains no PII; only used to disable taken slots on the website.)
      try {
        if (bookingData && bookingData.timeSlot) {
          const slotId = slotDocIdFromTimeSlot(bookingData.timeSlot);
          await admin.firestore().collection('bookedSlots').doc(slotId).set(
            {
              timeSlot: bookingData.timeSlot,
              bookingId: bookingId,
              createdAt: admin.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
          );
          console.log('✅ bookedSlots updated for booking:', bookingId);
        } else {
          console.warn('⚠️ bookingData.timeSlot missing; skipping bookedSlots write for:', bookingId);
        }
      } catch (slotError) {
        console.error('❌ Error writing bookedSlots (continuing with notifications):', slotError);
      }

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
          // Extract time from timeSlot (format: "2025-08-23 05:30 PM")
          const [, timePart, ampm] = bookingData.timeSlot.split(' ');
          const time = `${timePart} ${ampm}`;
          const smsMessage = `Mexi Cuts appointment confirmed\nDate: ${formattedDate}\nTime: ${time}\nService: Haircut ($20)\nLocation: 6 Rosella Tce, Peregian Springs\nMaps: https://maps.google.com/?q=6+Rosella+Tce,+Peregian+Springs,+Sunshine+Coast,+QLD,+Australia\nContact: 0402098123\nIG: @mexi_cuts\nArrive 5 min early. Cancel on the website. DO NOT REPLY`;

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
    secrets: [GOOGLE_SHEETS_CREDENTIALS, GOOGLE_SHEET_ID, GMAIL_USER, GMAIL_PASS]
  },
  async (event) => {
    try {
      const bookingId = event.data.id;
      const bookingData = event.data.data(); // Get the booking data before deletion
      console.log(`🗑️ Booking ${bookingId} was deleted from Firestore`);

      // Remove public-safe slot document
      try {
        const slotId = bookingData && bookingData.timeSlot ? slotDocIdFromTimeSlot(bookingData.timeSlot) : null;
        if (slotId) {
          await admin.firestore().collection('bookedSlots').doc(slotId).delete();
        }
        console.log('✅ bookedSlots removed for booking:', bookingId);
      } catch (slotDeleteError) {
        console.error('❌ Error deleting bookedSlots (continuing):', slotDeleteError);
      }

      // Delete from Google Sheets
      await deleteFromGoogleSheets(bookingId);

      // Send email notification about the cancellation
      if (bookingData) {
        await sendCancellationEmail(bookingData, bookingId);
      }

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
            // Extract time from timeSlot (format: "2025-08-23 05:30 PM")
            const [, timePart, ampm] = booking.timeSlot.split(' ');
            const time = `${timePart} ${ampm}`;
            const reminderMessage = `Mexi Cuts appointment tomorrow\nDate: ${formattedDate}\nTime: ${time}\nService: Haircut ($20)\nLocation: 6 Rosella Tce, Peregian Springs\nMaps: https://maps.google.com/?q=6+Rosella+Tce,+Peregian+Springs,+Sunshine+Coast,+QLD,+Australia\nContact: 0402098123\nIG: @mexi_cuts\nArrive 5 min early. Cancel on the website. DO NOT REPLY`;
            
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

// Function to send cancellation email notification
async function sendCancellationEmail(bookingData, bookingId) {
  try {
    const transporter = createTransporter();
    
    // Format the date for display
    const formattedDate = formatReadableDate(bookingData.timeSlot);
    const [, timePart, ampm] = bookingData.timeSlot.split(' ');
    const time = `${timePart} ${ampm}`;
    
    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: 'matias.oliverac@outlook.com', // Your email address
      subject: `❌ Booking Cancelled - ${bookingData.name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background-color: #CE1126; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 24px;">❌ Booking Cancelled</h1>
          </div>
          
          <div style="background-color: white; padding: 20px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h2 style="color: #CE1126; margin-top: 0;">Cancelled Booking Details:</h2>
            
            <div style="background-color: #f8f8f8; padding: 15px; border-radius: 6px; margin: 15px 0;">
              <p><strong>Customer Name:</strong> ${bookingData.name}</p>
              <p><strong>Phone Number:</strong> ${bookingData.phone}</p>
              <p><strong>Date:</strong> ${formattedDate}</p>
              <p><strong>Time:</strong> ${time}</p>
              ${bookingData.notes ? `<p><strong>Notes:</strong> ${bookingData.notes}</p>` : ''}
              <p><strong>Booking ID:</strong> ${bookingId}</p>
            </div>
            
            <p style="color: #666; font-size: 14px; margin-top: 20px;">
              This booking was cancelled by the customer through the website.
            </p>
            
            <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; text-align: center;">
              <p style="color: #999; font-size: 12px;">
                Mexi Cuts Booking System<br>
                Cancellation Notification
              </p>
            </div>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Cancellation email sent for booking ${bookingId}`);
  } catch (error) {
    console.error(`❌ Error sending cancellation email for booking ${bookingId}:`, error);
  }
}

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

// HTTP test endpoint for payment sheet auto-add (Gen 2)
exports.testPaymentSheetAdd = onRequest(
  {
    region: 'us-central1',
    secrets: [GOOGLE_SHEETS_CREDENTIALS, PAYMENT_SHEET_ID, GMAIL_USER, GMAIL_PASS],
    invoker: 'public',
    cors: true
  },
  async (req, res) => {
    // Enable CORS
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    
    try {
      // Get booking ID from query parameter or use a test booking
      const bookingId = req.query.bookingId;
      
      if (!bookingId) {
        res.status(400).send('Please provide a bookingId query parameter (e.g., ?bookingId=abc123)');
        return;
      }

      // Get the booking from Firestore
      const bookingDoc = await admin.firestore().collection('bookings').doc(bookingId).get();
      
      if (!bookingDoc.exists) {
        res.status(404).send('Booking not found with ID: ' + bookingId);
        return;
      }

      const booking = bookingDoc.data();

      // Check if already added
      if (booking.addedToPaymentSheet) {
        res.send(`⚠️ This booking was already added to payment sheet on ${booking.addedToPaymentSheetAt ? booking.addedToPaymentSheetAt.toDate().toLocaleString() : 'unknown date'}`);
        return;
      }

      console.log(`🧪 Testing payment sheet add for booking: ${booking.name}`);

      // Add to payment sheet
      const success = await addHaircutToPaymentSheet(booking, bookingId);

      if (success) {
        // Mark as added
        await admin.firestore().collection('bookings').doc(bookingId).update({
          addedToPaymentSheet: true,
          addedToPaymentSheetAt: admin.firestore.FieldValue.serverTimestamp(),
          paymentStatus: 'pending'
        });

        // Send email notification
        await sendPaymentReminderEmail(booking, bookingId);

        res.send(`✅ Success! Added "${booking.name}" to payment sheet and sent email notification. Check your Google Sheets and email!`);
      } else {
        res.status(500).send('❌ Failed to add to payment sheet. Check logs for details.');
      }

    } catch (err) {
      console.error("❌ Failed to test payment sheet add:", err);
      res.status(500).send("Failed to test payment sheet add: " + err.message);
    }
  }
);

// Function to add completed haircut to Google Sheets (for payment tracking)
async function addHaircutToPaymentSheet(bookingData, bookingId) {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
    const sheetId = process.env.PAYMENT_SHEET_ID; // Use payment sheet, not calendar backup sheet

    const auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });

    // Parse the appointment date
    const [datePart] = bookingData.timeSlot.split(' ');
    const [year, month, day] = datePart.split('-');
    const appointmentDate = `${parseInt(day)} ${getMonthName(parseInt(month))} ${year}`;

    // Prepare row data matching your sheet structure
    // Columns: When Cut | When Paid | Who | Amount | Cash/Card
    const rowData = [
      appointmentDate,           // When Cut (e.g., "28 October 2025")
      '',                        // When Paid (empty until confirmed)
      bookingData.name || '',    // Who
      '$20',                     // Amount
      ''                         // Cash/Card (empty until confirmed)
    ];

    // Append to sheet
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: 'A:E', // Columns A to E
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      resource: {
        values: [rowData]
      }
    });

    console.log(`✅ Added haircut to payment sheet: ${bookingData.name} on ${appointmentDate}`);
    return true;
  } catch (error) {
    console.error('❌ Error adding haircut to payment sheet:', error);
    return false;
  }
}

// Helper function to get month name
function getMonthName(monthNumber) {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  return months[monthNumber - 1];
}

// Scheduled function to process completed haircuts (runs every 15 minutes)
exports.processCompletedHaircuts = onSchedule(
  {
    schedule: 'every 15 minutes',
    timeZone: 'Australia/Brisbane',
    region: 'us-central1',
    secrets: [GOOGLE_SHEETS_CREDENTIALS, PAYMENT_SHEET_ID, GMAIL_USER, GMAIL_PASS]
  },
  async (event) => {
    try {
      console.log('💈 Checking for completed haircuts...');
      
      const now = new Date();
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
      const fortyFiveMinutesAgo = new Date(now.getTime() - 45 * 60 * 1000);
      
      // Get all bookings
      const bookingsSnapshot = await admin.firestore().collection('bookings').get();
      
      let processedCount = 0;
      
      for (const doc of bookingsSnapshot.docs) {
        const booking = doc.data();
        const bookingId = doc.id;
        
        // Skip if already processed
        if (booking.addedToPaymentSheet) {
          continue;
        }
        
        // Parse appointment time
        const appointmentDate = parseAppointmentTime(booking.timeSlot);
        if (!appointmentDate) continue;
        
        // Check if appointment was 30-45 minutes ago
        if (appointmentDate >= fortyFiveMinutesAgo && appointmentDate <= thirtyMinutesAgo) {
          console.log(`Processing completed haircut: ${booking.name} at ${booking.timeSlot}`);
          
          // Skip if admin already confirmed payment
          if (booking.adminConfirmed === true) {
            console.log(`⏭️ Skipping email - admin already confirmed payment for ${booking.name}`);
            continue;
          }
          
          // Add to Google Sheets
          const success = await addHaircutToPaymentSheet(booking, bookingId);
          
          if (success) {
            // Mark as added to payment sheet
            await admin.firestore().collection('bookings').doc(bookingId).update({
              addedToPaymentSheet: true,
              addedToPaymentSheetAt: admin.firestore.FieldValue.serverTimestamp(),
              paymentStatus: 'pending' // pending, paid_cash, paid_card
            });
            
            // Send email notification (only if not admin confirmed)
            await sendPaymentReminderEmail(booking, bookingId);
            
            processedCount++;
          }
        }
      }
      
      console.log(`✅ Processed ${processedCount} completed haircut(s)`);
      
    } catch (error) {
      console.error('❌ Error processing completed haircuts:', error);
    }
  }
);

// Send payment reminder email
async function sendPaymentReminderEmail(booking, bookingId) {
  try {
    const transporter = createTransporter();
    
    const mailOptions = {
      from: process.env.GMAIL_USER,
      to: 'matias.oliverac@outlook.com',
      subject: `💰 Payment Confirmation Needed - ${booking.name}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f9f9f9;">
          <div style="background-color: #006847; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="margin: 0; font-size: 24px;">💰 Payment Confirmation Needed</h1>
          </div>
          
          <div style="background-color: white; padding: 20px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h2 style="color: #006847; margin-top: 0;">Haircut Completed!</h2>
            
            <div style="background-color: #f8f8f8; padding: 15px; border-radius: 6px; margin: 15px 0;">
              <p><strong>Customer:</strong> ${booking.name}</p>
              <p><strong>Phone:</strong> ${booking.phone}</p>
              <p><strong>Appointment:</strong> ${booking.timeSlot}</p>
              <p><strong>Amount:</strong> $20</p>
            </div>
            
            <p style="color: #666; font-size: 14px; margin-top: 20px;">
              This haircut has been added to your Google Sheets.<br>
              Please confirm the payment status in your admin panel.
            </p>
            
            <div style="text-align: center; margin-top: 25px;">
              <a href="https://mexicuts-booking.web.app/admin_mxcts2009.html" 
                 style="background: #CE1126; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
                Go to Admin Panel
              </a>
            </div>
            
            <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #eee; text-align: center;">
              <p style="color: #999; font-size: 12px;">
                Mexi Cuts Payment Tracking System
              </p>
            </div>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
    console.log(`✅ Payment reminder email sent for ${booking.name}`);
  } catch (error) {
    console.error(`❌ Error sending payment reminder email:`, error);
  }
}

// HTTP endpoint to update payment status (Gen 2)
exports.updatePaymentStatus = onRequest(
  {
    region: 'us-central1',
    secrets: [GOOGLE_SHEETS_CREDENTIALS, PAYMENT_SHEET_ID],
    invoker: 'public',
    cors: true
  },
  async (req, res) => {
    // Enable CORS
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    
    try {
      const { bookingId, paymentMethod, paymentDate, methodOnly } = req.body;
      
      if (!bookingId || !paymentMethod) {
        res.status(400).send('Missing required fields');
        return;
      }
      
      // Get booking data
      const bookingDoc = await admin.firestore().collection('bookings').doc(bookingId).get();
      if (!bookingDoc.exists) {
        res.status(404).send('Booking not found');
        return;
      }
      
      const booking = bookingDoc.data();
      
      if (methodOnly) {
        // Step 1: Only setting payment method (Cash or Card)
        // Update Google Sheets with method only, no payment date
        await updatePaymentMethodInSheets(booking, paymentMethod);
        
        res.json({ success: true, message: 'Payment method set' });
      } else {
        // Step 2: Full payment confirmation with date
        // Update Firestore
        await admin.firestore().collection('bookings').doc(bookingId).update({
          paymentStatus: 'paid',
          paymentConfirmedAt: admin.firestore.FieldValue.serverTimestamp()
        });
        
        // Update Google Sheets with payment date
        await updatePaymentDateInSheets(booking, paymentMethod, paymentDate);
        
        res.json({ success: true, message: 'Payment confirmed' });
      }
    } catch (error) {
      console.error('Error updating payment status:', error);
      res.status(500).send('Error updating payment status: ' + error.message);
    }
  }
);

// Step 1: Update payment METHOD in Google Sheets (no date yet)
async function updatePaymentMethodInSheets(booking, paymentMethod) {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
    const sheetId = process.env.PAYMENT_SHEET_ID;

    const auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    // Get all data to find the row
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'A:E',
    });

    const rows = response.data.values;
    if (!rows) return;
    
    // Find the row with this customer and date
    const [datePart] = booking.timeSlot.split(' ');
    const [year, month, day] = datePart.split('-');
    const appointmentDate = `${parseInt(day)} ${getMonthName(parseInt(month))} ${year}`;
    
    let rowIndex = -1;
    for (let i = rows.length - 1; i >= 0; i--) { // Search from bottom (most recent)
      if (rows[i][0] === appointmentDate && rows[i][2] === booking.name) {
        rowIndex = i + 1; // Google Sheets is 1-indexed
        break;
      }
    }
    
    if (rowIndex === -1) {
      console.log('Row not found in sheets');
      return;
    }
    
    // Update only the Cash/Card column (column E)
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `E${rowIndex}`, // Only column E (Cash/Card)
      valueInputOption: 'RAW',
      resource: {
        values: [[
          paymentMethod === 'cash' ? 'Cash' : 'Card'
        ]]
      }
    });
    
    console.log(`✅ Updated payment method in sheets: ${booking.name} - ${paymentMethod}`);
  } catch (error) {
    console.error('❌ Error updating payment method in sheets:', error);
  }
}

// Step 2: Update payment DATE in Google Sheets
async function updatePaymentDateInSheets(booking, paymentMethod, paymentDate) {
  try {
    const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
    const sheetId = process.env.PAYMENT_SHEET_ID;

    const auth = new google.auth.GoogleAuth({
      credentials: credentials,
      scopes: ['https://www.googleapis.com/auth/spreadsheets']
    });

    const sheets = google.sheets({ version: 'v4', auth });
    
    // Get all data to find the row
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'A:E',
    });

    const rows = response.data.values;
    if (!rows) return;
    
    // Find the row with this customer and date
    const [datePart] = booking.timeSlot.split(' ');
    const [year, month, day] = datePart.split('-');
    const appointmentDate = `${parseInt(day)} ${getMonthName(parseInt(month))} ${year}`;
    
    let rowIndex = -1;
    for (let i = rows.length - 1; i >= 0; i--) { // Search from bottom (most recent)
      if (rows[i][0] === appointmentDate && rows[i][2] === booking.name && !rows[i][1]) {
        rowIndex = i + 1; // Google Sheets is 1-indexed
        break;
      }
    }
    
    if (rowIndex === -1) {
      console.log('Row not found in sheets');
      return;
    }
    
    // Update only the "When Paid" column (column B)
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `B${rowIndex}`, // Only column B (When Paid)
      valueInputOption: 'RAW',
      resource: {
        values: [[paymentDate]]
      }
    });
    
    console.log(`✅ Updated payment date in sheets: ${booking.name} - ${paymentDate}`);
  } catch (error) {
    console.error('❌ Error updating payment date in sheets:', error);
  }
}

// HTTP endpoint to clear all pending payments
exports.clearAllPendingPayments = onRequest(
  {
    region: 'us-central1',
    invoker: 'public',
    cors: true
  },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    
    try {
      const action = req.query.action || 'mark_paid'; // 'mark_paid' or 'delete'
      
      const snapshot = await admin.firestore().collection('bookings')
        .where('paymentStatus', '==', 'pending')
        .get();
      
      if (snapshot.empty) {
        res.send('✅ No pending payments found!');
        return;
      }
      
      const batch = admin.firestore().batch();
      let processed = 0;
      
      snapshot.forEach(doc => {
        if (action === 'delete') {
          batch.delete(doc.ref);
          console.log(`🗑️ Deleting: ${doc.data().name} - ${doc.data().timeSlot}`);
        } else {
          // Mark as paid
          batch.update(doc.ref, {
            paymentStatus: 'paid',
            paymentMethod: 'cash',
            paymentConfirmedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          console.log(`✓ Marking as paid: ${doc.data().name} - ${doc.data().timeSlot}`);
        }
        processed++;
      });
      
      await batch.commit();
      
      const actionText = action === 'delete' ? 'deleted' : 'marked as paid';
      res.send(`✅ Successfully ${actionText} ${processed} pending payment(s)!`);
      
    } catch (error) {
      console.error('Error clearing pending payments:', error);
      res.status(500).send('Error: ' + error.message);
    }
  }
);

// ===========================================================================
// LEADERBOARD FREQUENCY TRACKING SYSTEM
// Starting from Feb 14, 2026 - Track booking frequency for each user
// ===========================================================================

// Scheduled function to update user booking frequency stats (runs daily at 3 AM Brisbane time)
exports.updateUserFrequencyStats = onSchedule(
  {
    schedule: 'every day 03:00',
    timeZone: 'Australia/Brisbane',
    region: 'us-central1'
  },
  async (event) => {
    try {
      console.log('📊 Starting daily user frequency stats update...');
      
      const FEB_14_2026 = new Date('2026-02-14T00:00:00+10:00'); // Feb 14, 2026 Brisbane time
      const now = new Date();
      
      // Get all users
      const usersSnapshot = await admin.firestore().collection('users').get();
      
      if (usersSnapshot.empty) {
        console.log('No users found');
        return;
      }
      
      let updatedCount = 0;
      
      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        const userData = userDoc.data();
        
        // Get all bookings for this user from Feb 14, 2026 onwards
        const bookingsSnapshot = await admin.firestore().collection('bookings')
          .where('userId', '==', userId)
          .get();
        
        if (bookingsSnapshot.empty) {
          // User has no bookings, set default stats
          await admin.firestore().collection('users').doc(userId).update({
            frequencyStats: {
              bookingsSinceFeb14: 0,
              completedBookingsSinceFeb14: 0,
              firstBookingDate: null,
              lastBookingDate: null,
              averageWeeksBetween: null,
              lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            }
          });
          continue;
        }
        
        // Filter and parse bookings from Feb 14, 2026 onwards
        const bookingsAfterFeb14 = [];
        const completedBookingsAfterFeb14 = [];
        
        bookingsSnapshot.forEach(doc => {
          const booking = doc.data();
          if (booking.timeSlot) {
            const bookingDate = parseAppointmentTime(booking.timeSlot);
            if (bookingDate && bookingDate >= FEB_14_2026) {
              bookingsAfterFeb14.push(bookingDate);
              
              // For testing purposes: include FUTURE bookings in frequency calculation
              // This allows testing the leaderboard before bookings are completed
              // In production, you can change this to only count past bookings
              completedBookingsAfterFeb14.push(bookingDate);
            }
          }
        });
        
        // Calculate stats
        const stats = {
          bookingsSinceFeb14: bookingsAfterFeb14.length,
          completedBookingsSinceFeb14: completedBookingsAfterFeb14.length,
          firstBookingDate: null,
          lastBookingDate: null,
          averageWeeksBetween: null,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        };
        
        if (completedBookingsAfterFeb14.length > 0) {
          // Sort dates chronologically
          completedBookingsAfterFeb14.sort((a, b) => a - b);
          
          stats.firstBookingDate = completedBookingsAfterFeb14[0];
          stats.lastBookingDate = completedBookingsAfterFeb14[completedBookingsAfterFeb14.length - 1];
          
          // Calculate average weeks between bookings if there are at least 2
          if (completedBookingsAfterFeb14.length >= 2) {
            const timeDifferences = [];
            for (let i = 1; i < completedBookingsAfterFeb14.length; i++) {
              const diffMs = completedBookingsAfterFeb14[i] - completedBookingsAfterFeb14[i - 1];
              const diffWeeks = diffMs / (1000 * 60 * 60 * 24 * 7);
              timeDifferences.push(diffWeeks);
            }
            
            stats.averageWeeksBetween = timeDifferences.reduce((sum, weeks) => sum + weeks, 0) / timeDifferences.length;
          }
        }
        
        // Update user document with frequency stats
        await admin.firestore().collection('users').doc(userId).update({
          frequencyStats: stats
        });
        
        updatedCount++;
        console.log(`✅ Updated stats for ${userData.name}: ${stats.completedBookingsSinceFeb14} completed bookings, avg ${stats.averageWeeksBetween ? stats.averageWeeksBetween.toFixed(1) : 'N/A'} weeks`);
      }
      
      console.log(`✅ Frequency stats update complete: ${updatedCount} users updated`);
      
    } catch (error) {
      console.error('❌ Error updating user frequency stats:', error);
    }
  }
);

// HTTP endpoint to fix missing user documents in Firestore
exports.fixMissingUserDocuments = onRequest(
  {
    region: 'us-central1',
    invoker: 'public',
    cors: true
  },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    
    try {
      console.log('🔧 Checking for missing user documents...');
      
      // Get all Firebase Auth users
      const authUsers = await admin.auth().listUsers();
      
      // Get all Firestore user documents
      const firestoreUsers = await admin.firestore().collection('users').get();
      const firestoreUserIds = new Set(firestoreUsers.docs.map(doc => doc.id));
      
      const results = [];
      let createdCount = 0;
      
      // Check each Auth user
      for (const authUser of authUsers.users) {
        if (!firestoreUserIds.has(authUser.uid)) {
          // This Auth user is missing a Firestore document
          console.log(`❌ Missing Firestore document for: ${authUser.email}`);
          
          // Extract phone from email (format: 0402098123@mexicuts.local)
          const phone = authUser.email ? authUser.email.split('@')[0] : '';
          
          // Count bookings with this phone number
          const bookingsSnapshot = await admin.firestore().collection('bookings')
            .where('phone', '==', phone)
            .get();
          
          // Try to get the user's name from their most recent booking
          let userName = authUser.displayName || 'User';
          if (bookingsSnapshot.size > 0) {
            // Sort bookings by timeSlot to get the most recent one
            const bookings = bookingsSnapshot.docs.map(doc => doc.data());
            bookings.sort((a, b) => {
              const dateA = new Date(a.timeSlot || 0);
              const dateB = new Date(b.timeSlot || 0);
              return dateB - dateA; // Most recent first
            });
            
            // Use the name from the most recent booking
            if (bookings[0].name) {
              userName = bookings[0].name;
            }
          }
          
          // Create the missing user document
          await admin.firestore().collection('users').doc(authUser.uid).set({
            phone: phone,
            name: userName,
            createdAt: admin.firestore.Timestamp.fromDate(new Date(authUser.metadata.creationTime)),
            bookingCount: bookingsSnapshot.size
          });
          
          // Link existing bookings to this user
          const linkPromises = [];
          bookingsSnapshot.forEach(doc => {
            linkPromises.push(
              admin.firestore().collection('bookings').doc(doc.id).update({
                userId: authUser.uid
              })
            );
          });
          await Promise.all(linkPromises);
          
          createdCount++;
          results.push(`✅ Created document for ${userName} (${phone}): ${bookingsSnapshot.size} bookings linked`);
          console.log(`✅ Created Firestore document for ${userName} (${phone}) with ${bookingsSnapshot.size} bookings`);
        }
      }
      
      if (createdCount === 0) {
        res.send('✅ All Auth users have Firestore documents. No fixes needed!');
      } else {
        res.send(`✅ Fixed ${createdCount} user(s):\n\n${results.join('\n')}`);
      }
      
    } catch (error) {
      console.error('❌ Error:', error);
      res.status(500).send('Error: ' + error.message);
    }
  }
);

// HTTP endpoint to fix user names that are set to "User" by pulling from booking history
exports.fixUserNames = onRequest(
  {
    region: 'us-central1',
    invoker: 'public',
    cors: true
  },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    
    try {
      console.log('🔧 Fixing user names from booking history...');
      
      // Get all Firestore user documents where name is "User"
      const usersSnapshot = await admin.firestore().collection('users')
        .where('name', '==', 'User')
        .get();
      
      const results = [];
      let fixedCount = 0;
      
      // Check each user
      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        const userData = userDoc.data();
        const phone = userData.phone;
        
        console.log(`Checking user: ${userId} (${phone})`);
        
        // Get bookings for this user
        const bookingsSnapshot = await admin.firestore().collection('bookings')
          .where('phone', '==', phone)
          .get();
        
        if (bookingsSnapshot.size > 0) {
          // Sort bookings by timeSlot to get the most recent one
          const bookings = bookingsSnapshot.docs.map(doc => doc.data());
          bookings.sort((a, b) => {
            const dateA = new Date(a.timeSlot || 0);
            const dateB = new Date(b.timeSlot || 0);
            return dateB - dateA; // Most recent first
          });
          
          // Use the name from the most recent booking
          if (bookings[0].name) {
            const newName = bookings[0].name;
            await admin.firestore().collection('users').doc(userId).update({
              name: newName
            });
            
            fixedCount++;
            results.push(`✅ Updated ${phone}: "User" → "${newName}"`);
            console.log(`✅ Updated user ${phone} name to: ${newName}`);
          } else {
            results.push(`⚠️ ${phone}: No name found in bookings`);
          }
        } else {
          results.push(`⚠️ ${phone}: No bookings found`);
        }
      }
      
      if (usersSnapshot.size === 0) {
        res.send('✅ No users with name "User" found. All names are already set!');
      } else {
        res.send(`✅ Fixed ${fixedCount} of ${usersSnapshot.size} user(s):\n\n${results.join('\n')}`);
      }
      
    } catch (error) {
      console.error('❌ Error:', error);
      res.status(500).send('Error: ' + error.message);
    }
  }
);

// HTTP endpoint to fix booking counts for all users
exports.fixBookingCounts = onRequest(
  {
    region: 'us-central1',
    invoker: 'public',
    cors: true
  },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    
    try {
      console.log('🔧 Fixing booking counts for all users...');
      
      // Get all users
      const usersSnapshot = await admin.firestore().collection('users').get();
      
      if (usersSnapshot.empty) {
        res.send('No users found in database');
        return;
      }
      
      let updatedCount = 0;
      const results = [];
      
      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        const userData = userDoc.data();
        
        // Count bookings for this user
        const bookingsSnapshot = await admin.firestore().collection('bookings')
          .where('userId', '==', userId)
          .get();
        
        const actualBookingCount = bookingsSnapshot.size;
        
        // Update user document with correct count
        await admin.firestore().collection('users').doc(userId).update({
          bookingCount: actualBookingCount
        });
        
        updatedCount++;
        results.push(`${userData.name}: ${actualBookingCount} bookings`);
        console.log(`✅ Fixed count for ${userData.name}: ${actualBookingCount} bookings`);
      }
      
      res.send(`✅ Fixed booking counts for ${updatedCount} users:\n\n${results.join('\n')}`);
      
    } catch (error) {
      console.error('❌ Error:', error);
      res.status(500).send('Error: ' + error.message);
    }
  }
);

// HTTP endpoint to debug a specific booking
exports.debugBooking = onRequest(
  {
    region: 'us-central1',
    invoker: 'public',
    cors: true
  },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    
    try {
      const bookingId = req.query.bookingId;
      
      if (!bookingId) {
        res.status(400).send('Please provide bookingId parameter');
        return;
      }
      
      const doc = await admin.firestore().collection('bookings').doc(bookingId).get();
      
      if (!doc.exists) {
        res.status(404).send('Booking not found');
        return;
      }
      
      const booking = doc.data();
      const now = new Date();
      const thirtyMinutesAgo = new Date(now.getTime() - 30 * 60 * 1000);
      const fortyFiveMinutesAgo = new Date(now.getTime() - 45 * 60 * 1000);
      
      const appointmentDate = parseAppointmentTime(booking.timeSlot);
      
      const debug = {
        bookingId: bookingId,
        name: booking.name,
        timeSlot: booking.timeSlot,
        parsedDate: appointmentDate ? appointmentDate.toISOString() : 'FAILED TO PARSE',
        currentTime: now.toISOString(),
        thirtyMinutesAgo: thirtyMinutesAgo.toISOString(),
        fortyFiveMinutesAgo: fortyFiveMinutesAgo.toISOString(),
        isInWindow: appointmentDate ? (appointmentDate >= fortyFiveMinutesAgo && appointmentDate <= thirtyMinutesAgo) : false,
        alreadyProcessed: !!booking.addedToPaymentSheet,
        adminConfirmed: !!booking.adminConfirmed,
        shouldProcess: appointmentDate && (appointmentDate >= fortyFiveMinutesAgo && appointmentDate <= thirtyMinutesAgo) && !booking.addedToPaymentSheet && !booking.adminConfirmed
      };
      
      res.send(`<pre>${JSON.stringify(debug, null, 2)}</pre>`);
      
    } catch (error) {
      console.error('❌ Error:', error);
      res.status(500).send('Error: ' + error.message);
    }
  }
);

// HTTP endpoint to manually trigger frequency stats update (for testing/admin use)
exports.updateFrequencyStatsNow = onRequest(
  {
    region: 'us-central1',
    invoker: 'public',
    cors: true
  },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }
    
    try {
      console.log('📊 Manual frequency stats update triggered...');
      
      const FEB_14_2026 = new Date('2026-02-14T00:00:00+10:00');
      const now = new Date();
      
      // Get all users
      const usersSnapshot = await admin.firestore().collection('users').get();
      
      if (usersSnapshot.empty) {
        res.send('No users found in database');
        return;
      }
      
      let updatedCount = 0;
      const results = [];
      
      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        const userData = userDoc.data();
        
        // Get all bookings for this user
        const bookingsSnapshot = await admin.firestore().collection('bookings')
          .where('userId', '==', userId)
          .get();
        
        if (bookingsSnapshot.empty) {
          await admin.firestore().collection('users').doc(userId).update({
            frequencyStats: {
              bookingsSinceFeb14: 0,
              completedBookingsSinceFeb14: 0,
              firstBookingDate: null,
              lastBookingDate: null,
              averageWeeksBetween: null,
              lastUpdated: admin.firestore.FieldValue.serverTimestamp()
            }
          });
          results.push(`${userData.name}: No bookings`);
          continue;
        }
        
        // Filter and parse bookings from Feb 14, 2026 onwards
        const bookingsAfterFeb14 = [];
        const completedBookingsAfterFeb14 = [];
        
        bookingsSnapshot.forEach(doc => {
          const booking = doc.data();
          if (booking.timeSlot) {
            const bookingDate = parseAppointmentTime(booking.timeSlot);
            if (bookingDate && bookingDate >= FEB_14_2026) {
              bookingsAfterFeb14.push(bookingDate);
              // For testing: include future bookings
              completedBookingsAfterFeb14.push(bookingDate);
            }
          }
        });
        
        // Calculate stats
        const stats = {
          bookingsSinceFeb14: bookingsAfterFeb14.length,
          completedBookingsSinceFeb14: completedBookingsAfterFeb14.length,
          firstBookingDate: null,
          lastBookingDate: null,
          averageWeeksBetween: null,
          lastUpdated: admin.firestore.FieldValue.serverTimestamp()
        };
        
        if (completedBookingsAfterFeb14.length > 0) {
          completedBookingsAfterFeb14.sort((a, b) => a - b);
          
          stats.firstBookingDate = completedBookingsAfterFeb14[0];
          stats.lastBookingDate = completedBookingsAfterFeb14[completedBookingsAfterFeb14.length - 1];
          
          if (completedBookingsAfterFeb14.length >= 2) {
            const timeDifferences = [];
            for (let i = 1; i < completedBookingsAfterFeb14.length; i++) {
              const diffMs = completedBookingsAfterFeb14[i] - completedBookingsAfterFeb14[i - 1];
              const diffWeeks = diffMs / (1000 * 60 * 60 * 24 * 7);
              timeDifferences.push(diffWeeks);
            }
            
            stats.averageWeeksBetween = timeDifferences.reduce((sum, weeks) => sum + weeks, 0) / timeDifferences.length;
          }
        }
        
        await admin.firestore().collection('users').doc(userId).update({
          frequencyStats: stats
        });
        
        updatedCount++;
        results.push(`${userData.name}: ${stats.completedBookingsSinceFeb14} bookings, avg ${stats.averageWeeksBetween ? stats.averageWeeksBetween.toFixed(1) + ' weeks' : 'N/A'}`);
      }
      
      res.send(`✅ Updated ${updatedCount} users:\n\n${results.join('\n')}`);
      
    } catch (error) {
      console.error('❌ Error:', error);
      res.status(500).send('Error: ' + error.message);
    }
  }
);
