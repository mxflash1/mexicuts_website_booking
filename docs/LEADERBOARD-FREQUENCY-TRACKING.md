# 🏆 Leaderboard Frequency Tracking System

## Overview

The leaderboard now tracks booking frequency for each user account starting from **February 14, 2026**. This system automatically calculates and stores frequency statistics in user profiles, which are then used to rank customers on the leaderboard.

---

## 📊 How It Works

### 1. **Automatic Daily Updates**
- A Cloud Function runs **every day at 3:00 AM Brisbane time**
- It calculates booking frequency stats for all users
- Stats are stored in each user's Firestore profile

### 2. **What Gets Tracked**
For each user, the system tracks:
- **Total bookings since Feb 14, 2026** (including future bookings)
- **Completed bookings since Feb 14, 2026** (past bookings only)
- **First booking date** (since Feb 14, 2026)
- **Last booking date** (since Feb 14, 2026)
- **Average weeks between bookings** (calculated from completed bookings)
- **Last updated timestamp**

### 3. **Leaderboard Display**
- Only users with **2+ completed bookings** since Feb 14, 2026 appear on the leaderboard
- Users are ranked by **average weeks between bookings** (lower is better)
- Shows top 10 most frequent customers
- Displays total visits and days since last visit

---

## 🗄️ Database Structure

### User Profile with Frequency Stats

```javascript
users/
  └── {userId}/
       ├── name: "John Smith"
       ├── phone: "0412345678"
       ├── createdAt: timestamp
       ├── bookingCount: 5
       └── frequencyStats: {
            bookingsSinceFeb14: 5,              // Total bookings (including future)
            completedBookingsSinceFeb14: 4,     // Only past bookings
            firstBookingDate: timestamp,         // First booking date
            lastBookingDate: timestamp,          // Most recent booking date
            averageWeeksBetween: 2.5,           // Average weeks between visits
            lastUpdated: timestamp               // When stats were last calculated
          }
```

---

## 🔧 Cloud Functions

### 1. **updateUserFrequencyStats** (Scheduled)
- **Schedule:** Daily at 3:00 AM Brisbane time
- **Purpose:** Automatically updates frequency stats for all users
- **Runs:** Automatically via Cloud Scheduler

### 2. **updateFrequencyStatsNow** (HTTP Endpoint)
- **URL:** `https://us-central1-mexicuts-booking.cloudfunctions.net/updateFrequencyStatsNow`
- **Purpose:** Manually trigger stats update (for testing/admin use)
- **Method:** GET
- **Returns:** Summary of updated users with their stats

---

## 🚀 Manual Update

To manually update frequency stats (useful for testing or after making changes):

```bash
curl "https://us-central1-mexicuts-booking.cloudfunctions.net/updateFrequencyStatsNow"
```

Or visit the URL in your browser:
```
https://us-central1-mexicuts-booking.cloudfunctions.net/updateFrequencyStatsNow
```

---

## 📅 Important Dates

- **Tracking Start Date:** February 14, 2026
- **Only bookings from this date onwards** are counted for leaderboard rankings
- Bookings before Feb 14, 2026 are **not included** in frequency calculations

---

## 🎯 Leaderboard Requirements

To appear on the leaderboard, a user must:
1. Have a registered account (not guest bookings)
2. Have at least **2 completed bookings** since Feb 14, 2026
3. Have a valid `averageWeeksBetween` calculation

---

## 🔄 How Stats Are Calculated

### Average Weeks Between Bookings

1. Get all completed bookings for the user (since Feb 14, 2026)
2. Sort bookings chronologically
3. Calculate time difference between consecutive bookings
4. Convert differences to weeks
5. Calculate average of all differences

**Example:**
- Booking 1: Feb 20, 2026
- Booking 2: Mar 6, 2026 (2 weeks later)
- Booking 3: Mar 20, 2026 (2 weeks later)
- **Average:** (2 + 2) / 2 = **2 weeks**

---

## 🎨 User Interface

### Leaderboard Display Shows:
- 🥇🥈🥉 Medal icons for top 3
- Customer name
- Total visits since Feb 14, 2026
- Days since last visit
- Average frequency (in days/weeks/months)
- Note that tracking started Feb 14, 2026

### Skeleton/Placeholder State:
- Shown when no users qualify for leaderboard yet
- Displays 10 empty spots
- Explains requirements and how the system works

---

## 🛠️ Maintenance

### Daily Automatic Updates
The system runs automatically every day at 3 AM. No manual intervention needed.

### Manual Updates
If you need to force an update (e.g., after testing or data changes):
1. Visit the manual update URL
2. Wait for the function to complete (may take 5-10 seconds)
3. Refresh the website to see updated leaderboard

### Monitoring
Check Firebase Functions logs to monitor:
- Daily scheduled updates
- Manual update requests
- Any errors in calculation

---

## 📝 Notes

- **Guest bookings** (without userId) are **not tracked** for the leaderboard
- Users must have accounts to appear on the leaderboard
- Future bookings are counted in total but **not used** for frequency calculation
- Stats update automatically, so the leaderboard stays current
- The Feb 14, 2026 cutoff ensures fair comparison for all users from a fresh start

---

## 🔗 Related Files

- **Cloud Functions:** `functions/index.js` (lines ~1115-1350)
- **Leaderboard Display:** `public/js/leaderboard.js`
- **Leaderboard Section:** `public/index.html` (line 89)
- **Firestore Rules:** `firestore.rules`

---

## ✅ Deployment Status

**Status:** ✅ Deployed and Active

**Deployed Functions:**
- `updateUserFrequencyStats` - Scheduled daily updates
- `updateFrequencyStatsNow` - Manual update endpoint

**Last Deployed:** January 17, 2026

**Test Results:**
- ✅ Functions deployed successfully
- ✅ Manual update endpoint working
- ✅ Stats calculation working correctly
- ✅ Leaderboard displaying correctly

---

## 🎉 Summary

The leaderboard frequency tracking system is now live! It will automatically track and rank your most loyal customers based on how frequently they book appointments. The system runs automatically every day, and you can manually trigger updates anytime using the provided endpoint.

Customers will be motivated to book more frequently to climb the leaderboard rankings! 🏆


