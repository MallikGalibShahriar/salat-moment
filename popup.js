const ELEMENTS = {
  locationText: document.getElementById('location-text'),
  dateText: document.getElementById('date-text'),
  hijriDateText: document.getElementById('hijri-date-text'),
  prayerCardLabel: document.getElementById('prayer-card-label'),
  nextPrayerName: document.getElementById('next-prayer-name'),
  nextPrayerTimer: document.getElementById('next-prayer-timer'),
  prayerList: document.getElementById('prayer-list'),
  statusMsg: document.getElementById('status-msg'),
  // Settings UI
  settingsBtn: document.getElementById('settings-btn'),
  settingsOverlay: document.getElementById('settings-overlay'),
  closeSettingsBtn: document.getElementById('close-settings'),
  saveSettingsBtn: document.getElementById('save-settings'),
  calcMethodSelect: document.getElementById('calc-method'),
  schoolMethodSelect: document.getElementById('school-method'),
  refreshLocBtn: document.getElementById('refresh-loc-btn')
};

let prayerTimes = {};
let nextPrayer = null;
let timerInterval = null;
let currentSettings = { method: 3, school: 0 }; // Default: MWL, Standard

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  init();
  setupEventListeners();
});

async function init() {
  initTheme();
  updateDate();
  
  // Load settings
  const settings = await getStorage('settings');
  if (settings) {
    currentSettings = settings;
    // Update UI to match
    ELEMENTS.calcMethodSelect.value = settings.method;
    ELEMENTS.schoolMethodSelect.value = settings.school;
  }
  
  // Try to load cached data first
  const cached = await getStorage('prayerData');
  // Only use cache if it matches current settings (methods often change times)
  // Simplified: just check if cached exists and is today. 
  // Ideally we should check if cached params match current settings but for simplicity
  // let's rely on standard flow. If user changes settings, we will force refresh.
  
  if (cached && isToday(cached.date) && cached.settings && 
      cached.settings.method == currentSettings.method && 
      cached.settings.school == currentSettings.school) {
        
    renderPrayerTimes(cached.timings);
    prayerTimes = cached.timings;
    updateNextPrayer();
    updateLocationDisplay(cached.location);
  } else {
    getLocationAndFetch();
  }
  
  // Update timer every second
  startTimer();
}

function setupEventListeners() {
  // Open Settings
  ELEMENTS.settingsBtn.addEventListener('click', () => {
    ELEMENTS.settingsOverlay.classList.remove('hidden');
  });

  // Close Settings
  ELEMENTS.closeSettingsBtn.addEventListener('click', () => {
    ELEMENTS.settingsOverlay.classList.add('hidden');
  });

  // Save Settings
  ELEMENTS.saveSettingsBtn.addEventListener('click', async () => {
    const newMethod = ELEMENTS.calcMethodSelect.value;
    const newSchool = ELEMENTS.schoolMethodSelect.value;
    
    currentSettings = { method: newMethod, school: newSchool };
    await setStorage('settings', currentSettings);
    
    ELEMENTS.settingsOverlay.classList.add('hidden');
    // Refresh data
    const loc = await getStorage('location');
    if (loc) {
      fetchPrayerTimes(loc.lat, loc.lng);
    } else {
      getLocationAndFetch();
    }
  });

  // Refresh Location
  ELEMENTS.refreshLocBtn.addEventListener('click', () => {
    ELEMENTS.settingsOverlay.classList.add('hidden');
    getLocationAndFetch();
  });
}

function updateDate() {
  const now = new Date();
  const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  ELEMENTS.dateText.textContent = now.toLocaleDateString(undefined, options);
}

// Fallback to IP location if GPS is slow/denied
function getLocationAndFetch() {
  ELEMENTS.locationText.textContent = "Locating...";
  
  if (!navigator.geolocation) {
    fetchLocationByIP();
    return;
  }

  const geoOptions = { timeout: 10000 };

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude } = position.coords;
      fetchPrayerTimes(latitude, longitude);
      ELEMENTS.locationText.textContent = `${latitude.toFixed(2)}, ${longitude.toFixed(2)}`;
      setStorage('location', { lat: latitude, lng: longitude, name: 'My Location' });
    },
    (error) => {
      console.warn("Geolocation failed/denied, trying IP...", error);
      fetchLocationByIP();
    },
    geoOptions
  );
}

async function fetchLocationByIP() {
  ELEMENTS.locationText.textContent = "Locating (IP)...";
  try {
    const res = await fetch('http://ip-api.com/json');
    if (!res.ok) throw new Error('IP Geo failed');
    const data = await res.json();
    
    if (data.status === 'success') {
      const { lat, lon, city } = data;
      fetchPrayerTimes(lat, lon);
      ELEMENTS.locationText.textContent = city || `${lat.toFixed(2)}, ${lon.toFixed(2)}`;
      setStorage('location', { lat, lng: lon, name: city });
    } else {
      throw new Error('IP Geo failed');
    }
  } catch (err) {
    console.error(err);
    showError("Could not detect location. Please allow permissions.");
  }
}

