console.log('🔐 admin-auth.js loaded');

function adminPhoneToEmail(phone) {
  const cleaned = String(phone || '').replace(/\D/g, '');
  return `${cleaned}@mexicuts.local`;
}

async function ensureAdminClaim(user) {
  try {
    const idToken = await user.getIdToken(true);
    const response = await fetch('https://us-central1-mexicuts-booking.cloudfunctions.net/promoteSelfToAdmin', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ idToken })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success || !data.isAdmin) {
      throw new Error(data.message || 'Not authorized as admin');
    }

    // Refresh token so admin claim is included
    await user.getIdToken(true);
    return true;
  } catch (error) {
    console.error('❌ Failed to ensure admin claim:', error);
    return false;
  }
}

async function initializeAdminAuth() {
  try {
    // Make sure Firebase app is initialized
    const config = await window.firebaseConfigManager.loadConfig();
    if (!firebase.apps || firebase.apps.length === 0) {
      firebase.initializeApp(config);
    }
  } catch (e) {
    console.error('❌ Failed to initialize Firebase for admin auth:', e);
    return;
  }

  const auth = firebase.auth();
  const overlay = document.getElementById('adminLoginOverlay');
  const form = document.getElementById('adminLoginForm');
  const errorBox = document.getElementById('adminLoginError');

  function showError(message) {
    if (!errorBox) return;
    errorBox.textContent = message;
    errorBox.style.display = 'block';
  }

  function clearError() {
    if (!errorBox) return;
    errorBox.textContent = '';
    errorBox.style.display = 'none';
  }

  async function finishIfAdmin(user) {
    if (!user) return;
    try {
      const result = await user.getIdTokenResult(true);
      if (result.claims && result.claims.admin) {
        console.log('✅ Admin claim present for user:', user.uid);
        window.isAdmin = true;
        if (overlay) overlay.style.display = 'none';
        if (typeof window.__deferredAdminStart === 'function') {
          window.__deferredAdminStart();
        }
      }
    } catch (e) {
      console.error('Error checking admin claim:', e);
    }
  }

  // React to auth state
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      console.log('Admin auth: no user signed in yet');
      if (overlay) overlay.style.display = 'flex';
      return;
    }
    console.log('Admin auth: user signed in, checking claims...');
    await finishIfAdmin(user);
  });

  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearError();

      const phoneInput = document.getElementById('adminPhone');
      const passwordInput = document.getElementById('adminPassword');
      const phone = phoneInput ? phoneInput.value.trim() : '';
      const password = passwordInput ? passwordInput.value : '';

      if (!phone || !password) {
        showError('Please enter phone and password.');
        return;
      }

      try {
        const email = adminPhoneToEmail(phone);
        const cred = await auth.signInWithEmailAndPassword(email, password);
        const user = cred.user;
        console.log('✅ Admin login attempt user:', user.uid);

        const ok = await ensureAdminClaim(user);
        if (!ok) {
          showError('This account is not authorized for admin access.');
          await auth.signOut();
          return;
        }

        await finishIfAdmin(user);
      } catch (err) {
        console.error('Admin login error:', err);
        showError('Login failed. Check phone and password.');
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initializeAdminAuth().catch((e) => console.error('Admin auth init error:', e));
});

