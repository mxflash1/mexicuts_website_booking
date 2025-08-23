# 🔒 Security Setup Guide

This guide explains how to securely configure Firebase credentials for the Mexi Cuts booking website.

## 🚨 Important Security Notice

**NEVER commit real Firebase API keys to version control!** This setup ensures your credentials are kept secure.

## 📁 File Structure

```
public/
├── firebase-config.js          # Configuration manager (safe to commit)
├── firebase-config.json        # Real credentials (NEVER commit)
├── firebase-config.json.example # Template (safe to commit)
└── firebase-env.js             # Generated for production (NEVER commit)
```

## 🔧 Development Setup

1. **Copy the example configuration:**
   ```bash
   cp public/firebase-config.json.example public/firebase-config.json
   ```

2. **Fill in your real Firebase credentials:**
   Edit `public/firebase-config.json` with your actual Firebase project details.

3. **Verify .gitignore:**
   Ensure these lines are in your `.gitignore`:
   ```
   firebase-config.json
   public/firebase-config.json
   public/firebase-env.js
   ```

## 🚀 Production Deployment

### Option 1: Using the Setup Script
```bash
node deploy-setup.js production
```

This will:
- Generate `firebase-env.js` with your configuration
- Update HTML files to load the environment script
- Prepare files for production deployment

### Option 2: Manual Environment Variables

For platforms like Vercel, Netlify, or Firebase Hosting:

1. **Set environment variables in your hosting platform:**
   ```
   FIREBASE_API_KEY=your-api-key
   FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
   FIREBASE_PROJECT_ID=your-project-id
   FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
   FIREBASE_MESSAGING_SENDER_ID=your-sender-id
   FIREBASE_APP_ID=your-app-id
   FIREBASE_MEASUREMENT_ID=your-measurement-id
   ```

2. **Create a build script** that generates the environment file:
   ```javascript
   // In your build process
   const config = {
     apiKey: process.env.FIREBASE_API_KEY,
     authDomain: process.env.FIREBASE_AUTH_DOMAIN,
     projectId: process.env.FIREBASE_PROJECT_ID,
     storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
     messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
     appId: process.env.FIREBASE_APP_ID,
     measurementId: process.env.FIREBASE_MEASUREMENT_ID
   };
   
   const envScript = `window.FIREBASE_CONFIG = ${JSON.stringify(config)};`;
   fs.writeFileSync('public/firebase-env.js', envScript);
   ```

## 🔍 How It Works

1. **firebase-config.js** - The configuration manager that:
   - Tries to load from environment variables first
   - Falls back to local config file for development
   - Shows user-friendly errors if configuration is missing

2. **Development** - Uses `firebase-config.json` (gitignored)
3. **Production** - Uses environment variables or generated `firebase-env.js`

## ✅ Security Checklist

- [ ] Real API keys are NOT in any committed files
- [ ] `.gitignore` includes config files
- [ ] Production uses environment variables
- [ ] Local development uses gitignored config file
- [ ] Error handling shows user-friendly messages

## 🆘 Troubleshooting

### "Configuration not found" error
- Check that `firebase-config.json` exists in development
- Verify environment variables are set in production
- Ensure `firebase-config.js` is loaded before other scripts

### Firebase initialization fails
- Verify all required configuration fields are present
- Check browser console for detailed error messages
- Ensure Firebase project is active and properly configured

## 🔄 Migration from Old Setup

If you're migrating from hardcoded credentials:

1. **Backup your current credentials** (save them somewhere safe)
2. **Remove hardcoded config** from JS files
3. **Follow the development setup** above
4. **Test locally** before deploying
5. **Set up production environment** variables
6. **Deploy and test** in production

## 📞 Support

If you encounter issues with this security setup, check:
1. Browser console for error messages
2. Network tab for failed requests
3. Firebase console for project status

The website will show clear error messages if configuration is missing or incorrect.
