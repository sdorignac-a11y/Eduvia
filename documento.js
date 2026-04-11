import { auth, db } from "./firebase.js?v=7";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  setDoc,
  serverTimestamp,
  arrayUnion,
  arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const topbarTitle = document.getElementById("topbar-title");
const docTitle = document.getElementById("doc-title");

const chipMateria = document.getElementById("chip-materia");
const chipNivel = document.getElementById("chip-nivel");
const chipDuracion = document.getElementById("chip-duracion");

const metaMateria = document.getElementById("meta-materia");
const metaNivel = document.getElementById("meta-nivel");
const metaDuracion = document.getElementById("meta-duracion");

const docObjective = document.getElementById("doc-objective");
const docContent = document.getElementById("doc-content");

const documentApp = document.getElementById("document-app");
const accessGuard = document.getElementById("access-guard");
const toolbarWrap = document.querySelector(".toolbar-wrap");
const toolbarControls = document.querySelectorAll(
  ".toolbar button, .toolbar select, .toolbar input"
);

const shareModal = document.getElementById("share-modal");
const shareEmailInput = document.getElementById("share-email");
const shareRoleSelect = document.getElementById("share-role");
const shareStatus = document.getElementById("share-status");
const docLinkInput = document.getElementById("doc-link");

const params = new URLSearchParams(window.location.search);
const claseIdFromUrl = params.get("id") || params.get("doc");
const ownerUidFromUrl = params.get("owner");

const SHARED_DOC_KEY = "eduvia_shared_doc_access";
const SUPPORT_PANEL_ID = "document-support-panel";

let currentUser = null;
let currentClaseId = claseIdFromUrl || null;
let currentOwnerUid = ownerUidFromUrl || null;
let currentClaseRef = null;
let currentClaseData = null;
let currentRole = "viewer";
let saveTimer = null;
let saveInFlight = false;
let shareUiInitialized = false;

if (documentApp) {
  documentApp.style.display = "none";
}
if (accessGuard) {
  accessGuard.classList.remove("show");
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeEmail(email = "") {
  return String(email || "").trim().toLowerCase();
}

function emailToKey(email = "") {
  return normalizeEmail(email).replace(/[^a-z0-9]/gi, "_");
}

function normalizeRole(role = "") {
  return role === "editor" ? "editor" : "viewer";
}

function canEdit() {
  return currentRole === "owner" || currentRole === "editor";
}

function setSharedDocSession(role, user, ownerUid, claseId) {
  if (!user || !ownerUid || !claseId) return;

  if (role === "owner") {
    sessionStorage.removeItem(SHARED_DOC_KEY);
    return;
  }

  sessionStorage.setItem(
    SHARED_DOC_KEY,
    JSON.stringify({
      userUid: user.uid,
      userEmail: normalizeEmail(user.email || ""),
      ownerUid,
      claseId,
      role
    })
  );
}

function clearSharedDocSession() {
  sessionStorage.removeItem(SHARED_DOC_KEY);
}

function localStorageKey(ownerUid, claseId) {
  return `claseActual:${ownerUid || "unknown"}:${claseId || "unknown"}`;
}

function readClaseFromLocalStorage(ownerUid, claseId) {
  try {
    const specificKey = localStorageKey(ownerUid, claseId);
    const specific = localStorage.getItem(specificKey);
    if (specific) return JSON.parse(specific);

    const legacy = localStorage.getItem("claseActual");
    if (legacy) return JSON.parse(legacy);

    return null;
  } catch {
    return null;
  }
}

function writeClaseToLocalStorage(clase, ownerUid, claseId) {
  try {
    if (!clase || !ownerUid || !claseId) return;
    localStorage.setItem(localStorageKey(ownerUid, claseId), JSON.stringify(clase));
    localStorage.setItem("claseActual", JSON.stringify(clase));
  } catch {
    // no-op
  }
}

function stripObjectivePrefix(value = "") {
  return String(value || "")
    .replace(/^objetivo:\s*/i, "")
    .trim();
}

function limpiarTexto(value = "") {
  return String(value || "").trim();
}

function sanitizeUrl(value = "") {
  try {
    const url = new URL(String(value), window.location.origin);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.href;
    }
    return "";
  } catch {
    return "";
  }
}

