// Authentication System for Mexi Cuts
// Uses phone number + password for login
// Phone numbers are converted to email format for Firebase Auth

console.log('🔐 Auth.js loaded');

// Auth Manager Class
class AuthManager {
  constructor(db) {
    this.db = db;
    this.currentUser = null;
    this.auth = firebase.auth();
    
    // Set persistence to LOCAL (stays logged in forever)
    this.auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
    
    // Listen for auth state changes
    this.auth.onAuthStateChanged((user) => {
      this.handleAuthStateChange(user);
    });
  }

  // Convert phone number to email format for Firebase Auth
  // Example: "0402098123" becomes "0402098123@mexicuts.local"
  phoneToEmail(phone) {
    // Clean phone number (remove spaces, dashes, etc)
    const cleanPhone = phone.replace(/\D/g, '');
    return `${cleanPhone}@mexicuts.local`;
  }

  // Extract phone number from email format
  emailToPhone(email) {
    return email.replace('@mexicuts.local', '');
  }

  // Validate Australian phone number
  validatePhone(phone) {
    const cleaned = phone.replace(/\D/g, '');
    
    // Australian mobile: 10 digits starting with 0, or 11 digits starting with 61
    if (cleaned.startsWith('0') && cleaned.length === 10) {
      return { valid: true, formatted: cleaned };
    }
    
    if (cleaned.startsWith('61') && cleaned.length === 11) {
      return { valid: true, formatted: '0' + cleaned.substring(2) };
    }
    
    return { valid: false, message: 'Please enter a valid Australian phone number (10 digits)' };
  }

  // Handle authentication state changes
  async handleAuthStateChange(user) {
    if (user) {
      // User is logged in
      const phone = this.emailToPhone(user.email);
      
      // Load user profile from Firestore
      try {
        const userDoc = await this.db.collection('users').doc(user.uid).get();
        if (userDoc.exists) {
          this.currentUser = {
            uid: user.uid,
            phone: phone,
            ...userDoc.data()
          };
          
          console.log('✅ User logged in:', this.currentUser);
          this.updateUI(true);
          
          // Load user's bookings
          if (window.loadUserBookings) {
            window.loadUserBookings(this.currentUser);
          }
        }
      } catch (error) {
        console.error('Error loading user profile:', error);
      }
    } else {
      // User is logged out
      this.currentUser = null;
      console.log('👤 User logged out');
      this.updateUI(false);
    }
  }

  // Sign up new user
  async signUp(phone, password, name) {
    try {
      // Validate phone number
      const phoneValidation = this.validatePhone(phone);
      if (!phoneValidation.valid) {
        throw new Error(phoneValidation.message);
      }
      
      const formattedPhone = phoneValidation.formatted;
      const email = this.phoneToEmail(formattedPhone);
      
      // Create Firebase Auth account
      const userCredential = await this.auth.createUserWithEmailAndPassword(email, password);
      const user = userCredential.user;
      
      console.log('✅ Firebase account created:', user.uid);
      
      // Create user profile in Firestore
      await this.db.collection('users').doc(user.uid).set({
        phone: formattedPhone,
        name: name,
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
        bookingCount: 0
      });
      
      console.log('✅ User profile created in Firestore');
      
      // Link existing bookings to this user
      await this.linkExistingBookings(user.uid, formattedPhone);
      
      return { success: true, user: user };
    } catch (error) {
      console.error('❌ Signup error:', error);
      
      // User-friendly error messages
      let message = error.message;
      if (error.code === 'auth/email-already-in-use') {
        message = 'This phone number already has an account. Please log in instead.';
      } else if (error.code === 'auth/weak-password') {
        message = 'Password should be at least 6 characters long.';
      }
      
      return { success: false, error: message };
    }
  }

  // Log in existing user
  async login(phone, password) {
    try {
      // Validate phone number
      const phoneValidation = this.validatePhone(phone);
      if (!phoneValidation.valid) {
        throw new Error(phoneValidation.message);
      }
      
      const formattedPhone = phoneValidation.formatted;
      const email = this.phoneToEmail(formattedPhone);
      
      // Sign in with Firebase Auth
      const userCredential = await this.auth.signInWithEmailAndPassword(email, password);
      const user = userCredential.user;
      
      console.log('✅ User logged in:', user.uid);
      
      return { success: true, user: user };
    } catch (error) {
      console.error('❌ Login error:', error);
      
      // User-friendly error messages
      let message = error.message;
      if (error.code === 'auth/user-not-found') {
        message = 'No account found with this phone number. Please sign up first.';
      } else if (error.code === 'auth/wrong-password') {
        message = 'Incorrect password. Please try again.';
      }
      
      return { success: false, error: message };
    }
  }

  // Log out user
  async logout() {
    try {
      await this.auth.signOut();
      console.log('✅ User logged out');
      
      // Clear user bookings
      const userBookingsSection = document.getElementById('userBookingsSection');
      if (userBookingsSection) {
        userBookingsSection.style.display = 'none';
      }
      
      return { success: true };
    } catch (error) {
      console.error('❌ Logout error:', error);
      return { success: false, error: error.message };
    }
  }

