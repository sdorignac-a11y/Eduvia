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
const sourceModeInput = document.getElementById("source_mode");
const sourceLinksInput = document.getElementById("source-links");
const sourceLinksHidden = document.getElementById("source_links_hidden");

let currentUser = null;
let isSubmitting = false;

function getValue(id) {
  return document.getElementById(id)?.value?.trim() || "";
}

function limpiarNumeroPalabras(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const num = Number(raw);
  if (!Number.isFinite(num) || num < 0) return "";
  return String(Math.floor(num));
}

function construirExtensionDeseada({
  palabrasMin = "",
  palabrasMax = "",
  duracion = "",
}) {
  const min = String(palabrasMin || "").trim();
  const max = String(palabrasMax || "").trim();
  const dur = String(duracion || "").trim();

  if (min && max) return `Entre ${min} y ${max} palabras`;
  if (min) return `Mínimo ${min} palabras`;
  if (max) return `Máximo ${max} palabras`;
  if (dur) return dur;

  return "";
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

function getAttachedSources(files = []) {
  return files.map((file) => ({
    name: file.name || "",
    type: file.type || "",
    size: Number(file.size || 0),
    lastModified: Number(file.lastModified || 0),
  }));
}

function normalizarLinks(raw = "") {
  return String(raw || "")
    .split("\n")
    .map((link) => link.trim())
    .filter(Boolean);
}

const pageParams = new URLSearchParams(window.location.search);
const pendingTool =
  (pageParams.get("tool") || localStorage.getItem("eduvia_pending_tool") || "")
    .trim()
    .toLowerCase();

function buildDestino(formato, claseId, ownerUid, tool = "") {
  const base = formato === "documento" ? "documento.html" : "clase.html";
  const params = new URLSearchParams();

  params.set("id", claseId);
  params.set("owner", ownerUid);

  if (tool && formato === "documento") {
    params.set("tool", tool);
  }

  return `${base}?${params.toString()}`;
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

  const idleText = "Crear contenido";
  const loadingText = "Creando contenido...";

  submitBtn.disabled = disabled;
  submitBtn.style.opacity = disabled ? "0.7" : "1";
  submitBtn.style.pointerEvents = disabled ? "none" : "auto";
  submitBtn.textContent = disabled ? loadingText : idleText;
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  currentUser = user;
  setSubmitState(false);
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

  const palabrasMin = limpiarNumeroPalabras(getValue("clase_palabras_min"));
  const palabrasMax = limpiarNumeroPalabras(getValue("clase_palabras_max"));
  const extensionDeseada = construirExtensionDeseada({
    palabrasMin,
    palabrasMax,
    duracion,
  });

  const files = Array.from(archivoInput?.files || []);
  const rawLinks = sourceLinksInput?.value?.trim() || "";
  const sourceLinks = normalizarLinks(rawLinks);

  const hasFileSources = files.length > 0;
  const hasLinkSources = sourceLinks.length > 0;
  const hasAttachedSources = hasFileSources || hasLinkSources;
  const sourceMode = hasAttachedSources ? "exclusive" : "general";
  const attachedSources = getAttachedSources(files);

  if (sourceModeInput) {
    sourceModeInput.value = sourceMode;
  }

  if (sourceLinksHidden) {
    sourceLinksHidden.value = rawLinks;
  }

  if (!materia || !tema || !nivel) {
    alert("Completá materia, tema y nivel.");
    return;
  }

  if (palabrasMin && palabrasMax && Number(palabrasMin) > Number(palabrasMax)) {
    alert("El mínimo de palabras no puede ser mayor que el máximo.");
    return;
  }

  isSubmitting = true;
  setSubmitState(true);

  try {
    const payload = {
      materia,
      tema,
      nivel,
      duracion: extensionDeseada || duracion || "",
      palabrasMin,
      palabrasMax,
      extensionDeseada,
      objetivo,
      formato,
      sourceMode,
      hasAttachedSources,
      attachedSources,
      sourceLinks,
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
      duracion: extensionDeseada || duracion || "",
      palabrasMin,
      palabrasMax,
      extensionDeseada,
      objetivo,
      formato,
      sourceMode,
      hasAttachedSources,
      attachedSources,
      sourceLinks,
      ownerUid: currentUser.uid,
      ownerEmail: currentUser.email || "",
      sharedWithEmails: [],
      sharedViewerEmails: [],
      sharedEditorEmails: [],
      sharedUsers: {}
    };

    saveClaseInLocalStorage(claseGuardada);

    const destino = buildDestino(formato, docRef.id, currentUser.uid, pendingTool);
    localStorage.removeItem("eduvia_pending_tool");
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

    const rawLinks = sourceLinksInput?.value?.trim() || "";

    if (sourceModeInput) {
      sourceModeInput.value = (files.length || rawLinks) ? "exclusive" : "general";
    }
  });
}

if (sourceLinksInput) {
  sourceLinksInput.addEventListener("input", () => {
    const rawLinks = sourceLinksInput.value.trim();
    const files = Array.from(archivoInput?.files || []);

    if (sourceModeInput) {
      sourceModeInput.value = (files.length || rawLinks) ? "exclusive" : "general";
    }

    if (sourceLinksHidden) {
      sourceLinksHidden.value = rawLinks;
    }
  });
}
