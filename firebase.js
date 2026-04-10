import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBD2r0-IMOKOjc92I75AZx9czBsnUt7wd0",
  authDomain: "eduvia-97008.firebaseapp.com",
  projectId: "eduvia-97008",
  storageBucket: "eduvia-97008.firebasestorage.app",
  messagingSenderId: "1052924233848",
  appId: "1:1052924233848:web:d19b4177fc64890042c58d"
};

const app = initializeApp(firebaseConfig);

console.log("Firebase iniciado:", firebaseConfig.projectId);

export const auth = getAuth(app);
export const db = getFirestore(app);
