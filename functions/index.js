const functionsV1 = require('firebase-functions');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const crypto = require('crypto');
const { google } = require('googleapis');
const { defineSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated, onDocumentDeleted, onDocumentUpdated } = require('firebase-functions/v2/firestore');
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
const MANAGE_BOOKING_URL = 'https://mexicuts.au/?manage=booking#manage-booking';
const INSTAGRAM_DM_URL = 'https://ig.me/m/mexi_cuts';
const OWNER_EMAIL_SHA256 = 'b85acd4b1caf5cdde818a59b4f81f1a75cad45fc94c0e2c88797ec810da23ed6';

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
    const match = String(timeSlot || '').trim().match(
      /^(\d{4})-(\d{2})-(\d{2})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i
    );
    if (!match) return null;
    const [, year, month, day, hour, minute, ampmRaw] = match;
    const ampm = ampmRaw.toUpperCase();

    const monthNumber = Number(month);
    const dayNumber = Number(day);
    const hourNumber = Number(hour);
    const minuteNumber = Number(minute);
    if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31 || hourNumber < 1 || hourNumber > 12 || minuteNumber > 59) {
      return null;
    }
    
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
    return Number.isNaN(appointmentDate.getTime()) ? null : appointmentDate;
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

function normalizeAustralianPhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) return `61${digits.slice(1)}`;
  if (digits.length === 11 && digits.startsWith('61')) return digits;
  return digits;
}

function rateLimitDocId(prefix, value) {
  return `${prefix}_${crypto.createHash('sha256').update(String(value)).digest('hex')}`;
}

