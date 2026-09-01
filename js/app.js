/* ===================== State ===================== */
let map;
let currentUser = null;
let locations = {};      // id -> {id, name, lat, lng, catchCount, marker}
let activeLocationId = null;
let pendingPinLatLng = null; // used while naming a new pin

/* ===================== Auth ===================== */
const provider = new firebase.auth.GoogleAuthProvider();

document.getElementById('signInBtn').addEventListener('click', () => {
  auth.signInWithPopup(provider).catch(err => alert('Sign-in failed: ' + err.message));
});
document.getElementById('signOutBtn').addEventListener('click', () => auth.signOut());

auth.onAuthStateChanged(user => {
  currentUser = user;
  const gate = document.getElementById('gate');
  const app = document.getElementById('app');
  if (user) {
    gate.classList.add('hidden');
    app.classList.remove('hidden');
    document.getElementById('userName').textContent = user.displayName || user.email;
    loadLocations();
    checkFirstLoginOnboarding();
  } else {
    gate.classList.remove('hidden');
    app.classList.add('hidden');
  }
});

document.getElementById('helpBtn').addEventListener('click', () => openOnboarding());

/* ===================== Map ===================== */
// Called automatically by the Google Maps script tag once it loads.
function initMap() {
  map = new google.maps.Map(document.getElementById('map'), {
    center: { lat: 39.5, lng: -98.35 }, // center of the US as a default
    zoom: 4,
    mapTypeId: 'terrain',
    streetViewControl: false,
    fullscreenControl: false,
  });

  // Try to center on the user's location if they'll allow it.
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      map.setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      map.setZoom(9);
    }, () => {/* ignore, keep default */});
  }

  map.addListener('click', e => {
    promptNewLocation(e.latLng.lat(), e.latLng.lng());
  });
}

/* ===================== Locations ===================== */
function loadLocations() {
  Object.values(locations).forEach(l => l.marker && l.marker.setMap(null));
  locations = {};
  db.collection('users').doc(currentUser.uid).collection('locations')
    .orderBy('createdAt', 'desc')
    .onSnapshot(snap => {
      Object.values(locations).forEach(l => l.marker && l.marker.setMap(null));
      locations = {};
      snap.forEach(doc => {
        const data = doc.data();
        addLocationMarker(doc.id, data);
      });
      renderSidebar();
    });
}

// Catch-count tiers: how a spot's marker (and sidebar badge) is colored based on
// how many catches have been logged there. Edit the thresholds/colors here.
const CATCH_TIERS = [
  { min: 0,  max: 0,        color: '#9AA6A0', label: 'No catches yet' },
  { min: 1,  max: 1,        color: '#5B9E7A', label: '1 catch' },
  { min: 2,  max: 5,        color: '#4A5D3A', label: '2–5 catches' },
  { min: 6,  max: 10,       color: '#C9622D', label: '6–10 catches' },
  { min: 11, max: Infinity, color: '#D4A017', label: '11+ catches' },
];

function tierForCount(count) {
  return CATCH_TIERS.find(t => count >= t.min && count <= t.max) || CATCH_TIERS[0];
}

function renderTierLegend() {
  const el = document.getElementById('tierLegend');
  if (!el) return;
  el.innerHTML = CATCH_TIERS.map(t => `
    <li><span class="tier-dot" style="background:${t.color}"></span>${t.label}</li>
  `).join('');
}
renderTierLegend();

function addLocationMarker(id, data) {
  const count = data.catchCount || 0;
  const tier = tierForCount(count);
  const marker = new google.maps.Marker({
    position: { lat: data.lat, lng: data.lng },
    map,
    title: `${data.name} — ${tier.label}`,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 8 + Math.min(count, 11) * 0.15, // pins grow slightly with more catches
      fillColor: tier.color,
      fillOpacity: 1,
      strokeColor: '#0F2A3D',
      strokeWeight: 1.5,
    },
  });
  marker.addListener('click', () => openLocation(id));
  locations[id] = { id, ...data, marker };
}

function renderSidebar() {
  const list = document.getElementById('locationList');
  list.innerHTML = '';
  Object.values(locations).forEach(loc => {
    const count = loc.catchCount || 0;
    const tier = tierForCount(count);
    const li = document.createElement('li');
    li.innerHTML = `
      <span>${escapeHtml(loc.name)}</span>
      <span class="count" style="background:${tier.color}; color:#fff;">${count}</span>
    `;
    li.addEventListener('click', () => {
      map.panTo({ lat: loc.lat, lng: loc.lng });
      map.setZoom(13);
      openLocation(loc.id);
    });
    list.appendChild(li);
  });
  if (Object.keys(locations).length === 0) {
    const li = document.createElement('li');
    li.textContent = 'No spots yet — click the map to add one.';
    li.style.cursor = 'default';
    list.appendChild(li);
  }
}

