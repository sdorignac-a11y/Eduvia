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
const docLoading = document.getElementById("doc-loading");

const toolbarWrap = document.querySelector(".subbar");
const toolbarControls = document.querySelectorAll(
  '.subbar button, .subbar select, .subbar input'
);

const shareModal = document.getElementById("share-modal");
const shareEmailInput = document.getElementById("share-email");
const shareRoleSelect = document.getElementById("share-role");
const shareStatus = document.getElementById("share-status");
const docLinkInput = document.getElementById("doc-link");
const openShareBtn = document.getElementById("open-share-btn");
const closeShareBtn = document.getElementById("close-share-btn");
const copyLinkBtn = document.getElementById("copy-link-btn");
const sendShareBtn = document.getElementById("send-share-btn");

const params = new URLSearchParams(window.location.search);
const claseIdFromUrl = params.get("id") || params.get("doc");
const ownerUidFromUrl = params.get("owner");

const SHARED_DOC_KEY = "eduvia_shared_doc_access";
const SUPPORT_PANEL_ID = "document-support-panel";
const SAVE_DEBOUNCE_MS = 900;
const GENERATE_TIMEOUT_MS = 90000;

const DOC_SELECTION_STYLE_ID = "doc-selection-style";
const DOC_SELECTION_TOOLBAR_ID = "doc-selection-toolbar";
const DOC_SELECTION_RESULT_ID = "doc-selection-result";

let currentUser = null;
let currentClaseId = claseIdFromUrl || null;
let currentOwnerUid = ownerUidFromUrl || null;
let currentClaseRef = null;
let currentClaseData = null;
let currentRole = "viewer";
let saveTimer = null;
let saveInFlight = false;
let shareUiInitialized = false;
let autosaveListenersAttached = false;
let generationPromise = null;
let lastSavedSignature = "";

let selectionAssistantInitialized = false;
let selectionActionBusy = false;
let documentAssistantLastResponse = null;
let currentSelectedText = "";
let currentSelectedRange = null;

