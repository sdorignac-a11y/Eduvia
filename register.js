import { auth, db } from "./firebase.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const form = document.getElementById("register-form");

console.log("register.js cargado");

if (!form) {
  console.error("No se encontró el formulario register-form");
}

form?.addEventListener("submit", async (e) => {
  e.preventDefault();
  console.log("Submit de registro detectado");

  const nombre = document.getElementById("nombre")?.value.trim();
  const apellido = document.getElementById("apellido")?.value.trim();
  const email = document.getElementById("email")?.value.trim();
  const password = document.getElementById("password")?.value;
  const password2 = document.getElementById("password2")?.value;
  const terms = document.querySelector('.terms input[type="checkbox"]');

  console.log({ nombre, apellido, email });

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
    console.log("Intentando crear usuario en Auth...");
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);

    console.log("Usuario creado en Auth:", userCredential.user.uid);

    await setDoc(doc(db, "users", userCredential.user.uid), {
      nombre,
      apellido,
      email,
      creadoEn: serverTimestamp()
    });

    console.log("Usuario guardado en Firestore");
    alert("Cuenta creada con éxito");
    window.location.href = "panel.html";
  } catch (error) {
    console.error("ERROR COMPLETO:", error);
    alert(`Error: ${error.code} | ${error.message}`);
  }
});
