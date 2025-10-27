// Leaderboard System for Mexi Cuts
// Shows most frequent customers based on average weeks between haircuts

console.log('🏆 Leaderboard.js loaded');

// Calculate leaderboard data
async function calculateLeaderboard() {
  try {
    console.log('📊 Calculating leaderboard...');
    
    // Get all users
    const usersSnapshot = await db.collection('users').get();
    
    if (usersSnapshot.empty) {
      console.log('No users found');
      return [];
    }

    const leaderboardData = [];

    // For each user, calculate their average frequency
    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();

      // Get all PAST bookings for this user (completed haircuts only)
      const bookingsSnapshot = await db.collection('bookings')
        .where('userId', '==', userId)
        .get();

      if (bookingsSnapshot.empty || bookingsSnapshot.size < 2) {
        // Need at least 2 bookings to calculate frequency
        continue;
      }

      // Get booking dates and sort them
      const bookingDates = [];
      bookingsSnapshot.forEach(doc => {
        const booking = doc.data();
        if (booking.timeSlot) {
          const date = parseBookingDate(booking.timeSlot);
          // Only include past bookings (completed haircuts)
          if (date < new Date()) {
            bookingDates.push(date);
          }
        }
      });

      // Need at least 2 completed bookings
      if (bookingDates.length < 2) {
        continue;
      }

      // Sort dates chronologically (oldest first)
      bookingDates.sort((a, b) => a - b);

      // Calculate time differences between consecutive bookings
      const timeDifferences = [];
      for (let i = 1; i < bookingDates.length; i++) {
        const diffMs = bookingDates[i] - bookingDates[i - 1];
        const diffWeeks = diffMs / (1000 * 60 * 60 * 24 * 7); // Convert to weeks
        timeDifferences.push(diffWeeks);
      }

      // Calculate average weeks between haircuts
      const averageWeeks = timeDifferences.reduce((sum, weeks) => sum + weeks, 0) / timeDifferences.length;

      // Add to leaderboard
      leaderboardData.push({
        userId: userId,
        name: userData.name || 'Unknown',
        phone: userData.phone || '',
        totalVisits: bookingDates.length,
        averageWeeks: averageWeeks,
        lastVisit: bookingDates[bookingDates.length - 1]
      });
    }

    // Sort by average weeks (lower is better - more frequent)
    leaderboardData.sort((a, b) => a.averageWeeks - b.averageWeeks);

    console.log(`✅ Leaderboard calculated: ${leaderboardData.length} customers ranked`);
    return leaderboardData;

  } catch (error) {
    console.error('Error calculating leaderboard:', error);
    return [];
  }
}

// Parse booking timeSlot to Date object
function parseBookingDate(timeSlot) {
  try {
    // Format: "2025-08-23 05:30 PM"
    const [datePart, timePart, ampm] = timeSlot.split(' ');
    const [year, month, day] = datePart.split('-');
    const [hour, minute] = timePart.split(':');
    
    let hour24 = parseInt(hour);
    if (ampm === 'PM' && hour24 !== 12) {
      hour24 += 12;
    } else if (ampm === 'AM' && hour24 === 12) {
      hour24 = 0;
    }
    
    return new Date(year, month - 1, day, hour24, parseInt(minute));
  } catch (error) {
    console.error('Error parsing booking date:', timeSlot, error);
    return new Date(0);
  }
}

// Format weeks to readable string
function formatWeeks(weeks) {
  if (weeks < 1) {
    const days = Math.round(weeks * 7);
    return `${days} day${days !== 1 ? 's' : ''}`;
  } else if (weeks < 4) {
    return `${weeks.toFixed(1)} week${weeks >= 2 ? 's' : ''}`;
  } else {
    const months = weeks / 4.33; // Average weeks per month
    return `${months.toFixed(1)} month${months >= 2 ? 's' : ''}`;
  }
}