async function getOptionalRequestUser(req) {
  const authorization = String(req.headers.authorization || '');
  if (!authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice(7).trim();
  if (!token) return null;
  return auth.verifyIdToken(token);
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
  
  // Once a reminder becomes due, keep it eligible until the appointment. This
  // prevents a temporary scheduler failure or malformed booking from causing a
  // later booking's reminder to be missed permanently.
  return hoursDiff > 0 && hoursDiff <= 24.25;
}

async function isConfiguredBookingSlot(db, timeSlot) {
  const match = String(timeSlot || '').trim().match(/^(\d{4}-\d{2}-\d{2})\s+(\d{1,2}):(\d{2})\s+(AM|PM)$/i);
  if (!match) return false;

  const [, datePart, hourText, minuteText, periodText] = match;
  const settingsDoc = await db.collection('settings').doc('availability').get();
  const config = settingsDoc.exists ? settingsDoc.data() : {
    businessHours: {
      Saturday: { enabled: true, startTime: '08:00', endTime: '18:00', slotDuration: 30 },
      Tuesday: { enabled: true, startTime: '15:30', endTime: '16:30', slotDuration: 30 },
      Thursday: { enabled: true, startTime: '15:30', endTime: '16:30', slotDuration: 30 }
    },
    blockedDates: {},
    blockedTimes: {}
  };

  if (config.blockedDates && config.blockedDates[datePart]) return false;

  const weekday = new Date(`${datePart}T12:00:00+10:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'Australia/Brisbane'
  });
  const dayConfig = config.businessHours && config.businessHours[weekday];
  if (!dayConfig || !dayConfig.enabled) return false;

  const toMinutes = value => {
    const [hours, minutes] = String(value).split(':').map(Number);
    return hours * 60 + minutes;
  };
  let hours = Number(hourText);
  const period = periodText.toUpperCase();
  if (period === 'AM' && hours === 12) hours = 0;
  if (period === 'PM' && hours !== 12) hours += 12;
  const slotMinutes = hours * 60 + Number(minuteText);
  const startMinutes = toMinutes(dayConfig.startTime);
  let endMinutes = toMinutes(dayConfig.endTime);
  if (endMinutes === 0 && dayConfig.endTime === '00:00') endMinutes = 1440;
  const duration = Number(dayConfig.slotDuration) || 30;

  if (slotMinutes < startMinutes || slotMinutes >= endMinutes || (slotMinutes - startMinutes) % duration !== 0) {
    return false;
  }

  const blockedWindows = config.blockedTimes && Array.isArray(config.blockedTimes[datePart])
    ? config.blockedTimes[datePart]
    : [];
  return !blockedWindows.some(window => {
    const blockedStart = toMinutes(window.startTime || '00:00');
    let blockedEnd = toMinutes(window.endTime || '00:00');
    if (blockedEnd === 0 && window.endTime === '00:00') blockedEnd = 1440;
    return slotMinutes >= blockedStart && slotMinutes < blockedEnd;
  });
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

// Run actions that should only happen when a booking is APPROVED:
// - Send SMS confirmation to client
// - Backup booking to Google Sheets
// - Mark notificationsSent: true to avoid duplicates
async function handleBookingApproved(bookingData, bookingId) {
  try {
    if (!bookingData || !bookingData.phone || !bookingData.timeSlot) {
      console.warn('handleBookingApproved called with incomplete bookingData for', bookingId);
      return;
    }

    // Send SMS confirmation
    try {
      const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

      const formattedDate = formatReadableDate(bookingData.timeSlot);
      // Extract time from timeSlot (format: "2025-08-23 05:30 PM")
      const [, timePart, ampm] = bookingData.timeSlot.split(' ');
      const time = `${timePart} ${ampm}`;
      const service = bookingData.service || 'Haircut';
      const price = bookingData.price || 20;
      const smsMessage = `Mexi Cuts appointment confirmed\nDate: ${formattedDate}\nTime: ${time}\nService: ${service} ($${price})\nLocation: 6 Rosella Tce, Peregian Springs\nMaps: https://maps.google.com/?q=6+Rosella+Tce,+Peregian+Springs,+Sunshine+Coast,+QLD,+Australia\nReschedule or cancel: ${MANAGE_BOOKING_URL}\nQuestions? DM @mexi_cuts: ${INSTAGRAM_DM_URL}\nDO NOT REPLY`;

      await client.messages.create({
        body: smsMessage,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: formatPhoneNumber(bookingData.phone)
      });

      console.log('✅ SMS confirmation sent to client successfully (on approval)');
    } catch (smsError) {
      console.error('❌ Error sending SMS on approval (continuing):', smsError.message);
    }

    // Backup to Google Sheets
    await backupToGoogleSheets(bookingData, bookingId);

    // Mark notifications as sent to prevent duplicates
    await admin.firestore().collection('bookings').doc(bookingId).set(
      { notificationsSent: true },
      { merge: true }
    );
  } catch (error) {
    console.error('❌ Error in handleBookingApproved:', error);
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
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }

    try {
      const { name, phone, timeSlot, notes, service, price, deviceId } = req.body || {};
      let requestUser;
      try {
        requestUser = await getOptionalRequestUser(req);
      } catch (authError) {
        console.warn('Rejected booking with an invalid auth token:', authError.message);
        res.status(401).json({ success: false, message: 'Your login session is invalid. Please log in again.' });
        return;
      }
      const isAdminRequest = Boolean(requestUser && requestUser.admin === true);

      if (!name || !phone || !timeSlot) {
        res.status(400).json({ success: false, message: 'Missing required fields' });
        return;
      }

      if (typeof name !== 'string' || typeof phone !== 'string' || typeof timeSlot !== 'string') {
        res.status(400).json({ success: false, message: 'Invalid field types' });
        return;
      }

      // Service is required and must be one of the allowed values
      const ALLOWED_SERVICES = ['Fade', 'Trim', 'Fade + Trim'];
      const trimmedService = typeof service === 'string' ? service.trim() : '';
      if (!trimmedService || !ALLOWED_SERVICES.includes(trimmedService)) {
        res.status(400).json({ success: false, message: 'Please select a service (Fade, Trim, or Both) before booking.' });
        return;
      }

      // Name validation: max 75 chars, letters/spaces/hyphens/apostrophes/periods only
      const trimmedName = name.trim();
      if (trimmedName.length > 75) {
        res.status(400).json({ success: false, message: 'Name must be 75 characters or fewer.' });
        return;
      }
      if (!/^[a-zA-ZÀ-ÿ\s'\-.]+$/.test(trimmedName)) {
        res.status(400).json({ success: false, message: 'Name can only contain letters, spaces, hyphens, apostrophes and periods.' });
        return;
      }

      const normalizedPhone = normalizeAustralianPhone(phone);
      if (normalizedPhone.length !== 11 || !normalizedPhone.startsWith('61')) {
        res.status(400).json({ success: false, message: 'Please enter a valid Australian phone number.' });
        return;
      }

      const slotId = slotDocIdFromTimeSlot(timeSlot);
      if (!slotId) {
        res.status(400).json({ success: false, message: 'Invalid time slot' });
        return;
      }

      const db = admin.firestore();

      if (!(await isConfiguredBookingSlot(db, timeSlot))) {
        res.status(400).json({ success: false, message: 'That appointment time is not available.' });
        return;
      }

      // ── Registered-account check ─────────────────────────────────────────
      // If this phone number already has an account, reject guest booking.
      const phoneCandidates = [phone.trim(), normalizedPhone, `0${normalizedPhone.slice(2)}`];
      const existingUserChecks = await Promise.all(
        [...new Set(phoneCandidates)].map(candidate => db.collection('users').where('phone', '==', candidate).limit(1).get())
      );
      if (!requestUser && existingUserChecks.some(snapshot => !snapshot.empty)) {
        res.status(403).json({
          success: false,
          message: '📱 This number is already linked to an account. Please log in to book.'
        });
        return;
      }
      // ─────────────────────────────────────────────────────────────────────

      // All limit checks and reservations happen in the booking transaction.
      // This prevents a parallel burst from passing multiple pre-flight checks.
      const TEN_MIN_MS = 10 * 60 * 1000;
      const rawIp = (req.headers['x-forwarded-for'] || req.ip || '').split(',')[0].trim();
      const limiterRefs = [];
      if (!isAdminRequest) {
        limiterRefs.push(db.collection('rateLimits').doc(rateLimitDocId('phone', normalizedPhone)));
        if (requestUser) {
          limiterRefs.push(db.collection('rateLimits').doc(rateLimitDocId('uid', requestUser.uid)));
        } else {
          if (rawIp) limiterRefs.push(db.collection('rateLimits').doc(rateLimitDocId('ip', rawIp)));
          if (deviceId && typeof deviceId === 'string') {
            limiterRefs.push(db.collection('rateLimits').doc(rateLimitDocId('device', deviceId.slice(0, 200))));
          }
        }
      }

      const slotRef = db.collection('bookedSlots').doc(slotId);
      const bookingRef = db.collection('bookings').doc(); // auto id

      await db.runTransaction(async (tx) => {
        const [slotDoc, ...limiterDocs] = await tx.getAll(slotRef, ...limiterRefs);
        if (slotDoc.exists) {
          throw new Error('SLOT_TAKEN');
        }

        const nowMs = Date.now();
        const cutoffMs = nowMs - TEN_MIN_MS;
        const maxBookings = requestUser ? 4 : 1;
        const nextLimiterValues = limiterDocs.map(doc => {
          const recent = doc.exists && Array.isArray(doc.data().bookingTimes)
            ? doc.data().bookingTimes
              .map(value => value && value.toMillis ? value.toMillis() : 0)
              .filter(value => value > cutoffMs)
            : [];
          if (recent.length >= maxBookings) throw new Error('RATE_LIMITED');
          return [...recent.map(value => admin.firestore.Timestamp.fromMillis(value)), admin.firestore.Timestamp.fromMillis(nowMs)];
        });

        limiterRefs.forEach((ref, index) => {
          tx.set(ref, {
            bookingTimes: nextLimiterValues[index],
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        });

        tx.set(slotRef, {
          timeSlot,
          bookingId: bookingRef.id,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        const bookingData = {
          name: name.trim(),
          phone: phone.trim(),
          timeSlot: timeSlot.trim(),
          notes: typeof notes === 'string' ? notes.trim() : '',
          service: trimmedService,
          price: typeof price === 'number' && price > 0 ? price : 20,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
          guest: !requestUser,
          status: 'pending'
        };
        if (requestUser) bookingData.userId = requestUser.uid;
        tx.set(bookingRef, bookingData);
      });

      res.json({ success: true, bookingId: bookingRef.id });
    } catch (err) {
      if (err && err.message === 'SLOT_TAKEN') {
        res.status(409).json({ success: false, message: 'That time slot was just booked. Please choose another.' });
        return;
      }
      if (err && err.message === 'RATE_LIMITED') {
        res.status(429).json({
          success: false,
          message: requestUser
            ? 'You can make up to 4 bookings every 10 minutes. Please wait before trying again.'
            : 'Please wait 10 minutes before making another booking.'
        });
        return;
      }
      console.error('❌ createGuestBooking error:', err);
      res.status(500).json({ success: false, message: 'Failed to create booking' });
    }
  }
);

// Admin endpoint: notify a client via SMS that their appointment has been rescheduled.
// Called by the admin page after updating a booking's timeSlot.
exports.notifyReschedule = onRequest(
  { region: 'us-central1', invoker: 'public', cors: true, secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER] },
  async (req, res) => {
    try {
      const { bookingId, newTimeSlot, phone, name } = req.body || {};

      if (!bookingId || !newTimeSlot || !phone) {
        res.status(400).json({ success: false, message: 'Missing required fields' });
        return;
      }

      const formattedDate = formatReadableDate(newTimeSlot);
      // timeSlot format: "YYYY-MM-DD HH:MM" — time is everything after first space
      const spaceIdx = newTimeSlot.indexOf(' ');
      const time = spaceIdx !== -1 ? newTimeSlot.slice(spaceIdx + 1) : newTimeSlot;

      const formattedPhone = formatPhoneNumber(phone);
      const smsBody =
        `Hi ${name || 'there'}, your Mexi Cuts appointment has been rescheduled.\n` +
        `New date: ${formattedDate}\nNew time: ${time}\n` +
        `Location: 6 Rosella Tce, Peregian Springs\n` +
        `Reschedule or cancel: ${MANAGE_BOOKING_URL}\n` +
        `Questions? DM @mexi_cuts: ${INSTAGRAM_DM_URL}. DO NOT REPLY`;

      const twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      const msg = await twilioClient.messages.create({
        body: smsBody,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: formattedPhone
      });

      console.log(`✅ Reschedule SMS sent | booking: ${bookingId} | to: ${formattedPhone} | Twilio SID: ${msg.sid} | status: ${msg.status}`);
      res.json({ success: true, sid: msg.sid });
    } catch (err) {
      console.error('❌ notifyReschedule error:', err);
      res.status(500).json({ success: false, message: 'Failed to send reschedule notification' });
    }
  }
);

// Public endpoint: look up bookings by phone number (for guest self-service cancellation).
// Returns only future/active bookings for the provided phone — no admin data exposed.
exports.lookupBookingByPhone = onRequest(
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
      res.status(405).json({ success: false, message: 'Method not allowed' });
      return;
    }

    try {
      const { phone } = req.body || {};
      if (!phone || typeof phone !== 'string') {
        res.status(400).json({ success: false, message: 'Missing phone number' });
        return;
      }

      const db = admin.firestore();
      const phoneTrimmed = phone.trim();

      // Try both the provided number and the formatted +61 version
      const cleaned = phoneTrimmed.replace(/\D/g, '');
      const formatted = cleaned.startsWith('0') && cleaned.length === 10
        ? '+61' + cleaned.substring(1)
        : phoneTrimmed;

      let snapshot = await db.collection('bookings').where('phone', '==', phoneTrimmed).get();
      if (snapshot.empty && formatted !== phoneTrimmed) {
        snapshot = await db.collection('bookings').where('phone', '==', formatted).get();
      }

      if (snapshot.empty) {
        res.json({ success: true, bookings: [] });
        return;
      }

      // Only return safe fields — no internal IDs beyond bookingId, no userId
      const now = new Date();
      const bookings = snapshot.docs
        .filter(doc => {
          const data = doc.data();
          const appointmentDate = parseAppointmentTime(data.timeSlot);
          return appointmentDate && !Number.isNaN(appointmentDate.getTime()) && appointmentDate > now && (data.status || 'pending') !== 'rejected';
        })
        .map(doc => ({
          bookingId: doc.id,
          name: doc.data().name || '',
          timeSlot: doc.data().timeSlot || '',
          notes: doc.data().notes || '',
          phone: doc.data().phone || '',
          service: doc.data().service || 'Haircut',
          price: doc.data().price || 20,
          status: doc.data().status || 'pending'
        }));

      res.json({ success: true, bookings });
    } catch (err) {
      console.error('❌ lookupBookingByPhone error:', err);
      res.status(500).json({ success: false, message: 'Failed to look up booking' });
    }
  }
);

// Public endpoint: cancel a booking by phone number verification.
// Caller must provide the bookingId AND the matching phone number — prevents
// random cancellation of other people's bookings.
exports.cancelGuestBooking = onRequest(
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
      res.status(405).json({ success: false, message: 'Method not allowed' });
      return;
    }

    try {
      const { bookingId, phone } = req.body || {};

      if (!bookingId || !phone) {
        res.status(400).json({ success: false, message: 'Missing bookingId or phone' });
        return;
      }

      const db = admin.firestore();
      const bookingRef = db.collection('bookings').doc(bookingId);
      const bookingDoc = await bookingRef.get();

      if (!bookingDoc.exists) {
        res.status(404).json({ success: false, message: 'Booking not found' });
        return;
      }

      const bookingData = bookingDoc.data();

      // Verify the provided phone matches the booking — prevents cancelling others' bookings
      const normalise = p => (p || '').replace(/\D/g, '').replace(/^61/, '0');
      if (normalise(bookingData.phone) !== normalise(phone)) {
        res.status(403).json({ success: false, message: 'Phone number does not match this booking' });
        return;
      }

      await bookingRef.delete();

      res.json({ success: true });
    } catch (err) {
      console.error('❌ cancelGuestBooking error:', err);
      res.status(500).json({ success: false, message: 'Failed to cancel booking' });
    }
  }
);