function getDocumentoTitle(clase = {}) {
  return clase.tituloDocumento || clase.tema || "Documento sin título";
}

function getDocumentoObjective(clase = {}) {
  return clase.objetivoDocumento || clase.objetivo || "";
}

function getInvestigacionDocumento(clase = {}) {
  return limpiarTexto(
    clase.investigacion ||
      clase.research ||
      clase.baseInvestigada ||
      clase.resumenInvestigacion ||
      ""
  );
}

function getFuentesDocumento(clase = {}) {
  const raw =
    clase.fuentes ||
    clase.sources ||
    clase.webSources ||
    clase.fuentesUsadas ||
    [];

  if (!Array.isArray(raw)) return [];

  const seen = new Set();

  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      const title = limpiarTexto(item.title || item.titulo || item.name || "Fuente");
      const url = sanitizeUrl(item.url || item.link || "");
      const key = `${title}|${url}`;

      if (!title && !url) return null;
      if (seen.has(key)) return null;

      seen.add(key);

      return {
        title: title || "Fuente",
        url
      };
    })
    .filter(Boolean)
    .slice(0, 10);
}

function splitResearchParagraphs(text = "") {
  const clean = limpiarTexto(text);
  if (!clean) return [];

  const blocks = clean
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (blocks.length > 1) return blocks;

  return clean
    .split(/\.\s+(?=[A-ZÁÉÍÓÚÑ])/)
    .map((item) => item.trim())
    .filter(Boolean)
    .reduce((acc, sentence, index) => {
      const value = sentence.endsWith(".") ? sentence : `${sentence}.`;
      const bucket = Math.floor(index / 2);

      if (!acc[bucket]) acc[bucket] = value;
      else acc[bucket] += ` ${value}`;

      return acc;
    }, [])
    .filter(Boolean);
}

function ensureSupportPanel() {
  if (!docContent || !docContent.parentNode) return null;

  let panel = document.getElementById(SUPPORT_PANEL_ID);
  if (panel) return panel;

  panel = document.createElement("section");
  panel.id = SUPPORT_PANEL_ID;
  panel.setAttribute("contenteditable", "false");
  panel.style.marginTop = "26px";
  panel.style.padding = "18px";
  panel.style.borderRadius = "22px";
  panel.style.background = "linear-gradient(180deg, #f8fbff 0%, #f3f8ff 100%)";
  panel.style.border = "1px solid rgba(53, 93, 149, .12)";
  panel.style.boxShadow = "0 10px 28px rgba(0,0,0,.05)";
  panel.style.display = "none";

  docContent.parentNode.insertBefore(panel, docContent.nextSibling);
  return panel;
}

function clearSupportPanel() {
  const panel = document.getElementById(SUPPORT_PANEL_ID);
  if (!panel) return;
  panel.innerHTML = "";
  panel.style.display = "none";
}

function renderSupportPanel(clase = {}) {
  const panel = ensureSupportPanel();
  if (!panel) return;

  const investigacion = getInvestigacionDocumento(clase);
  const fuentes = getFuentesDocumento(clase);
  const paragraphs = splitResearchParagraphs(investigacion);

  if (!paragraphs.length && !fuentes.length) {
    clearSupportPanel();
    return;
  }

  const researchHtml = paragraphs.length
    ? `
      <div style="margin-bottom:${fuentes.length ? "20px" : "0"};">
        <div style="display:inline-flex;align-items:center;gap:8px;padding:7px 12px;border-radius:999px;background:#eaf3ff;color:#2d4f76;font-size:.82rem;font-weight:800;margin-bottom:12px;">
          Base investigada por Eduvia
        </div>
        <h3 style="margin:0 0 10px;color:#2d4f76;font-size:1.08rem;font-weight:800;">Investigación previa</h3>
        <div style="display:grid;gap:10px;">
          ${paragraphs
            .map(
              (item) => `
                <p style="margin:0;line-height:1.7;color:#30414f;font-size:.98rem;">
                  ${escapeHtml(item)}
                </p>
              `
            )
            .join("")}
        </div>
      </div>
    `
    : "";

  const fuentesHtml = fuentes.length
    ? `
      <div>
        <h3 style="margin:0 0 10px;color:#2d4f76;font-size:1.08rem;font-weight:800;">Fuentes consultadas</h3>
        <div style="display:grid;gap:10px;">
          ${fuentes
            .map((fuente, index) => {
              const title = escapeHtml(fuente.title || `Fuente ${index + 1}`);
              const safeUrl = sanitizeUrl(fuente.url || "");
              const visibleUrl = safeUrl
                ? escapeHtml(safeUrl.replace(/^https?:\/\//, ""))
                : "URL no disponible";

              return `
                <article style="padding:12px 14px;border-radius:16px;background:#ffffff;border:1px solid rgba(53,93,149,.10);">
                  <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px;">
                    <strong style="color:#2d4f76;font-size:.95rem;line-height:1.4;">${title}</strong>
                    <span style="flex-shrink:0;padding:4px 9px;border-radius:999px;background:#eef5ff;color:#355d95;font-size:.74rem;font-weight:800;">
                      Fuente ${index + 1}
                    </span>
                  </div>
                  ${
                    safeUrl
                      ? `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="color:#5e6c78;font-size:.86rem;line-height:1.45;text-decoration:none;word-break:break-word;">${visibleUrl}</a>`
                      : `<span style="color:#5e6c78;font-size:.86rem;line-height:1.45;">${visibleUrl}</span>`
                  }
                </article>
              `;
            })
            .join("")}
        </div>
      </div>
    `
    : "";

  panel.innerHTML = researchHtml + fuentesHtml;
  panel.style.display = "";
}

