// Paste the config object from your Firebase project settings here.
// Firebase console -> Project settings -> General -> "Your apps" -> SDK setup and configuration
const firebaseConfig = {
  apiKey: "AIzaSyDmnGFErKdIukBlosb3-e27BA_e0kmHPUI",
  authDomain: "fishing-log-b0d98.firebaseapp.com",
  projectId: "fishing-log-b0d98",
  storageBucket: "fishing-log-b0d98.firebasestorage.app",
  messagingSenderId: "565623179141",
  appId: "1:565623179141:web:e2a89836b688c856d826ec"
};

firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const storage = firebase.storage();
