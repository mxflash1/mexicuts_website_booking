// Authentication UI Handlers
// Manages login/signup modals and UI interactions

console.log('🎨 Auth-UI.js loaded');

// Global auth manager instance (will be initialized after Firebase loads)
let guestBookingMode = false;

// Wait for authManager to be available
function waitForAuthManager() {
  return new Promise((resolve) => {
    if (window.authManager) {
      resolve(window.authManager);
    } else {
      const checkInterval = setInterval(() => {
        if (window.authManager) {
          clearInterval(checkInterval);
          resolve(window.authManager);
        }
      }, 100);
    }
  });
}

// Open authentication modal
function openAuthModal(mode = 'login') {
  const modal = document.getElementById('authModal');
  if (!modal) return;
  
  if (mode === 'signup') {
    switchToSignup();
  } else {
    switchToLogin();
  }
  
  modal.style.display = 'flex';
}

// Close authentication modal
function closeAuthModal() {
  const modal = document.getElementById('authModal');
  if (modal) {
    modal.style.display = 'none';
    
    // Clear forms
    document.getElementById('loginPhone').value = '';
    document.getElementById('loginPassword').value = '';
    document.getElementById('signupName').value = '';
    document.getElementById('signupPhone').value = '';
    document.getElementById('signupPassword').value = '';
    
    // Hide error messages
    hideError('loginError');
    hideError('signupError');
    document.getElementById('signupSuccess').style.display = 'none';
  }
}

// Switch to login form
function switchToLogin() {
  document.getElementById('loginForm').style.display = 'block';
  document.getElementById('signupForm').style.display = 'none';
  hideError('loginError');
  hideError('signupError');
  document.getElementById('signupSuccess').style.display = 'none';
}

// Switch to signup form
function switchToSignup() {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('signupForm').style.display = 'block';
  hideError('loginError');
  hideError('signupError');
  document.getElementById('signupSuccess').style.display = 'none';
}

// Handle login form submission
async function handleLogin(event) {
  event.preventDefault();
  
  const authManager = await waitForAuthManager();
  
  const phone = document.getElementById('loginPhone').value.trim();
  const password = document.getElementById('loginPassword').value;
  
  // Show loading state
  const submitBtn = event.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = '⏳ Logging in...';
  submitBtn.disabled = true;
  
  hideError('loginError');
  
  try {
    const result = await authManager.login(phone, password);
    
    if (result.success) {
      console.log('✅ Login successful');
      
      // Close modal
      closeAuthModal();
      
      // Show success popup
      showPopup('✅ Welcome back!');
      
      // Scroll to bookings
      setTimeout(() => {
        document.querySelector('#booking').scrollIntoView({ behavior: 'smooth' });
      }, 500);
    } else {
      showError('loginError', result.error);
    }
  } catch (error) {
    console.error('Login error:', error);
    showError('loginError', 'An unexpected error occurred. Please try again.');
  } finally {
    // Reset button
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
  }
}

// Handle signup form submission
async function handleSignup(event) {
  event.preventDefault();
  
  const authManager = await waitForAuthManager();
  
  const name = document.getElementById('signupName').value.trim();
  const phone = document.getElementById('signupPhone').value.trim();
  const password = document.getElementById('signupPassword').value;
  
  // Show loading state
  const submitBtn = event.target.querySelector('button[type="submit"]');
  const originalText = submitBtn.textContent;
  submitBtn.textContent = '⏳ Creating account...';
  submitBtn.disabled = true;
  
  hideError('signupError');
  document.getElementById('signupSuccess').style.display = 'none';
  
  try {
    const result = await authManager.signUp(phone, password, name);
    
    if (result.success) {
      console.log('✅ Signup successful');
      
      // Show success message
      const successDiv = document.getElementById('signupSuccess');
      successDiv.textContent = '✅ Account created! Linking your existing bookings...';
      successDiv.style.display = 'block';
      
      // Wait a moment then close modal
      setTimeout(() => {
        closeAuthModal();
        
        // Show welcome popup
        showPopup('🎉 Welcome to Mexi Cuts!');
        
        // Scroll to bookings
        setTimeout(() => {
          document.querySelector('#booking').scrollIntoView({ behavior: 'smooth' });
        }, 500);
      }, 2000);
    } else {
      showError('signupError', result.error);
    }
  } catch (error) {
    console.error('Signup error:', error);
    showError('signupError', 'An unexpected error occurred. Please try again.');
  } finally {
    // Reset button
    submitBtn.textContent = originalText;
    submitBtn.disabled = false;
  }
}

