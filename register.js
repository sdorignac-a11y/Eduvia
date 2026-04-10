import { auth, db } from "./firebase.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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

  try {
    console.log("1. Creando usuario en Authentication...");
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    console.log("2. Usuario creado en Auth:", user.uid);

    try {
      console.log("3. Guardando usuario en Firestore...");
      await setDoc(doc(db, "users", user.uid), {
        nombre,
        apellido,
        email,
        creadoEn: serverTimestamp()
      });

      console.log("4. Usuario guardado en Firestore");
      alert("Cuenta creada con éxito");
      window.location.href = "panel.html";
    } catch (firestoreError) {
      console.error("ERROR FIRESTORE:", firestoreError);
      alert("El usuario se creó en Authentication, pero falló Firestore: " + firestoreError.message);
    }

  } catch (authError) {
    console.error("ERROR AUTH:", authError);
    alert("Falló Authentication: " + authError.message);
  }
});
