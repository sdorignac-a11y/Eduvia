import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBD2r0-IMOKOjc92I75AZx9czBsnUt7wd0",
  authDomain: "eduvia-97008.firebaseapp.com",
  projectId: "eduvia-97008",
  storageBucket: "eduvia-97008.firebasestorage.app",
  messagingSenderId: "1052924233848",
  appId: "1:1052924233848:web:d19b4177fc64890042c58d",
  measurementId: "G-RGYV89KWD4"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