function setBasicMeta(clase = {}) {
  const titulo = getDocumentoTitle(clase);
  const materia = clase.materia || "Sin materia";
  const nivel = clase.nivel || "No definido";
  const duracion = clase.duracion || "No definida";
  const objetivo = getDocumentoObjective(clase);

  if (topbarTitle) topbarTitle.textContent = titulo;
  if (docTitle) docTitle.textContent = titulo;

  if (chipMateria) chipMateria.textContent = `Materia: ${materia}`;
  if (chipNivel) chipNivel.textContent = `Nivel: ${nivel}`;
  if (chipDuracion) chipDuracion.textContent = `Duración: ${duracion}`;

  if (metaMateria) metaMateria.textContent = `Materia: ${materia}`;
  if (metaNivel) metaNivel.textContent = `Nivel: ${nivel}`;
  if (metaDuracion) metaDuracion.textContent = `Duración: ${duracion}`;

  if (docObjective) {
    docObjective.textContent = objetivo
      ? `Objetivo: ${objetivo}`
      : "Objetivo: todavía no se definió un objetivo para esta clase.";
  }
}

function renderError(message) {
  clearSupportPanel();

  if (!docContent) return;

  docContent.innerHTML = `
    <div class="doc-placeholder">
      <p><strong>No se pudo cargar el documento.</strong></p>
      <p>${escapeHtml(message)}</p>
    </div>
  `;

  if (documentApp) {
    documentApp.style.display = "";
  }
}