if (documentApp) {
  documentApp.style.display = "";
}
if (accessGuard) {
  accessGuard.classList.remove("show");
}
if (docLoading) {
  docLoading.classList.add("show");
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function limpiarTexto(value = "") {
  return String(value || "").trim();
}

function normalizeEmail(email = "") {
  return limpiarTexto(email).toLowerCase();
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

function stripObjectivePrefix(value = "") {
  return String(value || "")
    .replace(/^objetivo:\s*/i, "")
    .trim();
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

function safeJsonParse(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function localStorageKey(ownerUid, claseId) {
  return `claseActual:${ownerUid || "unknown"}:${claseId || "unknown"}`;
}

function readClaseFromLocalStorage(ownerUid, claseId) {
  try {
    const specificKey = localStorageKey(ownerUid, claseId);
    const specific = localStorage.getItem(specificKey);
    if (specific) {
      const parsed = safeJsonParse(specific, null);
      if (parsed && typeof parsed === "object") return parsed;
    }

    const legacy = localStorage.getItem("claseActual");
    if (legacy) {
      const parsed = safeJsonParse(legacy, null);
      if (parsed && typeof parsed === "object") return parsed;
    }

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

function setSharedDocSession(role, user, ownerUid, claseId) {
  if (!user || !ownerUid || !claseId) return;

  if (role === "owner") {
    sessionStorage.removeItem(SHARED_DOC_KEY);
    return;
  }

  try {
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
  } catch {
    // no-op
  }
}

function clearSharedDocSession() {
  try {
    sessionStorage.removeItem(SHARED_DOC_KEY);
  } catch {
    // no-op
  }
}

function getDocumentoTitle(clase = {}) {
  return (
    clase.tituloDocumento ||
    clase.tema ||
    clase.titulo ||
    "Documento sin título"
  );
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

function hasRealHtml(value = "") {
  return typeof value === "string" && value.trim().length > 30;
}

function hasRealText(value = "") {
  return typeof value === "string" && value.trim().length > 30;
}

function hasRealStructuredDoc(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;

  const puntosClave = Array.isArray(obj.puntosClave)
    ? obj.puntosClave.filter((item) => limpiarTexto(item))
    : [];

  const preguntas = Array.isArray(obj.preguntas)
    ? obj.preguntas.filter((item) => limpiarTexto(item))
    : [];

  return Boolean(
    limpiarTexto(obj.resumen) ||
    limpiarTexto(obj.explicacion) ||
    limpiarTexto(obj.ejemplo) ||
    limpiarTexto(obj.cierre) ||
    puntosClave.length ||
    preguntas.length
  );
}

function sanitizeCssStyle(styleText = "") {
  if (!styleText || typeof styleText !== "string") return "";

  const allowedProps = new Set([
    "color",
    "background-color",
    "text-align",
    "font-weight",
    "font-style",
    "text-decoration"
  ]);

  const safeDeclarations = [];
  const declarations = styleText.split(";");

  for (const declaration of declarations) {
    const [rawProp, ...rest] = declaration.split(":");
    const prop = limpiarTexto(rawProp).toLowerCase();
    const value = limpiarTexto(rest.join(":"));

    if (!prop || !value) continue;
    if (!allowedProps.has(prop)) continue;

    const lowerValue = value.toLowerCase();
    if (
      lowerValue.includes("url(") ||
      lowerValue.includes("expression") ||
      lowerValue.includes("javascript:") ||
      lowerValue.includes("behavior:")
    ) {
      continue;
    }

    const validTextAlign = ["left", "center", "right", "justify"];
    const validFontWeight = ["normal", "bold", "500", "600", "700", "800"];
    const validFontStyle = ["normal", "italic"];
    const validTextDecoration = ["none", "underline", "line-through"];
    const genericColorRegex =
      /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|[a-z\s-]+)$/i;

    let isValid = false;

    if (prop === "text-align") {
      isValid = validTextAlign.includes(lowerValue);
    } else if (prop === "font-weight") {
      isValid = validFontWeight.includes(lowerValue);
    } else if (prop === "font-style") {
      isValid = validFontStyle.includes(lowerValue);
    } else if (prop === "text-decoration") {
      isValid = validTextDecoration.includes(lowerValue);
    } else if (prop === "color" || prop === "background-color") {
      isValid = genericColorRegex.test(value);
    }

    if (!isValid) continue;

    safeDeclarations.push(`${prop}: ${value}`);
  }

  return safeDeclarations.join("; ");
}

function sanitizeHtml(inputHtml = "") {
  if (!inputHtml || typeof inputHtml !== "string") return "";

  const allowedTags = new Set([
    "H1",
    "H2",
    "H3",
    "P",
    "UL",
    "OL",
    "LI",
    "BLOCKQUOTE",
    "STRONG",
    "EM",
    "U",
    "A",
    "BR",
    "DIV",
    "SPAN",
    "FONT"
  ]);

  const parser = new DOMParser();
  const parsed = parser.parseFromString(`<div>${inputHtml}</div>`, "text/html");
  const sourceRoot = parsed.body.firstElementChild;

  const cleanDoc = document.implementation.createHTMLDocument("");
  const cleanRoot = cleanDoc.createElement("div");

  function cleanNode(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return cleanDoc.createTextNode(node.textContent || "");
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return cleanDoc.createDocumentFragment();
    }

    const tag = node.tagName.toUpperCase();

    if (["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "META", "LINK"].includes(tag)) {
      return cleanDoc.createDocumentFragment();
    }

    if (!allowedTags.has(tag)) {
      const fragment = cleanDoc.createDocumentFragment();
      for (const child of Array.from(node.childNodes)) {
        fragment.appendChild(cleanNode(child));
      }
      return fragment;
    }

    const targetTag = tag === "FONT" ? "span" : tag.toLowerCase();
    const cleanEl = cleanDoc.createElement(targetTag);

    if (tag === "A") {
      const href = sanitizeUrl(node.getAttribute("href") || "");
      if (href) {
        cleanEl.setAttribute("href", href);
        cleanEl.setAttribute("target", "_blank");
        cleanEl.setAttribute("rel", "noopener noreferrer");
      }
    }

    const rawStyle = node.getAttribute("style") || "";
    const safeStyle = sanitizeCssStyle(rawStyle);
    if (safeStyle) {
      cleanEl.setAttribute("style", safeStyle);
    }

    if (tag === "FONT") {
      const colorAttr = node.getAttribute("color") || "";
      const colorStyle = sanitizeCssStyle(`color:${colorAttr}`);
      const mergedStyle = [safeStyle, colorStyle].filter(Boolean).join("; ");
      if (mergedStyle) {
        cleanEl.setAttribute("style", mergedStyle);
      }
    }

    for (const child of Array.from(node.childNodes)) {
      cleanEl.appendChild(cleanNode(child));
    }

    return cleanEl;
  }

  for (const child of Array.from(sourceRoot.childNodes)) {
    cleanRoot.appendChild(cleanNode(child));
  }

  return cleanRoot.innerHTML.trim();
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

function hideLoading() {
  if (docLoading) {
    docLoading.classList.remove("show");
  }
}

function setSelectionAssistantVisibility(visible) {
  const toolbar = document.getElementById(DOC_SELECTION_TOOLBAR_ID);
  const panel = document.getElementById(DOC_SELECTION_RESULT_ID);

  if (toolbar) {
    toolbar.style.display = visible ? "" : "none";
    if (!visible) toolbar.classList.remove("show");
  }

  if (panel) {
    panel.style.display = visible ? "" : "none";
    if (!visible) panel.classList.remove("show");
  }
}

function showDenied() {
  hideLoading();
  setSelectionAssistantVisibility(false);
  if (documentApp) documentApp.style.display = "none";
  if (accessGuard) accessGuard.classList.add("show");
}

function showDocument() {
  hideLoading();
  if (accessGuard) accessGuard.classList.remove("show");
  if (documentApp) documentApp.style.display = "";
  setSelectionAssistantVisibility(true);
}

function renderError(message) {
  clearSupportPanel();
  hideLoading();
  setSelectionAssistantVisibility(false);

  if (docContent) {
    docContent.innerHTML = `
      <div class="doc-placeholder">
        <p><strong>No se pudo cargar el documento.</strong></p>
        <p>${escapeHtml(message)}</p>
      </div>
    `;
  }

  if (documentApp) {
    documentApp.style.display = "";
  }
}

function renderGeneratingDocument(clase = {}) {
  setBasicMeta(clase);

  if (!docContent) return;

  docContent.innerHTML = `
    <div class="doc-placeholder">
      <p><strong>Generando documento...</strong></p>
      <p>Estamos investigando y armando el contenido completo de esta clase.</p>
      <p>Cuando termine, el apunte se pega automáticamente acá.</p>
    </div>
  `;
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
      En esta sección debería aparecer la explicación principal del tema.
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
    </ul>

    <h2>Cierre</h2>
    <p>
      Este documento quedó como base visual, pero no se recibió contenido HTML completo.
    </p>
  `;
}

function renderRichHtmlDocumento(clase = {}) {
  if (!docContent) return false;

  const rawHtml =
    clase.contenidoHtml ||
    clase.documentoHtml ||
    clase.htmlDocumento ||
    "";

  if (!rawHtml || typeof rawHtml !== "string" || !rawHtml.trim()) {
    return false;
  }

  const safeHtml = sanitizeHtml(rawHtml);
  if (!safeHtml) return false;

  docContent.innerHTML = safeHtml;
  return true;
}

function renderStructuredDocumento(clase = {}) {
  if (!docContent) return false;

  const contenido = clase.documento || clase.contenidoDocumento || clase.contenido || null;

  if (!hasRealStructuredDoc(contenido)) {
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
    html += "<h2>Puntos clave</h2><ul>";
    html += puntosClave.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    html += "</ul>";
  }

  if (ejemplo) {
    html += `
      <h2>Ejemplo o aplicación</h2>
      <p>${ejemplo}</p>
    `;
  }

  if (preguntas.length) {
    html += "<h2>Preguntas para practicar</h2><ol>";
    html += preguntas.map((item) => `<li>${escapeHtml(item)}</li>`).join("");
    html += "</ol>";
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

  if (!hasRealText(rawText)) return false;

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
    syncSavedSignatureFromDom();
    return;
  }

  if (renderStructuredDocumento(clase)) {
    renderSupportPanel(clase);
    syncSavedSignatureFromDom();
    return;
  }

  if (renderPlainTextDocumento(clase)) {
    renderSupportPanel(clase);
    syncSavedSignatureFromDom();
    return;
  }

  renderGeneratedStructure(clase);
  renderSupportPanel(clase);
  syncSavedSignatureFromDom();
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

  if (openShareBtn) {
    openShareBtn.style.display = role === "owner" ? "" : "none";
  }
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

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = GENERATE_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    let data = null;
    try {
      data = await response.json();
    } catch {
      throw new Error("El servidor devolvió un JSON inválido.");
    }

    return { response, data };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("La generación tardó demasiado y fue cancelada.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function generarDocumentoSiFalta(clase = {}) {
  if (generationPromise) {
    return generationPromise;
  }

  generationPromise = (async () => {
    const yaExiste =
      hasRealHtml(clase.contenidoHtml) ||
      hasRealHtml(clase.documentoHtml) ||
      hasRealHtml(clase.htmlDocumento) ||
      hasRealText(clase.documentoTexto) ||
      hasRealText(clase.textoDocumento) ||
      hasRealText(clase.contenidoTexto) ||
      hasRealStructuredDoc(clase.documento) ||
      hasRealStructuredDoc(clase.contenidoDocumento) ||
      hasRealStructuredDoc(clase.contenido);

    if (yaExiste) {
      return clase;
    }

    if (!clase?.materia || !clase?.tema || !clase?.nivel) {
      throw new Error("Faltan materia, tema o nivel para generar el documento.");
    }

    renderGeneratingDocument(clase);

    const payload = {
      materia: clase.materia || "",
      tema: clase.tema || "",
      nivel: clase.nivel || "",
      duracion: clase.duracion || "",
      objetivo: clase.objetivo || "",
      investigacion: clase.investigacion || "",
      fuentes: Array.isArray(clase.fuentes) ? clase.fuentes : [],
    };

    const { response, data } = await fetchJsonWithTimeout(
      "/api/generar-documento",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      GENERATE_TIMEOUT_MS
    );

    if (!response.ok || !data?.ok || !data?.documento) {
      throw new Error(data?.error || "No se pudo generar el documento.");
    }

    const safeHtml = sanitizeHtml(data.documento.contenidoHtml || "");
    if (!safeHtml) {
      throw new Error("La IA respondió, pero no devolvió contenido utilizable.");
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
      contenidoHtml: safeHtml,
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
  })();

  try {
    return await generationPromise;
  } finally {
    generationPromise = null;
  }
}

function updateTopbarTitleFromEditor() {
  if (!topbarTitle || !docTitle) return;
  const value = limpiarTexto(docTitle.textContent);
  topbarTitle.textContent = value || "Documento sin título";
}

function getCurrentDocumentPayload() {
  const titulo = limpiarTexto(docTitle?.textContent || "") || "Documento sin título";
  const objetivoRaw = limpiarTexto(docObjective?.textContent || "");
  const objetivo = stripObjectivePrefix(objetivoRaw);
  const contenidoHtmlRaw = docContent?.innerHTML || "";
  const contenidoHtml = sanitizeHtml(contenidoHtmlRaw);

  return {
    tituloDocumento: titulo,
    objetivoDocumento: objetivo,
    contenidoHtml,
    ultimoEditorUid: currentUser?.uid || "",
    ultimoEditorEmail: normalizeEmail(currentUser?.email || ""),
    updatedAt: serverTimestamp()
  };
}

function getPayloadSignature(payloadLike = {}) {
  return JSON.stringify({
    tituloDocumento: payloadLike.tituloDocumento || "",
    objetivoDocumento: payloadLike.objetivoDocumento || "",
    contenidoHtml: payloadLike.contenidoHtml || ""
  });
}

function syncSavedSignatureFromDom() {
  const payload = getCurrentDocumentPayload();
  lastSavedSignature = getPayloadSignature(payload);
}

function scheduleSave() {
  if (!currentClaseRef || !canEdit()) return;

  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveDocumentEdits();
  }, SAVE_DEBOUNCE_MS);
}

async function saveDocumentEdits(force = false) {
  if (!currentClaseRef || !canEdit()) return;
  if (saveInFlight && !force) return;

  const payload = getCurrentDocumentPayload();
  const signature = getPayloadSignature(payload);

  if (!force && signature === lastSavedSignature) {
    return;
  }

  saveInFlight = true;

  try {
    await updateDoc(currentClaseRef, payload);

    currentClaseData = {
      ...(currentClaseData || {}),
      tituloDocumento: payload.tituloDocumento,
      objetivoDocumento: payload.objetivoDocumento,
      contenidoHtml: payload.contenidoHtml,
      ultimoEditorUid: payload.ultimoEditorUid,
      ultimoEditorEmail: payload.ultimoEditorEmail,
      updatedAt: new Date().toISOString()
    };

    lastSavedSignature = signature;
    writeClaseToLocalStorage(currentClaseData, currentOwnerUid, currentClaseId);
  } catch (error) {
    console.error("Error guardando documento:", error);

    try {
      await setDoc(currentClaseRef, payload, { merge: true });

      currentClaseData = {
        ...(currentClaseData || {}),
        tituloDocumento: payload.tituloDocumento,
        objetivoDocumento: payload.objetivoDocumento,
        contenidoHtml: payload.contenidoHtml,
        ultimoEditorUid: payload.ultimoEditorUid,
        ultimoEditorEmail: payload.ultimoEditorEmail,
        updatedAt: new Date().toISOString()
      };

      lastSavedSignature = signature;
      writeClaseToLocalStorage(currentClaseData, currentOwnerUid, currentClaseId);
    } catch (secondError) {
      console.error("Error secundario guardando documento:", secondError);
    }
  } finally {
    saveInFlight = false;
  }
}

function handlePlainTextPaste(e) {
  if (!canEdit()) return;

  e.preventDefault();
  const text = e.clipboardData?.getData("text/plain") || "";
  document.execCommand("insertText", false, text);
}

function attachAutosaveListeners() {
  if (autosaveListenersAttached) return;
  autosaveListenersAttached = true;

  const onInput = () => {
    updateTopbarTitleFromEditor();
    scheduleSave();
  };

  docTitle?.addEventListener("input", onInput);
  docObjective?.addEventListener("input", onInput);
  docContent?.addEventListener("input", onInput);

  docTitle?.addEventListener("paste", handlePlainTextPaste);
  docObjective?.addEventListener("paste", handlePlainTextPaste);
  docContent?.addEventListener("paste", handlePlainTextPaste);

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(saveTimer);
      void saveDocumentEdits(true);
    }
  });

  window.addEventListener("pagehide", () => {
    clearTimeout(saveTimer);
    void saveDocumentEdits(true);
  });
}

function getShareUrl() {
  if (!currentClaseId || !currentOwnerUid) return window.location.href;

  const url = new URL(window.location.href);
  url.searchParams.set("id", currentClaseId);
  url.searchParams.set("owner", currentOwnerUid);
  return url.toString();
}

function setupShareUi() {
  if (!shareModal || shareUiInitialized) return;
  shareUiInitialized = true;

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

    if (!email || !email.includes("@")) {
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

function getPlainDocumentText() {
  const titulo = limpiarTexto(docTitle?.textContent || "");
  const objetivo = stripObjectivePrefix(limpiarTexto(docObjective?.textContent || ""));
  const contenido = limpiarTexto(docContent?.innerText || docContent?.textContent || "");

  return [titulo, objetivo, contenido].filter(Boolean).join("\n\n");
}

function nodeBelongsToDocument(node) {
  const element =
    node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;

  if (!element) return false;

  return Boolean(
    docTitle?.contains(element) ||
      docObjective?.contains(element) ||
      docContent?.contains(element)
  );
}

function rangeBelongsToDocument(range) {
  if (!range) return false;
  return (
    nodeBelongsToDocument(range.startContainer) &&
    nodeBelongsToDocument(range.endContainer)
  );
}

function getClosestEditableRoot(node) {
  const element =
    node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;

  if (!element) return null;
  if (docTitle?.contains(element)) return docTitle;
  if (docObjective?.contains(element)) return docObjective;
  if (docContent?.contains(element)) return docContent;

  return null;
}

function getClosestBlockElement(node) {
  const element =
    node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;

  if (!element) return null;

  return element.closest("p, li, h1, h2, h3, blockquote, div");
}

function hideSelectionToolbar() {
  const toolbar = document.getElementById(DOC_SELECTION_TOOLBAR_ID);
  if (toolbar) {
    toolbar.classList.remove("show");
  }
}

function showSelectionToolbarAt(rect) {
  const toolbar = document.getElementById(DOC_SELECTION_TOOLBAR_ID);
  if (!toolbar || !rect) return;

  toolbar.classList.add("show");

  const margin = 16;
  const maxWidth = Math.min(620, window.innerWidth - 32);
  const toolbarWidth = Math.min(toolbar.offsetWidth || maxWidth, maxWidth);
  const top = window.scrollY + rect.top - toolbar.offsetHeight - 12;
  const rawLeft = window.scrollX + rect.left + rect.width / 2 - toolbarWidth / 2;
  const left = Math.max(
    window.scrollX + margin,
    Math.min(rawLeft, window.scrollX + window.innerWidth - toolbarWidth - margin)
  );

  toolbar.style.top = `${Math.max(window.scrollY + 12, top)}px`;
  toolbar.style.left = `${left}px`;
}

function hideSelectionResult() {
  const panel = document.getElementById(DOC_SELECTION_RESULT_ID);
  if (panel) {
    panel.classList.remove("show");
  }
}

function trackSelectedTextForAssistant() {
  if (selectionActionBusy) return;

  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) {
    currentSelectedText = "";
    currentSelectedRange = null;
    hideSelectionToolbar();
    return;
  }

  const text = limpiarTexto(selection.toString());
  const range = selection.getRangeAt(0);

  if (!text || !rangeBelongsToDocument(range)) {
    currentSelectedText = "";
    currentSelectedRange = null;
    hideSelectionToolbar();
    return;
  }

  const rect = range.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) {
    hideSelectionToolbar();
    return;
  }

  currentSelectedText = text.slice(0, 5000);
  currentSelectedRange = range.cloneRange();
  showSelectionToolbarAt(rect);
}

function getDocumentAssistantQuestion(action, selectedText = "") {
  const base = limpiarTexto(selectedText);

  switch (action) {
    case "explicar":
      return `Explicá mejor el texto seleccionado de forma clara, didáctica y fácil de entender. Si conviene, proponé una versión mejor explicada del fragmento. Texto: ${base}`;
    case "mejorar":
      return `Mejorá la redacción del texto seleccionado sin cambiar la idea principal. Texto: ${base}`;
    case "alargar":
      return `Alargá el texto seleccionado agregando contenido útil, contexto o desarrollo, sin meter relleno. Texto: ${base}`;
    case "acortar":
      return `Acortá el texto seleccionado conservando la idea principal y lo más importante. Texto: ${base}`;
    case "claro":
      return `Reescribí el texto seleccionado para que quede más claro, más simple y más fácil de estudiar. Texto: ${base}`;
    case "formal":
      return `Reescribí el texto seleccionado con un tono más formal, prolijo y académico. Texto: ${base}`;
    case "resumir":
      return `Resumí el texto seleccionado en una versión más breve y directa. Texto: ${base}`;
    default:
      return `Ayudame con este texto seleccionado del documento: ${base}`;
  }
}

function plainTextToHtmlBlocks(text = "") {
  const clean = limpiarTexto(text);
  if (!clean) return "";

  return clean
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function restoreStoredSelection() {
  if (!currentSelectedRange) return false;

  const selection = window.getSelection();
  if (!selection) return false;

  selection.removeAllRanges();
  selection.addRange(currentSelectedRange);

  const root = getClosestEditableRoot(currentSelectedRange.startContainer);
  root?.focus?.();

  return true;
}

function replaceSelectedTextWithResult(text = "") {
  if (!canEdit()) return;
  const clean = limpiarTexto(text);
  if (!clean) return;
  if (!restoreStoredSelection()) return;

  document.execCommand("insertText", false, clean);
  scheduleSave();
  hideSelectionToolbar();
}

function insertResultBelowSelection(text = "") {
  if (!canEdit()) return;
  const clean = limpiarTexto(text);
  if (!clean) return;

  const html = plainTextToHtmlBlocks(clean);
  if (!html) return;

  const startNode = currentSelectedRange?.startContainer || null;
  const root = getClosestEditableRoot(startNode);

  if (root === docContent) {
    const block = getClosestBlockElement(startNode);
    if (block && docContent.contains(block)) {
      block.insertAdjacentHTML("afterend", html);
    } else {
      docContent.insertAdjacentHTML("beforeend", html);
    }
  } else if (root === docObjective) {
    docObjective.insertAdjacentHTML("afterend", html);
  } else {
    docContent?.insertAdjacentHTML("afterbegin", html);
  }

  scheduleSave();
}

async function copyAssistantText(text = "") {
  const value = limpiarTexto(text);
  if (!value) return false;

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function normalizeAssistantResponse(raw = {}) {
  const respuesta =
    raw?.respuesta && typeof raw.respuesta === "object" ? raw.respuesta : raw;

  return {
    subtitulo: limpiarTexto(raw?.subtitulo || "Asistente del documento"),
    titulo: limpiarTexto(respuesta?.titulo || "Sugerencia"),
    modo: limpiarTexto(respuesta?.modo || "respuesta"),
    resumen: limpiarTexto(respuesta?.resumen || ""),
    cambios: Array.isArray(respuesta?.cambios) ? respuesta.cambios : [],
    textoPropuesto: limpiarTexto(respuesta?.textoPropuesto || ""),
    preguntasSeguimiento: Array.isArray(respuesta?.preguntasSeguimiento)
      ? respuesta.preguntasSeguimiento
      : [],
  };
}

function renderSelectionResult(raw = {}, actionLabel = "Acción") {
  const panel = document.getElementById(DOC_SELECTION_RESULT_ID);
  if (!panel) return;

  const data = normalizeAssistantResponse(raw);
  documentAssistantLastResponse = data;

  const suggestedText = data.textoPropuesto || "";
  const copyValue = suggestedText || data.resumen || "";

  panel.innerHTML = `
    <div class="doc-selection-result-header">
      <div>
        <div class="doc-selection-result-chip">${escapeHtml(actionLabel)}</div>
        <h3>${escapeHtml(data.titulo)}</h3>
      </div>
      <button type="button" class="doc-selection-result-close" data-close-selection-panel>×</button>
    </div>

    ${
      data.resumen
        ? `<p class="doc-selection-result-summary">${escapeHtml(data.resumen)}</p>`
        : ""
    }

    ${
      data.cambios.length
        ? `
          <div class="doc-selection-result-section">
            <div class="doc-selection-result-label">Cambios sugeridos</div>
            <div class="doc-selection-result-list">
              ${data.cambios
                .map((item) => {
                  const tipo = escapeHtml(item?.tipo || "mejora");
                  const titulo = escapeHtml(item?.titulo || "Cambio");
                  const detalle = escapeHtml(item?.detalle || "");
                  const ejemplo = escapeHtml(item?.ejemplo || "");

                  return `
                    <article class="doc-selection-change">
                      <div class="doc-selection-change-top">
                        <span class="doc-selection-mini-chip">${tipo}</span>
                        <strong>${titulo}</strong>
                      </div>
                      ${detalle ? `<p>${detalle}</p>` : ""}
                      ${ejemplo ? `<div class="doc-selection-example">${ejemplo}</div>` : ""}
                    </article>
                  `;
                })
                .join("")}
            </div>
          </div>
        `
        : ""
    }

    ${
      suggestedText
        ? `
          <div class="doc-selection-result-section">
            <div class="doc-selection-result-label">Texto propuesto</div>
            <pre class="doc-selection-proposed">${escapeHtml(suggestedText)}</pre>
          </div>
        `
        : ""
    }

    ${
      data.preguntasSeguimiento.length
        ? `
          <div class="doc-selection-result-section">
            <div class="doc-selection-result-label">Siguientes ideas</div>
            <ul class="doc-selection-followup">
              ${data.preguntasSeguimiento
                .map((item) => `<li>${escapeHtml(item)}</li>`)
                .join("")}
            </ul>
          </div>
        `
        : ""
    }

    <div class="doc-selection-result-actions">
      <button type="button" class="doc-selection-action-btn" data-copy-selection-result>
        Copiar
      </button>
      ${
        suggestedText && canEdit()
          ? `
            <button type="button" class="doc-selection-action-btn" data-insert-selection-result>
              Insertar debajo
            </button>
            <button type="button" class="doc-selection-action-btn primary" data-replace-selection-result>
              Reemplazar selección
            </button>
          `
          : ""
      }
    </div>
  `;

  panel
    .querySelector("[data-close-selection-panel]")
    ?.addEventListener("click", () => {
      hideSelectionResult();
    });

  panel
    .querySelector("[data-copy-selection-result]")
    ?.addEventListener("click", async () => {
      await copyAssistantText(copyValue);
    });

  panel
    .querySelector("[data-insert-selection-result]")
    ?.addEventListener("click", () => {
      insertResultBelowSelection(suggestedText);
    });

  panel
    .querySelector("[data-replace-selection-result]")
    ?.addEventListener("click", () => {
      replaceSelectedTextWithResult(suggestedText);
    });

  panel.classList.add("show");
}

async function runSelectionAction(action = "mejorar", label = "Mejorar") {
  if (selectionActionBusy) return;
  if (!currentSelectedText) return;

  selectionActionBusy = true;
  hideSelectionToolbar();

  const panel = document.getElementById(DOC_SELECTION_RESULT_ID);
  if (panel) {
    panel.innerHTML = `
      <div class="doc-selection-result-header">
        <div>
          <div class="doc-selection-result-chip">${escapeHtml(label)}</div>
          <h3>Generando propuesta...</h3>
        </div>
      </div>
      <p class="doc-selection-result-summary">
        Estamos analizando el fragmento seleccionado.
      </p>
    `;
    panel.classList.add("show");
  }

  try {
    const response = await fetch("/api/preguntar-documento", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pregunta: getDocumentAssistantQuestion(action, currentSelectedText),
        tituloDocumento: limpiarTexto(docTitle?.textContent || ""),
        objetivoDocumento: stripObjectivePrefix(
          limpiarTexto(docObjective?.textContent || "")
        ),
        documentoActual: getPlainDocumentText(),
        textoSeleccionado: currentSelectedText,
        investigacion: getInvestigacionDocumento(currentClaseData || {}),
        fuentes: getFuentesDocumento(currentClaseData || {}),
        ultimaRespuesta: documentAssistantLastResponse,
      }),
    });

    const data = await response.json();

    if (!response.ok || !data?.ok) {
      throw new Error(data?.error || "No se pudo procesar la selección.");
    }

    renderSelectionResult(data.respuesta, label);
  } catch (error) {
    console.error("Error procesando selección:", error);

    if (panel) {
      panel.innerHTML = `
        <div class="doc-selection-result-header">
          <div>
            <div class="doc-selection-result-chip">${escapeHtml(label)}</div>
            <h3>No se pudo generar la sugerencia</h3>
          </div>
          <button type="button" class="doc-selection-result-close" data-close-selection-panel>×</button>
        </div>
        <p class="doc-selection-result-summary">
          ${escapeHtml(error?.message || "Hubo un problema al consultar la IA.")}
        </p>
      `;

      panel
        .querySelector("[data-close-selection-panel]")
        ?.addEventListener("click", () => {
          hideSelectionResult();
        });

      panel.classList.add("show");
    }
  } finally {
    selectionActionBusy = false;
  }
}

function injectSelectionAssistantStyles() {
  if (document.getElementById(DOC_SELECTION_STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = DOC_SELECTION_STYLE_ID;
  style.textContent = `
    #${DOC_SELECTION_TOOLBAR_ID}{
      position:absolute;
      z-index:1300;
      display:none;
      align-items:center;
      gap:8px;
      flex-wrap:wrap;
      max-width:min(620px, calc(100vw - 32px));
      padding:10px;
      border-radius:18px;
      background:rgba(255,255,255,.96);
      border:1px solid rgba(53,93,149,.12);
      box-shadow:0 18px 45px rgba(20,34,60,.18);
      backdrop-filter:blur(8px);
    }

    #${DOC_SELECTION_TOOLBAR_ID}.show{
      display:flex;
    }

    .doc-selection-tool-btn{
      border:none;
      border-radius:12px;
      padding:9px 12px;
      background:#eef4ff;
      color:#355d95;
      font-weight:800;
      font-size:.84rem;
      cursor:pointer;
      transition:.18s ease;
    }

    .doc-selection-tool-btn:hover{
      background:#e2eeff;
      transform:translateY(-1px);
    }

    #${DOC_SELECTION_RESULT_ID}{
      position:fixed;
      right:22px;
      top:96px;
      width:min(420px, calc(100vw - 28px));
      max-height:min(75vh, 720px);
      overflow:auto;
      z-index:1250;
      display:none;
      padding:16px;
      border-radius:24px;
      background:#fff;
      border:1px solid rgba(53,93,149,.12);
      box-shadow:0 28px 72px rgba(24,39,75,.18);
    }

    #${DOC_SELECTION_RESULT_ID}.show{
      display:block;
    }

    .doc-selection-result-header{
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap:12px;
      margin-bottom:10px;
    }

    .doc-selection-result-header h3{
      margin:6px 0 0;
      color:#223b59;
      font-size:1.06rem;
      line-height:1.35;
      font-weight:800;
    }

    .doc-selection-result-chip{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      padding:5px 10px;
      border-radius:999px;
      background:#edf4ff;
      color:#355d95;
      font-size:.74rem;
      font-weight:800;
    }

    .doc-selection-result-close{
      border:none;
      background:#eef4ff;
      color:#355d95;
      width:34px;
      height:34px;
      border-radius:999px;
      cursor:pointer;
      font-size:18px;
      flex-shrink:0;
    }

    .doc-selection-result-summary{
      margin:0 0 14px;
      color:#4a6077;
      line-height:1.65;
      white-space:pre-wrap;
    }

    .doc-selection-result-section{
      margin-top:14px;
    }

    .doc-selection-result-label{
      margin-bottom:8px;
      color:#2d4f76;
      font-size:.82rem;
      font-weight:800;
      letter-spacing:.02em;
      text-transform:uppercase;
    }

    .doc-selection-result-list{
      display:grid;
      gap:8px;
    }

    .doc-selection-change{
      padding:11px 12px;
      border-radius:14px;
      background:#f7faff;
      border:1px solid rgba(53,93,149,.08);
    }

    .doc-selection-change-top{
      display:flex;
      align-items:center;
      gap:8px;
      flex-wrap:wrap;
      margin-bottom:6px;
    }

    .doc-selection-change p{
      margin:0;
      color:#4b6177;
      line-height:1.55;
    }

    .doc-selection-mini-chip{
      display:inline-flex;
      align-items:center;
      justify-content:center;
      padding:4px 8px;
      border-radius:999px;
      background:#e8f1ff;
      color:#355d95;
      font-size:.7rem;
      font-weight:800;
      text-transform:capitalize;
    }

    .doc-selection-example{
      margin-top:8px;
      padding:10px;
      border-radius:12px;
      background:#fff;
      border:1px dashed rgba(53,93,149,.16);
      color:#40576f;
      line-height:1.55;
      white-space:pre-wrap;
    }

    .doc-selection-proposed{
      margin:0;
      padding:12px;
      border-radius:14px;
      background:#f7f9fc;
      border:1px solid rgba(53,93,149,.10);
      color:#33485f;
      font-size:.92rem;
      line-height:1.6;
      white-space:pre-wrap;
      overflow:auto;
      font-family:Inter, sans-serif;
    }

    .doc-selection-followup{
      margin:0;
      padding-left:18px;
      color:#4b6075;
      line-height:1.6;
    }

    .doc-selection-result-actions{
      display:flex;
      gap:8px;
      flex-wrap:wrap;
      margin-top:16px;
    }

    .doc-selection-action-btn{
      border:none;
      border-radius:12px;
      padding:10px 12px;
      background:#eef4ff;
      color:#355d95;
      font-weight:800;
      cursor:pointer;
    }

    .doc-selection-action-btn.primary{
      background:linear-gradient(135deg,#355d95 0%, #4d7bc0 100%);
      color:#fff;
    }

    @media (max-width: 768px){
      #${DOC_SELECTION_RESULT_ID}{
        right:14px;
        left:14px;
        top:auto;
        bottom:18px;
        width:auto;
        max-height:58vh;
      }

      #${DOC_SELECTION_TOOLBAR_ID}{
        max-width:calc(100vw - 24px);
      }

      .doc-selection-tool-btn{
        font-size:.8rem;
        padding:8px 10px;
      }
    }
  `;

  document.head.appendChild(style);
}

function ensureSelectionAssistantUi() {
  if (selectionAssistantInitialized) return;
  selectionAssistantInitialized = true;

  injectSelectionAssistantStyles();

  const toolbar = document.createElement("div");
  toolbar.id = DOC_SELECTION_TOOLBAR_ID;
  toolbar.innerHTML = `
    <button type="button" class="doc-selection-tool-btn" data-selection-action="explicar" data-selection-label="Explicar">Explicar</button>
    <button type="button" class="doc-selection-tool-btn" data-selection-action="mejorar" data-selection-label="Mejorar">Mejorar</button>
    <button type="button" class="doc-selection-tool-btn" data-selection-action="alargar" data-selection-label="Alargar">Alargar</button>
    <button type="button" class="doc-selection-tool-btn" data-selection-action="acortar" data-selection-label="Acortar">Acortar</button>
    <button type="button" class="doc-selection-tool-btn" data-selection-action="claro" data-selection-label="Más claro">Más claro</button>
    <button type="button" class="doc-selection-tool-btn" data-selection-action="formal" data-selection-label="Más formal">Más formal</button>
    <button type="button" class="doc-selection-tool-btn" data-selection-action="resumir" data-selection-label="Resumir">Resumir</button>
  `;

  const resultPanel = document.createElement("aside");
  resultPanel.id = DOC_SELECTION_RESULT_ID;

  document.body.appendChild(toolbar);
  document.body.appendChild(resultPanel);

  toolbar.addEventListener("mousedown", (e) => {
    e.preventDefault();
  });

  toolbar.addEventListener("click", (e) => {
    const button = e.target.closest("[data-selection-action]");
    if (!button) return;

    const action = button.getAttribute("data-selection-action") || "mejorar";
    const label = button.getAttribute("data-selection-label") || "Mejorar";
    void runSelectionAction(action, label);
  });

  document.addEventListener("selectionchange", () => {
    setTimeout(trackSelectedTextForAssistant, 0);
  });

  document.addEventListener(
    "scroll",
    () => {
      if (!currentSelectedRange) return;
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return;
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect && (rect.width || rect.height)) {
        showSelectionToolbarAt(rect);
      }
    },
    true
  );

  document.addEventListener("mousedown", (e) => {
    const toolbarEl = document.getElementById(DOC_SELECTION_TOOLBAR_ID);
    const resultEl = document.getElementById(DOC_SELECTION_RESULT_ID);

    if (
      toolbarEl?.contains(e.target) ||
      resultEl?.contains(e.target) ||
      docContent?.contains(e.target) ||
      docObjective?.contains(e.target) ||
      docTitle?.contains(e.target)
    ) {
      return;
    }

    hideSelectionToolbar();
  });
}

async function resolveClaseFromFirestoreOrLocal(user) {
  const fallbackOwner = ownerUidFromUrl || user.uid;
  const localClase = readClaseFromLocalStorage(fallbackOwner, claseIdFromUrl);

  if (!currentClaseId && localClase?.id) {
    currentClaseId = localClase.id;
  }

  if (!currentOwnerUid) {
    currentOwnerUid = ownerUidFromUrl || localClase?.ownerUid || user.uid;
  }

  if (!currentClaseId && localClase?.id) {
    currentClaseId = localClase.id;
  }

  if (!currentClaseId) {
    if (localClase) {
      currentClaseData = localClase;
      currentRole = currentOwnerUid === user.uid ? "owner" : "viewer";

      if (currentRole === "owner") {
        clearSharedDocSession();
      } else {
        setSharedDocSession(currentRole, user, currentOwnerUid, localClase.id || currentClaseId);
      }

      if (currentClaseId && currentOwnerUid) {
        currentClaseRef = doc(db, "usuarios", currentOwnerUid, "clases", currentClaseId);
      }

      return {
        clase: localClase,
        origin: "local"
      };
    }

    throw new Error("No se encontró el identificador de la clase.");
  }

  const claseRef = doc(db, "usuarios", currentOwnerUid, "clases", currentClaseId);

  try {
    const claseSnap = await getDoc(claseRef);

    if (!claseSnap.exists()) {
      if (localClase) {
        currentClaseRef = claseRef;
        currentClaseData = localClase;
        currentRole = currentOwnerUid === user.uid ? "owner" : "viewer";

        if (currentRole === "owner") {
          clearSharedDocSession();
        } else {
          setSharedDocSession(currentRole, user, currentOwnerUid, currentClaseId);
        }

        return {
          clase: localClase,
          origin: "local"
        };
      }

      throw new Error("La clase no existe o no se pudo encontrar en Firestore.");
    }

    const claseData = {
      id: claseSnap.id,
      ownerUid: currentOwnerUid,
      ...claseSnap.data()
    };

    const role = resolveUserRole(claseData, user, currentOwnerUid);

    if (!role) {
      return {
        denied: true
      };
    }

    currentClaseRef = claseRef;
    currentClaseData = claseData;
    currentRole = role;
    setSharedDocSession(role, user, currentOwnerUid, currentClaseId);

    return {
      clase: claseData,
      origin: "firestore"
    };
  } catch (error) {
    if (localClase) {
      currentClaseRef = claseRef;
      currentClaseData = localClase;
      currentRole = currentOwnerUid === user.uid ? "owner" : "viewer";

      if (currentRole === "owner") {
        clearSharedDocSession();
      } else {
        setSharedDocSession(currentRole, user, currentOwnerUid, currentClaseId);
      }

      return {
        clase: localClase,
        origin: "local"
      };
    }

    throw error;
  }
}

async function loadClase(user) {
  try {
    const result = await resolveClaseFromFirestoreOrLocal(user);

    if (result?.denied) {
      showDenied();
      return;
    }

    const claseBase = result?.clase;
    if (!claseBase) {
      throw new Error("No se encontró información de la clase.");
    }

    showDocument();
    setupShareUi();
    attachAutosaveListeners();
    ensureSelectionAssistantUi();

    const claseFinal = await generarDocumentoSiFalta(claseBase);

    currentClaseData = claseFinal;
    writeClaseToLocalStorage(claseFinal, currentOwnerUid, currentClaseId);

    renderClase(claseFinal);
    applyRoleUi(currentRole);
  } catch (error) {
    console.error("Error al cargar la clase:", error);
    showDocument();
    renderError(error?.message || "Hubo un problema al cargar la clase.");
    applyRoleUi("viewer");
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    clearSharedDocSession();
    window.location.href = "login.html";
    return;
  }

  currentUser = user;
  await loadClase(user);
});
