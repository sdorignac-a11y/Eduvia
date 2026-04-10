import { auth, db } from "./firebase.js";
import {
  createUserWithEmailAndPassword,
  deleteUser,
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

console.log("REGISTER LIMPIO CARGADO");

const form = document.getElementById("register-form");
const googleBtn = document.getElementById("google-register-btn");
const provider = new GoogleAuthProvider();

function esMobile() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
}

async function guardarUsuarioEnFirestore(user, datosExtra = {}) {
  await setDoc(
    doc(db, "users", user.uid),
    {
      uid: user.uid,
      email: user.email || "",
      nombre: datosExtra.nombre || user.displayName?.split(" ")[0] || "",
      apellido: datosExtra.apellido || user.displayName?.split(" ").slice(1).join(" ") || "",
      foto: user.photoURL || "",
      provider: datosExtra.provider || "email",
      creadoEn: serverTimestamp()
    },
    { merge: true }
  );
}

// ---------- REGISTRO CON EMAIL ----------
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

  let user = null;

  try {
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Creando cuenta...";
    }

    const cred = await createUserWithEmailAndPassword(auth, email, password);
    user = cred.user;

    await user.getIdToken(true);

    await guardarUsuarioEnFirestore(user, {
      nombre,
      apellido,
      provider: "email"
    });

    alert("Cuenta creada con éxito");
    window.location.href = "panel.html";
  } catch (error) {
    console.error("ERROR EMAIL:", error);

    if (user) {
      try {
        await deleteUser(user);
      } catch (e) {
        console.error("No se pudo borrar el usuario de Auth:", e);
      }
    }

    alert("Error: " + error.code + " | " + error.message);
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Crear mi cuenta";
    }
  }
});

// ---------- REGISTRO / LOGIN CON GOOGLE ----------
googleBtn?.addEventListener("click", async () => {
  try {
    googleBtn.disabled = true;
    googleBtn.textContent = "Entrando con Google...";

    if (esMobile()) {
      await signInWithRedirect(auth, provider);
      return;
    }

    const result = await signInWithPopup(auth, provider);
    await guardarUsuarioEnFirestore(result.user, { provider: "google" });
    window.location.href = "panel.html";
  } catch (error) {
    console.error("ERROR GOOGLE:", error);
    alert("Error con Google: " + error.code + " | " + error.message);
    googleBtn.disabled = false;
    googleBtn.textContent = "Continuar con Google";
  }
});

getRedirectResult(auth)
  .then(async (result) => {
    if (!result?.user) return;
    await guardarUsuarioEnFirestore(result.user, { provider: "google" });
    window.location.href = "panel.html";
  })
  .catch((error) => {
    console.error("ERROR REDIRECT:", error);
    alert("Error con Google Redirect: " + error.code + " | " + error.message);

    if (googleBtn) {
      googleBtn.disabled = false;
      googleBtn.textContent = "Continuar con Google";
    }
  });
