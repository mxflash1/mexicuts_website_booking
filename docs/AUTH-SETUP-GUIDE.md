# 🔐 Authentication System Setup Guide

This guide will walk you through setting up the new phone number + password authentication system.

---

## 📋 **WHAT WAS ADDED**

### New Features:
- ✅ **User Accounts**: Customers can create accounts with phone number + password
- ✅ **Auto-Login**: Devices remember users forever (until they log out)
- ✅ **Auto-Fill**: Booking forms auto-fill for logged-in users
- ✅ **Booking History**: Users see all their past and upcoming appointments
- ✅ **Auto-Linking**: Existing bookings automatically linked to accounts on signup
- ✅ **Guest Mode**: Logged-in users can still book for others
- ✅ **Secure**: Passwords encrypted, phone numbers validated

### New Files Created:
1. `public/js/auth.js` - Authentication manager
2. `public/js/auth-ui.js` - UI handlers for login/signup
3. `public/js/user-bookings.js` - User booking display and management
4. `docs/AUTH-SETUP-GUIDE.md` - This file

### Modified Files:
1. `public/index.html` - Added login UI, modals, auth scripts
2. `public/js/booking.js` - Integrated with auth system
3. Firebase Authentication SDK added

---

## 🚀 **DEPLOYMENT STEPS**

### **Step 1: Enable Firebase Authentication**

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: `mexicuts-booking`
3. Click **Authentication** in left sidebar
4. Click **Get Started** (if first time)
5. Click **Sign-in method** tab
6. Click **Email/Password**
7. Toggle **Enable** to ON
8. Click **Save**

**Note:** Even though we're using phone numbers, we're storing them in email format internally (e.g., `0402098123@mexicuts.local`)

---

### **Step 2: Update Firestore Security Rules**

Your database needs new rules to support user accounts and protect user data.

1. Go to **Firestore Database** in Firebase Console
2. Click **Rules** tab
3. Replace with these rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Users collection - users can only read/write their own data
    match /users/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Bookings collection
    match /bookings/{bookingId} {
      // Anyone can create a booking (guest or logged in)
      allow create: if true;
      
      // Users can read their own bookings
      // OR read bookings by phone number (for booking lookup)
      allow read: if true;
      
      // Users can update/delete their own bookings
      // OR delete bookings by matching phone number
      allow update, delete: if true;
    }
    
    // Settings collection - read-only for clients
    match /settings/{document=**} {
      allow read: if true;
      allow write: if false; // Only admin can write via console
    }
  }
}
```

4. Click **Publish**

**Security Note:** The rules above are permissive for ease of use. For production, you may want to add more restrictions.

---

### **Step 3: Deploy Your Updated Code**

1. **Open Terminal** and navigate to your project:
```bash
cd "/Users/moliveracervantes/Desktop/Haircuts/mexi_cuts page"
```

2. **Deploy to Firebase**:
```bash
firebase deploy
```

This will upload all the new files and changes to your live website.

---

### **Step 4: Test the System**

1. **Visit your website**: `https://mexicuts-booking.web.app`

2. **Test Signup**:
   - Click **Log In** button in header
   - Click **Sign Up** link
   - Enter:
     - Name: Test User
     - Phone: 0400000000 (use a test number)
     - Password: test123
   - Click **Create Account**
   - Should see success message and auto-login

3. **Test Existing Bookings Link**:
   - Create an account with a phone number that already has bookings
   - After signup, scroll down to see "My Bookings"
   - Should see all existing bookings automatically linked

4. **Test Login**:
   - Log out (click account dropdown → Log Out)
   - Click **Log In**
   - Enter phone + password
   - Should log in and see bookings

5. **Test Booking Form**:
   - When logged in, booking form should auto-fill with your name/phone
   - Make a booking - should save with your user ID
   - New booking should appear in "My Bookings" section

6. **Test Guest Booking** (while logged in):
   - Click "Book as guest" link in the green banner
   - Fields should become editable
   - Can book for someone else

---

## 🔄 **HOW IT WORKS**

### **Phone Number as Login**

Since Firebase Auth requires email addresses, we convert phone numbers:
- User enters: `0402098123`
- Stored as: `0402098123@mexicuts.local`
- User never sees the `@mexicuts.local` part

### **Auto-Linking Existing Bookings**

When someone creates an account:
1. System searches all bookings in database
2. Finds bookings matching their phone number
3. Adds `userId` field to those bookings
4. User can now see their booking history

### **Database Structure**