function renderGeneratedStructure(clase = {}) {
  if (!docContent) return;

  const materia = escapeHtml(clase.materia || "la materia");
  const tema = escapeHtml(getDocumentoTitle(clase));
  const nivel = escapeHtml(clase.nivel || "el nivel seleccionado");
  const duracion = escapeHtml(clase.duracion || "la duración indicada");
  const objetivo = escapeHtml(
    getDocumentoObjective(clase) || "comprender mejor el contenido trabajado"
  );

  const investigacion = getInvestigacionDocumento(clase);
  const researchParagraphs = splitResearchParagraphs(investigacion);

  docContent.innerHTML = `
    <h2>Resumen</h2>
    <p>
      Este documento organiza la clase de <strong>${materia}</strong> sobre
      <strong>${tema}</strong> en un formato claro y fácil de estudiar.
      Está pensado para una explicación adaptada a <strong>${nivel}</strong>,
      con una duración estimada de <strong>${duracion}</strong>.
    </p>

    <p>
      El foco principal de esta clase es <strong>${objetivo}</strong>.
      Por eso, el contenido debería avanzar de forma ordenada, con definiciones,
      explicación paso a paso y ejemplos simples antes de pasar a ideas más complejas.
    </p>

    <h2>Desarrollo del tema</h2>
    <p>
      En esta sección la IA va a volcar la explicación principal del tema. La idea es que
      se vea como un apunte serio: limpio, entendible y útil para repasar después.
    </p>

    <p>
      Según la materia y el nivel, acá después pueden aparecer fórmulas, conceptos,
      definiciones, reglas, vocabulario, fechas importantes, procesos, ejemplos o análisis.
    </p>

    ${
      researchParagraphs.length
        ? `
          <h2>Base investigada</h2>
          ${researchParagraphs
            .slice(0, 3)
            .map((item) => `<p>${escapeHtml(item)}</p>`)
            .join("")}
        `
        : ""
    }

    <h2>Puntos clave</h2>
    <ul>
      <li>La clase está centrada en el tema: <strong>${tema}</strong>.</li>
      <li>El contenido debe estar adaptado al nivel: <strong>${nivel}</strong>.</li>
      <li>El objetivo principal es: <strong>${objetivo}</strong>.</li>
      <li>Este formato documento sirve para leer, repasar y estudiar con más claridad.</li>
    </ul>

    <h2>Ejemplo o aplicación</h2>
    <p>
      Más adelante, esta parte puede mostrar un ejemplo guiado o una aplicación concreta
      del contenido para que el alumno no solo lea teoría, sino que también vea cómo se usa.
    </p>

    <blockquote>
      Este documento es una base visual. El próximo paso es conectar la generación real
      del contenido con IA para que acá aparezca la explicación completa automáticamente.
    </blockquote>

    <h2>Cierre</h2>
    <p>
      Al final de la clase, este mismo documento puede resumir lo más importante y servir
      como punto de partida para crear ejercicios, tarjetas de memoria o un resumen más corto.
    </p>
  `;
}

function renderRichHtmlDocumento(clase = {}) {
  if (!docContent) return false;

  const html =
    clase.contenidoHtml ||
    clase.documentoHtml ||
    clase.htmlDocumento ||
    "";

  if (!html || typeof html !== "string" || !html.trim()) {
    return false;
  }

  docContent.innerHTML = html;
  return true;
}

function renderStructuredDocumento(clase = {}) {
  if (!docContent) return false;

  const contenido = clase.documento || clase.contenidoDocumento || clase.contenido || null;

  if (!contenido || typeof contenido !== "object" || Array.isArray(contenido)) {
    return false;
  }

  const resumen = escapeHtml(contenido.resumen || "");
  const explicacion = escapeHtml(contenido.explicacion || "");
  const ejemplo = escapeHtml(contenido.ejemplo || "");
  const cierre = escapeHtml(contenido.cierre || "");

  const puntosClave = Array.isArray(contenido.puntosClave) ? contenido.puntosClave : [];
  const preguntas = Array.isArray(contenido.preguntas) ? contenido.preguntas : [];

  let html = "";

  if (resumen) {
    html += `
      <h2>Resumen</h2>
      <p>${resumen}</p>
    `;
  }

  if (explicacion) {
    html += `
      <h2>Desarrollo del tema</h2>
      <p>${explicacion}</p>
    `;
  }

  if (puntosClave.length) {
    html += `<h2>Puntos clave</h2><ul>`;
    html += puntosClave.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    html += `</ul>`;
  }

  if (ejemplo) {
    html += `
      <h2>Ejemplo o aplicación</h2>
      <p>${ejemplo}</p>
    `;
  }

  if (preguntas.length) {
    html += `<h2>Preguntas para practicar</h2><ol>`;
    html += preguntas.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    html += `</ol>`;
  }

  if (cierre) {
    html += `
      <h2>Cierre</h2>
      <p>${cierre}</p>
    `;
  }

  if (!html.trim()) return false;

  docContent.innerHTML = html;
  return true;
}

function renderPlainTextDocumento(clase = {}) {
  if (!docContent) return false;

  const rawText =
    clase.documentoTexto ||
    clase.textoDocumento ||
    clase.contenidoTexto ||
    "";

  if (!rawText || typeof rawText !== "string") return false;

  const blocks = rawText
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (!blocks.length) return false;

  docContent.innerHTML = blocks
    .map((block, index) => {
      if (index === 0) {
        return `<p><strong>${escapeHtml(block)}</strong></p>`;
      }
      return `<p>${escapeHtml(block)}</p>`;
    })
    .join("");

  return true;
}

