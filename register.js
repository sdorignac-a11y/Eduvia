import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

import {
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

console.log("register.js cargado");

const form = document.getElementById("register-form");

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  console.log("submit detectado");

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

    console.log("Antes de Auth");

    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    console.log("Auth OK:", user.uid);
    console.log("Antes de Firestore");

    const ref = doc(db, "usuarios", user.uid);
    console.log("Referencia creada:", ref.path);

    await setDoc(ref, {
      uid: user.uid,
      nombre,
      apellido,
      email,
      creadoEn: serverTimestamp()
    });

    console.log("Firestore OK");

    localStorage.setItem("registroNombre", nombre);
    localStorage.setItem("registroApellido", apellido);

    window.location.href = "panel.html";
  } catch (error) {
    console.error("ERROR REGISTER COMPLETO:", error);
    console.error("CODE:", error.code);
    console.error("MESSAGE:", error.message);
    alert("Error: " + error.code + " | " + error.message);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Crear mi cuenta";
    }
  }
});
