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
          <div class="catch-actions">
            <button class="catch-edit" data-id="${doc.id}">Edit</button>
            <button class="catch-delete" data-id="${doc.id}">Delete</button>
          </div>
        `;
        div.querySelector('.catch-edit').addEventListener('click', () => showCatchForm(locId, { id: doc.id, ...c }));
        div.querySelector('.catch-delete').addEventListener('click', () => deleteCatch(doc.id, locId));
        listEl.appendChild(div);
      });

      // Self-heal: keep the location's stored catchCount in sync with reality.
      // Covers spots created before catchCount existed, or any drift.
      const actualCount = snap.size;
      const loc = locations[locId];
      if (loc && (loc.catchCount || 0) !== actualCount) {
        db.collection('users').doc(currentUser.uid).collection('locations').doc(locId)
          .update({ catchCount: actualCount })
          .catch(() => {/* best effort */});
      }
    });
}

async function deleteCatch(catchId, locId) {
  if (!confirm('Delete this catch?')) return;
  await db.collection('users').doc(currentUser.uid).collection('catches').doc(catchId).delete();
  await db.collection('users').doc(currentUser.uid).collection('locations').doc(locId).update({
    catchCount: firebase.firestore.FieldValue.increment(-1),
  });
}

/* ===================== Catch form ===================== */
function showCatchForm(locId, existingCatch) {
  const isEdit = !!existingCatch;
  const content = document.getElementById('drawerContent');
  const tpl = document.getElementById('catchFormTemplate').content.cloneNode(true);
  content.innerHTML = '';
  content.appendChild(tpl);

  const form = document.getElementById('catchForm');
  const heading = form.querySelector('h3');
  const submitBtn = form.querySelector('button[type="submit"]');
  const dateInput = form.querySelector('[name="caughtAt"]');
  const moonOut = document.getElementById('moonPhaseOut');

  if (isEdit) {
    heading.textContent = 'Edit catch';
    submitBtn.textContent = 'Save changes';
  }

  if (isEdit && existingCatch.caughtAt) {
    // pre-fill date/time from the stored timestamp, in local time
    const d = new Date(existingCatch.caughtAt);
    d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
    dateInput.value = d.toISOString().slice(0, 16);
  } else {
    // default to now, local time
    const now = new Date();
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
    dateInput.value = now.toISOString().slice(0, 16);
  }
  moonOut.textContent = moonPhaseName(new Date(dateInput.value));

  dateInput.addEventListener('change', () => {
    moonOut.textContent = dateInput.value ? moonPhaseName(new Date(dateInput.value)) : '—';
  });

  // pre-fill the rest of the fields when editing
  if (isEdit) {
    const textFields = ['species', 'lure', 'lureColor', 'length', 'weight', 'waterTemp',
      'clarity', 'waterNotes', 'airTemp', 'wind', 'sky', 'notes'];
    textFields.forEach(name => {
      const el = form.querySelector(`[name="${name}"]`);
      if (el && existingCatch[name] !== undefined && existingCatch[name] !== null) {
        el.value = existingCatch[name];
      }
    });
  }

  document.getElementById('cancelCatchForm').addEventListener('click', () => openLocation(locId));

  form.addEventListener('submit', async e => {
    e.preventDefault();
    submitBtn.disabled = true;
    submitBtn.textContent = isEdit ? 'Saving…' : 'Saving…';

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
    };

    try {
      if (isEdit) {
        await db.collection('users').doc(currentUser.uid).collection('catches').doc(existingCatch.id).update(catchData);
      } else {
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