function renderClase(clase = {}) {
  setBasicMeta(clase);

  if (renderRichHtmlDocumento(clase)) {
    renderSupportPanel(clase);
    return;
  }

  if (renderStructuredDocumento(clase)) {
    renderSupportPanel(clase);
    return;
  }

  if (renderPlainTextDocumento(clase)) {
    renderSupportPanel(clase);
    return;
  }

  renderGeneratedStructure(clase);
  renderSupportPanel(clase);
}

function setEditableState(element, editable) {
  if (!element) return;
  element.setAttribute("contenteditable", editable ? "true" : "false");
}

function applyRoleUi(role) {
  const editable = role === "owner" || role === "editor";

  setEditableState(docTitle, editable);
  setEditableState(docObjective, editable);
  setEditableState(docContent, editable);

  toolbarControls.forEach((control) => {
    control.disabled = !editable;
  });

  if (toolbarWrap) {
    toolbarWrap.style.opacity = editable ? "1" : "0.55";
    toolbarWrap.style.pointerEvents = editable ? "auto" : "none";
  }

  const openShareBtn = document.getElementById("open-share-btn");
  if (openShareBtn) {
    openShareBtn.style.display = role === "owner" ? "" : "none";
  }
}

function showDenied() {
  if (documentApp) documentApp.style.display = "none";
  if (accessGuard) accessGuard.classList.add("show");
}

function showDocument() {
  if (accessGuard) accessGuard.classList.remove("show");
  if (documentApp) documentApp.style.display = "";
}

function resolveUserRole(clase, user, ownerUid) {
  if (!user) return null;
  if (user.uid === ownerUid) return "owner";

  const email = normalizeEmail(user.email);
  if (!email) return null;

  const viewerEmails = Array.isArray(clase.sharedViewerEmails)
    ? clase.sharedViewerEmails.map(normalizeEmail)
    : [];

  const editorEmails = Array.isArray(clase.sharedEditorEmails)
    ? clase.sharedEditorEmails.map(normalizeEmail)
    : [];

  const allEmails = Array.isArray(clase.sharedWithEmails)
    ? clase.sharedWithEmails.map(normalizeEmail)
    : [];

  if (editorEmails.includes(email)) return "editor";
  if (viewerEmails.includes(email)) return "viewer";
  if (allEmails.includes(email)) return "viewer";

  const sharedUsers = clase.sharedUsers && typeof clase.sharedUsers === "object"
    ? clase.sharedUsers
    : {};

  const key = emailToKey(email);
  const sharedUser = sharedUsers[key] || null;

  if (sharedUser?.role) {
    return normalizeRole(sharedUser.role);
  }

  const legacyShared = Array.isArray(clase.sharedWith) ? clase.sharedWith : [];
  const legacyEntry = legacyShared.find(
    (item) => normalizeEmail(item?.email) === email
  );

  if (legacyEntry) {
    return normalizeRole(legacyEntry.role);
  }

  return null;
}