async function fetchPrayerTimes(lat, lng) {
  try {
    const date = new Date();
    const timestamp = Math.floor(date.getTime() / 1000);
    
    // Use settings
    const method = currentSettings.method;
    const school = currentSettings.school;
    
    const response = await fetch(`https://api.aladhan.com/v1/timings/${timestamp}?latitude=${lat}&longitude=${lng}&method=${method}&school=${school}`);
    const data = await response.json();

    if (data.code === 200) {
      const timings = data.data.timings;
      const dateInfo = data.data.date;
      
    // Clean timings (remove suffixes like "(EST)")
      for (let key in timings) {
        if (timings[key]) {
          timings[key] = timings[key].split(' ')[0];
        }
      }

      prayerTimes = timings;
      
      // Save to storage
      setStorage('prayerData', {
        date: new Date().toDateString(),
        timings: timings,
        hijri: dateInfo.hijri,
        location: { lat, lng },
        settings: currentSettings // store settings used for this fetch
      });

      renderPrayerTimes(timings);
      ELEMENTS.hijriDateText.textContent = `${dateInfo.hijri.day} ${dateInfo.hijri.month.en} ${dateInfo.hijri.year}`;
      updateNextPrayer();
      ELEMENTS.statusMsg.textContent = ''; // Clear any existing errors
    } else {
      showError("API Error: " + (data.status || data.code));
    }
  } catch (err) {
    console.error(err);
    showError("Network/API Error. Check internet.");
  }
}

function renderPrayerTimes(timings) {
  ELEMENTS.prayerList.innerHTML = '';
  
  // Define sequence for core prayers + markers
  const schedule = [
    { name: 'Fajr', ends: 'Sunrise' },
    { name: 'Sunrise', ends: null, displayName: 'Sunrise (Forbidden)', isDanger: true },      
    { name: 'Dhuhr', ends: 'Asr' },
    { name: 'Asr', ends: 'Sunset', offsetEnd: -15 }, // Ends 15 mins before Sunset
    { name: 'Sunset', ends: null, displayName: 'Sunset (Forbidden)', isDanger: true },       
    { name: 'Maghrib', ends: 'Isha', offsetStart: 2 }, // Starts 2 mins after Sunset
    { name: 'Isha', ends: 'Fajr' }
  ];

  schedule.forEach(item => {
    const name = item.name;
    let startTime = timings[name];
    if (!startTime) return;
    
    // Apply Start Offset if needed
    if (item.offsetStart) {
      startTime = adjustTime(startTime, item.offsetStart);
    }
    
    let endTimeKey = item.ends;
    
    const div = document.createElement('div');
    div.className = 'prayer-item';
    if (item.isDanger) div.classList.add('danger');
    div.dataset.name = name;
    
    // Format times
    const startFormatted = formatTime(startTime);
    let timeDisplay = startFormatted;
    
    // Add End Time if exists
    if (endTimeKey) {
      let endTime = timings[endTimeKey];
      
      // For Isha, we rely on Fajr
      if (item.name === 'Isha' && !endTime) {
         endTime = timings['Fajr']; 
      }
      
      // Apply offset if needed (e.g. Asr Gap)
      if (endTime && item.offsetEnd) {
        endTime = adjustTime(endTime, item.offsetEnd);
      }
      
      if (endTime) {
        timeDisplay = `<span class="time-range"><span class="start">${startFormatted}</span> <span class="sep">-</span> <span class="end">${formatTime(endTime)}</span></span>`;
      }
    } else {
      // Markers
      div.classList.add('marker-item');
    }
    
    div.innerHTML = `
      <span class="prayer-name">${item.displayName || name}</span>
      <span class="prayer-time">${timeDisplay}</span>
    `;
    
    ELEMENTS.prayerList.appendChild(div);
  });
}

function adjustTime(timeStr, mins) {
  const [h, m] = timeStr.split(':').map(Number);
  const date = new Date();
  date.setHours(h, m + mins);
  return `${date.getHours()}:${pad(date.getMinutes())}`;
}

