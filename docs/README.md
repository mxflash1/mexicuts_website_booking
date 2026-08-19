# Mexi Cuts Barbershop Booking Website

A modern, responsive web application for the Mexi Cuts barbershop that allows customers to book haircut appointments online. Built with vanilla JavaScript, Firebase, and modern web technologies.

## 🎯 Project Overview

**Mexi Cuts** is a local barbershop located in Peregian Springs, Sunshine Coast, offering professional haircuts for $20. This website streamlines the booking process by allowing customers to:

- View barbershop information and services
- Book appointments 24/7 without calling
- Select from available time slots
- Receive instant booking confirmations
- Add special notes for the barber

## ✨ Features

### For Customers
- **Easy Booking:** Simple 3-step booking process
- **Real-time Availability:** See only available time slots
- **Mobile Responsive:** Works perfectly on all devices
- **Instant Confirmation:** Get immediate booking confirmation
- **Special Notes:** Add specific requests or preferences

### For Business
- **Automated Notifications:** Instant email alerts for new bookings
- **24/7 Availability:** Accept bookings outside business hours
- **Digital Records:** All bookings stored securely in the cloud
- **Reduced Phone Calls:** Focus on haircuts, not scheduling

## 🏗️ Technical Architecture

### Frontend Technologies
- **HTML5:** Semantic markup and structure
- **CSS3:** Responsive design with animations and modern styling
- **Vanilla JavaScript:** No frameworks, pure performance
- **Firebase SDK:** Real-time database integration

### Backend Services
- **Firebase Functions:** Serverless backend processing
- **Firestore Database:** NoSQL database for booking storage
- **Firebase Hosting:** Fast, secure website hosting

### External Libraries
- **Flatpickr:** Beautiful date picker component
- **Canvas Confetti:** Celebration effects for successful bookings
- **Nodemailer:** Automated email notifications

## 🚀 Getting Started

### Prerequisites
- Node.js (version 14 or higher)
- Firebase CLI tools
- A Firebase project account

### Installation

1. **Clone the repository**
   ```bash
   git clone [your-repository-url]
   cd mexi_cuts-page
   ```

2. **Install dependencies**
   ```bash
   npm install
   cd functions
   npm install
   cd ..
   ```

3. **Firebase Setup**
   ```bash
   # Login to Firebase
   firebase login
   
   # Initialize your project (if not already done)
   firebase init
   ```

4. **Environment Configuration**
   - Set up Firebase project in the Firebase Console
   - Update `firebase.json` with your project ID
   - Configure Firestore database rules
   - Set up Firebase Functions secrets for email notifications

5. **Deploy to Firebase**
   ```bash
   firebase deploy
   ```

## 🔒 Security Configuration

### Important: API Keys and Credentials
This project uses a secure configuration system to protect Firebase credentials. **Never commit actual API keys to version control!**

**🚨 SECURITY UPDATE:** The project now uses a secure configuration manager instead of hardcoded credentials.

1. **For Development:**
   ```bash
   cp public/firebase-config.json.example public/firebase-config.json
   # Edit firebase-config.json with your real Firebase credentials
   ```

2. **For Production:**
   ```bash
   node deploy-setup.js production
   # Or set up environment variables in your hosting platform
   ```

3. **Detailed Setup Instructions:**
   See [SECURITY-SETUP.md](SECURITY-SETUP.md) for complete security configuration guide.

**✅ What's Secure Now:**
- Firebase credentials loaded dynamically
- Real API keys never committed to git
- Environment variable support for production
- User-friendly error messages for missing config

### Security Best Practices
- ✅ Use template files for configuration
- ✅ Keep API keys out of version control
- ✅ Use environment variables in production
- ✅ Regularly rotate API keys
- ❌ Never hardcode credentials in source code
- ❌ Never commit sensitive files to Git

## 📱 Usage

### For Customers
1. Visit the website
2. Navigate to the "Book" section
3. Fill in your name and phone number
4. Select your preferred date and time
5. Add any special notes (optional)
6. Click "Confirm Booking"
7. Receive instant confirmation

### For Administrators
- All new bookings automatically trigger email notifications
- Booking data is stored in Firestore database
- Access booking information through Firebase Console

## 🕒 Business Hours

- **Saturday:** 8:00 AM - 6:00 PM (20 available slots)
- **Tuesday:** 3:30 PM - 4:30 PM (2 available slots)
- **Thursday:** 3:30 PM - 4:30 PM (2 available slots)

**Service Price:** $20 per haircut

## 🔧 Configuration

### Firebase Configuration
The app uses Firebase for:
- **Hosting:** Website deployment
- **Firestore:** Database storage
- **Functions:** Backend processing and email notifications

### Email Notifications
Configure email settings in Firebase Functions:
- Set `GMAIL_USER` and `GMAIL_PASS` secrets
- Update recipient email in `functions/index.js`
- Test email functionality using the test endpoint

## 📁 Project Structure

```
mexi_cuts-page/
├── public/                 # Website files
│   ├── index.html         # Main page
│   ├── style.css          # Styling
│   ├── booking.js         # Booking logic
│   ├── admin.js           # Admin functionality
│   └── assets/            # Images and logos
├── functions/             # Firebase Cloud Functions
│   ├── index.js           # Function definitions
│   └── package.json       # Function dependencies
├── firebase.json          # Firebase configuration
├── package.json           # Project dependencies
└── README.md              # This file
```

## 🎨 Customization

### Styling
- Modify `public/style.css` to change colors, fonts, and layout
- Update logo images in the `public/` directory
- Adjust business hours in `public/booking.js`

### Functionality
- Add new features in `public/booking.js`
- Modify email templates in `functions/index.js`
- Update booking validation rules

## 🚀 Deployment

### Development
```bash
firebase serve
```

### Production
```bash
firebase deploy
```

## 📊 Monitoring & Analytics

- **Firebase Console:** Monitor website performance and usage
- **Firestore:** View all booking data and analytics
- **Functions Logs:** Track email notification delivery

## 🔒 Security Considerations

- All data is transmitted over HTTPS
- Firebase provides built-in security rules
- Input validation prevents malicious data entry
- Admin access is restricted to authorized personnel

## 🐛 Troubleshooting

### Common Issues
1. **Booking not saving:** Check Firebase configuration and Firestore rules
2. **Email notifications not working:** Verify Gmail credentials in Firebase secrets
3. **Website not loading:** Check Firebase hosting configuration

### Debug Mode
Enable Firebase debug logging:
```bash
firebase functions:log
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the ISC License.

## 📞 Support

For technical support or questions:
- **Business Contact:** [DM @mexi_cuts on Instagram](https://ig.me/m/mexi_cuts)
- **Instagram:** [@mexi_cuts](https://www.instagram.com/mexi_cuts/)
- **Location:** Peregian Springs, Sunshine Coast

## 🙏 Acknowledgments

- Built with Firebase and modern web technologies
- Designed for simplicity and user experience
- Special thanks to the local community for support

---

**Built with ❤️ for the Mexi Cuts barbershop**
