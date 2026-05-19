// ══════════════════════════════════════════════════
//  firebase-config.js
//  ⚠️  Remplace ces valeurs par celles de ta Firebase Console
//  Console → Project settings → Your apps → SDK setup
// ══════════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDcWLVGbq_zB653IPkQ62AX1Rc9Qn4VBMU",
  authDomain: "cardiolog-app.firebaseapp.com",
  projectId: "cardiolog-app",
  storageBucket: "cardiolog-app.firebasestorage.app",
  messagingSenderId: "384172695433",
  appId: "1:384172695433:web:9059f2a5a0aa1b14530b58"
};

// Initialize Firebase
firebase.initializeApp(FIREBASE_CONFIG);
window.auth = firebase.auth();
window.db   = firebase.firestore();

// ──────────────────────────────────────────────────
//  FIRESTORE SECURITY RULES (à copier dans la console)
//  Console → Firestore → Rules
// ──────────────────────────────────────────────────
//
//  rules_version = '2';
//  service cloud.firestore {
//    match /databases/{database}/documents {
//      match /readings/{docId} {
//        allow read, write: if request.auth != null;
//      }
//      match /{document=**} {
//        allow read, write: if false;
//      }
//    }
//  }
//
// ──────────────────────────────────────────────────
