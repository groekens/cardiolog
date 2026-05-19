// ══════════════════════════════════════════════════
//  firebase-config.js
//  ⚠️  Remplace ces valeurs par celles de ta Firebase Console
//  Console → Project settings → Your apps → SDK setup
// ══════════════════════════════════════════════════

const FIREBASE_CONFIG = {
  apiKey:            "REMPLACE_PAR_TON_API_KEY",
  authDomain:        "REMPLACE_PAR_TON_AUTH_DOMAIN",
  projectId:         "REMPLACE_PAR_TON_PROJECT_ID",
  storageBucket:     "REMPLACE_PAR_TON_STORAGE_BUCKET",
  messagingSenderId: "REMPLACE_PAR_TON_SENDER_ID",
  appId:             "REMPLACE_PAR_TON_APP_ID"
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
