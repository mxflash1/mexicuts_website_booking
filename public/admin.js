document.addEventListener("DOMContentLoaded", function () {
  const firebaseConfig = {
    apiKey: "AIzaSyBAv55SmKCWD0upLy7-8v_2RAqEFwO3uBA",
    authDomain: "mexicuts-booking.firebaseapp.com",
    projectId: "mexicuts-booking",
    storageBucket: "mexicuts-booking.appspot.com",
    messagingSenderId: "738836577452",
    appId: "1:738836577452:web:22c8a304b3b34cad41b309",
    measurementId: "G-KMXWYV1H9X"
  };

  firebase.initializeApp(firebaseConfig);
  const db = firebase.firestore();

  const calendarEl = document.getElementById("calendar");
  const events = [];

  db.collection("bookings").get().then(snapshot => {
    snapshot.forEach(doc => {
      const data = doc.data();

      if (data.timeSlot) {
        const match = data.timeSlot.match(/^(\d{4}-\d{2}-\d{2}) (\d{1,2}):(\d{2}) (AM|PM)$/);
        if (!match) {
          console.warn("Skipping malformed timeSlot:", data.timeSlot);
          return;
        }

        const [, datePart, rawHour, rawMinute, ampm] = match;
        let hour = parseInt(rawHour, 10);
        const minute = parseInt(rawMinute, 10);

        if (ampm === "PM" && hour !== 12) hour += 12;
        if (ampm === "AM" && hour === 12) hour = 0;

        const isoTime = `${datePart}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
        const endTime = new Date(new Date(isoTime).getTime() + 30 * 60000).toISOString();

        events.push({
          title: `${data.name} - ${data.phone}`,
          start: isoTime,
          end: endTime,
          allDay: false,
          extendedProps: {
            fullDetails: `Name: ${data.name}\nPhone: ${data.phone}\nTime: ${data.timeSlot}\nNotes: ${data.notes || 'None'}`
          }
        });
      } else {
        console.warn("Missing timeSlot on doc:", doc.id);
      }
    });

    const calendar = new FullCalendar.Calendar(calendarEl, {
      initialView: "timeGridWeek",
      slotDuration: "00:30:00",
      slotLabelInterval: "01:00",
      slotMinTime: "08:00:00",
      slotMaxTime: "18:00:00",
      events: events,
      themeSystem: "standard",
      height: "auto",
      eventClick: function(info) {
        const modal = document.getElementById("appointmentModal");
        const details = document.getElementById("appointmentDetails");
        const closeBtn = document.querySelector(".close-button");

        details.textContent = info.event.extendedProps.fullDetails || info.event.title;
        modal.style.display = "block";

        closeBtn.onclick = function () {
          modal.style.display = "none";
        };
        window.onclick = function (event) {
          if (event.target === modal) {
            modal.style.display = "none";
          }
        };
      }
    });

    calendar.render();
  }).catch(error => {
    console.error("Error fetching bookings:", error);
  });
});
