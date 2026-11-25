/* Firebase web config for the "Containers" project.
   Firebase console → Project settings → General → Your apps → Config.
   Set to null to run ContainerTracks on a single device (browser storage only). */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyD5u6I-MQ_2bfVXKBc9Zrr19tepIY8ms2U",
  authDomain: "containers-73d69.firebaseapp.com",
  projectId: "containers-73d69",
  storageBucket: "containers-73d69.firebasestorage.app",
  messagingSenderId: "278400602124",
  appId: "1:278400602124:web:5f8db544b579b08514de29"
};

/* false = open straight to the yard (silent anonymous sign-in).
   true  = show an email/password sign-in screen. */
window.CT_REQUIRE_LOGIN = false;
