import { auth, db } from "./firebase.js?v=3";
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

function withTimeout(promise, ms = 12000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Firestore tardó demasiado en responder")), ms)
    )
  ]);
}

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

    console.log("1. creando usuario en auth...");
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    console.log("2. Auth OK:", user.uid);

    // Fuerza token fresco antes de escribir en Firestore
    await user.getIdToken(true);
    console.log("3. token actualizado");

    console.log("4. guardando en Firestore...");
    await withTimeout(
      setDoc(
        doc(db, "usuarios", user.uid),
        {
          uid: user.uid,
          nombre,
          apellido,
          email,
          creadoEn: serverTimestamp()
        },
        { merge: true }
      )
    );

    console.log("5. Firestore OK");

    localStorage.setItem("registroNombre", nombre);
    localStorage.setItem("registroApellido", apellido);

    window.location.href = "panel.html";

  } catch (error) {
    console.error("ERROR REGISTER COMPLETO:", error);
    alert((error.code || "sin-code") + " | " + (error.message || "Error desconocido"));
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Crear mi cuenta";
    }
  }
});
