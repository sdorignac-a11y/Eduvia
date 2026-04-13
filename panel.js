import { auth } from "./firebase.js?v=3";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const $ = (id) => document.getElementById(id);

const userNameEl = $("userName");
const userSubtitleEl = $("userSubtitle");
const heroTitleEl = $("heroTitle");
const heroTextEl = $("heroText");
const logoutBtn = $("logout");

function getDisplayName(user) {
  if (!user) return "Usuario";

  if (user.displayName && user.displayName.trim()) {
    return user.displayName.trim();
  }

  if (user.email) {
    const base = user.email.split("@")[0] || "Usuario";
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  return "Usuario";
}

function getUserSubtitle(user) {
  if (!user?.email) return "Cuenta activa";
  return user.email;
}

function renderUser(user) {
  const name = getDisplayName(user);
  const subtitle = getUserSubtitle(user);

  if (userNameEl) userNameEl.textContent = name;
  if (userSubtitleEl) userSubtitleEl.textContent = subtitle;

  if (heroTitleEl) {
    heroTitleEl.textContent = `Bienvenido, ${name}`;
  }

  if (heroTextEl) {
    heroTextEl.textContent =
      "Accedé rápido a tus herramientas principales y mantené tu espacio de estudio ordenado.";
  }
}

function redirectToLogin() {
  window.location.href = "login.html";
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    console.log("No hay usuario logueado");
    redirectToLogin();
    return;
  }

  console.log("Usuario activo:", user.email || "sin email");
  renderUser(user);
});

if (logoutBtn) {
  logoutBtn.addEventListener("click", async () => {
    try {
      logoutBtn.disabled = true;
      await signOut(auth);
      redirectToLogin();
    } catch (error) {
      console.error("Error al cerrar sesión:", error);
      logoutBtn.disabled = false;
    }
  });
}
