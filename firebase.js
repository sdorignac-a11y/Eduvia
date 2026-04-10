import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "TU_API_KEY",
  authDomain: "eduvia-97008.firebaseapp.com",
  projectId: "eduvia-97008",
  storageBucket: "eduvia-97008.firebasestorage.app",
  messagingSenderId: "1052924233848",
  appId: "EL_APP_ID_EXACTO_QUE_TE_DA_FIREBASE"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