function promptNewLocation(lat, lng) {
  pendingPinLatLng = { lat, lng };
  const drawer = document.getElementById('drawer');
  const content = document.getElementById('drawerContent');
  content.innerHTML = `
    <h3>Name this spot</h3>
    <form class="new-location-form" id="newLocationForm">
      <input type="text" name="name" placeholder="e.g. Lower dam, north bank" required autofocus>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Save spot</button>
        <button type="button" id="cancelNewLocation" class="btn btn-ghost">Cancel</button>
      </div>
    </form>
  `;
  drawer.classList.remove('hidden');

  document.getElementById('cancelNewLocation').addEventListener('click', closeDrawer);
  document.getElementById('newLocationForm').addEventListener('submit', async e => {
    e.preventDefault();
    const name = e.target.name.value.trim();
    if (!name) return;
    await db.collection('users').doc(currentUser.uid).collection('locations').add({
      name,
      lat: pendingPinLatLng.lat,
      lng: pendingPinLatLng.lng,
      catchCount: 0,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    closeDrawer();
  });
}

/* ===================== Drawer: location detail + trips ===================== */
document.getElementById('drawerClose').addEventListener('click', closeDrawer);

function closeDrawer() {
  document.getElementById('drawer').classList.add('hidden');
  activeLocationId = null;
}

function openLocation(locId) {
  activeLocationId = locId;
  const loc = locations[locId];
  const drawer = document.getElementById('drawer');
  const content = document.getElementById('drawerContent');
  content.innerHTML = `
    <h3>${escapeHtml(loc.name)}</h3>
    <div class="form-actions" style="margin-bottom:0.5rem;">
      <button id="logTripBtn" class="btn btn-primary">Log a trip</button>
      <button id="deleteLocationBtn" class="btn btn-ghost">Delete spot</button>
    </div>
    <div id="tripList">Loading trips…</div>
  `;
  drawer.classList.remove('hidden');

  document.getElementById('logTripBtn').addEventListener('click', () => showTripForm(locId));
  document.getElementById('deleteLocationBtn').addEventListener('click', () => deleteLocation(locId));

  loadTrips(locId);
  reconcileLocationCatchCount(locId);
}

async function deleteLocation(locId) {
  if (!confirm('Delete this spot and all its trips and catches? This can\'t be undone.')) return;
  const catchesSnap = await db.collection('users').doc(currentUser.uid).collection('catches')
    .where('locationId', '==', locId).get();
  const tripsSnap = await db.collection('users').doc(currentUser.uid).collection('trips')
    .where('locationId', '==', locId).get();
  const batch = db.batch();
  catchesSnap.forEach(doc => batch.delete(doc.ref));
  tripsSnap.forEach(doc => batch.delete(doc.ref));
  batch.delete(db.collection('users').doc(currentUser.uid).collection('locations').doc(locId));
  await batch.commit();
  closeDrawer();
}

// Keeps a location's stored catchCount in sync with the real number of catch
// docs at that location (covers spots created before catchCount existed, or drift).
async function reconcileLocationCatchCount(locId) {
  const snap = await db.collection('users').doc(currentUser.uid).collection('catches')
    .where('locationId', '==', locId).get();
  const actualCount = snap.size;
  const loc = locations[locId];
  if (loc && (loc.catchCount || 0) !== actualCount) {
    db.collection('users').doc(currentUser.uid).collection('locations').doc(locId)
      .update({ catchCount: actualCount })
      .catch(() => {/* best effort */});
  }
}

/* ===================== Trips ===================== */
function loadTrips(locId) {
  db.collection('users').doc(currentUser.uid).collection('trips')
    .where('locationId', '==', locId)
    .onSnapshot(snap => {
      if (activeLocationId !== locId) return; // drawer moved on
      const listEl = document.getElementById('tripList');
      if (!listEl) return;
      if (snap.empty) {
        listEl.innerHTML = '<p class="hint">No trips logged here yet.</p>';
        return;
      }
      // sort client-side, newest first — avoids needing a composite index
      const trips = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.date || 0) - (a.date || 0));

      listEl.innerHTML = '';
      trips.forEach(trip => {
        const card = document.createElement('div');
        card.className = 'trip-card';
        card.innerHTML = `
          <div class="trip-card-head">
            <div>
              <span class="trip-date">${formatTripTimeRange(trip)}</span>
              ${trip.moonPhase ? `<span class="trip-meta"> · ${trip.moonPhase}</span>` : ''}
              ${trip.hadMiss ? '<span class="miss-badge">Had a miss</span>' : ''}
            </div>
            <div class="trip-card-actions">
              <button class="link-btn trip-edit">Edit</button>
              <button class="link-btn trip-delete">Delete</button>
            </div>
          </div>
          ${(trip.waterTemp || trip.clarity || trip.waterNotes) ? `<div class="catch-meta">Water: ${[trip.waterTemp ? trip.waterTemp + '°F' : '', trip.clarity, trip.waterNotes].filter(Boolean).join(' · ')}</div>` : ''}
          ${(trip.airTemp || trip.wind || trip.sky) ? `<div class="catch-meta">Weather: ${[trip.airTemp ? trip.airTemp + '°F' : '', trip.wind, trip.sky].filter(Boolean).join(' · ')}</div>` : ''}
          ${trip.notes ? `<div class="catch-notes">${escapeHtml(trip.notes)}</div>` : ''}
          <div class="trip-catches" id="trip-catches-${trip.id}">Loading catches…</div>
          <button class="btn btn-ghost btn-small add-catch-btn">+ Add a catch</button>
        `;
        card.querySelector('.trip-edit').addEventListener('click', () => showTripForm(locId, trip));
        card.querySelector('.trip-delete').addEventListener('click', () => deleteTrip(trip.id, locId));
        card.querySelector('.add-catch-btn').addEventListener('click', () => showCatchForm(locId, trip.id));
        listEl.appendChild(card);

        loadCatchesForTrip(trip.id, locId);
      });
    });
}

