import { auth } from "./firebase.js";
import {
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const form = document.getElementById("register-form");

form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const nombre = document.getElementById("nombre")?.value.trim();
  const apellido = document.getElementById("apellido")?.value.trim();
  const email = document.getElementById("email")?.value.trim();
  const password = document.getElementById("password")?.value || "";
  const password2 = document.getElementById("password2")?.value || "";
  const terms = document.querySelector('.terms input[type="checkbox"]');
  const submitBtn = form.querySelector('button[type="submit"]');

  if (!nombre || !apellido || !email || !password || !password2) {
    alert("Completá todos los campos.");
    return;
  }

  if (password.length < 6) {
    alert("La contraseña debe tener al menos 6 caracteres.");
    return;
  }

  if (password !== password2) {
    alert("Las contraseñas no coinciden.");
    return;
  }

  if (!terms?.checked) {
    alert("Aceptá los términos.");
    return;
  }

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Creando cuenta...";
    }

    await createUserWithEmailAndPassword(auth, email, password);

    localStorage.setItem("registroNombre", nombre);
    localStorage.setItem("registroApellido", apellido);

    window.location.href = "panel.html";
  } catch (error) {
    console.error("ERROR REGISTER:", error);
    alert("Error: " + error.code + " | " + error.message);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Crear mi cuenta";
    }
  }
});
