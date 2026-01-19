# 🧪 Testing the Leaderboard Frequency System

## ✅ What's Been Fixed

1. **Manual Booking Feature** - Now works correctly in admin panel
2. **User Account Linking** - Automatically links bookings to existing user accounts by phone number
3. **Future Booking Support** - System now includes future bookings for testing purposes
4. **Frequency Calculation** - Works with any bookings from Feb 14, 2026 onwards

---

## 📋 How to Test the Leaderboard

### Step 1: Access the Admin Panel

Visit: `https://mexicuts-booking.web.app/admin_mxcts2009.html`

---

### Step 2: Create Test Users (if needed)

If you don't have user accounts yet:

1. Go to the main website: `https://mexicuts-booking.web.app`
2. Click **"Sign Up"** in the header
3. Create a few test accounts with different phone numbers:
   - Example: "Test User 1" with phone "0400000001"
   - Example: "Test User 2" with phone "0400000002"
   - Example: "Test User 3" with phone "0400000003"

---

### Step 3: Add Manual Bookings

In the admin panel:

1. Click **"➕ Add Manual Booking"** button (top of calendar)
2. Fill in the form:
   - **Customer Name:** Use the same name as a registered user
   - **Phone Number:** Use the phone number of an existing user account
   - **Date:** Pick any date from Feb 14, 2026 onwards
   - **Time:** Select a time slot
   - **Notes:** Optional
3. Click **"✅ Create"**
4. You'll see a success message indicating if it was linked to a user account

**Example Test Scenario:**

For "Test User 1" (phone: 0400000001), create bookings:
- Feb 20, 2026 at 10:00 AM
- Feb 27, 2026 at 10:00 AM (1 week later)
- Mar 6, 2026 at 10:00 AM (1 week later)
- **Average frequency: 1 week**

For "Test User 2" (phone: 0400000002), create bookings:
- Feb 15, 2026 at 2:00 PM
- Mar 1, 2026 at 2:00 PM (2 weeks later)
- Mar 15, 2026 at 2:00 PM (2 weeks later)
- **Average frequency: 2 weeks**

For "Test User 3" (phone: 0400000003), create bookings:
- Feb 16, 2026 at 11:00 AM
- Mar 16, 2026 at 11:00 AM (4 weeks later)
- **Average frequency: 4 weeks**

---

### Step 4: Update Frequency Stats

After adding bookings, trigger the stats calculation:

**Option A: Visit the URL**
```
https://updatefrequencystatsnow-tktzr4t4nq-uc.a.run.app
```

**Option B: Use curl**
```bash
curl "https://updatefrequencystatsnow-tktzr4t4nq-uc.a.run.app"
```

You should see output like:
```
✅ Updated 3 users:

Test User 1: 3 bookings, avg 1.0 weeks
Test User 2: 3 bookings, avg 2.0 weeks
Test User 3: 2 bookings, avg 4.0 weeks
```

---

### Step 5: Check the Leaderboard

1. Go to the main website: `https://mexicuts-booking.web.app`
2. Scroll down to the **"🏆 Most Loyal Customers"** section
3. You should see your test users ranked by frequency:
   - 🥇 Test User 1 (1 week average) - Most frequent
   - 🥈 Test User 2 (2 weeks average)
   - 🥉 Test User 3 (4 weeks average)

---

## 🔍 What the System Checks

When you add a manual booking:

