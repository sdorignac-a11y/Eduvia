import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  deleteUser
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

console.log("REGISTER NUEVO CARGADO");

const form = document.getElementById("register-form");

form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const nombre = document.getElementById("nombre")?.value.trim();
  const apellido = document.getElementById("apellido")?.value.trim();
  const email = document.getElementById("email")?.value.trim();
  const password = document.getElementById("password")?.value;
  const password2 = document.getElementById("password2")?.value;
  const terms = document.querySelector('.terms input[type="checkbox"]');
  const submitBtn = form.querySelector('button[type="submit"]');

  if (!nombre || !apellido || !email || !password || !password2) {
    alert("Completá todos los campos.");
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

  let user = null;

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Creando cuenta...";
    }

    console.log("1. Creando usuario en Authentication...");
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    user = userCredential.user;

    console.log("2. Usuario creado en Auth:", user.uid);

    // Fuerza a que el token esté listo
    await user.getIdToken(true);

    console.log("3. Guardando usuario en Firestore...");
    await setDoc(doc(db, "users", user.uid), {
      uid: user.uid,
      nombre,
      apellido,
      email,
      creadoEn: serverTimestamp()
    });

    console.log("4. Usuario guardado en Firestore");
    alert("Cuenta creada con éxito");
    window.location.href = "panel.html";

  } catch (error) {
    console.error("ERROR COMPLETO:", error);
    console.error("ERROR CODE:", error.code);
    console.error("ERROR MESSAGE:", error.message);

    // Si Auth sí creó el usuario pero Firestore falló, lo borramos
    if (user) {
      try {
        await deleteUser(user);
        console.log("Usuario eliminado de Authentication porque Firestore falló.");
      } catch (deleteError) {
        console.error("No se pudo borrar el usuario de Auth:", deleteError);
      }
    }

    if (error.code === "auth/email-already-in-use") {
      alert("Ese correo ya está registrado.");
    } else if (
      error.code === "permission-denied" ||
      error.code === "firestore/permission-denied"
    ) {
      alert("Firestore bloqueó el guardado por permisos.");
    } else {
      alert("Error al crear la cuenta: " + error.message);
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Crear mi cuenta";
    }
  }
});
