const functionsV1 = require('firebase-functions');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');
const { defineSecret } = require('firebase-functions/params');
const { onRequest } = require('firebase-functions/v2/https');
const { onDocumentCreated } = require('firebase-functions/v2/firestore');

// Initialize Firebase Admin
admin.initializeApp();

const GMAIL_USER = defineSecret('GMAIL_USER');
const GMAIL_PASS = defineSecret('GMAIL_PASS');

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

// This function automatically triggers when a new booking is added to the database (Gen 2)
exports.sendBookingNotification = onDocumentCreated(
  {
    region: 'us-central1',
    document: 'bookings/{bookingId}',
    secrets: [GMAIL_USER, GMAIL_PASS]
  },
  async (event) => {
    try {
      const transporter = createTransporter();
      const bookingData = event.data && event.data.data ? event.data.data() : {};

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
          <p>This booking has been automatically saved to your database.</p>
        `
      };

      await transporter.sendMail(mailOptions);
      console.log('✅ Booking notification email sent successfully');
    } catch (error) {
      console.error('❌ Error sending booking notification email:', error);
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
