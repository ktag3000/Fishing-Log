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
  } else {
    gate.classList.remove('hidden');
    app.classList.add('hidden');
  }
});

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
        const when = trip.date ? new Date(trip.date) : null;
        card.innerHTML = `
          <div class="trip-card-head">
            <div>
              <span class="trip-date">${when ? when.toLocaleString() : 'Undated trip'}</span>
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
  const dateInput = form.querySelector('[name="tripDate"]');
  const moonOut = document.getElementById('tripMoonPhaseOut');

  if (isEdit) {
    heading.textContent = 'Edit trip';
    submitBtn.textContent = 'Save changes';
  }

  const setDate = (ms) => {
    const d = ms ? new Date(ms) : new Date();
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    dateInput.value = d.toISOString().slice(0, 16);
    moonOut.textContent = moonPhaseName(new Date(dateInput.value));
  };
  setDate(isEdit ? existingTrip.date : null);

  dateInput.addEventListener('change', () => {
    moonOut.textContent = dateInput.value ? moonPhaseName(new Date(dateInput.value)) : '—';
  });

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
    const tripDate = new Date(fd.get('tripDate'));

    const tripData = {
      locationId: locId,
      date: tripDate.getTime(),
      moonPhase: moonPhaseName(tripDate),
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

/* ===================== Nav: Map / Reports ===================== */
document.getElementById('navMapBtn').addEventListener('click', () => switchView('map'));
document.getElementById('navReportsBtn').addEventListener('click', () => switchView('reports'));

function switchView(view) {
  const mapBtn = document.getElementById('navMapBtn');
  const reportsBtn = document.getElementById('navReportsBtn');
  const mapView = document.getElementById('mapView');
  const reportsView = document.getElementById('reportsView');

  if (view === 'reports') {
    mapBtn.classList.remove('active');
    reportsBtn.classList.add('active');
    mapView.classList.add('hidden');
    reportsView.classList.remove('hidden');
    loadReports();
  } else {
    reportsBtn.classList.remove('active');
    mapBtn.classList.add('active');
    reportsView.classList.add('hidden');
    mapView.classList.remove('hidden');
  }
}

/* ===================== Reports / Analytics ===================== */
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