async function generarDocumentoSiFalta(clase = {}) {
  const yaExiste =
    limpiarTexto(clase.contenidoHtml) ||
    limpiarTexto(clase.documentoHtml) ||
    limpiarTexto(clase.htmlDocumento) ||
    limpiarTexto(clase.documentoTexto) ||
    limpiarTexto(clase.textoDocumento) ||
    limpiarTexto(clase.contenidoTexto) ||
    (clase.documento && typeof clase.documento === "object") ||
    (clase.contenidoDocumento && typeof clase.contenidoDocumento === "object") ||
    (clase.contenido && typeof clase.contenido === "object");

  if (yaExiste) {
    return clase;
  }

  if (!clase?.materia || !clase?.tema || !clase?.nivel) {
    return clase;
  }

  const payload = {
    materia: clase.materia || "",
    tema: clase.tema || "",
    nivel: clase.nivel || "",
    duracion: clase.duracion || "",
    objetivo: clase.objetivo || "",
    investigacion: clase.investigacion || "",
    fuentes: Array.isArray(clase.fuentes) ? clase.fuentes : [],
  };

  const response = await fetch("/api/generar-documento", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("El servidor devolvió un formato inválido al generar el documento.");
  }

  if (!response.ok || !data?.ok || !data?.documento) {
    throw new Error(data?.error || "No se pudo generar el documento.");
  }

  const merged = {
    ...clase,
    tituloDocumento:
      data.documento.tituloDocumento ||
      clase.tituloDocumento ||
      clase.tema ||
      "Documento",
    objetivoDocumento:
      data.documento.objetivoDocumento ||
      clase.objetivoDocumento ||
      clase.objetivo ||
      "",
    contenidoHtml: data.documento.contenidoHtml || "",
    resumenDocumento: data.documento.resumenCorto || "",
    investigacion: data.investigacion || clase.investigacion || "",
    fuentes: Array.isArray(data.fuentes)
      ? data.fuentes
      : Array.isArray(clase.fuentes)
        ? clase.fuentes
        : [],
    updatedAt: new Date().toISOString()
  };

  if (currentClaseRef && canEdit()) {
    try {
      await setDoc(
        currentClaseRef,
        {
          tituloDocumento: merged.tituloDocumento,
          objetivoDocumento: merged.objetivoDocumento,
          contenidoHtml: merged.contenidoHtml,
          resumenDocumento: merged.resumenDocumento,
          investigacion: merged.investigacion,
          fuentes: merged.fuentes,
          updatedAt: serverTimestamp()
        },
        { merge: true }
      );
    } catch (error) {
      console.error("Error guardando documento generado:", error);
    }
  }

  currentClaseData = merged;
  writeClaseToLocalStorage(merged, currentOwnerUid, currentClaseId);

  return merged;
}

function updateTopbarTitleFromEditor() {
  if (!topbarTitle || !docTitle) return;
  const value = docTitle.textContent.trim();
  topbarTitle.textContent = value || "Documento sin título";
}

function getCurrentDocumentPayload() {
  const titulo = docTitle?.textContent?.trim() || "Documento sin título";
  const objetivoRaw = docObjective?.textContent?.trim() || "";
  const objetivo = stripObjectivePrefix(objetivoRaw);
  const contenidoHtml = docContent?.innerHTML || "";

  return {
    tituloDocumento: titulo,
    objetivoDocumento: objetivo,
    contenidoHtml,
    ultimoEditorUid: currentUser?.uid || "",
    ultimoEditorEmail: normalizeEmail(currentUser?.email || ""),
    updatedAt: serverTimestamp()
  };
}

function scheduleSave() {
  if (!currentClaseRef || !canEdit()) return;

  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveDocumentEdits();
  }, 700);
}

async function saveDocumentEdits(force = false) {
  if (!currentClaseRef || !canEdit()) return;
  if (saveInFlight && !force) return;

  saveInFlight = true;

  try {
    const payload = getCurrentDocumentPayload();

    await updateDoc(currentClaseRef, payload);

    currentClaseData = {
      ...(currentClaseData || {}),
      ...payload,
      updatedAt: new Date().toISOString()
    };

    writeClaseToLocalStorage(currentClaseData, currentOwnerUid, currentClaseId);
  } catch (error) {
    console.error("Error guardando documento:", error);

    try {
      const payload = getCurrentDocumentPayload();
      await setDoc(currentClaseRef, payload, { merge: true });

      currentClaseData = {
        ...(currentClaseData || {}),
        ...payload,
        updatedAt: new Date().toISOString()
      };

      writeClaseToLocalStorage(currentClaseData, currentOwnerUid, currentClaseId);
    } catch (secondError) {
      console.error("Error secundario guardando documento:", secondError);
    }
  } finally {
    saveInFlight = false;
  }
}

function attachAutosaveListeners() {
  const onInput = () => {
    updateTopbarTitleFromEditor();
    scheduleSave();
  };

  docTitle?.addEventListener("input", onInput);
  docObjective?.addEventListener("input", onInput);
  docContent?.addEventListener("input", onInput);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(saveTimer);
      saveDocumentEdits(true);
    }
  });
}

function getShareUrl() {
  if (!currentClaseId || !currentOwnerUid) return window.location.href;

  const url = new URL(window.location.href);
  url.searchParams.set("id", currentClaseId);
  url.searchParams.set("owner", currentOwnerUid);
  return url.toString();
}

function replaceElementToClearOldListeners(id) {
  const oldEl = document.getElementById(id);
  if (!oldEl || !oldEl.parentNode) return oldEl;
  const clone = oldEl.cloneNode(true);
  oldEl.parentNode.replaceChild(clone, oldEl);
  return clone;
}