1. **Phone Number Match:** System searches for existing users with that phone number
2. **Automatic Linking:** If found, adds `userId` to the booking
3. **Guest Booking:** If no user found, creates booking without `userId` (won't appear on leaderboard)
4. **Confirmation Message:** Shows whether booking was linked to an account

---

## 📊 Leaderboard Requirements

For a user to appear on the leaderboard:

✅ Must have a registered account (not guest bookings)  
✅ Must have at least **2 bookings** since Feb 14, 2026  
✅ Bookings must be linked to their account (via `userId`)  
✅ Must have valid frequency calculation

---

## 🎯 Testing Different Scenarios

### Scenario 1: Very Frequent Customer (Weekly)
```
Bookings every 7 days:
- Feb 14, 2026
- Feb 21, 2026
- Feb 28, 2026
- Mar 7, 2026
Average: 1 week → Rank #1
```

### Scenario 2: Regular Customer (Bi-weekly)
```
Bookings every 14 days:
- Feb 14, 2026
- Feb 28, 2026
- Mar 14, 2026
Average: 2 weeks → Rank #2
```

### Scenario 3: Monthly Customer
```
Bookings every 4 weeks:
- Feb 14, 2026
- Mar 14, 2026
- Apr 11, 2026
Average: 4 weeks → Rank #3
```

---

## 🐛 Troubleshooting

### Booking Not Linked to User Account

**Problem:** Success message says "Guest booking" instead of "Linked to user account"

**Solution:**
- Check that the phone number **exactly matches** the user's account phone
- Phone format should match (e.g., "0402098123")
- User must have a registered account first

### User Not Appearing on Leaderboard

**Problem:** User has bookings but doesn't show on leaderboard

**Checklist:**
1. ✅ User has registered account?
2. ✅ Bookings have `userId` field?
3. ✅ At least 2 bookings since Feb 14, 2026?
4. ✅ Ran the frequency stats update?
5. ✅ Refreshed the website?

### Stats Not Updating

**Problem:** Frequency stats show old data

**Solution:**
1. Run the manual update endpoint
2. Wait 5-10 seconds for function to complete
3. Hard refresh the website (Cmd+Shift+R or Ctrl+Shift+R)

---

## 🔄 Automatic Updates

After testing, the system will:
- **Update automatically** every day at 3:00 AM Brisbane time
- **Include new bookings** in calculations
- **Update rankings** based on latest frequency data

---

## 📝 Important Notes

### Future Bookings (For Testing)

✅ **Currently enabled:** Future bookings are included in frequency calculations  
📅 **Purpose:** Allows you to test the leaderboard before bookings are completed  
🔧 **Production:** In the future, you can change this to only count past bookings

The code comment in `functions/index.js` shows where to modify this:
```javascript
// For testing purposes: include FUTURE bookings in frequency calculation
// This allows testing the leaderboard before bookings are completed
// In production, you can change this to only count past bookings
completedBookingsAfterFeb14.push(bookingDate);
```

### Date Range

- Only bookings from **Feb 14, 2026 onwards** are counted
- Bookings before this date are ignored
- This ensures fair comparison for all users

---

## ✅ Success Criteria

Your testing is successful when:

1. ✅ Manual booking form works in admin panel
2. ✅ Bookings are linked to user accounts by phone number
3. ✅ Frequency stats update correctly
4. ✅ Leaderboard shows users ranked by frequency
5. ✅ Top 10 customers are displayed with medals
6. ✅ Average frequency is calculated correctly

---

## 🎉 Next Steps

After successful testing:

1. **Keep adding bookings** to see rankings change
2. **Monitor automatic updates** (daily at 3 AM)
3. **Share with customers** to encourage frequent visits
4. **Adjust settings** if needed (e.g., only count past bookings)

---

## 🔗 Quick Links

- **Main Website:** https://mexicuts-booking.web.app
- **Admin Panel:** https://mexicuts-booking.web.app/admin_mxcts2009.html
- **Manual Stats Update:** https://updatefrequencystatsnow-tktzr4t4nq-uc.a.run.app
- **Firebase Console:** https://console.firebase.google.com/project/mexicuts-booking

---

## 📞 Need Help?

If something isn't working:
1. Check the browser console for errors (F12)
2. Verify Firebase is initialized correctly
3. Ensure user accounts exist before adding bookings
4. Run the manual stats update endpoint
5. Hard refresh the website to clear cache