// Display skeleton/placeholder leaderboard
function displaySkeletonLeaderboard(container) {
  let html = `
    <div style="max-width: 800px; margin: 0 auto;">
      <h2 style="color: #CE1126; text-align: center; margin-bottom: 10px; font-size: 2rem;">🏆 Most Loyal Customers</h2>
      <p style="text-align: center; color: #ccc; margin-bottom: 30px; font-size: 0.9rem;">
        Ranked by how frequently they come in for haircuts
      </p>

      <div style="display: flex; flex-direction: column; gap: 15px;">
  `;

  // Create 10 placeholder entries
  const placeholders = [
    { rank: 1, medal: '🥇', borderColor: '#FFD700', bgColor: 'rgba(255, 215, 0, 0.1)' },
    { rank: 2, medal: '🥈', borderColor: '#C0C0C0', bgColor: 'rgba(192, 192, 192, 0.1)' },
    { rank: 3, medal: '🥉', borderColor: '#CD7F32', bgColor: 'rgba(205, 127, 50, 0.1)' },
    { rank: 4, medal: '#4', borderColor: '#555', bgColor: '#1a1a1a' },
    { rank: 5, medal: '#5', borderColor: '#555', bgColor: '#1a1a1a' },
    { rank: 6, medal: '#6', borderColor: '#555', bgColor: '#1a1a1a' },
    { rank: 7, medal: '#7', borderColor: '#555', bgColor: '#1a1a1a' },
    { rank: 8, medal: '#8', borderColor: '#555', bgColor: '#1a1a1a' },
    { rank: 9, medal: '#9', borderColor: '#555', bgColor: '#1a1a1a' },
    { rank: 10, medal: '#10', borderColor: '#555', bgColor: '#1a1a1a' }
  ];

  placeholders.forEach(({ rank, medal, borderColor, bgColor }) => {
    html += `
      <div style="
        background: ${bgColor};
        border: 2px solid ${borderColor};
        border-radius: 12px;
        padding: 20px;
        display: flex;
        align-items: center;
        gap: 20px;
        opacity: 0.5;
      ">
        
        <!-- Rank Badge -->
        <div style="
          font-size: 2rem;
          font-weight: bold;
          min-width: 60px;
          text-align: center;
          color: ${rank <= 3 ? borderColor : '#CE1126'};
        ">
          ${medal}
        </div>

        <!-- Placeholder Info -->
        <div style="flex: 1;">
          <div style="font-size: 1.2rem; font-weight: bold; color: #666; margin-bottom: 5px;">
            ${rank === 1 ? 'Be the first!' : 'Available spot'}
          </div>
          <div style="font-size: 0.85rem; color: #555;">
            ${rank === 1 ? 'Come in regularly to claim the top spot!' : 'Keep coming back to earn this position'}
          </div>
        </div>

        <!-- Frequency Placeholder -->
        <div style="
          text-align: center;
          padding: 15px 20px;
          background: rgba(0, 104, 71, 0.1);
          border: 2px solid #444;
          border-radius: 8px;
          min-width: 120px;
        ">
          <div style="font-size: 1.5rem; font-weight: bold; color: #666;">
            ---
          </div>
          <div style="font-size: 0.75rem; color: #555; margin-top: 5px;">
            avg frequency
          </div>
        </div>

      </div>
    `;
  });

  html += `
      </div>

      <!-- Explanation -->
      <div style="
        margin-top: 30px;
        padding: 20px;
        background: #2a2a2a;
        border: 1px solid #555;
        border-radius: 8px;
        text-align: center;
      ">
        <p style="color: #ccc; font-size: 0.85rem; line-height: 1.6;">
          💡 <strong>How it works:</strong> Customers are ranked by how frequently they come in for haircuts.<br>
          The lower the average time between visits, the higher they rank!<br>
          <span style="color: #999; font-size: 0.8rem;">Create an account and come back regularly to appear on the leaderboard!</span>
        </p>
        <div style="margin-top: 15px; padding: 15px; background: rgba(206, 17, 38, 0.1); border: 1px solid #CE1126; border-radius: 6px;">
          <p style="color: #CE1126; font-size: 0.9rem; margin: 0;">
            🎯 <strong>Requirements:</strong> You need at least 2 completed haircuts to appear on the leaderboard
          </p>
        </div>
      </div>
    </div>
  `;

  container.innerHTML = html;
}