function setupShareUi() {
  if (!shareModal || shareUiInitialized) return;
  shareUiInitialized = true;

  const openShareBtn = replaceElementToClearOldListeners("open-share-btn");
  const closeShareBtn = replaceElementToClearOldListeners("close-share-btn");
  const copyLinkBtn = replaceElementToClearOldListeners("copy-link-btn");
  const sendShareBtn = replaceElementToClearOldListeners("send-share-btn");

  if (docLinkInput) {
    docLinkInput.value = getShareUrl();
  }

  openShareBtn?.addEventListener("click", () => {
    if (docLinkInput) docLinkInput.value = getShareUrl();
    if (shareStatus) shareStatus.textContent = "";
    shareModal.classList.add("show");
  });

  closeShareBtn?.addEventListener("click", () => {
    shareModal.classList.remove("show");
  });

  shareModal.addEventListener("click", (e) => {
    if (e.target === shareModal) {
      shareModal.classList.remove("show");
    }
  });

  copyLinkBtn?.addEventListener("click", async () => {
    try {
      const url = getShareUrl();
      await navigator.clipboard.writeText(url);
      if (docLinkInput) docLinkInput.value = url;
      if (shareStatus) shareStatus.textContent = "Link copiado.";
    } catch {
      if (shareStatus) shareStatus.textContent = "No se pudo copiar el link.";
    }
  });

  sendShareBtn?.addEventListener("click", async () => {
    if (currentRole !== "owner") {
      if (shareStatus) {
        shareStatus.textContent = "Solo el dueño del documento puede compartirlo.";
      }
      return;
    }

    const email = normalizeEmail(shareEmailInput?.value || "");
    const role = normalizeRole(shareRoleSelect?.value || "viewer");

    if (!email) {
      if (shareStatus) shareStatus.textContent = "Escribí un email válido.";
      return;
    }

    if (!currentClaseRef || !currentClaseId || !currentOwnerUid) {
      if (shareStatus) {
        shareStatus.textContent = "Todavía no se pudo identificar este documento.";
      }
      return;
    }

    if (email === normalizeEmail(currentUser?.email || "")) {
      if (shareStatus) {
        shareStatus.textContent = "Ese email ya es el dueño del documento.";
      }
      return;
    }

    try {
      const sharedUserKey = `sharedUsers.${emailToKey(email)}`;

      const updates = {
        sharedWithEmails: arrayUnion(email),
        [sharedUserKey]: {
          email,
          role,
          invitedBy: normalizeEmail(currentUser?.email || ""),
          invitedAt: new Date().toISOString()
        },
        updatedAt: serverTimestamp()
      };

      if (role === "editor") {
        updates.sharedEditorEmails = arrayUnion(email);
        updates.sharedViewerEmails = arrayRemove(email);
      } else {
        updates.sharedViewerEmails = arrayUnion(email);
        updates.sharedEditorEmails = arrayRemove(email);
      }

      await updateDoc(currentClaseRef, updates);

      currentClaseData = {
        ...(currentClaseData || {}),
        sharedWithEmails: Array.isArray(currentClaseData?.sharedWithEmails)
          ? Array.from(new Set([...currentClaseData.sharedWithEmails, email]))
          : [email]
      };

      writeClaseToLocalStorage(currentClaseData, currentOwnerUid, currentClaseId);

      const shareUrl = getShareUrl();
      if (docLinkInput) docLinkInput.value = shareUrl;

      const subject = encodeURIComponent("Te compartieron un documento de Eduvia");
      const body = encodeURIComponent(
        `Hola.\n\n` +
          `Te compartieron este documento de Eduvia:\n` +
          `${shareUrl}\n\n` +
          `Permiso: ${role === "editor" ? "Puede editar" : "Solo ver"}\n\n` +
          `Ese enlace te da acceso únicamente a este documento.`
      );

      const gmailUrl =
        `https://mail.google.com/mail/?view=cm&fs=1` +
        `&to=${encodeURIComponent(email)}` +
        `&su=${subject}` +
        `&body=${body}`;

      window.open(gmailUrl, "_blank");

      if (shareStatus) {
        shareStatus.textContent = "Permiso guardado y Gmail abierto con la invitación.";
      }

      if (shareEmailInput) shareEmailInput.value = "";
      if (shareRoleSelect) shareRoleSelect.value = "viewer";
    } catch (error) {
      console.error("Error compartiendo documento:", error);
      if (shareStatus) {
        shareStatus.textContent = "No se pudo compartir el documento.";
      }
    }
  });
}

