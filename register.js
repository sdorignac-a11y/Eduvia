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

const form = document.getElementById("register-form");

form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  const nombre = document.getElementById("nombre")?.value.trim();
  const apellido = document.getElementById("apellido")?.value.trim();
  const email = document.getElementById("email")?.value.trim();
  const password = document.getElementById("password")?.value;
  const password2 = document.getElementById("password2")?.value;
  const terms = document.querySelector('.terms input[type="checkbox"]');

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
    console.log("1. Creando usuario en Authentication...");
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    user = userCredential.user;

    console.log("2. Usuario creado en Auth:", user.uid);

    // Fuerza a que el token esté listo antes de escribir en Firestore
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

    // Si Auth funcionó pero Firestore falló, borra el usuario para no dejarlo a medias
    if (user && auth.currentUser) {
      try {
        await deleteUser(user);
        console.log("Usuario eliminado de Auth porque Firestore falló.");
      } catch (deleteError) {
        console.error("No se pudo borrar el usuario de Auth:", deleteError);
      }
    }

    if (error.code === "auth/email-already-in-use") {
      alert("Ese correo ya está registrado.");
    } else if (error.code === "permission-denied" || error.code === "firestore/permission-denied") {
      alert("Firestore bloqueó el guardado por permisos.");
    } else {
      alert("Ocurrió un error: " + error.message);
    }
  }
});