// Customer endpoint: move an upcoming booking to an available future slot.
// Phone verification protects guest bookings; account bookings use the same
// path so slot release/reservation is always atomic.
exports.rescheduleBooking = onRequest(
  {
    region: 'us-central1',
    invoker: 'public',
    cors: true,
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER]
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
      res.status(405).json({ success: false, message: 'Method not allowed' });
      return;
    }

    try {
      const { bookingId, phone, newTimeSlot } = req.body || {};
      if (!bookingId || !phone || !newTimeSlot) {
        res.status(400).json({ success: false, message: 'Missing booking, phone number, or new time' });
        return;
      }

      const newAppointmentDate = parseAppointmentTime(newTimeSlot);
      if (!newAppointmentDate || Number.isNaN(newAppointmentDate.getTime()) || newAppointmentDate <= new Date()) {
        res.status(400).json({ success: false, message: 'Please choose a future appointment time' });
        return;
      }

      const newSlotId = slotDocIdFromTimeSlot(newTimeSlot);
      if (!newSlotId) {
        res.status(400).json({ success: false, message: 'Invalid appointment time' });
        return;
      }

      const db = admin.firestore();
      if (!await isConfiguredBookingSlot(db, newTimeSlot)) {
        res.status(400).json({ success: false, message: 'That appointment time is not available' });
        return;
      }
      const bookingRef = db.collection('bookings').doc(String(bookingId));
      const newSlotRef = db.collection('bookedSlots').doc(newSlotId);
      const normalise = value => String(value || '').replace(/\D/g, '').replace(/^61/, '0');
      let updatedBooking = null;

      await db.runTransaction(async tx => {
        const bookingDoc = await tx.get(bookingRef);
        if (!bookingDoc.exists) throw new Error('BOOKING_NOT_FOUND');

        const booking = bookingDoc.data();
        if (normalise(booking.phone) !== normalise(phone)) throw new Error('PHONE_MISMATCH');

        const oldAppointmentDate = parseAppointmentTime(booking.timeSlot);
        if (!oldAppointmentDate || oldAppointmentDate <= new Date()) throw new Error('BOOKING_PASSED');
        if (booking.timeSlot === newTimeSlot) throw new Error('SAME_SLOT');

        const oldSlotId = slotDocIdFromTimeSlot(booking.timeSlot);
        const oldSlotRef = oldSlotId ? db.collection('bookedSlots').doc(oldSlotId) : null;
        const [newSlotDoc, oldSlotDoc] = await Promise.all([
          tx.get(newSlotRef),
          oldSlotRef ? tx.get(oldSlotRef) : Promise.resolve(null)
        ]);
        if (newSlotDoc.exists && newSlotDoc.data().bookingId !== bookingId) {
          throw new Error('SLOT_TAKEN');
        }

        if (oldSlotRef && oldSlotDoc && oldSlotDoc.exists && oldSlotDoc.data().bookingId === bookingId) {
          tx.delete(oldSlotRef);
        }

        tx.set(newSlotRef, {
          timeSlot: newTimeSlot,
          bookingId,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        tx.update(bookingRef, {
          timeSlot: newTimeSlot,
          reminderSent: false,
          reminderSentAt: admin.firestore.FieldValue.delete(),
          rescheduledAt: admin.firestore.FieldValue.serverTimestamp()
        });

        updatedBooking = { ...booking, timeSlot: newTimeSlot };
      });

      // Confirm the change by SMS. The booking stays rescheduled if Twilio is
      // temporarily unavailable; the API reports smsSent so the UI can explain it.
      let smsSent = false;
      try {
        const formattedDate = formatReadableDate(newTimeSlot);
        const [, timePart, ampm] = newTimeSlot.split(' ');
        const time = `${timePart} ${ampm}`;
        const message =
          `Hi ${updatedBooking.name || 'there'}, your Mexi Cuts appointment has been rescheduled.\n` +
          `New date: ${formattedDate}\nNew time: ${time}\n` +
          `Reschedule or cancel: ${MANAGE_BOOKING_URL}\n` +
          `Questions? DM @mexi_cuts: ${INSTAGRAM_DM_URL}. DO NOT REPLY`;
        const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
        await client.messages.create({
          body: message,
          from: process.env.TWILIO_PHONE_NUMBER,
          to: formatPhoneNumber(updatedBooking.phone)
        });
        smsSent = true;
      } catch (smsError) {
        console.error('Reschedule saved but confirmation SMS failed:', smsError.message);
      }

      res.json({ success: true, smsSent });
    } catch (err) {
      const knownErrors = {
        BOOKING_NOT_FOUND: [404, 'Booking not found'],
        PHONE_MISMATCH: [403, 'Phone number does not match this booking'],
        BOOKING_PASSED: [409, 'Past appointments cannot be rescheduled'],
        SAME_SLOT: [400, 'Please choose a different appointment time'],
        SLOT_TAKEN: [409, 'That time was just booked. Please choose another.']
      };
      const known = knownErrors[err && err.message];
      if (known) {
        res.status(known[0]).json({ success: false, message: known[1] });
        return;
      }
      console.error('rescheduleBooking error:', err);
      res.status(500).json({ success: false, message: 'Failed to reschedule booking' });
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

      // Send email notification to barber (always on create, regardless of status)
      const transporter = createTransporter();

      const mailOptions = {
        from: process.env.GMAIL_USER,
        to: 'matias.oliverac@outlook.com',
        subject: '🆕 New Booking Pending Approval - Mexi Cuts',
        html: `
          <h2>New Booking Received (Pending Approval)</h2>
          <p><strong>Customer Name:</strong> ${bookingData.name || ''}</p>
          <p><strong>Phone Number:</strong> ${bookingData.phone || ''}</p>
          <p><strong>Appointment Time:</strong> ${bookingData.timeSlot || ''}</p>
          <p><strong>Special Notes:</strong> ${bookingData.notes || 'None'}</p>
          <p><strong>Booking Date:</strong> ${bookingData.timestamp ? new Date(bookingData.timestamp.toDate()).toLocaleString() : ''}</p>
          <br>
          <p>Status: <strong>${(bookingData.status || 'pending').toUpperCase()}</strong></p>
          <p>This booking is currently <strong>pending</strong>. Please review it in your admin panel to accept or reject it.</p>
          <p>SMS confirmation and Google Sheets backup will only be triggered <strong>after you accept</strong> the booking.</p>
        `
      };

      await transporter.sendMail(mailOptions);
      console.log('✅ Booking notification email (pending) sent successfully');

      // If this booking is already approved on create (e.g. manual admin booking),
      // run the approved actions immediately.
      const statusOnCreate = bookingData.status || 'pending';
      if (statusOnCreate === 'approved' && !bookingData.notificationsSent) {
        await handleBookingApproved(bookingData, bookingId);
      }

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

// Trigger when a booking is updated; if status changes from non-approved to approved,
// send SMS + Google Sheets backup once.
exports.handleBookingStatusChange = onDocumentUpdated(
  {
    region: 'us-central1',
    document: 'bookings/{bookingId}',
    secrets: [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, GOOGLE_SHEETS_CREDENTIALS, GOOGLE_SHEET_ID]
  },
  async (event) => {
    try {
      const beforeData = event.data && event.data.before && event.data.before.data ? event.data.before.data() : null;
      const afterData = event.data && event.data.after && event.data.after.data ? event.data.after.data() : null;
      const bookingId = event.params.bookingId;

      if (!beforeData || !afterData) {
        return;
      }

      const previousStatus = beforeData.status || 'pending';
      const newStatus = afterData.status || 'pending';

      // Only react when transitioning into approved
      if (previousStatus === 'approved' || newStatus !== 'approved') {
        return;
      }

      if (afterData.notificationsSent) {
        console.log('Notifications already sent for booking', bookingId);
        return;
      }

      console.log(`✅ Booking ${bookingId} status changed from ${previousStatus} to approved. Running approved actions.`);
      await handleBookingApproved(afterData, bookingId);
    } catch (error) {
      console.error('❌ Error handling booking status change:', error);
    }
  }
);

// HTTP endpoint to rebuild bookedSlots collection from existing bookings.
// Useful after changing how availability is tracked so old bookings still block slots.
exports.rebuildBookedSlots = onRequest(
  {
    region: 'us-central1',
    invoker: 'public',
    cors: true
  },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    try {
      const db = admin.firestore();
      const bookingsSnapshot = await db.collection('bookings').get();

      if (bookingsSnapshot.empty) {
        res.send('No bookings found to rebuild bookedSlots.');
        return;
      }

      let written = 0;
      const batch = db.batch();

      bookingsSnapshot.forEach(doc => {
        const data = doc.data();
        if (!data.timeSlot) return;

        const slotId = slotDocIdFromTimeSlot(data.timeSlot);
        const ref = db.collection('bookedSlots').doc(slotId);
        batch.set(ref, {
          timeSlot: data.timeSlot,
          bookingId: doc.id,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
        written++;
      });

      await batch.commit();
      res.send(`✅ Rebuilt bookedSlots for ${written} booking(s).`);
    } catch (error) {
      console.error('❌ Error rebuilding bookedSlots:', error);
      res.status(500).send('Error rebuilding bookedSlots: ' + error.message);
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

        if ((booking.status || 'approved') !== 'approved') {
          console.log('Appointment is not approved - skipping reminder');
          continue;
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
        console.log(`Should send reminder: ${hoursDiff > 0 && hoursDiff <= 24.25}`);
        
        // Send once the appointment is within 24 hours. reminderSent makes this
        // idempotent, while the wider recovery window prevents permanent misses.
        if (isAppointmentTomorrow(appointmentDate)) {
          // Check if we've already sent a reminder for this booking
          if (booking.reminderSent) {
            console.log(`Reminder already sent for booking ${bookingId}`);
            continue;
          }
          
          try {
            // Send reminder SMS
            // Extract time from timeSlot (format: "2025-08-23 05:30 PM")
            const [, timePart, ampm] = booking.timeSlot.split(' ');
            const time = `${timePart} ${ampm}`;
            const reminderMessage = `Reminder: Your Mexi Cuts appointment is tomorrow at ${time}. See you then! DO NOT REPLY`;
            
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
        to: formatPhoneNumber(req.query.phone || '0400000000') // Non-customer fallback for test messages
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
        phone: '0400000000',
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

// Keep payment amounts numeric when writing to Google Sheets. Currency symbols
// belong in the sheet's number format; including them in the value makes Sheets
// store entries such as "$25" as text.
function normalizePaymentAmount(value, fallback = 20) {
  const amount = typeof value === 'number'
    ? value
    : Number(String(value ?? '').replace(/[^0-9.-]/g, ''));

  return Number.isFinite(amount) && amount > 0 ? amount : fallback;
}

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
    const amount = normalizePaymentAmount(bookingData.price);
    const rowData = [
      appointmentDate,           // When Cut (e.g., "28 October 2025")
      '',                        // When Paid (empty until confirmed)
      bookingData.name || '',    // Who
      amount,                    // Amount (numeric so Sheets can sum it; falls back to 20)
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
              <a href="https://mexicuts-booking.web.app/admin_mxcts2010.html?tab=payments"
                 style="background: #CE1126; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: bold;">
                Go to Payments
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
    
    // Update Amount (D) + Cash/Card (E) in one shot so any admin price edit syncs.
    const methodAmount = normalizePaymentAmount(booking.price);
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `D${rowIndex}:E${rowIndex}`,
      valueInputOption: 'RAW',
      resource: {
        values: [[
          methodAmount,
          paymentMethod === 'cash' ? 'Cash' : 'Card'
        ]]
      }
    });

    console.log(`✅ Updated payment method in sheets: ${booking.name} - ${paymentMethod} - $${methodAmount}`);
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
    
    // Update When Paid (B) and re-write Amount (D) so the latest price sticks
    // even if it was adjusted between method-set and final confirm.
    const confirmAmount = normalizePaymentAmount(booking.price);
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      resource: {
        valueInputOption: 'RAW',
        data: [
          { range: `B${rowIndex}`, values: [[paymentDate]] },
          { range: `D${rowIndex}`, values: [[confirmAmount]] }
        ]
      }
    });

    console.log(`✅ Updated payment date in sheets: ${booking.name} - ${paymentDate} - $${confirmAmount}`);
  } catch (error) {
    console.error('❌ Error updating payment date in sheets:', error);
  }
}

// List unsettled rows from the payment sheet (rows where When Paid (B) is empty).
// Used by the admin Payments tab as a fallback when Firestore booking docs are
// missing/orphaned but the sheet still has the row.
exports.listSheetUnsettledRows = onRequest(
  {
    region: 'us-central1',
    secrets: [GOOGLE_SHEETS_CREDENTIALS, PAYMENT_SHEET_ID],
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
      const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
      const sheetId = process.env.PAYMENT_SHEET_ID;
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      const sheets = google.sheets({ version: 'v4', auth });

      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: sheetId,
        range: 'A:E'
      });

      const rows = response.data.values || [];
      const unsettled = [];
      // Walk from bottom up so the most recent unsettled rows surface first.
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i];
        const whenCut = (r[0] || '').trim();
        const whenPaid = (r[1] || '').trim();
        const who = (r[2] || '').trim();
        const amount = String(r[3] ?? '').trim();
        const method = (r[4] || '').trim();
        // Skip header row and blank rows
        if (!whenCut || !who) continue;
        if (whenCut.toLowerCase() === 'when cut') continue;
        if (whenPaid) continue; // already settled
        unsettled.push({
          rowIndex: i + 1, // 1-based
          whenCut,
          who,
          amount: amount || '$20',
          method: method || ''
        });
      }

      res.json({ success: true, rows: unsettled });
    } catch (err) {
      console.error('❌ listSheetUnsettledRows error:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// Confirm a single sheet row by index — writes columns B (When Paid), D (Amount), E (Cash/Card).
exports.confirmSheetRow = onRequest(
  {
    region: 'us-central1',
    secrets: [GOOGLE_SHEETS_CREDENTIALS, PAYMENT_SHEET_ID],
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
      const { rowIndex, paymentMethod, paymentDate, amount } = req.body || {};
      const idx = parseInt(rowIndex, 10);
      if (!idx || idx < 1) {
        res.status(400).json({ success: false, message: 'Invalid rowIndex' });
        return;
      }
      if (!['cash', 'card'].includes(String(paymentMethod || '').toLowerCase())) {
        res.status(400).json({ success: false, message: 'paymentMethod must be cash or card' });
        return;
      }
      if (!paymentDate || typeof paymentDate !== 'string') {
        res.status(400).json({ success: false, message: 'Missing paymentDate' });
        return;
      }
      const numericAmount = Number(amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        res.status(400).json({ success: false, message: 'Invalid amount' });
        return;
      }

      const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
      const sheetId = process.env.PAYMENT_SHEET_ID;
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      const sheets = google.sheets({ version: 'v4', auth });

      const methodLabel = paymentMethod.toLowerCase() === 'cash' ? 'Cash' : 'Card';

      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: sheetId,
        resource: {
          valueInputOption: 'RAW',
          data: [
            { range: `B${idx}`, values: [[paymentDate]] },
            { range: `D${idx}`, values: [[numericAmount]] },
            { range: `E${idx}`, values: [[methodLabel]] }
          ]
        }
      });

      res.json({ success: true });
    } catch (err) {
      console.error('❌ confirmSheetRow error:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// Delete a payment sheet row by its row index. Used by the admin Payments tab
// to clear orphaned sheet rows that have no matching Firestore booking.
exports.deletePaymentSheetRow = onRequest(
  {
    region: 'us-central1',
    secrets: [GOOGLE_SHEETS_CREDENTIALS, PAYMENT_SHEET_ID],
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
      const { rowIndex } = req.body || {};
      const idx = parseInt(rowIndex, 10);
      if (!idx || idx < 1) {
        res.status(400).json({ success: false, message: 'Invalid rowIndex' });
        return;
      }

      const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
      const sheetId = process.env.PAYMENT_SHEET_ID;
      const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/spreadsheets']
      });
      const sheets = google.sheets({ version: 'v4', auth });

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        resource: {
          requests: [{
            deleteDimension: {
              range: {
                sheetId: 0,
                dimension: 'ROWS',
                startIndex: idx - 1,
                endIndex: idx
              }
            }
          }]
        }
      });

      res.json({ success: true });
    } catch (err) {
      console.error('❌ deletePaymentSheetRow error:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

// Delete a booking awaiting payment: removes the Firestore doc AND the
// matching payment sheet row (matched by name + appointment date).
exports.deletePaymentBooking = onRequest(
  {
    region: 'us-central1',
    secrets: [GOOGLE_SHEETS_CREDENTIALS, PAYMENT_SHEET_ID],
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
      const { bookingId } = req.body || {};
      if (!bookingId || typeof bookingId !== 'string') {
        res.status(400).json({ success: false, message: 'Missing bookingId' });
        return;
      }

      const db = admin.firestore();
      const bookingRef = db.collection('bookings').doc(bookingId);
      const bookingDoc = await bookingRef.get();

      let removedSheetRow = false;
      if (bookingDoc.exists) {
        const booking = bookingDoc.data();
        if (booking && booking.timeSlot) {
          try {
            const credentials = JSON.parse(process.env.GOOGLE_SHEETS_CREDENTIALS);
            const sheetId = process.env.PAYMENT_SHEET_ID;
            const auth = new google.auth.GoogleAuth({
              credentials,
              scopes: ['https://www.googleapis.com/auth/spreadsheets']
            });
            const sheets = google.sheets({ version: 'v4', auth });

            const [datePart] = booking.timeSlot.split(' ');
            const [year, month, day] = datePart.split('-');
            const appointmentDate = `${parseInt(day)} ${getMonthName(parseInt(month))} ${year}`;

            const response = await sheets.spreadsheets.values.get({
              spreadsheetId: sheetId,
              range: 'A:E'
            });
            const rows = response.data.values || [];

            // Walk bottom-up so the most recent matching row goes first.
            for (let i = rows.length - 1; i >= 0; i--) {
              if ((rows[i][0] || '').trim() === appointmentDate &&
                  (rows[i][2] || '').trim() === (booking.name || '').trim()) {
                await sheets.spreadsheets.batchUpdate({
                  spreadsheetId: sheetId,
                  resource: {
                    requests: [{
                      deleteDimension: {
                        range: {
                          sheetId: 0,
                          dimension: 'ROWS',
                          startIndex: i,
                          endIndex: i + 1
                        }
                      }
                    }]
                  }
                });
                removedSheetRow = true;
                break;
              }
            }
          } catch (sheetErr) {
            console.error('Sheet delete failed (continuing with Firestore delete):', sheetErr);
          }
        }

        // Also delete the public bookedSlots mirror so the time slot opens up.
        try {
          const slotId = slotDocIdFromTimeSlot(booking.timeSlot);
          if (slotId) await db.collection('bookedSlots').doc(slotId).delete();
        } catch (slotErr) {
          console.error('bookedSlots cleanup failed (continuing):', slotErr);
        }

        await bookingRef.delete();
      }

      res.json({ success: true, removedSheetRow, bookingDeleted: bookingDoc.exists });
    } catch (err) {
      console.error('❌ deletePaymentBooking error:', err);
      res.status(500).json({ success: false, message: err.message });
    }
  }
);

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
      
      const db = admin.firestore();
      const usersSnapshot = await db.collection('users').get();
      
      if (usersSnapshot.empty) {
        console.log('No users found');
        return;
      }
      
      let updatedCount = 0;
      const leaderboardEntries = [];
      
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
          // Only count approved bookings (treat no-status legacy bookings as approved)
          const status = booking.status || 'approved';
          if (status !== 'approved') return;

          if (booking.timeSlot) {
            const bookingDate = parseAppointmentTime(booking.timeSlot);
            if (bookingDate && bookingDate >= FEB_14_2026) {
              bookingsAfterFeb14.push(bookingDate);
              if (bookingDate <= now) {
                completedBookingsAfterFeb14.push(bookingDate);
              }
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
        await db.collection('users').doc(userId).update({
          frequencyStats: stats
        });
        
        updatedCount++;
        console.log(`✅ Updated stats for ${userData.name}: ${stats.completedBookingsSinceFeb14} completed bookings, avg ${stats.averageWeeksBetween ? stats.averageWeeksBetween.toFixed(1) : 'N/A'} weeks`);

        // Build leaderboard entry (no phone numbers; only if they qualify)
        if (stats.completedBookingsSinceFeb14 >= 2 && stats.averageWeeksBetween !== null) {
          leaderboardEntries.push({
            userId,
            displayName: userData.name || 'Customer',
            totalVisits: stats.completedBookingsSinceFeb14,
            averageWeeks: stats.averageWeeksBetween,
            lastVisit: stats.lastBookingDate || null
          });
        }
      }
      
      // Sort leaderboard by average weeks (lower is more frequent)
      leaderboardEntries.sort((a, b) => a.averageWeeks - b.averageWeeks);
      
      // Write public-safe leaderboard collection
      const leaderboardRef = db.collection('leaderboardPublic');
      const existing = await leaderboardRef.get();
      const batch = db.batch();
      
      // Clear old entries
      existing.forEach(doc => batch.delete(doc.ref));
      
      // Limit to top 100 for safety
      leaderboardEntries.slice(0, 100).forEach((entry, index) => {
        const ref = leaderboardRef.doc(entry.userId);
        batch.set(ref, {
          displayName: entry.displayName,
          totalVisits: entry.totalVisits,
          averageWeeks: entry.averageWeeks,
          lastVisit: entry.lastVisit,
          position: index + 1,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
      
      await batch.commit();
      
      console.log(`✅ Frequency stats update complete: ${updatedCount} users updated, leaderboardPublic size: ${Math.min(leaderboardEntries.length, 100)}`);
      
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
          
          // Extract phone from the internal digits@mexicuts.local email format.
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

// HTTP endpoint to promote the barber owner account to admin (custom claim).
// Only the owner account is allowed; compare a hash so the identifier is not exposed in source.
exports.promoteSelfToAdmin = onRequest(
  {
    region: 'us-central1',
    invoker: 'public',
    cors: true
  },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }

    try {
      const idToken = (req.body && req.body.idToken) || '';
      if (!idToken) {
        res.status(400).json({ success: false, message: 'Missing idToken' });
        return;
      }

      const decoded = await admin.auth().verifyIdToken(idToken);
      const uid = decoded.uid;
      const email = decoded.email || '';

      const emailHash = crypto.createHash('sha256').update(email).digest('hex');

      if (emailHash !== OWNER_EMAIL_SHA256) {
        console.warn('promoteSelfToAdmin called by non-owner account:', email);
        res.status(403).json({ success: false, isAdmin: false, message: 'Not authorized' });
        return;
      }

      const userRecord = await admin.auth().getUser(uid);
      const existingClaims = userRecord.customClaims || {};

      if (!existingClaims.admin) {
        existingClaims.admin = true;
        await admin.auth().setCustomUserClaims(uid, existingClaims);
        console.log(`✅ Set admin custom claim for owner uid=${uid}`);
      } else {
        console.log(`ℹ️ Owner uid=${uid} already has admin claim`);
      }

      // Mark in Firestore user profile as admin (optional, for UI/debug).
      await admin.firestore().collection('users').doc(uid).set(
        {
          isAdmin: true
        },
        { merge: true }
      );

      res.json({ success: true, isAdmin: true });
    } catch (error) {
      console.error('❌ Error in promoteSelfToAdmin:', error);
      res.status(500).json({ success: false, isAdmin: false, message: 'Internal error' });
    }
  }
);

// HTTP endpoint to delete a user completely (admin only).
// - Requires an idToken from a user with custom claim admin: true
// - Unlinks that user's bookings (removes userId field)
// - Deletes Firestore user document
// - Deletes leaderboardPublic entry
// - Deletes Firebase Auth user
exports.deleteUserCompletely = onRequest(
  {
    region: 'us-central1',
    invoker: 'public',
    cors: true
  },
  async (req, res) => {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.status(204).send('');
      return;
    }

    if (req.method !== 'POST') {
      res.status(405).send('Method not allowed');
      return;
    }

    try {
      const { idToken, userId } = req.body || {};
      if (!idToken || !userId) {
        res.status(400).json({ success: false, message: 'Missing idToken or userId' });
        return;
      }

      const decoded = await admin.auth().verifyIdToken(idToken);
      if (!decoded.admin) {
        console.warn('deleteUserCompletely called by non-admin uid:', decoded.uid);
        res.status(403).json({ success: false, message: 'Not authorized' });
        return;
      }

      const db = admin.firestore();
      const result = {
        unlinkedBookings: 0,
        userDocDeleted: false,
        leaderboardEntryDeleted: false,
        authUserDeleted: false
      };

      // Unlink bookings (remove userId field)
      const bookingsSnapshot = await db.collection('bookings')
        .where('userId', '==', userId)
        .get();

      if (!bookingsSnapshot.empty) {
        const batch = db.batch();
        bookingsSnapshot.forEach(doc => {
          batch.update(doc.ref, {
            userId: admin.firestore.FieldValue.delete()
          });
          result.unlinkedBookings++;
        });
        await batch.commit();
      }

      // Delete Firestore user document
      try {
        await db.collection('users').doc(userId).delete();
        result.userDocDeleted = true;
      } catch (e) {
        console.error('Error deleting Firestore user doc:', e);
      }

      // Delete leaderboardPublic entry
      try {
        await db.collection('leaderboardPublic').doc(userId).delete();
        result.leaderboardEntryDeleted = true;
      } catch (e) {
        console.error('Error deleting leaderboardPublic entry:', e);
      }

      // Delete Firebase Auth user
      try {
        await admin.auth().deleteUser(userId);
        result.authUserDeleted = true;
      } catch (e) {
        console.error('Error deleting Auth user:', e);
      }

      res.json({
        success: true,
        ...result
      });
    } catch (error) {
      console.error('❌ Error in deleteUserCompletely:', error);
      res.status(500).json({ success: false, message: 'Internal error' });
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
      
      const db = admin.firestore();
      const usersSnapshot = await db.collection('users').get();
      
      if (usersSnapshot.empty) {
        res.send('No users found in database');
        return;
      }
      
      let updatedCount = 0;
      const results = [];
      const leaderboardEntries = [];
      
      for (const userDoc of usersSnapshot.docs) {
        const userId = userDoc.id;
        const userData = userDoc.data();
        
        // Get all bookings for this user
        const bookingsSnapshot = await admin.firestore().collection('bookings')
          .where('userId', '==', userId)
          .get();
        
        if (bookingsSnapshot.empty) {
          await db.collection('users').doc(userId).update({
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
          // Only count approved bookings (treat no-status legacy bookings as approved)
          const status = booking.status || 'approved';
          if (status !== 'approved') return;

          if (booking.timeSlot) {
            const bookingDate = parseAppointmentTime(booking.timeSlot);
            if (bookingDate && bookingDate >= FEB_14_2026) {
              bookingsAfterFeb14.push(bookingDate);
              if (bookingDate <= now) {
                completedBookingsAfterFeb14.push(bookingDate);
              }
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
        
        await db.collection('users').doc(userId).update({
          frequencyStats: stats
        });
        
        updatedCount++;
        results.push(`${userData.name}: ${stats.completedBookingsSinceFeb14} bookings, avg ${stats.averageWeeksBetween ? stats.averageWeeksBetween.toFixed(1) + ' weeks' : 'N/A'}`);

        if (stats.completedBookingsSinceFeb14 >= 2 && stats.averageWeeksBetween !== null) {
          leaderboardEntries.push({
            userId,
            displayName: userData.name || 'Customer',
            totalVisits: stats.completedBookingsSinceFeb14,
            averageWeeks: stats.averageWeeksBetween,
            lastVisit: stats.lastBookingDate || null
          });
        }
      }
      
      // Sort and write leaderboardPublic immediately for manual refresh
      leaderboardEntries.sort((a, b) => a.averageWeeks - b.averageWeeks);
      const leaderboardRef = db.collection('leaderboardPublic');
      const existing = await leaderboardRef.get();
      const batch = db.batch();
      existing.forEach(doc => batch.delete(doc.ref));
      leaderboardEntries.slice(0, 100).forEach((entry, index) => {
        const ref = leaderboardRef.doc(entry.userId);
        batch.set(ref, {
          displayName: entry.displayName,
          totalVisits: entry.totalVisits,
          averageWeeks: entry.averageWeeks,
          lastVisit: entry.lastVisit,
          position: index + 1,
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
      await batch.commit();
      
      res.send(`✅ Updated ${updatedCount} users and wrote ${Math.min(leaderboardEntries.length, 100)} leaderboard entries:\n\n${results.join('\n')}`);
      
    } catch (error) {
      console.error('❌ Error:', error);
      res.status(500).send('Error: ' + error.message);
    }
  }
);
