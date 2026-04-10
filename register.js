import { auth, db } from "./firebase.js";
import { createUserWithEmailAndPassword } from "firebase/auth";
import { doc, setDoc, serverTimestamp } from "firebase/firestore";

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

  if (password.length < 6) {
    alert("La contraseña debe tener al menos 6 caracteres.");
    return;
  }

  if (password !== password2) {
    alert("Las contraseñas no coinciden.");
    return;
  }

  if (!terms.checked) {
    alert("Tenés que aceptar los términos y condiciones.");
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

    alert("Cuenta creada con éxito.");
    window.location.href = "panel.html";
  } catch (error) {
    console.error("Error al crear cuenta:", error);

    let mensaje = "Ocurrió un error al crear la cuenta.";

    if (error.code === "auth/email-already-in-use") {
      mensaje = "Ese correo ya está en uso.";
    } else if (error.code === "auth/invalid-email") {
      mensaje = "El correo no es válido.";
    } else if (error.code === "auth/weak-password") {
      mensaje = "La contraseña es demasiado débil.";
    }

    alert(mensaje);
  }
});
