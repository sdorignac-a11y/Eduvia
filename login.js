import { auth } from "./firebase.js?v=3"
import { signInWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const form = document.getElementById("login-form");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;

  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    console.log("Usuario logueado:", userCredential.user);

    // Redirigir al panel
    window.location.href = "panel.html";

  } catch (error) {
    console.error(error);

    alert("Error al iniciar sesión: " + error.message);
  }
});