function updateNextPrayer() {
  if (!prayerTimes) return;
  
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  
  const prayers = ['Fajr', 'Sunrise', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  let upcoming = null;
  let minDiff = Infinity;
  let nextDayFajr = false;

  for (const name of prayers) {
    const timeStr = prayerTimes[name];
    if (!timeStr) continue;
    
    const [h, m] = timeStr.split(':').map(Number);
    const pMinutes = h * 60 + m;
    
    if (isNaN(pMinutes)) continue;

    if (pMinutes > currentMinutes) {
      if (pMinutes - currentMinutes < minDiff) {
        minDiff = pMinutes - currentMinutes;
        upcoming = { name, time: timeStr };
      }
    }
  }

  // If no upcoming prayer today, it's Fajr tomorrow
  if (!upcoming) {
    if (prayerTimes['Fajr']) {
       upcoming = { name: 'Fajr', time: prayerTimes['Fajr'] }; 
       nextDayFajr = true;
    } else {
       return; 
    }
  }
  
  // Calculate Current Active Prayer
  let currentP = null;
  let maxP = -1;
  const activeCandidates = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
  
  for (const name of activeCandidates) {
     if(!prayerTimes[name]) continue;
     const [h, m] = prayerTimes[name].split(':').map(Number);
     const val = h * 60 + m; 
     if (val <= currentMinutes && val > maxP) {
       maxP = val;
       currentP = name;
     }
  }
  
  // Special Check: Fajr ends at Sunrise
  if (currentP === 'Fajr' && prayerTimes['Sunrise']) {
    const [sh, sm] = prayerTimes['Sunrise'].split(':').map(Number);
    const sMin = sh * 60 + sm;
    if (currentMinutes >= sMin) {
      currentP = null;
    }
  }

  // Set Timer Target
  nextPrayer = { ...upcoming, nextDay: nextDayFajr };
  
  // Update Card Display
  if (currentP) {
    ELEMENTS.nextPrayerName.textContent = currentP;
    if (ELEMENTS.prayerCardLabel) ELEMENTS.prayerCardLabel.textContent = "NOW";
  } else {
    ELEMENTS.nextPrayerName.textContent = upcoming.name;
    if (ELEMENTS.prayerCardLabel) ELEMENTS.prayerCardLabel.textContent = "NEXT PRAYER";
  }
  
  // Highlight in list
  document.querySelectorAll('.prayer-item').forEach(el => {
    el.classList.remove('active', 'next', 'passed');
    
    const name = el.dataset.name;
    if (prayerTimes[name]) {
      const [h, m] = prayerTimes[name].split(':').map(Number);
      const val = h * 60 + m;
      if (val <= currentMinutes) {
        el.classList.add('passed');
      }
    }

    if (upcoming && el.dataset.name === upcoming.name) {
      el.classList.add('next');
    }
    
    if (currentP && el.dataset.name === currentP) {
      el.classList.add('active');
      el.classList.remove('passed');
    }
  });
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);
  updateTimer(); // run once immediately
  timerInterval = setInterval(updateTimer, 1000);
}

function updateTimer() {
  if (!nextPrayer) return;
  
  const now = new Date();
  const [h, m] = nextPrayer.time.split(':').map(Number);
  
  let target = new Date();
  target.setHours(h, m, 0, 0);
  
  if (nextPrayer.nextDay || target < now) {
    target.setDate(target.getDate() + 1);
  }
  
  const diff = target - now;
  
  if (diff < 0) {
    // Timer finished, refresh
    updateNextPrayer();
    return;
  }
  
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  const secs = Math.floor((diff % (1000 * 60)) / 1000);
  
  ELEMENTS.nextPrayerTimer.textContent = 
    `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

// Helpers
function pad(n) { return n < 10 ? '0'+n : n; }

function formatTime(time24) {
  if(!time24) return '--:--';
  const [h, m] = time24.split(':');
  let hour = parseInt(h);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  hour = hour ? hour : 12; 
  return `${hour}:${m} ${ampm}`;
}

function isToday(dateString) {
  return new Date().toDateString() === dateString;
}

function showError(msg) {
  ELEMENTS.statusMsg.innerHTML = `<span style="color:var(--danger-color)">${msg}</span>`;
  // Also show clearly in the main area if empty
  if (ELEMENTS.prayerList.children.length === 0 || ELEMENTS.prayerList.querySelector('.loading')) {
     ELEMENTS.prayerList.innerHTML = `<div style="text-align:center; padding: 20px; color: var(--danger-color);">${msg} <br><br> <button onclick="location.reload()" style="padding:8px 16px; background:var(--accent-color); color:#000; border:none; border-radius:4px; cursor:pointer;">Retry</button></div>`;
  }
}

function getStorage(key) {
  return new Promise(resolve => {
    chrome.storage.local.get([key], (result) => resolve(result[key]));
  });
}

function setStorage(key, value) {
  chrome.storage.local.set({ [key]: value });
}

function updateLocationDisplay(loc) {
  if(loc && loc.lat) {
     ELEMENTS.locationText.textContent = `${loc.lat.toFixed(2)}, ${loc.lng.toFixed(2)}`;
  }
}

function initTheme() {
  const toggle = document.getElementById('theme-toggle');
  
  chrome.storage.local.get(['theme'], (result) => {
    if (result.theme === 'dark') {
      document.body.classList.add('dark-theme');
      if (toggle) toggle.checked = true;
    }
  });
  
  if (toggle) {
    toggle.addEventListener('change', (e) => {
      if (e.target.checked) {
        document.body.classList.add('dark-theme');
        chrome.storage.local.set({ theme: 'dark' });
      } else {
        document.body.classList.remove('dark-theme');
        chrome.storage.local.set({ theme: 'light' });
      }
    });
  }
}
