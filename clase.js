import { auth, db } from "./firebase.js?v=7";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const loading = document.getElementById("loading");
const contenido = document.getElementById("contenido");

const tituloClase = document.getElementById("titulo-clase");
const materiaEl = document.getElementById("materia");
const temaEl = document.getElementById("tema");
const nivelEl = document.getElementById("nivel");
const duracionEl = document.getElementById("duracion");
const objetivoEl = document.getElementById("objetivo");

const params = new URLSearchParams(window.location.search);
const claseId = params.get("id");

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  if (!claseId) {
    loading.textContent = "No se encontró el ID de la clase.";
    return;
  }

  try {
    const ref = doc(db, "usuarios", user.uid, "clases", claseId);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      loading.textContent = "La clase no existe o no tenés acceso.";
      return;
    }

    const data = snap.data();

    tituloClase.textContent = data.tema || "Clase";
    materiaEl.textContent = data.materia || "-";
    temaEl.textContent = data.tema || "-";
    nivelEl.textContent = data.nivel || "-";

    if (duracionEl) {
      duracionEl.textContent = data.duracion || "-";
    }

    if (objetivoEl) {
      objetivoEl.textContent = data.objetivo || "-";
    }

    loading.style.display = "none";
    contenido.style.display = "block";
  } catch (error) {
    console.error("Error al cargar la clase:", error);
    loading.textContent = "Error al cargar la clase.";
  }
});
