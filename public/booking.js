
const firebaseConfig = {
  apiKey: "AIzaSyBAv55SmKCWD0upLy7-8v_2RAqEFwO3uBA",
  authDomain: "mexicuts-booking.firebaseapp.com",
  projectId: "mexicuts-booking",
  storageBucket: "mexicuts-booking.firebasestorage.app",
  messagingSenderId: "738836577452",
  appId: "1:738836577452:web:22c8a304b3b34cad41b309",
  measurementId: "G-KMXWYV1H9X"
};

function showPopup(message) {
  let popup = document.getElementById("popupMessage");
  if (!popup) {
    popup = document.createElement("div");
    popup.id = "popupMessage";
    document.body.appendChild(popup);
  }
  popup.textContent = message;
  popup.classList.add("show");
  setTimeout(() => popup.classList.remove("show"), 2000);
}

function triggerConfetti(e) {
  e.preventDefault(); // stop jump
  confetti();         // launch
  setTimeout(() => {
    window.location.hash = "booking"; // scroll after effect
  }, 300);
}

function triggerConfettiThenScroll(e) {
  e.preventDefault();
  confetti();
  setTimeout(() => {
    document.querySelector('#booking').scrollIntoView({ behavior: 'smooth' });
  }, 300);
}



firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

const timeSlotsMap = {
  'Saturday': ['08:00 AM','08:30 AM','09:00 AM','09:30 AM','10:00 AM','10:30 AM','11:00 AM','11:30 AM','12:00 PM','12:30 PM','01:00 PM','01:30 PM','02:00 PM','02:30 PM','03:00 PM','03:30 PM','04:00 PM','04:30 PM','05:00 PM','05:30 PM'],
  'Tuesday': ['03:30 PM', '04:00 PM'],
  'Thursday': ['03:30 PM', '04:00 PM']
};

let bookedSlots = [];

document.addEventListener("DOMContentLoaded", () => {
  const navLogo = document.getElementById("navLogo");
  if (!navLogo) return;

  const bulldogFrames = ["lil_logo_opened.png", "lil_logo_closed.png"];
  let i = 0;

  setInterval(() => {
    i = (i + 1) % bulldogFrames.length;
    navLogo.src = bulldogFrames[i];
  }, 1000);
});

document.addEventListener("DOMContentLoaded", () => {
  const logo = document.getElementById("logoAnimated");
  if (!logo) return;

  const frames = ["logo_open.png", "logo_closed.png"];
  let index = 0;

  setInterval(() => {
    index = (index + 1) % frames.length;
    logo.src = frames[index];
  }, 1000); // 1 seconds
  const form = document.getElementById("bookingForm");

  const bookingDateInput = document.createElement("input");
  bookingDateInput.setAttribute("type", "text");
  bookingDateInput.setAttribute("id", "bookingDate");
  bookingDateInput.setAttribute("placeholder", "Select a date");
  bookingDateInput.required = true;

  const slotContainer = document.createElement("div");
  slotContainer.id = "timeSlots";

  const notesField = form.querySelector("textarea");
  form.insertBefore(bookingDateInput, notesField);
  form.insertBefore(slotContainer, notesField);

  // Fetch all booked slots once on load
  db.collection("bookings").onSnapshot(snapshot => {
    bookedSlots = snapshot.docs.map(doc => doc.data().timeSlot);
  });
  

  flatpickr(bookingDateInput, {
    dateFormat: "Y-m-d",
    minDate: "today",
    disable: [
      function(date) {
        const day = date.toLocaleString('en-US', { weekday: 'long' });
        return !['Saturday', 'Tuesday', 'Thursday'].includes(day);
      }
    ],
    onChange: function(selectedDates, dateStr) {
      const selectedDate = selectedDates[0];
      const weekday = selectedDate.toLocaleString('en-US', { weekday: 'long' });
      const slots = timeSlotsMap[weekday] || [];

      slotContainer.innerHTML = '';
      slotContainer.classList.add('active');

      slots.forEach(time => {
        const fullSlot = `${dateStr} ${time}`;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = time;

        if (bookedSlots.includes(fullSlot)) {
          btn.disabled = true;
          btn.style.backgroundColor = '#a00';
          btn.style.opacity = '0.5';
          btn.title = 'Already booked';
        } else {
          btn.onclick = () => {
            document.querySelectorAll("#timeSlots button").forEach(b => b.classList.remove("time-selected"));
            btn.classList.add("time-selected");
          
            let hidden = document.getElementById('timeSlotHidden');
            if (!hidden) {
              hidden = document.createElement('input');
              hidden.type = 'hidden';
              hidden.name = 'timeSlot';
              hidden.id = 'timeSlotHidden';
              form.appendChild(hidden);
            }
            hidden.value = fullSlot;
            showPopup("🎉 Your MexiCut date has been selected! 🎉");
          };
          
        }

        slotContainer.appendChild(btn);
      });
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = form.querySelector('input[placeholder="Full Name"]').value;
    const phone = form.querySelector('input[placeholder="Phone Number"]').value;
    const notes = form.querySelector('textarea').value;
    const timeSlotField = document.getElementById("timeSlotHidden");
    const timeSlot = timeSlotField ? timeSlotField.value : "Not selected";

    const data = {
      name,
      phone,
      timeSlot,
      notes,
      timestamp: new Date()
    };

    try {
      await db.collection("bookings").add(data);
      confetti();
      showPopup("✅ Booking Confirmed!");
      form.reset();
      slotContainer.innerHTML = '';
    } catch (err) {
      alert("Something went wrong. Try again.");
      console.error(err);
    }
  });
});