async function deleteTrip(tripId, locId) {
  if (!confirm('Delete this trip and all catches logged under it? This can\'t be undone.')) return;
  const catchesSnap = await db.collection('users').doc(currentUser.uid).collection('catches')
    .where('tripId', '==', tripId).get();
  const batch = db.batch();
  catchesSnap.forEach(doc => batch.delete(doc.ref));
  batch.delete(db.collection('users').doc(currentUser.uid).collection('trips').doc(tripId));
  await batch.commit();
  // catchCount decreases by however many catches were under this trip
  if (catchesSnap.size > 0) {
    await db.collection('users').doc(currentUser.uid).collection('locations').doc(locId).update({
      catchCount: firebase.firestore.FieldValue.increment(-catchesSnap.size),
    });
  }
}

function loadCatchesForTrip(tripId, locId) {
  db.collection('users').doc(currentUser.uid).collection('catches')
    .where('tripId', '==', tripId)
    .onSnapshot(snap => {
      const el = document.getElementById(`trip-catches-${tripId}`);
      if (!el) return; // trip card no longer rendered
      if (snap.empty) {
        el.innerHTML = '<p class="hint">No catches logged on this trip yet.</p>';
        return;
      }
      const catchDocs = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.caughtAt || 0) - (a.caughtAt || 0));

      el.innerHTML = '';
      catchDocs.forEach(c => {
        const div = document.createElement('div');
        div.className = 'catch-item';
        const when = c.caughtAt ? new Date(c.caughtAt) : null;
        div.innerHTML = `
          <div class="catch-species">${escapeHtml(c.species || 'Unknown species')}</div>
          <div class="catch-meta">
            ${when ? when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
            ${c.length ? ' · ' + c.length + '"' : ''}
            ${c.weight ? ' · ' + c.weight + ' lb' : ''}
          </div>
          ${(c.lure || c.lureColor) ? `<div class="catch-meta">Lure: ${[c.lure, c.lureColor].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
          ${c.notes ? `<div class="catch-notes">${escapeHtml(c.notes)}</div>` : ''}
          <div class="catch-actions">
            <button class="catch-edit" data-id="${c.id}">Edit</button>
            <button class="catch-delete" data-id="${c.id}">Delete</button>
          </div>
        `;
        div.querySelector('.catch-edit').addEventListener('click', () => showCatchForm(locId, tripId, c));
        div.querySelector('.catch-delete').addEventListener('click', () => deleteCatch(c.id, locId));
        el.appendChild(div);
      });
    });
}

/* ===================== Trip form ===================== */
function showTripForm(locId, existingTrip) {
  const isEdit = !!existingTrip;
  const drawer = document.getElementById('drawer');
  const content = document.getElementById('drawerContent');
  const tpl = document.getElementById('tripFormTemplate').content.cloneNode(true);
  content.innerHTML = '';
  content.appendChild(tpl);
  drawer.classList.remove('hidden');

  const form = document.getElementById('tripForm');
  const heading = form.querySelector('h3');
  const submitBtn = form.querySelector('button[type="submit"]');
  const startInput = form.querySelector('[name="tripStart"]');
  const endInput = form.querySelector('[name="tripEnd"]');
  const moonOut = document.getElementById('tripMoonPhaseOut');
  const durationOut = document.getElementById('tripDurationOut');

  if (isEdit) {
    heading.textContent = 'Edit trip';
    submitBtn.textContent = 'Save changes';
  }

  const toLocalInputValue = (ms) => {
    const d = new Date(ms);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    return d.toISOString().slice(0, 16);
  };

  if (isEdit && existingTrip.date) {
    startInput.value = toLocalInputValue(existingTrip.date);
    if (existingTrip.endDate) endInput.value = toLocalInputValue(existingTrip.endDate);
  } else {
    const now = Date.now();
    startInput.value = toLocalInputValue(now);
    endInput.value = toLocalInputValue(now + 2 * 60 * 60 * 1000); // default 2-hour trip
  }

  function refreshComputedFields() {
    moonOut.textContent = startInput.value ? moonPhaseName(new Date(startInput.value)) : '—';
    if (startInput.value && endInput.value) {
      const startMs = new Date(startInput.value).getTime();
      const endMs = new Date(endInput.value).getTime();
      durationOut.textContent = endMs > startMs ? formatDuration((endMs - startMs) / 60000) : '—';
    } else {
      durationOut.textContent = '—';
    }
  }
  refreshComputedFields();
  startInput.addEventListener('change', refreshComputedFields);
  endInput.addEventListener('change', refreshComputedFields);

  if (isEdit) {
    const fields = ['waterTemp', 'clarity', 'waterNotes', 'airTemp', 'wind', 'sky', 'notes'];
    fields.forEach(name => {
      const el = form.querySelector(`[name="${name}"]`);
      if (el && existingTrip[name] !== undefined && existingTrip[name] !== null) el.value = existingTrip[name];
    });
    form.querySelector('[name="hadMiss"]').checked = !!existingTrip.hadMiss;
  }

  document.getElementById('cancelTripForm').addEventListener('click', () => openLocation(locId));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    const fd = new FormData(form);
    const startDate = new Date(fd.get('tripStart'));
    const endDate = fd.get('tripEnd') ? new Date(fd.get('tripEnd')) : null;
    const durationMinutes = (endDate && endDate > startDate) ? (endDate.getTime() - startDate.getTime()) / 60000 : null;

    const tripData = {
      locationId: locId,
      date: startDate.getTime(),
      endDate: endDate ? endDate.getTime() : null,
      durationMinutes,
      moonPhase: moonPhaseName(startDate),
      hadMiss: fd.get('hadMiss') === 'on',
      waterTemp: fd.get('waterTemp') ? Number(fd.get('waterTemp')) : null,
      clarity: fd.get('clarity') || '',
      waterNotes: fd.get('waterNotes') || '',
      airTemp: fd.get('airTemp') ? Number(fd.get('airTemp')) : null,
      wind: fd.get('wind') || '',
      sky: fd.get('sky') || '',
      notes: fd.get('notes') || '',
    };

    try {
      if (isEdit) {
        await db.collection('users').doc(currentUser.uid).collection('trips').doc(existingTrip.id).update(tripData);
      } else {
        tripData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection('users').doc(currentUser.uid).collection('trips').add(tripData);
      }
      openLocation(locId);
    } catch (err) {
      alert('Could not save trip: ' + err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = isEdit ? 'Save changes' : 'Save trip';
    }
  });
}

function formatDuration(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const mins = Math.round(totalMinutes % 60);
  if (hours === 0) return `${mins}m`;
  if (mins === 0) return `${hours}h`;
  return `${hours}h ${mins}m`;
}

function formatTripTimeRange(trip) {
  if (!trip.date) return 'Undated trip';
  const start = new Date(trip.date);
  const dateStr = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const startTimeStr = start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  if (!trip.endDate) {
    return `${dateStr}, ${startTimeStr}`;
  }
  const end = new Date(trip.endDate);
  const endTimeStr = end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const sameDay = start.toDateString() === end.toDateString();
  const durationStr = trip.durationMinutes ? ` (${formatDuration(trip.durationMinutes)})` : '';

  if (sameDay) {
    return `${dateStr}, ${startTimeStr} – ${endTimeStr}${durationStr}`;
  }
  const endDateStr = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${dateStr} ${startTimeStr} – ${endDateStr} ${endTimeStr}${durationStr}`;
}

/* ===================== Catch form (belongs to a trip) ===================== */
async function deleteCatch(catchId, locId) {
  if (!confirm('Delete this catch?')) return;
  await db.collection('users').doc(currentUser.uid).collection('catches').doc(catchId).delete();
  await db.collection('users').doc(currentUser.uid).collection('locations').doc(locId).update({
    catchCount: firebase.firestore.FieldValue.increment(-1),
  });
}

function showCatchForm(locId, tripId, existingCatch) {
  const isEdit = !!existingCatch;
  const drawer = document.getElementById('drawer');
  const content = document.getElementById('drawerContent');
  const tpl = document.getElementById('catchFormTemplate').content.cloneNode(true);
  content.innerHTML = '';
  content.appendChild(tpl);
  drawer.classList.remove('hidden');

  const form = document.getElementById('catchForm');
  const heading = form.querySelector('h3');
  const submitBtn = form.querySelector('button[type="submit"]');

  if (isEdit) {
    heading.textContent = 'Edit catch';
    submitBtn.textContent = 'Save changes';
    const fields = ['species', 'lure', 'lureColor', 'length', 'weight', 'notes'];
    fields.forEach(name => {
      const el = form.querySelector(`[name="${name}"]`);
      if (el && existingCatch[name] !== undefined && existingCatch[name] !== null) el.value = existingCatch[name];
    });
  }

  document.getElementById('cancelCatchForm').addEventListener('click', () => openLocation(locId));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    const fd = new FormData(form);

    const catchData = {
      locationId: locId,
      tripId: tripId,
      species: fd.get('species') || '',
      lure: fd.get('lure') || '',
      lureColor: fd.get('lureColor') || '',
      length: fd.get('length') ? Number(fd.get('length')) : null,
      weight: fd.get('weight') ? Number(fd.get('weight')) : null,
      notes: fd.get('notes') || '',
    };

    try {
      if (isEdit) {
        await db.collection('users').doc(currentUser.uid).collection('catches').doc(existingCatch.id).update(catchData);
      } else {
        // new catches default to the trip's date/time for caughtAt
        let caughtAtMs = Date.now();
        try {
          const tripDoc = await db.collection('users').doc(currentUser.uid).collection('trips').doc(tripId).get();
          if (tripDoc.exists && tripDoc.data().date) caughtAtMs = tripDoc.data().date;
        } catch (_) {/* fall back to now */}
        catchData.caughtAt = caughtAtMs;
        catchData.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        await db.collection('users').doc(currentUser.uid).collection('catches').add(catchData);
        await db.collection('users').doc(currentUser.uid).collection('locations').doc(locId).update({
          catchCount: firebase.firestore.FieldValue.increment(1),
        });
      }
      openLocation(locId);
    } catch (err) {
      alert('Could not save catch: ' + err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = isEdit ? 'Save changes' : 'Save catch';
    }
  });
}

/* ===================== Nav: Map / Reports / Log ===================== */
document.getElementById('navMapBtn').addEventListener('click', () => switchView('map'));
document.getElementById('navReportsBtn').addEventListener('click', () => switchView('reports'));
document.getElementById('navLogBtn').addEventListener('click', () => switchView('log'));

function switchView(view) {
  const views = {
    map: { btn: 'navMapBtn', el: 'mapView' },
    reports: { btn: 'navReportsBtn', el: 'reportsView' },
    log: { btn: 'navLogBtn', el: 'logView' },
  };
  Object.entries(views).forEach(([key, { btn, el }]) => {
    document.getElementById(btn).classList.toggle('active', key === view);
    document.getElementById(el).classList.toggle('hidden', key !== view);
  });
  if (view === 'reports') loadReports();
  if (view === 'log') loadLog();
}

/* ===================== Log / CSV export ===================== */
// Single source of truth for columns, shared by the on-screen table and the CSV
// export so they never drift out of sync.
const LOG_COLUMNS = [
  { key: 'locationName', label: 'Location',          width: 150 },
  { key: 'tripDate',     label: 'Trip date',          width: 110 },
  { key: 'tripStart',    label: 'Start time',         width: 100 },
  { key: 'tripEnd',      label: 'End time',           width: 100 },
  { key: 'duration',     label: 'Duration',           width: 90 },
  { key: 'moonPhase',    label: 'Moon phase',         width: 130 },
  { key: 'hadMiss',      label: 'Had a miss',         width: 100 },
  { key: 'waterTemp',    label: 'Water temp (°F)',    width: 120 },
  { key: 'clarity',      label: 'Water clarity',      width: 110 },
  { key: 'waterNotes',   label: 'Water notes',        width: 200 },
  { key: 'airTemp',      label: 'Air temp (°F)',      width: 110 },
  { key: 'wind',         label: 'Wind',                width: 110 },
  { key: 'sky',          label: 'Sky',                 width: 120 },
  { key: 'tripNotes',    label: 'Trip notes',         width: 200 },
  { key: 'species',      label: 'Species',             width: 140 },
  { key: 'lure',         label: 'Lure',                width: 130 },
  { key: 'lureColor',    label: 'Lure color',         width: 120 },
  { key: 'length',       label: 'Length (in)',        width: 100 },
  { key: 'weight',       label: 'Weight (lb)',        width: 100 },
  { key: 'catchTime',    label: 'Catch time',         width: 100 },
  { key: 'catchNotes',   label: 'Catch notes',        width: 200 },
];

let currentLogRows = [];

async function loadLog() {
  const el = document.getElementById('logContent');
  el.innerHTML = '<p class="hint">Loading your full log…</p>';

  const [tripsSnap, catchesSnap] = await Promise.all([
    db.collection('users').doc(currentUser.uid).collection('trips').get(),
    db.collection('users').doc(currentUser.uid).collection('catches').get(),
  ]);

  const trips = tripsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const catches = catchesSnap.docs.map(d => ({ id: d.id, ...d.data() }));

  if (trips.length === 0) {
    el.innerHTML = `
      <div class="log-toolbar"><h2>Full log</h2></div>
      <p class="hint">Log a trip and your full catch history will show up here, exportable as a CSV backup.</p>
    `;
    currentLogRows = [];
    return;
  }

  const catchesByTrip = {};
  catches.forEach(c => {
    if (!catchesByTrip[c.tripId]) catchesByTrip[c.tripId] = [];
    catchesByTrip[c.tripId].push(c);
  });

  const rows = [];
  trips.forEach(trip => {
    const locName = locations[trip.locationId] ? locations[trip.locationId].name : 'Unknown spot';
    const tripCatches = (catchesByTrip[trip.id] || []).sort((a, b) => (a.caughtAt || 0) - (b.caughtAt || 0));
    const tripDateObj = trip.date ? new Date(trip.date) : null;

    const baseRow = {
      locationName: locName,
      tripDate: tripDateObj ? tripDateObj.toLocaleDateString() : '',
      tripStart: tripDateObj ? tripDateObj.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '',
      tripEnd: trip.endDate ? new Date(trip.endDate).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '',
      duration: trip.durationMinutes ? formatDuration(trip.durationMinutes) : '',
      moonPhase: trip.moonPhase || '',
      hadMiss: trip.hadMiss ? 'Yes' : 'No',
      waterTemp: trip.waterTemp ?? '',
      clarity: trip.clarity || '',
      waterNotes: trip.waterNotes || '',
      airTemp: trip.airTemp ?? '',
      wind: trip.wind || '',
      sky: trip.sky || '',
      tripNotes: trip.notes || '',
      _sortKey: trip.date || 0,
    };

    if (tripCatches.length === 0) {
      rows.push({ ...baseRow, species: '', lure: '', lureColor: '', length: '', weight: '', catchTime: '', catchNotes: '' });
    } else {
      tripCatches.forEach(c => {
        rows.push({
          ...baseRow,
          species: c.species || '',
          lure: c.lure || '',
          lureColor: c.lureColor || '',
          length: c.length ?? '',
          weight: c.weight ?? '',
          catchTime: c.caughtAt ? new Date(c.caughtAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '',
          catchNotes: c.notes || '',
          _sortKey: c.caughtAt || trip.date || 0,
        });
      });
    }
  });

  rows.sort((a, b) => a._sortKey - b._sortKey); // chronological, oldest first
  currentLogRows = rows;
  renderLogTable(rows);
}

/* ---- column order & width persistence ---- */
function getLogColumnOrder() {
  const allKeys = LOG_COLUMNS.map(c => c.key);
  let saved;
  try { saved = JSON.parse(localStorage.getItem('creel-log-column-order')); } catch (_) { saved = null; }
  if (!Array.isArray(saved)) return allKeys;
  const filtered = saved.filter(k => allKeys.includes(k));
  const missing = allKeys.filter(k => !filtered.includes(k));
  return [...filtered, ...missing]; // any newly-added columns land at the end
}
function saveLogColumnOrder(order) {
  localStorage.setItem('creel-log-column-order', JSON.stringify(order));
}
function getLogColumnWidths() {
  try { return JSON.parse(localStorage.getItem('creel-log-column-widths')) || {}; } catch (_) { return {}; }
}
function saveLogColumnWidths(widths) {
  localStorage.setItem('creel-log-column-widths', JSON.stringify(widths));
}

function renderLogTable(rows) {
  const el = document.getElementById('logContent');
  const colsByKey = Object.fromEntries(LOG_COLUMNS.map(c => [c.key, c]));
  const order = getLogColumnOrder();
  const widths = getLogColumnWidths();
  const orderedCols = order.map(k => colsByKey[k]);

  el.innerHTML = `
    <div class="log-toolbar">
      <h2>Full log</h2>
      <div class="log-toolbar-actions">
        <button id="resetColumnsBtn" class="btn btn-ghost btn-small">Reset columns</button>
        <button id="exportCsvBtn" class="btn btn-primary">Export CSV</button>
      </div>
    </div>
    <p class="hint">${rows.length} row${rows.length === 1 ? '' : 's'} · drag a column header to reorder it, drag its right edge to resize. Rows with a catch are highlighted. Export doubles as a backup.</p>
    <div class="log-table-wrap">
      <table class="log-table" id="logTable">
        <colgroup>
          ${orderedCols.map(c => `<col data-key="${c.key}" style="width:${widths[c.key] || c.width}px">`).join('')}
        </colgroup>
        <thead>
          <tr>
            ${orderedCols.map(c => `
              <th draggable="true" data-key="${c.key}">
                <span class="th-label">${escapeHtml(c.label)}</span>
                <span class="col-resize-handle" data-key="${c.key}"></span>
              </th>
            `).join('')}
          </tr>
        </thead>
        <tbody>
          ${rows.map(row => {
            const hasCatch = !!row.species;
            return `<tr>${orderedCols.map((c, i) => `<td${i === 0 && hasCatch ? ' class="has-catch-cell"' : ''} title="${escapeHtml(String(row[c.key] ?? ''))}">${escapeHtml(String(row[c.key] ?? ''))}</td>`).join('')}</tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>
  `;

  document.getElementById('exportCsvBtn').addEventListener('click', exportLogCsv);
  document.getElementById('resetColumnsBtn').addEventListener('click', () => {
    localStorage.removeItem('creel-log-column-order');
    localStorage.removeItem('creel-log-column-widths');
    renderLogTable(currentLogRows);
  });

  setupLogTableInteractions();
}

function setupLogTableInteractions() {
  const table = document.getElementById('logTable');
  if (!table) return;
  let dragKey = null;
  let resizing = false;

  table.querySelectorAll('thead th').forEach(th => {
    th.addEventListener('dragstart', e => {
      if (resizing) { e.preventDefault(); return; }
      dragKey = th.dataset.key;
      e.dataTransfer.effectAllowed = 'move';
      th.classList.add('dragging-col');
    });
    th.addEventListener('dragend', () => th.classList.remove('dragging-col'));
    th.addEventListener('dragover', e => { e.preventDefault(); th.classList.add('drop-target'); });
    th.addEventListener('dragleave', () => th.classList.remove('drop-target'));
    th.addEventListener('drop', e => {
      e.preventDefault();
      th.classList.remove('drop-target');
      const targetKey = th.dataset.key;
      if (!dragKey || dragKey === targetKey) return;
      const order = getLogColumnOrder();
      const from = order.indexOf(dragKey);
      const to = order.indexOf(targetKey);
      if (from === -1 || to === -1) return;
      order.splice(from, 1);
      order.splice(to, 0, dragKey);
      saveLogColumnOrder(order);
      renderLogTable(currentLogRows);
    });

    const handle = th.querySelector('.col-resize-handle');
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      e.stopPropagation();
      resizing = true;
      const key = handle.dataset.key;
      const col = table.querySelector(`col[data-key="${key}"]`);
      const startX = e.clientX;
      const startWidth = col.getBoundingClientRect().width;

      function onMove(ev) {
        const newWidth = Math.max(60, Math.round(startWidth + (ev.clientX - startX)));
        col.style.width = newWidth + 'px';
      }
      function onUp() {
        resizing = false;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        const widths = getLogColumnWidths();
        widths[key] = parseInt(col.style.width, 10);
        saveLogColumnWidths(widths);
      }
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  });
}

function csvEscape(value) {
  const str = String(value ?? '');
  if (/[",\n]/.test(str)) return '"' + str.replace(/"/g, '""') + '"';
  return str;
}

function exportLogCsv() {
  const colsByKey = Object.fromEntries(LOG_COLUMNS.map(c => [c.key, c]));
  const orderedCols = getLogColumnOrder().map(k => colsByKey[k]);
  const header = orderedCols.map(c => csvEscape(c.label)).join(',');
  const lines = currentLogRows.map(row => orderedCols.map(c => csvEscape(row[c.key])).join(','));
  const csv = [header, ...lines].join('\r\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const today = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `creel-export-${today}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}


async function loadReports() {
  const el = document.getElementById('reportsContent');
  el.innerHTML = '<p class="hint">Loading your stats…</p>';

  const snap = await db.collection('users').doc(currentUser.uid).collection('catches').get();
  const catches = snap.docs.map(d => d.data());

  if (catches.length === 0) {
    el.innerHTML = '<h2>Reports</h2><p class="hint">Log a few catches and your stats will show up here.</p>';
    return;
  }

  // ---- basic tallies ----
  const speciesCounts = {};
  const lureCounts = {};
  const yearCounts = {};
  let weightSum = 0, weightN = 0;
  let lengthSum = 0, lengthN = 0;
  let biggest = null; // by weight
  let longest = null; // by length

  catches.forEach(c => {
    if (c.species) speciesCounts[c.species] = (speciesCounts[c.species] || 0) + 1;
    if (c.lure) lureCounts[c.lure] = (lureCounts[c.lure] || 0) + 1;
    if (c.caughtAt) {
      const year = new Date(c.caughtAt).getFullYear();
      yearCounts[year] = (yearCounts[year] || 0) + 1;
    }
    if (typeof c.weight === 'number') {
      weightSum += c.weight; weightN++;
      if (!biggest || c.weight > biggest.weight) biggest = c;
    }
    if (typeof c.length === 'number') {
      lengthSum += c.length; lengthN++;
      if (!longest || c.length > longest.length) longest = c;
    }
  });

  const topSpecies = Object.entries(speciesCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topLures = Object.entries(lureCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const topLocations = Object.values(locations)
    .filter(l => (l.catchCount || 0) > 0)
    .sort((a, b) => (b.catchCount || 0) - (a.catchCount || 0))
    .slice(0, 5);
  const years = Object.keys(yearCounts).sort();
  const maxYearCount = Math.max(...Object.values(yearCounts), 1);

  const avgWeight = weightN ? (weightSum / weightN).toFixed(2) : null;
  const avgLength = lengthN ? (lengthSum / lengthN).toFixed(1) : null;

  const locName = id => (locations[id] ? locations[id].name : 'Unknown spot');
  const fmtDate = ts => ts ? new Date(ts).toLocaleDateString() : '';

  el.innerHTML = `
    <h2>Reports</h2>

    <div class="stat-cards">
      <div class="stat-card"><span class="stat-num">${catches.length}</span><span class="stat-label">Total catches</span></div>
      <div class="stat-card"><span class="stat-num">${Object.keys(speciesCounts).length}</span><span class="stat-label">Species logged</span></div>
      <div class="stat-card"><span class="stat-num">${Object.keys(locations).length}</span><span class="stat-label">Spots fished</span></div>
      <div class="stat-card"><span class="stat-num">${avgWeight ?? '—'}</span><span class="stat-label">Avg weight (lb)</span></div>
      <div class="stat-card"><span class="stat-num">${avgLength ?? '—'}</span><span class="stat-label">Avg length (in)</span></div>
    </div>

    ${years.length ? `
    <h3>Catches by year</h3>
    <div class="year-chart">
      ${years.map(y => `
        <div class="year-bar-col">
          <div class="year-bar" style="height:${Math.max((yearCounts[y] / maxYearCount) * 100, 6)}%"></div>
          <span class="year-bar-count">${yearCounts[y]}</span>
          <span class="year-bar-label">${y}</span>
        </div>
      `).join('')}
    </div>` : ''}

    <div class="report-cols">
      <div class="report-col">
        <h3>Top species</h3>
        ${renderBarList(topSpecies)}
      </div>
      <div class="report-col">
        <h3>Top lures</h3>
        ${topLures.length ? renderBarList(topLures) : '<p class="hint">No lures logged yet.</p>'}
      </div>
      <div class="report-col">
        <h3>Top spots</h3>
        ${topLocations.length ? renderBarList(topLocations.map(l => [l.name, l.catchCount || 0])) : '<p class="hint">No catches logged yet.</p>'}
      </div>
    </div>

    <h3>Personal bests</h3>
    <div class="best-cards">
      ${biggest ? `
        <div class="best-card">
          <span class="best-label">Heaviest catch</span>
          <span class="best-value">${biggest.weight} lb</span>
          <span class="best-meta">${escapeHtml(biggest.species || 'Unknown species')} · ${locName(biggest.locationId)} · ${fmtDate(biggest.caughtAt)}</span>
        </div>` : ''}
      ${longest ? `
        <div class="best-card">
          <span class="best-label">Longest catch</span>
          <span class="best-value">${longest.length}"</span>
          <span class="best-meta">${escapeHtml(longest.species || 'Unknown species')} · ${locName(longest.locationId)} · ${fmtDate(longest.caughtAt)}</span>
        </div>` : ''}
      ${!biggest && !longest ? '<p class="hint">Log a weight or length to see your personal bests here.</p>' : ''}
    </div>
  `;
}

function renderBarList(entries) {
  if (!entries.length) return '<p class="hint">Nothing logged yet.</p>';
  const max = Math.max(...entries.map(e => e[1]), 1);
  return `
    <ul class="bar-list">
      ${entries.map(([label, count]) => `
        <li>
          <div class="bar-list-row">
            <span class="bar-list-label">${escapeHtml(String(label))}</span>
            <span class="bar-list-count">${count}</span>
          </div>
          <div class="bar-list-track"><div class="bar-list-fill" style="width:${(count / max) * 100}%"></div></div>
        </li>
      `).join('')}
    </ul>
  `;
}

/* ===================== Moon phase ===================== */
// Simple approximation good enough for a fishing log: returns a phase name for a given date.
function moonPhaseName(date) {
  const synodicMonth = 29.53058867;
  const knownNewMoon = Date.UTC(2000, 0, 6, 18, 14); // Jan 6 2000 new moon
  const diffDays = (date.getTime() - knownNewMoon) / 86400000;
  let phase = (diffDays % synodicMonth) / synodicMonth;
  if (phase < 0) phase += 1;

  const names = [
    'New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous',
    'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent',
  ];
  const index = Math.round(phase * 8) % 8;
  return names[index];
}

/* ===================== Utils ===================== */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ===================== Onboarding tutorial ===================== */
const ONBOARDING_SLIDES = [
  {
    title: 'Welcome to Creel',
    body: 'Creel is your fishing log — every spot you fish, every trip you take, and every fish you catch, all on one map.',
  },
  {
    title: 'Drop pins for your spots',
    body: 'Click anywhere on the map to add a fishing spot. Pins are colored by how many fish you\'ve caught there — check the legend in the sidebar.',
  },
  {
    title: 'Log a trip',
    body: 'Open a spot and click "Log a trip" each time you go. Record the date, water conditions, weather — and check the box if you only had a miss, no catch.',
  },
  {
    title: 'Add your catches',
    body: 'Inside each trip, click "+ Add a catch" for every fish you land: species, lure, lure color, length, weight, and notes.',
  },
  {
    title: 'See your stats',
    body: 'The Reports tab turns your history into stats — top species, top lures, top spots, catches by year, and your personal bests.',
  },
  {
    title: 'Your full log, and a backup',
    body: 'The Log tab shows everything in one spreadsheet — drag columns to reorder or resize them. Export to CSV any time, which also works as a backup of your data.',
  },
];

let onboardingIndex = 0;

async function checkFirstLoginOnboarding() {
  try {
    const doc = await db.collection('users').doc(currentUser.uid).get();
    const seen = doc.exists && doc.data().hasSeenOnboarding;
    if (!seen) openOnboarding();
  } catch (_) {/* if this fails, just don't force the tutorial */}
}

function openOnboarding() {
  onboardingIndex = 0;
  renderOnboardingSlide();
  document.getElementById('onboardingModal').classList.remove('hidden');
}

function closeOnboarding() {
  document.getElementById('onboardingModal').classList.add('hidden');
  db.collection('users').doc(currentUser.uid).set({ hasSeenOnboarding: true }, { merge: true }).catch(() => {});
}

function renderOnboardingSlide() {
  const slide = ONBOARDING_SLIDES[onboardingIndex];
  const isLast = onboardingIndex === ONBOARDING_SLIDES.length - 1;

  document.getElementById('onboardingSlide').innerHTML = `
    <h3>${escapeHtml(slide.title)}</h3>
    <p>${escapeHtml(slide.body)}</p>
  `;
  document.getElementById('onboardingDots').innerHTML = ONBOARDING_SLIDES
    .map((_, i) => `<span class="dot${i === onboardingIndex ? ' active' : ''}"></span>`)
    .join('');
  document.getElementById('onboardingBack').style.visibility = onboardingIndex === 0 ? 'hidden' : 'visible';
  document.getElementById('onboardingNext').textContent = isLast ? 'Get started' : 'Next';
}

document.getElementById('onboardingSkip').addEventListener('click', closeOnboarding);
document.getElementById('onboardingBack').addEventListener('click', () => {
  if (onboardingIndex > 0) { onboardingIndex--; renderOnboardingSlide(); }
});
document.getElementById('onboardingNext').addEventListener('click', () => {
  if (onboardingIndex < ONBOARDING_SLIDES.length - 1) {
    onboardingIndex++;
    renderOnboardingSlide();
  } else {
    closeOnboarding();
  }
});

/* ===================== Drawer resize ===================== */
(function setupDrawerResize() {
  const drawer = document.getElementById('drawer');
  const handle = document.getElementById('drawerResizeHandle');
  if (!drawer || !handle) return;

  const MIN_WIDTH = 320;
  const MAX_WIDTH_RATIO = 0.9; // don't let it swallow the whole screen

  // restore a previously chosen width, if any
  const saved = parseInt(localStorage.getItem('creel-drawer-width'), 10);
  if (saved) drawer.style.width = saved + 'px';

  let dragging = false;

  function applyWidth(clientX) {
    const maxWidth = window.innerWidth * MAX_WIDTH_RATIO;
    const newWidth = Math.max(MIN_WIDTH, Math.min(window.innerWidth - clientX, maxWidth));
    drawer.style.width = newWidth + 'px';
  }

  function startDrag(clientX) {
    dragging = true;
    handle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    applyWidth(clientX);
  }

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.userSelect = '';
    const width = parseInt(drawer.style.width, 10);
    if (width) localStorage.setItem('creel-drawer-width', width);
  }

  handle.addEventListener('mousedown', e => { e.preventDefault(); startDrag(e.clientX); });
  window.addEventListener('mousemove', e => { if (dragging) applyWidth(e.clientX); });
  window.addEventListener('mouseup', endDrag);

  handle.addEventListener('touchstart', e => startDrag(e.touches[0].clientX), { passive: true });
  window.addEventListener('touchmove', e => { if (dragging) applyWidth(e.touches[0].clientX); }, { passive: true });
  window.addEventListener('touchend', endDrag);
})();