// Handle logout
async function logout() {
  const authManager = await waitForAuthManager();
  
  const result = await authManager.logout();
  
  if (result.success) {
    console.log('✅ Logged out successfully');
    showPopup('👋 Logged out successfully');
    
    // Reset guest booking mode
    guestBookingMode = false;
    
    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    alert('Error logging out. Please try again.');
  }
}

// Toggle account menu dropdown
function toggleAccountMenu() {
  const menu = document.getElementById('accountMenu');
  if (menu) {
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
  }
}

// Close account menu when clicking outside
document.addEventListener('click', function(event) {
  const dropdown = document.getElementById('userAccountDropdown');
  const menu = document.getElementById('accountMenu');
  
  if (dropdown && menu && !dropdown.contains(event.target)) {
    menu.style.display = 'none';
  }
});

// Scroll to bookings section
function scrollToBookings() {
  const bookingsSection = document.getElementById('userBookingsSection');
  if (bookingsSection && bookingsSection.style.display !== 'none') {
    bookingsSection.scrollIntoView({ behavior: 'smooth' });
  } else {
    document.querySelector('#booking').scrollIntoView({ behavior: 'smooth' });
  }
}

// Enable guest booking mode (for logged-in users who want to book for someone else)
async function enableGuestBookingMode() {
  guestBookingMode = true;
  
  const authManager = await waitForAuthManager();
  authManager.enableGuestBooking();
  
  // Hide logged-in banner
  const banner = document.getElementById('loggedInBanner');
  if (banner) {
    banner.style.display = 'none';
  }
  
  // Show info message
  showPopup('📝 Booking as guest - enter details below');
}

// Show error message
function showError(elementId, message) {
  const errorDiv = document.getElementById(elementId);
  if (errorDiv) {
    errorDiv.textContent = message;
    errorDiv.style.display = 'block';
  }
}

// Hide error message
function hideError(elementId) {
  const errorDiv = document.getElementById(elementId);
  if (errorDiv) {
    errorDiv.style.display = 'none';
  }
}

// Update UI after auth state changes
function updateAuthUI(user) {
  if (user && !guestBookingMode) {
    // Show logged-in banner
    const banner = document.getElementById('loggedInBanner');
    const userName = document.getElementById('loggedInUserName');
    if (banner && userName) {
      userName.textContent = user.name || 'there';
      banner.style.display = 'block';
    }
  } else {
    // Hide logged-in banner
    const banner = document.getElementById('loggedInBanner');
    if (banner) {
      banner.style.display = 'none';
    }
  }
}

// Close modal when clicking outside
document.addEventListener('click', function(event) {
  const modal = document.getElementById('authModal');
  if (event.target === modal) {
    closeAuthModal();
  }
});

// Show welcome popup for first-time users
function showWelcomePopup() {
  // Check if user has seen welcome popup before
  if (localStorage.getItem('mexicuts_seen_welcome')) {
    return;
  }
  
  // Wait a moment for page to load
  setTimeout(() => {
    const popup = document.getElementById('welcomePopup');
    if (popup) {
      popup.style.display = 'flex';
    }
  }, 2000); // Show after 2 seconds
}

// Close welcome popup
function closeWelcomePopup() {
  const popup = document.getElementById('welcomePopup');
  if (popup) {
    popup.style.display = 'none';
  }
  // Remember that user has seen it
  localStorage.setItem('mexicuts_seen_welcome', 'true');
}

// Close welcome and open signup
function closeWelcomeAndSignup() {
  closeWelcomePopup();
  openAuthModal('signup');
}

// Check if should show welcome popup on page load
document.addEventListener('DOMContentLoaded', () => {
  // Only show if not logged in
  setTimeout(() => {
    if (window.authManager && !window.authManager.isLoggedIn()) {
      showWelcomePopup();
    }
  }, 1000);
});

// Export functions for global use
window.openAuthModal = openAuthModal;
window.closeAuthModal = closeAuthModal;
window.switchToLogin = switchToLogin;
window.switchToSignup = switchToSignup;
window.handleLogin = handleLogin;
window.handleSignup = handleSignup;
window.logout = logout;
window.toggleAccountMenu = toggleAccountMenu;
window.scrollToBookings = scrollToBookings;
window.enableGuestBookingMode = enableGuestBookingMode;
window.updateAuthUI = updateAuthUI;
window.closeWelcomePopup = closeWelcomePopup;
window.closeWelcomeAndSignup = closeWelcomeAndSignup;