async function loadClase(user) {
  const fallbackOwner = ownerUidFromUrl || user.uid;
  const localClase = readClaseFromLocalStorage(fallbackOwner, claseIdFromUrl);

  if (!currentClaseId && localClase?.id) {
    currentClaseId = localClase.id;
  }

  if (!currentOwnerUid) {
    currentOwnerUid = ownerUidFromUrl || localClase?.ownerUid || user.uid;
  }

  if (!currentClaseId) {
    if (localClase) {
      currentClaseData = localClase;
      currentRole = currentOwnerUid === user.uid ? "owner" : "viewer";

      if (currentRole === "owner") {
        clearSharedDocSession();
      } else {
        setSharedDocSession(
          currentRole,
          user,
          currentOwnerUid,
          localClase.id || currentClaseId
        );
      }

      if (currentClaseId && currentOwnerUid) {
        currentClaseRef = doc(db, "usuarios", currentOwnerUid, "clases", currentClaseId);
      }

      const claseLista = await generarDocumentoSiFalta(localClase);
      renderClase(claseLista);
      applyRoleUi(currentRole);
      showDocument();
      setupShareUi();
      return;
    }

    renderError("No se encontró el identificador de la clase.");
    showDocument();
    return;
  }

  try {
    const claseRef = doc(db, "usuarios", currentOwnerUid, "clases", currentClaseId);
    const claseSnap = await getDoc(claseRef);

    if (!claseSnap.exists()) {
      if (localClase) {
        currentClaseData = localClase;
        currentRole = currentOwnerUid === user.uid ? "owner" : "viewer";

        if (currentRole === "owner") {
          clearSharedDocSession();
        } else {
          setSharedDocSession(currentRole, user, currentOwnerUid, currentClaseId);
        }

        currentClaseRef = claseRef;

        const claseLista = await generarDocumentoSiFalta(localClase);
        renderClase(claseLista);
        applyRoleUi(currentRole);
        showDocument();
        setupShareUi();
        return;
      }

      renderError("La clase no existe o no se pudo encontrar en Firestore.");
      showDocument();
      return;
    }

    const claseData = {
      id: claseSnap.id,
      ownerUid: currentOwnerUid,
      ...claseSnap.data()
    };

    const role = resolveUserRole(claseData, user, currentOwnerUid);

    if (!role) {
      showDenied();
      return;
    }

    setSharedDocSession(role, user, currentOwnerUid, currentClaseId);

    currentClaseRef = claseRef;
    currentClaseData = claseData;
    currentRole = role;

    const claseLista = await generarDocumentoSiFalta(claseData);

    writeClaseToLocalStorage(claseLista, currentOwnerUid, currentClaseId);
    renderClase(claseLista);
    applyRoleUi(role);
    showDocument();
    setupShareUi();
  } catch (error) {
    console.error("Error al cargar la clase:", error);

    if (localClase) {
      currentClaseData = localClase;
      currentRole = currentOwnerUid === user.uid ? "owner" : "viewer";

      if (currentRole === "owner") {
        clearSharedDocSession();
      } else {
        setSharedDocSession(currentRole, user, currentOwnerUid, currentClaseId);
      }

      if (currentClaseId && currentOwnerUid) {
        currentClaseRef = doc(db, "usuarios", currentOwnerUid, "clases", currentClaseId);
      }

      try {
        const claseLista = await generarDocumentoSiFalta(localClase);
        renderClase(claseLista);
      } catch (innerError) {
        console.error("Error generando documento desde local:", innerError);
        renderClase(localClase);
      }

      applyRoleUi(currentRole);
      showDocument();
      setupShareUi();
      return;
    }

    renderError(error.message || "Hubo un problema al cargar la clase.");
    showDocument();
  }
}

attachAutosaveListeners();

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    clearSharedDocSession();
    window.location.href = "login.html";
    return;
  }

  currentUser = user;
  await loadClase(user);
});
