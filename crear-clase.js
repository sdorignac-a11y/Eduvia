import { auth, db } from "./firebase.js?v=7";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const form = document.getElementById("clase-form");
const archivoInput = document.getElementById("archivo");
const fileList = document.getElementById("file-list");

let currentUser = null;
let isSubmitting = false;

function getValue(id) {
  return document.getElementById(id)?.value?.trim() || "";
}

function renderFiles(files = []) {
  if (!fileList) return;

  fileList.innerHTML = "";

  files.forEach((file) => {
    const item = document.createElement("div");
    item.className = "file-item";
    item.textContent = `📄 ${file.name}`;
    fileList.appendChild(item);
  });
}

function getSelectedFormato() {
  return document.querySelector('input[name="formato"]:checked')?.value || "pizarron";
}

function buildDestino(formato, claseId, ownerUid) {
  const base = formato === "documento" ? "documento.html" : "clase.html";
  return `${base}?id=${encodeURIComponent(claseId)}&owner=${encodeURIComponent(ownerUid)}`;
}

function saveClaseInLocalStorage(clase) {
  try {
    localStorage.setItem("claseActual", JSON.stringify(clase));
    localStorage.setItem(
      `claseActual:${clase.ownerUid}:${clase.id}`,
      JSON.stringify(clase)
    );
  } catch (error) {
    console.warn("No se pudo guardar la clase en localStorage:", error);
  }
}

function setSubmitState(disabled) {
  const submitBtn = form?.querySelector('button[type="submit"]');
  if (!submitBtn) return;

  submitBtn.disabled = disabled;
  submitBtn.style.opacity = disabled ? "0.7" : "1";
  submitBtn.style.pointerEvents = disabled ? "none" : "auto";
  submitBtn.textContent = disabled ? "Creando clase..." : "Crear clase";
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  currentUser = user;
});

form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (isSubmitting) return;

  if (!currentUser) {
    alert("Todavía no cargó el usuario. Probá de nuevo en un segundo.");
    return;
  }

  const materia = getValue("materia");
  const tema = getValue("tema");
  const nivel = document.getElementById("nivel")?.value || "";
  const duracion = document.getElementById("duracion")?.value || "";
  const objetivo = getValue("objetivo");
  const formato = getSelectedFormato();

  if (!materia || !tema || !nivel) {
    alert("Completá materia, tema y nivel.");
    return;
  }

  isSubmitting = true;
  setSubmitState(true);

  try {
    const payload = {
      materia,
      tema,
      nivel,
      duracion,
      objetivo,
      formato,
      ownerUid: currentUser.uid,
      ownerEmail: currentUser.email || "",
      creadoEn: serverTimestamp(),
      updatedAt: serverTimestamp(),
      sharedWithEmails: [],
      sharedViewerEmails: [],
      sharedEditorEmails: [],
      sharedUsers: {}
    };

    const docRef = await addDoc(
      collection(db, "usuarios", currentUser.uid, "clases"),
      payload
    );

    const claseGuardada = {
      id: docRef.id,
      materia,
      tema,
      nivel,
      duracion,
      objetivo,
      formato,
      ownerUid: currentUser.uid,
      ownerEmail: currentUser.email || "",
      sharedWithEmails: [],
      sharedViewerEmails: [],
      sharedEditorEmails: [],
      sharedUsers: {}
    };

    saveClaseInLocalStorage(claseGuardada);

    const destino = buildDestino(formato, docRef.id, currentUser.uid);
    window.location.href = destino;
  } catch (error) {
    console.error("Error al crear la clase:", error);
    alert("Error al crear la clase: " + (error.message || "No se pudo guardar."));
  } finally {
    isSubmitting = false;
    setSubmitState(false);
  }
});

if (archivoInput) {
  archivoInput.addEventListener("change", () => {
    const files = Array.from(archivoInput.files || []);
    renderFiles(files);
  });
}
