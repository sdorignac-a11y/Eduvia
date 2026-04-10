import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

onAuthStateChanged(auth, (user) => {
  if (user) {
    console.log("Usuario activo:", user.email);
  } else {
    console.log("No hay usuario logueado");

    window.location.href = "login.html";
  }
});
