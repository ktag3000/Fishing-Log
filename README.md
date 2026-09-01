# Creel — a fishing log

A map-based fishing log: drop pins for your spots, log catches at each one with
species, size, lure, water conditions, and weather. Data syncs to your Google
account across devices. Hosted for free on GitHub Pages.

## What you need before it works

The app is just static files, so it has no server of its own — it talks
directly to two free Google services from the browser:

1. **Firebase** (Google) — handles sign-in, stores your locations/catches, and stores photos.
2. **Google Maps** — draws the map.

Both have generous free tiers that comfortably cover personal use.

---

### 1. Create a Firebase project

1. Go to [console.firebase.google.com](https://console.firebase.google.com) and click **Add project**. Give it any name (e.g. "creel-fishing-log"). You can skip Google Analytics.
2. In the left menu, go to **Build → Authentication → Get started**. Under **Sign-in method**, enable **Google**.
3. Go to **Build → Firestore Database → Create database**. Start in **production mode**, pick any region close to you.
4. Go to **Build → Storage → Get started**. Accept the defaults (this is where catch photos go).
5. Go to **Project settings** (gear icon, top left) → scroll to **Your apps** → click the `</>` (web) icon → register the app (any nickname, no need for Firebase Hosting). Copy the `firebaseConfig` object it shows you.
6. Paste that config into `js/firebase-config.js` in this project, replacing the placeholder values.

#### Lock the data down to each signed-in user

By default Firestore/Storage in production mode block everything. Set these rules so each user can only read/write their own data:

**Firestore rules** (Firestore Database → Rules):
```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

**Storage rules** (Storage → Rules):
```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /users/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```
Click **Publish** after pasting each.

---

### 2. Get a Google Maps API key

1. Go to [console.cloud.google.com](https://console.cloud.google.com) (same Google account is fine). It will likely already show the project Firebase created for you — select it.
2. Go to **APIs & Services → Library**, search for **Maps JavaScript API**, and click **Enable**.
3. Go to **APIs & Services → Credentials → Create credentials → API key**. Copy the key.
4. Click into the key and under **Application restrictions**, choose **Websites**, and add your future GitHub Pages URL (e.g. `https://yourusername.github.io/*`) so the key only works from your site.
5. In `index.html`, find the line near the bottom:
   ```html
   <script src="https://maps.googleapis.com/maps/api/js?key=REPLACE_WITH_YOUR_GOOGLE_MAPS_API_KEY&callback=initMap&loading=async" async defer></script>
   ```
   Replace `REPLACE_WITH_YOUR_GOOGLE_MAPS_API_KEY` with your key.

Google requires billing to be *enabled* on the Cloud project to use Maps, but includes a $200/month free credit — normal personal use won't come close to a charge. You can also set a budget alert under **Billing** for peace of mind.

---

### 3. Put it on GitHub Pages

1. Create a new repository on GitHub (public or private both work with Pages, though private repos need a paid plan for Pages — public is fine for this).
2. Push all these files to it (keep the folder structure: `index.html`, `css/`, `js/`).
3. In the repo, go to **Settings → Pages**. Under **Source**, choose the branch (usually `main`) and folder `/ (root)`, then **Save**.
4. After a minute, your app will be live at `https://yourusername.github.io/your-repo-name/`.
5. Go back to your Google Maps API key restrictions (step 2.4) and make sure that exact URL is allowed.

---

## Using the app

- Sign in with Google.
- Click anywhere on the map to drop a pin and name a fishing spot.
- Click a pin (or a spot in the sidebar) to open it, then **Log a catch** to record species, size, lure, water conditions, and weather. Moon phase is filled in automatically from the date.
- Add a photo if you want — it's stored privately under your account.
- Delete individual catches, or a whole spot (which removes its catches too), from the same panel.

## Notes on what's manual vs. automatic

- **Moon phase** is calculated automatically from the catch date/time.
- **Weather and water conditions** are entered by hand, by design — no weather API is wired in. If you ever want auto-filled weather, that's a small addition to `js/app.js` using a free weather API and the pin's coordinates.