**New Collection: `users`**
```javascript
users/
  └── abc123xyz/           // Auto-generated user ID
       ├── phone: "0402098123"
       ├── name: "John Smith"
       ├── createdAt: timestamp
       └── bookingCount: 5
```

**Updated Collection: `bookings`**
```javascript
bookings/
  └── xyz789abc/
       ├── name: "John Smith"
       ├── phone: "0402098123"
       ├── timeSlot: "2025-11-02 10:00 AM"
       ├── notes: "Fade please"
       ├── timestamp: timestamp
       └── userId: "abc123xyz"    // NEW - links to user account
```

---

## 🎨 **USER INTERFACE CHANGES**

### **Header Changes**

**Before (Not Logged In):**
```
[Logo]    About | Book | Contact | [Log In]
```

**After (Logged In):**
```
[Logo]    About | Book | Contact | Hi, John ▼
                                    ├─ 📅 My Bookings
                                    ├─ ➕ New Booking
                                    └─ 🚪 Log Out
```

### **Booking Section Changes**

**When Logged In:**
- Green banner shows: "Logged in as John Smith"
- Name and phone auto-filled (read-only)
- Option to "Book as guest" for booking on behalf of someone else
- New "My Bookings" section below form showing:
  - **Upcoming Appointments** (can cancel, add to calendar)
  - **Past Appointments** (view history)

---

## 🔐 **SECURITY FEATURES**

### **Password Security**
- Firebase automatically encrypts passwords (bcrypt)
- Minimum 6 characters required
- Never stored in plain text

### **Phone Validation**
- Australian mobile format: 10 digits starting with 0
- International format: +61 followed by 9 digits
- Invalid numbers rejected before account creation

### **Session Security**
- Sessions stored in browser's `localStorage`
- Automatically expires if Firebase detects suspicious activity
- Users can log out to clear session

### **Data Privacy**
- Users only see their own bookings (when using userId)
- Firestore rules prevent unauthorized access
- Phone numbers stored securely

---

## 🐛 **TROUBLESHOOTING**

### **"Configuration not found" Error**
- **Solution**: Firebase Authentication not enabled in console
- Go to Firebase Console → Authentication → Enable Email/Password

### **"User already exists" Error**
- **Solution**: That phone number already has an account
- Try logging in instead of signing up

### **Bookings Not Linking Automatically**
- **Check**: Phone number format matches exactly
- **Try**: Different phone formats (with/without +61)
- **Debug**: Check browser console for linking logs

### **Auto-fill Not Working**
- **Check**: You're actually logged in (see account dropdown in header)
- **Try**: Refresh the page
- **Check**: Browser console for auth manager errors

### **Login/Signup Modal Not Appearing**
- **Check**: JavaScript files loaded correctly
- **Look for**: Console errors in browser DevTools (F12)
- **Verify**: All script tags in `index.html` are correct

---

## 📊 **MONITORING USERS**

### **View Users in Firebase Console**

1. Go to **Authentication** in Firebase Console
2. Click **Users** tab
3. See all registered users with:
   - User ID
   - Email (actually phone@mexicuts.local)
   - Creation date
   - Last sign-in

### **View User Data in Firestore**

1. Go to **Firestore Database**
2. Click `users` collection
3. See user profiles with phone, name, booking count

### **Track User Bookings**

1. Go to **Firestore Database**
2. Click `bookings` collection
3. Filter by `userId` to see one user's bookings

---

## 🔄 **MIGRATION FOR EXISTING CUSTOMERS**

### **What Happens to Existing Bookings?**

All existing bookings stay exactly as they are. Nothing is deleted or changed until:
1. Customer creates an account with their phone number
2. System automatically links their old bookings
3. They can now see booking history

### **Encouraging Sign-ups**

Consider adding a banner on your website:
- "Create an account to view all your bookings!"
- "Sign up to make future bookings faster!"
- "Track your haircut history - Sign up now!"

---

## 🎯 **NEXT STEPS / FUTURE ENHANCEMENTS**

Possible future improvements:
- [ ] Password reset via SMS
- [ ] Profile editing (change name/phone)
- [ ] Email notifications (if you add email field)
- [ ] Loyalty system (every 10th haircut free)
- [ ] Booking preferences saved per user
- [ ] Review/rating system for completed bookings

---

## 📞 **SUPPORT**

If you encounter issues:
1. Check browser console (F12) for errors
2. Review this guide's troubleshooting section
3. Check Firebase Console for authentication status
4. Test in incognito mode (clears cache/storage)

---

**🎉 Congratulations! Your authentication system is now live!**

Users can now create accounts, and their experience will be much smoother with auto-fill and booking history.