  // Link existing bookings to user account
  async linkExistingBookings(userId, phone) {
    try {
      console.log(`🔗 Linking existing bookings for phone: ${phone}`);
      
      // Format phone in both possible formats
      const phoneFormats = [
        phone,
        formatPhoneNumber(phone), // International format
      ];
      
      // Get all bookings
      const allBookings = await this.db.collection('bookings').get();
      
      let linkedCount = 0;
      const batch = this.db.batch();
      
      allBookings.forEach(doc => {
        const booking = doc.data();
        
        // Check if this booking matches the user's phone number
        if (phoneFormats.includes(booking.phone) || phoneFormats.includes(formatPhoneNumber(booking.phone))) {
          // Link this booking to the user
          batch.update(doc.ref, {
            userId: userId,
            linkedAt: firebase.firestore.FieldValue.serverTimestamp()
          });
          linkedCount++;
        }
      });
      
      // Commit all updates at once
      if (linkedCount > 0) {
        await batch.commit();
        console.log(`✅ Linked ${linkedCount} existing bookings to user account`);
        
        // Update user's booking count
        await this.db.collection('users').doc(userId).update({
          bookingCount: linkedCount
        });
      } else {
        console.log('ℹ️ No existing bookings found for this phone number');
      }
      
      return linkedCount;
    } catch (error) {
      console.error('❌ Error linking existing bookings:', error);
      return 0;
    }
  }

  // Update UI based on login state
  updateUI(isLoggedIn) {
    const loginBtn = document.getElementById('loginBtn');
    const signupBtn = document.getElementById('signupBtn');
    const userAccountDropdown = document.getElementById('userAccountDropdown');
    const bookingFormFields = document.getElementById('bookingFormFields');
    const guestBookingToggle = document.getElementById('guestBookingToggle');
    
    if (isLoggedIn && this.currentUser) {
      // Hide login and signup buttons
      if (loginBtn) loginBtn.style.display = 'none';
      if (signupBtn) signupBtn.style.display = 'none';
      
      // Show user dropdown
      if (userAccountDropdown) {
        userAccountDropdown.style.display = 'block';
        const userNameDisplay = document.getElementById('userNameDisplay');
        if (userNameDisplay) {
          userNameDisplay.textContent = this.currentUser.name || 'Account';
        }
      }
      
      // Auto-fill booking form
      this.autoFillBookingForm();
      
      // Update auth UI in other modules
      if (window.updateAuthUI) {
        window.updateAuthUI(this.currentUser);
      }
      
      // Show "or book as guest" option
      if (guestBookingToggle) {
        guestBookingToggle.style.display = 'block';
      }
    } else {
      // Show login and signup buttons
      if (loginBtn) loginBtn.style.display = 'inline';
      if (signupBtn) signupBtn.style.display = 'inline';
      
      // Hide user dropdown
      if (userAccountDropdown) userAccountDropdown.style.display = 'none';
      
      // Clear any auto-filled data
      const nameInput = document.querySelector('input[placeholder="Full Name"]');
      const phoneInput = document.querySelector('input[placeholder="Phone Number"]');
      if (nameInput) nameInput.value = '';
      if (phoneInput) phoneInput.value = '';
      
      // Update auth UI in other modules
      if (window.updateAuthUI) {
        window.updateAuthUI(null);
      }
      
      // Hide guest booking toggle
      if (guestBookingToggle) {
        guestBookingToggle.style.display = 'none';
      }
    }
  }

  // Auto-fill booking form with user data
  autoFillBookingForm() {
    if (!this.currentUser) return;
    
    const nameInput = document.querySelector('input[placeholder="Full Name"]');
    const phoneInput = document.querySelector('input[placeholder="Phone Number"]');
    
    if (nameInput) {
      nameInput.value = this.currentUser.name || '';
      nameInput.readOnly = true;
      nameInput.style.backgroundColor = '#f0f0f0';
      nameInput.style.cursor = 'not-allowed';
    }
    
    if (phoneInput) {
      phoneInput.value = this.currentUser.phone || '';
      phoneInput.readOnly = true;
      phoneInput.style.backgroundColor = '#f0f0f0';
      phoneInput.style.cursor = 'not-allowed';
    }
  }

  // Enable guest booking (make fields editable again)
  enableGuestBooking() {
    const nameInput = document.querySelector('input[placeholder="Full Name"]');
    const phoneInput = document.querySelector('input[placeholder="Phone Number"]');
    
    if (nameInput) {
      nameInput.value = '';
      nameInput.readOnly = false;
      nameInput.style.backgroundColor = '';
      nameInput.style.cursor = '';
    }
    
    if (phoneInput) {
      phoneInput.value = '';
      phoneInput.readOnly = false;
      phoneInput.style.backgroundColor = '';
      phoneInput.style.cursor = '';
    }
  }

  // Get current user
  getCurrentUser() {
    return this.currentUser;
  }

  // Check if user is logged in
  isLoggedIn() {
    return this.currentUser !== null;
  }
}

// Helper function to format phone numbers (reuse from booking.js)
function formatPhoneNumber(phone) {
  const cleaned = phone.replace(/\D/g, '');
  
  if (cleaned.startsWith('0') && cleaned.length === 10) {
    return '+61' + cleaned.substring(1);
  }
  
  if (cleaned.startsWith('61') && cleaned.length === 11) {
    return '+' + cleaned;
  }
  
  if (cleaned.length === 10) {
    return '+61' + cleaned.substring(1);
  }
  
  return phone;
}

// Export for use in other files
window.AuthManager = AuthManager;