// Display leaderboard on page
async function displayLeaderboard() {
  const leaderboardContainer = document.getElementById('leaderboard');
  
  if (!leaderboardContainer) {
    console.log('Leaderboard container not found');
    return;
  }

  // Show loading state
  leaderboardContainer.innerHTML = `
    <div style="text-align: center; padding: 40px; color: #ccc;">
      <p style="font-size: 18px;">🏆 Loading leaderboard...</p>
    </div>
  `;

  // Calculate leaderboard
  const leaderboardData = await calculateLeaderboard();

  // If no data, show skeleton/placeholder
  if (leaderboardData.length === 0) {
    displaySkeletonLeaderboard(leaderboardContainer);
    return;
  }

  // Take top 10
  const top10 = leaderboardData.slice(0, 10);

  // Build HTML
  let html = `
    <div style="max-width: 800px; margin: 0 auto;">
      <h2 style="color: #CE1126; text-align: center; margin-bottom: 10px; font-size: 2rem;">🏆 Most Loyal Customers</h2>
      <p style="text-align: center; color: #ccc; margin-bottom: 30px; font-size: 0.9rem;">
        Ranked by how frequently they come in for haircuts
      </p>

      <div style="display: flex; flex-direction: column; gap: 15px;">
  `;

  top10.forEach((customer, index) => {
    const rank = index + 1;
    const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
    const borderColor = rank === 1 ? '#FFD700' : rank === 2 ? '#C0C0C0' : rank === 3 ? '#CD7F32' : '#555';
    const bgColor = rank === 1 ? 'rgba(255, 215, 0, 0.1)' : rank === 2 ? 'rgba(192, 192, 192, 0.1)' : rank === 3 ? 'rgba(205, 127, 50, 0.1)' : '#1a1a1a';

    // Calculate days since last visit
    const daysSinceLastVisit = Math.floor((new Date() - customer.lastVisit) / (1000 * 60 * 60 * 24));
    const lastVisitText = daysSinceLastVisit === 0 ? 'Today' : 
                          daysSinceLastVisit === 1 ? 'Yesterday' : 
                          `${daysSinceLastVisit} days ago`;

    html += `
      <div style="
        background: ${bgColor};
        border: 2px solid ${borderColor};
        border-radius: 12px;
        padding: 20px;
        display: flex;
        align-items: center;
        gap: 20px;
        transition: transform 0.2s;
      " onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
        
        <!-- Rank Badge -->
        <div style="
          font-size: 2rem;
          font-weight: bold;
          min-width: 60px;
          text-align: center;
          color: ${rank <= 3 ? borderColor : '#CE1126'};
        ">
          ${medal}
        </div>

        <!-- Customer Info -->
        <div style="flex: 1;">
          <div style="font-size: 1.2rem; font-weight: bold; color: white; margin-bottom: 5px;">
            ${customer.name}
          </div>
          <div style="font-size: 0.85rem; color: #999; display: flex; gap: 15px; flex-wrap: wrap;">
            <span>📊 ${customer.totalVisits} visit${customer.totalVisits !== 1 ? 's' : ''}</span>
            <span>📅 Last: ${lastVisitText}</span>
          </div>
        </div>

        <!-- Frequency Score -->
        <div style="
          text-align: center;
          padding: 15px 20px;
          background: rgba(0, 104, 71, 0.2);
          border: 2px solid #006847;
          border-radius: 8px;
          min-width: 120px;
        ">
          <div style="font-size: 1.5rem; font-weight: bold; color: #4CAF50;">
            ${formatWeeks(customer.averageWeeks)}
          </div>
          <div style="font-size: 0.75rem; color: #999; margin-top: 5px;">
            avg frequency
          </div>
        </div>

      </div>
    `;
  });

  html += `
      </div>

      <!-- Explanation -->
      <div style="
        margin-top: 30px;
        padding: 20px;
        background: #2a2a2a;
        border: 1px solid #555;
        border-radius: 8px;
        text-align: center;
      ">
        <p style="color: #ccc; font-size: 0.85rem; line-height: 1.6;">
          💡 <strong>How it works:</strong> Customers are ranked by how frequently they come in for haircuts.<br>
          The lower the average time between visits, the higher they rank!<br>
          <span style="color: #999; font-size: 0.8rem;">Updated in real-time as bookings are completed</span>
        </p>
      </div>
    </div>
  `;

  leaderboardContainer.innerHTML = html;
}

// Initialize leaderboard when page loads
document.addEventListener('DOMContentLoaded', () => {
  // Wait for Firebase to initialize
  const checkDatabase = () => {
    if (window.db) {
      console.log('✅ Database ready, loading leaderboard...');
      displayLeaderboard();
    } else {
      setTimeout(checkDatabase, 500);
    }
  };
  
  setTimeout(checkDatabase, 500);
});

// Export function for manual refresh
window.refreshLeaderboard = displayLeaderboard;

