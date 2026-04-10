import { auth, db } from "./firebase.js";
import { createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const form = document.getElementById("register-form");

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const nombre = document.getElementById("nombre").value.trim();
  const apellido = document.getElementById("apellido").value.trim();
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const password2 = document.getElementById("password2").value;
  const terms = document.querySelector('.terms input[type="checkbox"]');

  if (!nombre || !apellido || !email || !password || !password2) {
    alert("Completá todos los campos.");
    return;
  }

  if (password !== password2) {
    alert("Las contraseñas no coinciden.");
    return;
  }

  if (!terms.checked) {
    alert("Tenés que aceptar los términos.");
    return;
  }

  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    await setDoc(doc(db, "users", user.uid), {
      nombre,
      apellido,
      email,
      plan: "free",
      creadoEn: serverTimestamp()
    });

    alert("Cuenta creada con éxito");
    window.location.href = "panel.html";
  } catch (error) {
    console.error(error);
    alert("Error al crear cuenta: " + error.message);
  }
});
