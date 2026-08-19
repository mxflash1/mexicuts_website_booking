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

  // ── Name validation ────────────────────────────────────────────────────
  const NAME_MAX = 75;
  const NAME_REGEX = /^[a-zA-ZÀ-ÿ\s'\-.]+$/;
  if (!name) {
    showError('signupError', 'Name is required.');
    return;
  }
  if (name.length > NAME_MAX) {
    showError('signupError', `Name must be ${NAME_MAX} characters or fewer.`);
    return;
  }
  if (!NAME_REGEX.test(name)) {
    showError('signupError', 'Name can only contain letters, spaces, hyphens, apostrophes and periods.');
    return;
  }
  // ──────────────────────────────────────────────────────────────────────

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

// Handle account deletion
async function deleteAccount() {
  // Close dropdown first
  const menu = document.getElementById('accountMenu');
  if (menu) menu.style.display = 'none';

  // Show a custom confirmation modal instead of browser confirm
  const confirmed = await new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.id = 'deleteAccountOverlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.88);z-index:9999999;display:flex;align-items:center;justify-content:center;padding:15px;box-sizing:border-box;';
    overlay.innerHTML = `
      <div style="background:#1a1a1a;border:2px solid #CE1126;border-radius:12px;padding:28px;max-width:360px;width:100%;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,0.7);">
        <h3 style="color:#CE1126;margin:0 0 14px 0;font-size:clamp(16px,4.5vw,20px);">⚠️ Delete Account</h3>
        <p style="color:#ccc;font-size:clamp(13px,3.5vw,15px);line-height:1.5;margin-bottom:22px;font-family:'VT323',monospace;">
          This will permanently delete your account and cannot be undone.<br><br>
          Your past booking history will be kept for admin records.
        </p>
        <div style="display:flex;flex-direction:column;gap:10px;">
          <button id="confirmDeleteBtn" style="background:#CE1126;color:white;border:none;padding:14px;border-radius:8px;font-size:clamp(14px,3.5vw,16px);font-weight:bold;cursor:pointer;font-family:'VT323',monospace;">
            Yes, delete my account
          </button>
          <button id="cancelDeleteBtn" style="background:#333;color:#ccc;border:1px solid #555;padding:14px;border-radius:8px;font-size:clamp(14px,3.5vw,16px);font-weight:bold;cursor:pointer;font-family:'VT323',monospace;">
            Cancel
          </button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('confirmDeleteBtn').onclick = () => { overlay.remove(); resolve(true); };
    document.getElementById('cancelDeleteBtn').onclick  = () => { overlay.remove(); resolve(false); };
  });

  if (!confirmed) return;

  try {
    const authManager = await waitForAuthManager();
    const result = await authManager.deleteAccount();
    if (result.success) {
      showPopup('✅ Your account has been deleted.');
      setTimeout(() => window.location.reload(), 1500);
    } else {
      showPopup('❌ Could not delete account: ' + result.error);
    }
  } catch (err) {
    console.error('Delete account error:', err);
    showPopup('❌ Something went wrong. Please try again.');
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
window.deleteAccount = deleteAccount;
window.toggleAccountMenu = toggleAccountMenu;
window.scrollToBookings = scrollToBookings;
window.enableGuestBookingMode = enableGuestBookingMode;
window.updateAuthUI = updateAuthUI;
window.closeWelcomePopup = closeWelcomePopup;
window.closeWelcomeAndSignup = closeWelcomeAndSignup;

// Live name validation for the signup form (called via oninput on the input element)
function validateSignupName(input) {
  const NAME_MAX = 75;
  const NAME_REGEX = /^[a-zA-ZÀ-ÿ\s'\-.]+$/;
  const val = input.value.trim();
  let msg = '';
  if (val.length > NAME_MAX) {
    msg = `Name must be ${NAME_MAX} characters or fewer.`;
  } else if (val && !NAME_REGEX.test(val)) {
    msg = 'Name can only contain letters, spaces, hyphens, apostrophes and periods.';
  }
  // Show or clear inline error just below the input
  let errEl = document.getElementById('signupNameInlineError');
  if (msg) {
    if (!errEl) {
      errEl = document.createElement('div');
      errEl.id = 'signupNameInlineError';
      errEl.style.cssText = 'color:#f44336;font-size:13px;margin-top:4px;font-family:\'VT323\',monospace;';
      input.parentNode.appendChild(errEl);
    }
    errEl.textContent = msg;
  } else if (errEl) {
    errEl.remove();
  }
}
window.validateSignupName = validateSignupName;
