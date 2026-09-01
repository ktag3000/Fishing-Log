/* ===================== State ===================== */
let map;
let currentUser = null;
let locations = {};      // id -> {id, name, lat, lng, marker}
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

function addLocationMarker(id, data) {
  const marker = new google.maps.Marker({
    position: { lat: data.lat, lng: data.lng },
    map,
    title: data.name,
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 8,
      fillColor: '#C9622D',
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
    const li = document.createElement('li');
    li.textContent = loc.name;
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
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
    closeDrawer();
  });
}

/* ===================== Drawer: location detail + catches ===================== */
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
      <button id="logCatchBtn" class="btn btn-primary">Log a catch</button>
      <button id="deleteLocationBtn" class="btn btn-ghost">Delete spot</button>
    </div>
    <div id="catchList">Loading catches…</div>
  `;
  drawer.classList.remove('hidden');

  document.getElementById('logCatchBtn').addEventListener('click', () => showCatchForm(locId));
  document.getElementById('deleteLocationBtn').addEventListener('click', () => deleteLocation(locId));

  loadCatches(locId);
}

async function deleteLocation(locId) {
  if (!confirm('Delete this spot and all its logged catches? This can\'t be undone.')) return;
  const catchesSnap = await db.collection('users').doc(currentUser.uid).collection('catches')
    .where('locationId', '==', locId).get();
  const batch = db.batch();
  catchesSnap.forEach(doc => batch.delete(doc.ref));
  batch.delete(db.collection('users').doc(currentUser.uid).collection('locations').doc(locId));
  await batch.commit();
  closeDrawer();
}

function loadCatches(locId) {
  db.collection('users').doc(currentUser.uid).collection('catches')
    .where('locationId', '==', locId)
    .orderBy('caughtAt', 'desc')
    .onSnapshot(snap => {
      if (activeLocationId !== locId) return; // drawer moved on
      const listEl = document.getElementById('catchList');
      if (!listEl) return;
      if (snap.empty) {
        listEl.innerHTML = '<p class="hint">No catches logged here yet.</p>';
        return;
      }
      listEl.innerHTML = '';
      snap.forEach(doc => {
        const c = doc.data();
        const div = document.createElement('div');
        div.className = 'catch-item';
        const when = c.caughtAt ? new Date(c.caughtAt) : null;
        div.innerHTML = `
          <div class="catch-species">${escapeHtml(c.species || 'Unknown species')}</div>
          <div class="catch-meta">
            ${when ? when.toLocaleString() : ''}
            ${c.length ? ' · ' + c.length + '"' : ''}
            ${c.weight ? ' · ' + c.weight + ' lb' : ''}
            ${c.moonPhase ? ' · ' + c.moonPhase : ''}
          </div>
          ${(c.lure || c.lureColor) ? `<div class="catch-meta">Lure: ${[c.lure, c.lureColor].filter(Boolean).map(escapeHtml).join(' · ')}</div>` : ''}
          ${(c.waterTemp || c.clarity || c.waterNotes) ? `<div class="catch-meta">Water: ${[c.waterTemp ? c.waterTemp + '°F' : '', c.clarity, c.waterNotes].filter(Boolean).join(' · ')}</div>` : ''}
          ${(c.airTemp || c.wind || c.sky) ? `<div class="catch-meta">Weather: ${[c.airTemp ? c.airTemp + '°F' : '', c.wind, c.sky].filter(Boolean).join(' · ')}</div>` : ''}
          ${c.notes ? `<div class="catch-notes">${escapeHtml(c.notes)}</div>` : ''}
          <button class="catch-delete" data-id="${doc.id}">Delete</button>
        `;
        div.querySelector('.catch-delete').addEventListener('click', () => deleteCatch(doc.id));
        listEl.appendChild(div);
      });
    });
}

async function deleteCatch(catchId) {
  if (!confirm('Delete this catch?')) return;
  await db.collection('users').doc(currentUser.uid).collection('catches').doc(catchId).delete();
}

/* ===================== Catch form ===================== */
function showCatchForm(locId) {
  const content = document.getElementById('drawerContent');
  const tpl = document.getElementById('catchFormTemplate').content.cloneNode(true);
  content.innerHTML = '';
  content.appendChild(tpl);

  const form = document.getElementById('catchForm');
  const dateInput = form.querySelector('[name="caughtAt"]');
  const moonOut = document.getElementById('moonPhaseOut');

  // default to now, local time
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  dateInput.value = now.toISOString().slice(0, 16);
  moonOut.textContent = moonPhaseName(new Date(dateInput.value));

  dateInput.addEventListener('change', () => {
    moonOut.textContent = dateInput.value ? moonPhaseName(new Date(dateInput.value)) : '—';
  });

  document.getElementById('cancelCatchForm').addEventListener('click', () => openLocation(locId));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving…';

    const fd = new FormData(form);
    const caughtAtDate = new Date(fd.get('caughtAt'));

    const catchData = {
      locationId: locId,
      species: fd.get('species') || '',
      lure: fd.get('lure') || '',
      lureColor: fd.get('lureColor') || '',
      length: fd.get('length') ? Number(fd.get('length')) : null,
      weight: fd.get('weight') ? Number(fd.get('weight')) : null,
      waterTemp: fd.get('waterTemp') ? Number(fd.get('waterTemp')) : null,
      clarity: fd.get('clarity') || '',
      waterNotes: fd.get('waterNotes') || '',
      airTemp: fd.get('airTemp') ? Number(fd.get('airTemp')) : null,
      wind: fd.get('wind') || '',
      sky: fd.get('sky') || '',
      notes: fd.get('notes') || '',
      caughtAt: caughtAtDate.getTime(),
      moonPhase: moonPhaseName(caughtAtDate),
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    };

    try {
      await db.collection('users').doc(currentUser.uid).collection('catches').add(catchData);
      openLocation(locId);
    } catch (err) {
      alert('Could not save catch: ' + err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = 'Save catch';
    }
  });
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
