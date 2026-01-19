const admin = require('firebase-admin');
const serviceAccount = require('./credentials/mexicuts-backup-booking-cd0af90941d8.json');

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'mexicuts-booking'
});

const db = admin.firestore();

async function checkUsers() {
  console.log('🔍 Checking users in Firestore...\n');
  
  try {
    // Check users collection
    const usersSnapshot = await db.collection('users').get();
    
    if (usersSnapshot.empty) {
      console.log('❌ No users found in Firestore database!');
      console.log('This means user accounts were created in Firebase Auth but not saved to Firestore.\n');
    } else {
      console.log(`✅ Found ${usersSnapshot.size} user(s) in Firestore:\n`);
      
      usersSnapshot.forEach(doc => {
        const data = doc.data();
        console.log(`User ID: ${doc.id}`);
        console.log(`  Name: ${data.name || 'N/A'}`);
        console.log(`  Phone: ${data.phone || 'N/A'}`);
        console.log(`  Created: ${data.createdAt ? data.createdAt.toDate() : 'N/A'}`);
        console.log(`  Booking Count: ${data.bookingCount || 0}\n`);
      });
    }
    
    // Check Firebase Auth users
    console.log('🔍 Checking Firebase Authentication users...\n');
    const authUsers = await admin.auth().listUsers();
    
    if (authUsers.users.length === 0) {
      console.log('❌ No users in Firebase Authentication!\n');
    } else {
      console.log(`✅ Found ${authUsers.users.length} user(s) in Firebase Auth:\n`);
      
      authUsers.users.forEach(user => {
        console.log(`Auth User ID: ${user.uid}`);
        console.log(`  Email: ${user.email}`);
        console.log(`  Created: ${user.metadata.creationTime}\n`);
      });
    }
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  process.exit(0);
}

checkUsers();
