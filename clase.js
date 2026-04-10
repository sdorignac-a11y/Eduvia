import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const loading = document.getElementById("loading");
const contenido = document.getElementById("contenido");

const materiaEl = document.getElementById("materia");
const temaEl = document.getElementById("tema");
const nivelEl = document.getElementById("nivel");
const tituloClaseEl = document.getElementById("titulo-clase");

const params = new URLSearchParams(window.location.search);
const claseId = params.get("id");

if (!claseId) {
  alert("No se encontró el ID de la clase.");
  window.location.href = "panel.html";
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  try {
    const claseRef = doc(db, "users", user.uid, "clases", claseId);
    const claseSnap = await getDoc(claseRef);

    if (!claseSnap.exists()) {
      alert("La clase no existe o no te pertenece.");
      window.location.href = "panel.html";
      return;
    }

    const data = claseSnap.data();

    materiaEl.textContent = data.materia || "-";
    temaEl.textContent = data.tema || "-";
    nivelEl.textContent = data.nivel || "-";
    tituloClaseEl.textContent = data.tema ? `Clase: ${data.tema}` : "Clase";

    loading.style.display = "none";
    contenido.style.display = "block";
  } catch (error) {
    console.error("Error al cargar clase:", error);
    alert("Hubo un error al cargar la clase.");
    window.location.href = "panel.html";
  }
});
