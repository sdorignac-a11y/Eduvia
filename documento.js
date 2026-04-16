import { auth, db } from "./firebase.js?v=7";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CONFIG = {
  sharedDocKey: "eduvia_shared_doc_access",
  referenceViewKey: "eduvia_reference_view",
  supportPanelId: "document-support-panel",
  saveDebounceMs: 900,
  generateTimeoutMs: 180000,
  selectionStyleId: "doc-selection-style",
  selectionToolbarId: "doc-selection-toolbar",
  selectionResultId: "doc-selection-result",
  maxSources: 20,
};

const params = new URLSearchParams(window.location.search);

const $ = (id) => document.getElementById(id);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

const txt = (value = "") => String(value ?? "").trim();

const safeJsonParse = (value, fallback = null) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const escapeHtml = (value = "") =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const normalizeEmail = (email = "") => txt(email).toLowerCase();
const normalizeRole = (role = "") => (role === "editor" ? "editor" : "viewer");
const emailToKey = (email = "") => normalizeEmail(email).replace(/[^a-z0-9]/gi, "_");

const DOCUMENTOS_COLLECTION = "documentos";
const sourceParam = params.get("source") || "clases";

const toArray = (value) => (Array.isArray(value) ? value : []);

const localDocKey = (ownerUid, claseId) =>
  `claseActual:${ownerUid || "unknown"}:${claseId || "unknown"}`;

const getDomainLabel = (url = "") => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

const extractYear = (value = "") => {
  const match = String(value).match(/\b(19|20)\d{2}\b/);
  return match ? match[0] : "";
};

const sanitizeUrl = (value = "") => {
  try {
    const url = new URL(String(value), window.location.origin);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    return "";
  } catch {
    return "";
  }
};

const stripObjectivePrefix = (value = "") =>
  String(value || "").replace(/^objetivo:\s*/i, "").trim();

const plainTextToBlocks = (text = "") => {
  const clean = txt(text);
  if (!clean) return "";

  return clean
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
    .join("");
};

const splitResearchParagraphs = (text = "") => {
  const clean = txt(text);
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
};

const hasRealText = (value = "") => typeof value === "string" && value.trim().length > 30;
const hasRealHtml = (value = "") => typeof value === "string" && value.trim().length > 30;

const hasRealStructuredDoc = (obj) => {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;

  const puntosClave = toArray(obj.puntosClave).filter((item) => txt(item));
  const preguntas = toArray(obj.preguntas).filter((item) => txt(item));

  return Boolean(
    txt(obj.resumen) ||
      txt(obj.explicacion) ||
      txt(obj.ejemplo) ||
      txt(obj.cierre) ||
      puntosClave.length ||
      preguntas.length
  );
};

const stripHtmlTags = (value = "") =>
  String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

function isTemporaryDocumentPlaceholder(value = "") {
  const clean = txt(stripHtmlTags(value)).toLowerCase();
  if (!clean) return false;

  return (
    clean.includes("generando documento") ||
    clean.includes("estamos investigando y armando el contenido completo") ||
    clean.includes("cuando termine, el apunte se pega automáticamente acá") ||
    clean.includes("no se pudo cargar el documento") ||
    clean.includes("esta sección debería aparecer la explicación principal") ||
    clean.includes("este documento quedó como base visual")
  );
}

function isManualEmptyDocument(clase = {}) {
  return (
    sourceParam === "documentos" &&
    (clase.origen === "vacio" ||
      clase.tipo === "documento" ||
      clase.formato === "documento") &&
    !hasDocumentoReal(clase)
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
    "text-decoration",
  ]);

  const validTextAlign = new Set(["left", "center", "right", "justify"]);
  const validFontWeight = new Set(["normal", "bold", "500", "600", "700", "800"]);
  const validFontStyle = new Set(["normal", "italic"]);
  const validTextDecoration = new Set(["none", "underline", "line-through"]);
  const genericColorRegex =
    /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%]+\)|[a-z\s-]+)$/i;

  const safeDeclarations = [];

  for (const declaration of styleText.split(";")) {
    const [rawProp, ...rest] = declaration.split(":");
    const prop = txt(rawProp).toLowerCase();
    const value = txt(rest.join(":"));

    if (!prop || !value || !allowedProps.has(prop)) continue;

    const lowerValue = value.toLowerCase();
    if (
      lowerValue.includes("url(") ||
      lowerValue.includes("expression") ||
      lowerValue.includes("javascript:") ||
      lowerValue.includes("behavior:")
    ) {
      continue;
    }

    let isValid = false;

    if (prop === "text-align") isValid = validTextAlign.has(lowerValue);
    if (prop === "font-weight") isValid = validFontWeight.has(lowerValue);
    if (prop === "font-style") isValid = validFontStyle.has(lowerValue);
    if (prop === "text-decoration") isValid = validTextDecoration.has(lowerValue);
    if (prop === "color" || prop === "background-color") isValid = genericColorRegex.test(value);

    if (isValid) safeDeclarations.push(`${prop}: ${value}`);
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
    "FONT",
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
      for (const child of Array.from(node.childNodes)) fragment.appendChild(cleanNode(child));
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

    if (tag === "FONT") {
      const colorAttr = node.getAttribute("color") || "";
      const colorStyle = sanitizeCssStyle(`color:${colorAttr}`);
      const merged = [safeStyle, colorStyle].filter(Boolean).join("; ");
      if (merged) cleanEl.setAttribute("style", merged);
    } else if (safeStyle) {
      cleanEl.setAttribute("style", safeStyle);
    }

    for (const child of Array.from(node.childNodes)) cleanEl.appendChild(cleanNode(child));

    return cleanEl;
  }

  for (const child of Array.from(sourceRoot.childNodes)) cleanRoot.appendChild(cleanNode(child));
  return cleanRoot.innerHTML.trim();
}

/* =========================
   ELEMENTS
========================= */

const els = {
  topbarTitle: $("topbar-title"),
  topbarLastSave: $("topbar-last-save"),
  docTitle: $("doc-title"),
  docObjective: $("doc-objective"),
  docContent: $("doc-content"),

  chipMateria: $("chip-materia"),
  chipNivel: $("chip-nivel"),
  chipDuracion: $("chip-duracion"),

  metaMateria: $("meta-materia"),
  metaNivel: $("meta-nivel"),
  metaDuracion: $("meta-duracion"),

  documentApp: $("document-app"),
  accessGuard: $("access-guard"),
  docLoading: $("doc-loading"),

  toolbarWrap: document.querySelector(".subbar"),
  toolbarControls: $$('.subbar button, .subbar select, .subbar input'),

  shareModal: $("share-modal"),
  shareEmailInput: $("share-email"),
  shareRoleSelect: $("share-role"),
  shareStatus: $("share-status"),
  docLinkInput: $("doc-link"),

  openShareBtn: $("open-share-btn"),
  closeShareBtn: $("close-share-btn"),
  copyLinkBtn: $("copy-link-btn"),
  sendShareBtn: $("send-share-btn"),

  moreStatus: $("more-status"),

  exportPptBtn:
    $("btn-exportar-ppt") ||
    $("export-ppt-btn") ||
    $("action-presentation") ||
    document.querySelector('[data-action="export-ppt"]'),

  referencesSection: $("references-section"),
  referencesTitle: $("references-title"),
  referencesSub: $("references-sub"),
  referencesList: $("references-list"),
  simpleViewBtn: $("simple-view-btn"),
  apaViewBtn: $("apa-view-btn"),
  toggleReferenceViewBtn: $("toggle-reference-view-btn"),
};

/* =========================
   STATE
========================= */

const state = {
  currentUser: null,
  currentClaseId: params.get("id") || params.get("doc") || null,
  currentOwnerUid: params.get("owner") || null,
  currentClaseRef: null,
  currentClaseData: null,
  currentRole: "viewer",

  saveTimer: null,
  saveInFlight: false,
  queuedSave: false,
  lastSavedSignature: "",

  generationPromise: null,
  isGeneratingDocument: false,

  shareBound: false,
  autosaveBound: false,
  referencesBound: false,
  pptBound: false,

  selectionAssistantInitialized: false,
  selectionActionBusy: false,
  currentSelectedText: "",
  currentSelectedRange: null,
  assistantLastResponse: null,

  referenceMode:
    localStorage.getItem(CONFIG.referenceViewKey) === "apa" ? "apa" : "simple",
};

/* =========================
   DOM BASICS
========================= */

function setLastSaveLabel(text = "") {
  if (els.topbarLastSave) els.topbarLastSave.textContent = text;
}

function setMoreStatus(message = "") {
  if (els.moreStatus) els.moreStatus.textContent = message;
  if (typeof window.setMoreStatus === "function") window.setMoreStatus(message);
}

function canEdit() {
  return state.currentRole === "owner" || state.currentRole === "editor";
}

function setLoadingStage(stage, message = "") {
  window.EduviaDocLoading?.setStage?.(stage, message);
}

function keepLoadingVisible() {
  els.docLoading?.classList.add("show");
  els.documentApp?.classList.add("hidden");
}

function finishLoadingAndShowDocument() {
  els.accessGuard?.classList.remove("show");
  els.documentApp?.classList.remove("hidden");
  window.EduviaDocLoading?.finish?.();
  els.docLoading?.classList.remove("show");
  setSelectionAssistantVisibility(true);
}

function showDenied() {
  window.EduviaDocLoading?.stopAutoFlow?.();
  els.docLoading?.classList.remove("show");
  els.documentApp?.classList.add("hidden");
  els.accessGuard?.classList.add("show");
  setSelectionAssistantVisibility(false);
}

function renderError(message) {
  window.EduviaDocLoading?.showError?.(message || "No se pudo cargar el documento.");
  window.EduviaDocLoading?.stopAutoFlow?.();

  els.accessGuard?.classList.remove("show");
  els.docLoading?.classList.remove("show");
  els.documentApp?.classList.remove("hidden");
  clearSupportPanel();

  if (els.docContent) {
    els.docContent.innerHTML = `
      <div class="doc-placeholder">
        <p><strong>No se pudo cargar el documento.</strong></p>
        <p>${escapeHtml(message)}</p>
      </div>
    `;
  }

  applyRoleUi("viewer");
  setSelectionAssistantVisibility(true);
}

function updateTopbarTitleFromEditor() {
  if (!els.topbarTitle || !els.docTitle) return;
  els.topbarTitle.textContent = txt(els.docTitle.textContent) || "Documento sin título";
}

function replaceNodeToClearListeners(node) {
  if (!node || !node.parentNode) return node;
  const clone = node.cloneNode(true);
  node.parentNode.replaceChild(clone, node);
  return clone;
}

/* =========================
   STORAGE
========================= */

function readClaseFromLocalStorage(ownerUid, claseId) {
  try {
    const specific = localStorage.getItem(localDocKey(ownerUid, claseId));
    if (!specific) return null;

    const parsed = safeJsonParse(specific, null);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeClaseToLocalStorage(clase, ownerUid, claseId) {
  try {
    if (!clase || !ownerUid || !claseId) return;
    localStorage.setItem(localDocKey(ownerUid, claseId), JSON.stringify(clase));
  } catch {
    // no-op
  }
}

function clearSharedDocSession() {
  try {
    sessionStorage.removeItem(CONFIG.sharedDocKey);
  } catch {
    // no-op
  }
}

function setSharedDocSession(role, user, ownerUid, claseId) {
  if (!user || !ownerUid || !claseId) return;

  if (role === "owner") {
    clearSharedDocSession();
    return;
  }

  try {
    sessionStorage.setItem(
      CONFIG.sharedDocKey,
      JSON.stringify({
        userUid: user.uid,
        userEmail: normalizeEmail(user.email || ""),
        ownerUid,
        claseId,
        role,
      })
    );
  } catch {
    // no-op
  }
}

/* =========================
   DOCUMENT DATA
========================= */

function getDocumentoTitle(clase = {}) {
  return clase.tituloDocumento || clase.tema || clase.titulo || "Documento sin título";
}

function getDocumentoObjective(clase = {}) {
  return clase.objetivoDocumento || clase.objetivo || "";
}

function getInvestigacionDocumento(clase = {}) {
  return txt(
    clase.investigacion ||
      clase.research ||
      clase.baseInvestigada ||
      clase.resumenInvestigacion ||
      ""
  );
}

function normalizeSourceItem(item, index = 0) {
  if (!item || typeof item !== "object") return null;

  const url = sanitizeUrl(item.url || item.link || item.href || "");
  const title = txt(item.title || item.titulo || item.name || item.nombre || `Fuente ${index + 1}`);
  const year = txt(item.year || item.año || item.anio || extractYear(item.date || item.fecha || ""));
  const site = txt(item.site || item.sitio || item.publisher || item.publicacion || getDomainLabel(url));
  const author = txt(
    item.author || item.autor || item.authors?.[0] || item.autores?.[0] || site || "Autor desconocido"
  );

  if (!title && !url) return null;

  return {
    id: item.id || index + 1,
    author,
    year: year || "s.f.",
    title: title || `Fuente ${index + 1}`,
    site,
    url,
  };
}

function getFuentesDocumento(clase = {}) {
  const raw =
    clase.fuentes ||
    clase.sources ||
    clase.webSources ||
    clase.fuentesUsadas ||
    clase.referencias ||
    [];

  const seen = new Set();

  return toArray(raw)
    .map((item, index) => normalizeSourceItem(item, index))
    .filter(Boolean)
    .filter((item) => {
      const key = `${item.title}|${item.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, CONFIG.maxSources);
}

function getDocumentoHtmlRaw(clase = {}) {
  return txt(
    clase.contenidoHtml ||
      clase.documentoHtml ||
      clase.htmlDocumento ||
      clase.htmlGenerado ||
      clase.documentoGeneradoHtml ||
      ""
  );
}

function getDocumentoStructuredRaw(clase = {}) {
  const genericContenido =
    clase.contenido && typeof clase.contenido === "object" && !Array.isArray(clase.contenido)
      ? clase.contenido
      : null;

  const structured =
    clase.documento ||
    clase.contenidoDocumento ||
    clase.documentoGenerado ||
    genericContenido ||
    null;

  return hasRealStructuredDoc(structured) ? structured : null;
}

function getDocumentoPlainTextRaw(clase = {}) {
  const genericContenido = typeof clase.contenido === "string" ? clase.contenido : "";

  const candidates = [
    clase.documentoTexto,
    clase.textoDocumento,
    clase.contenidoTexto,
    clase.contenidoGenerado,
    clase.textoGenerado,
    clase.documentoGeneradoTexto,
    clase.respuestaFinal,
    genericContenido,
  ];

  return txt(candidates.find((value) => txt(value)) || "");
}

function hasDocumentoReal(clase = {}) {
  const rawHtml = getDocumentoHtmlRaw(clase);
  const rawText = getDocumentoPlainTextRaw(clase);
  const structured = getDocumentoStructuredRaw(clase);

  const htmlValido = hasRealHtml(rawHtml) && !isTemporaryDocumentPlaceholder(rawHtml);
  const textValido = hasRealText(rawText) && !isTemporaryDocumentPlaceholder(rawText);
  const structuredValido = hasRealStructuredDoc(structured);

  return htmlValido || textValido || structuredValido;
}

function normalizeGeneratedDocumentResult(apiDocumento = {}, claseBase = {}) {
  const rawHtml = txt(
    apiDocumento.contenidoHtml ||
      apiDocumento.documentoHtml ||
      apiDocumento.htmlDocumento ||
      apiDocumento.html ||
      ""
  );

  const safeHtml = sanitizeHtml(rawHtml);

  const structuredCandidate =
    apiDocumento.documento ||
    apiDocumento.contenidoDocumento ||
    apiDocumento.estructura ||
    (apiDocumento && typeof apiDocumento === "object" && !Array.isArray(apiDocumento)
      ? apiDocumento
      : null);

  const structured = hasRealStructuredDoc(structuredCandidate) ? structuredCandidate : null;

  const plainText = txt(
    apiDocumento.documentoTexto ||
      apiDocumento.textoDocumento ||
      apiDocumento.contenidoTexto ||
      apiDocumento.texto ||
      apiDocumento.respuesta ||
      apiDocumento.resultado ||
      (typeof apiDocumento.contenido === "string" ? apiDocumento.contenido : "") ||
      ""
  );

  return {
    tituloDocumento:
      txt(apiDocumento.tituloDocumento) ||
      txt(claseBase.tituloDocumento) ||
      txt(claseBase.tema) ||
      "Documento",
    objetivoDocumento:
      txt(apiDocumento.objetivoDocumento) ||
      txt(claseBase.objetivoDocumento) ||
      txt(claseBase.objetivo) ||
      "",
    contenidoHtml: safeHtml || "",
    documento: structured || null,
    documentoTexto: !safeHtml && plainText ? plainText : "",
    resumenDocumento: txt(apiDocumento.resumenCorto || apiDocumento.resumen || ""),
  };
}

/* =========================
   META + UI ROLE
========================= */

function setBasicMeta(clase = {}) {
  const titulo = getDocumentoTitle(clase);
  const materia = clase.materia || "Sin materia";
  const nivel = clase.nivel || "No definido";
  const duracion = clase.duracion || "No definida";
  const objetivo = getDocumentoObjective(clase);

  if (els.topbarTitle) els.topbarTitle.textContent = titulo;
  if (els.docTitle) els.docTitle.textContent = titulo;

  if (els.chipMateria) els.chipMateria.textContent = `Materia: ${materia}`;
  if (els.chipNivel) els.chipNivel.textContent = `Nivel: ${nivel}`;
  if (els.chipDuracion) els.chipDuracion.textContent = `Duración: ${duracion}`;

  if (els.metaMateria) els.metaMateria.textContent = `Materia: ${materia}`;
  if (els.metaNivel) els.metaNivel.textContent = `Nivel: ${nivel}`;
  if (els.metaDuracion) els.metaDuracion.textContent = `Duración: ${duracion}`;

  if (els.docObjective) {
    els.docObjective.textContent = objetivo
      ? `Objetivo: ${objetivo}`
      : "Objetivo: todavía no se definió un objetivo para esta clase.";
  }
}

function setEditableState(element, editable) {
  if (!element) return;
  element.setAttribute("contenteditable", editable ? "true" : "false");
}

function applyRoleUi(role = "viewer") {
  const editable = role === "owner" || role === "editor";

  setEditableState(els.docTitle, editable);
  setEditableState(els.docObjective, editable);
  setEditableState(els.docContent, editable);

  els.toolbarControls.forEach((control) => {
    control.disabled = !editable;
  });

  if (els.toolbarWrap) {
    els.toolbarWrap.style.opacity = editable ? "1" : "0.72";
    els.toolbarWrap.style.pointerEvents = editable ? "auto" : "none";
  }

  if (els.openShareBtn) {
    els.openShareBtn.style.display = role === "owner" ? "" : "none";
  }
}

/* =========================
   SUPPORT PANEL
========================= */

function ensureSupportPanel() {
  if (!els.docContent || !els.docContent.parentNode) return null;

  let panel = $(CONFIG.supportPanelId);
  if (panel) return panel;

  panel = document.createElement("section");
  panel.id = CONFIG.supportPanelId;
  panel.setAttribute("contenteditable", "false");
  panel.style.marginTop = "26px";
  panel.style.padding = "18px";
  panel.style.borderRadius = "22px";
  panel.style.background = "linear-gradient(180deg, #f8fbff 0%, #f3f8ff 100%)";
  panel.style.border = "1px solid rgba(53, 93, 149, .12)";
  panel.style.boxShadow = "0 10px 28px rgba(0,0,0,.05)";
  panel.style.display = "none";

  els.docContent.parentNode.insertBefore(panel, els.docContent.nextSibling);
  return panel;
}

function clearSupportPanel() {
  const panel = $(CONFIG.supportPanelId);
  if (!panel) return;
  panel.innerHTML = "";
  panel.style.display = "none";
}

function renderSupportPanel(clase = {}) {
  const panel = ensureSupportPanel();
  if (!panel) return;

  const investigacion = getInvestigacionDocumento(clase);
  const paragraphs = splitResearchParagraphs(investigacion);
  const sources = getFuentesDocumento(clase);

  const hasReferencesSection = Boolean(els.referencesSection);

  if (!paragraphs.length && (!sources.length || hasReferencesSection)) {
    clearSupportPanel();
    return;
  }

  const researchHtml = paragraphs.length
    ? `
      <div style="margin-bottom:${!hasReferencesSection && sources.length ? "20px" : "0"};">
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

  const sourcesHtml =
    !hasReferencesSection && sources.length
      ? `
        <div>
          <h3 style="margin:0 0 10px;color:#2d4f76;font-size:1.08rem;font-weight:800;">Fuentes consultadas</h3>
          <div style="display:grid;gap:10px;">
            ${sources
              .map((source, index) => {
                const safeUrl = sanitizeUrl(source.url || "");
                const visibleUrl = safeUrl
                  ? escapeHtml(safeUrl.replace(/^https?:\/\//, ""))
                  : "URL no disponible";

                return `
                  <article style="padding:12px 14px;border-radius:16px;background:#ffffff;border:1px solid rgba(53,93,149,.10);">
                    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px;">
                      <strong style="color:#2d4f76;font-size:.95rem;line-height:1.4;">${escapeHtml(source.title)}</strong>
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

  const html = `${researchHtml}${sourcesHtml}`.trim();

  if (!html) {
    clearSupportPanel();
    return;
  }

  panel.innerHTML = html;
  panel.style.display = "";
}

/* =========================
   REFERENCES / APA
========================= */

function bindReferencesUi() {
  if (state.referencesBound) return;
  state.referencesBound = true;

  els.simpleViewBtn?.addEventListener("click", () => setReferenceMode("simple"));
  els.apaViewBtn?.addEventListener("click", () => setReferenceMode("apa"));
  els.toggleReferenceViewBtn?.addEventListener("click", () => {
    setReferenceMode(state.referenceMode === "apa" ? "simple" : "apa");
  });
}

function getSourceById(id, sources = []) {
  return sources.find((source) => String(source.id) === String(id));
}

function formatSimpleReference(source) {
  const url = sanitizeUrl(source.url || "");
  return `
    <strong>${escapeHtml(source.title)}</strong><br>
    <span>${escapeHtml(source.author)} · ${escapeHtml(source.year)}${
      source.site ? ` · ${escapeHtml(source.site)}` : ""
    }</span>
    ${
      url
        ? `<br><a class="reference-link" href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
        : ""
    }
  `;
}

function formatApaReference(source) {
  const url = sanitizeUrl(source.url || "");
  return `
    <span>${escapeHtml(source.author)}. (${escapeHtml(source.year || "s.f.")}). <em>${escapeHtml(
      source.title
    )}</em>${source.site ? `. ${escapeHtml(source.site)}` : ""}.</span>
    ${
      url
        ? `<a class="reference-link" href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>`
        : ""
    }
  `;
}

function formatInlineCitation(source) {
  const shortAuthor = txt(source.author || "Autor").split(",")[0].trim();
  return `(${escapeHtml(shortAuthor)}, ${escapeHtml(source.year || "s.f.")})`;
}

function renderInlineCitations() {
  if (!els.docContent) return;

  const sources = getFuentesDocumento(state.currentClaseData || {});
  const slots = $$(".citation-slot", els.docContent);

  slots.forEach((slot) => {
    const ids = txt(slot.dataset.sources || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    const selectedSources = ids.map((id) => getSourceById(id, sources)).filter(Boolean);

    if (!selectedSources.length) {
      slot.innerHTML = "";
      return;
    }

    if (state.referenceMode === "apa") {
      slot.innerHTML = `<span class="apa-inline-citation">${selectedSources
        .map(formatInlineCitation)
        .join("; ")}</span>`;
    } else {
      slot.innerHTML = ids
        .map((id) => `<span class="citation-chip">${escapeHtml(id)}</span>`)
        .join("");
    }
  });
}

function renderReferencesSection() {
  if (!els.referencesSection || !els.referencesList) return;

  const sources = getFuentesDocumento(state.currentClaseData || {});

  if (els.referencesTitle) {
    els.referencesTitle.textContent =
      state.referenceMode === "apa" ? "Referencias (APA)" : "Fuentes utilizadas";
  }

  if (els.referencesSub) {
    els.referencesSub.textContent =
      state.referenceMode === "apa"
        ? "Listado académico en estilo APA para entregar o estudiar."
        : "Vista simple para leer rápido y revisar de dónde salió la información.";
  }

  els.simpleViewBtn?.classList.toggle("is-active", state.referenceMode === "simple");
  els.apaViewBtn?.classList.toggle("is-active", state.referenceMode === "apa");

  if (els.toggleReferenceViewBtn) {
    els.toggleReferenceViewBtn.textContent =
      state.referenceMode === "apa" ? "Simple" : "APA";
  }

  if (!sources.length) {
    els.referencesList.innerHTML = `
      <div class="reference-item">
        Todavía no hay fuentes cargadas para este documento.
      </div>
    `;
    return;
  }

  els.referencesList.innerHTML = sources
    .map(
      (source) => `
        <div class="reference-item ${state.referenceMode === "apa" ? "apa" : ""}">
          ${
            state.referenceMode === "apa"
              ? formatApaReference(source)
              : formatSimpleReference(source)
          }
        </div>
      `
    )
    .join("");
}

function setReferenceMode(mode) {
  state.referenceMode = mode === "apa" ? "apa" : "simple";
  localStorage.setItem(CONFIG.referenceViewKey, state.referenceMode);
  renderInlineCitations();
  renderReferencesSection();
}

/* =========================
   DOCUMENT RENDER
========================= */

function renderGeneratingDocument(clase = {}) {
  setBasicMeta(clase);

  if (!els.docContent) return;
  els.docContent.innerHTML = `
    <div class="doc-placeholder">
      <p><strong>Generando documento...</strong></p>
      <p>Estamos investigando y armando el contenido completo de esta clase.</p>
      <p>Cuando termine, el apunte se pega automáticamente acá.</p>
    </div>
  `;
}

function renderGeneratedStructure(clase = {}) {
  if (!els.docContent) return;

  const materia = escapeHtml(clase.materia || "la materia");
  const tema = escapeHtml(getDocumentoTitle(clase));
  const nivel = escapeHtml(clase.nivel || "el nivel seleccionado");
  const duracion = escapeHtml(clase.duracion || "la duración indicada");
  const objetivo = escapeHtml(
    getDocumentoObjective(clase) || "comprender mejor el contenido trabajado"
  );

  const researchParagraphs = splitResearchParagraphs(getInvestigacionDocumento(clase));

  els.docContent.innerHTML = `
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
    <p>En esta sección debería aparecer la explicación principal del tema.</p>

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
    <p>Este documento quedó como base visual, pero no se recibió contenido completo.</p>
  `;
}

function renderRichHtmlDocumento(clase = {}) {
  const rawHtml = getDocumentoHtmlRaw(clase);
  if (!hasRealHtml(rawHtml) || !els.docContent) return false;

  const safeHtml = sanitizeHtml(rawHtml);
  if (!safeHtml) return false;

  els.docContent.innerHTML = safeHtml;
  return true;
}

function renderStructuredDocumento(clase = {}) {
  if (!els.docContent) return false;

  const content = getDocumentoStructuredRaw(clase);
  if (!hasRealStructuredDoc(content)) return false;

  const resumen = escapeHtml(content.resumen || "");
  const explicacion = escapeHtml(content.explicacion || "");
  const ejemplo = escapeHtml(content.ejemplo || "");
  const cierre = escapeHtml(content.cierre || "");
  const puntosClave = toArray(content.puntosClave);
  const preguntas = toArray(content.preguntas);

  let html = "";

  if (resumen) html += `<h2>Resumen</h2><p>${resumen}</p>`;
  if (explicacion) html += `<h2>Desarrollo del tema</h2><p>${explicacion}</p>`;

  if (puntosClave.length) {
    html += `<h2>Puntos clave</h2><ul>${puntosClave
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("")}</ul>`;
  }

  if (ejemplo) html += `<h2>Ejemplo o aplicación</h2><p>${ejemplo}</p>`;

  if (preguntas.length) {
    html += `<h2>Preguntas para practicar</h2><ol>${preguntas
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("")}</ol>`;
  }

  if (cierre) html += `<h2>Cierre</h2><p>${cierre}</p>`;
  if (!html.trim()) return false;

  els.docContent.innerHTML = html;
  return true;
}

function renderPlainTextDocumento(clase = {}) {
  if (!els.docContent) return false;

  const rawText = getDocumentoPlainTextRaw(clase);
  if (!hasRealText(rawText)) return false;

  const blocks = rawText
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (!blocks.length) return false;

  els.docContent.innerHTML = blocks
    .map((block, index) =>
      index === 0
        ? `<p><strong>${escapeHtml(block)}</strong></p>`
        : `<p>${escapeHtml(block)}</p>`
    )
    .join("");

  return true;
}

function syncSavedSignatureFromDom() {
  state.lastSavedSignature = getPayloadSignature(getCurrentDocumentPayload());
}

function renderClase(clase = {}) {
  setBasicMeta(clase);

  if (
    !renderRichHtmlDocumento(clase) &&
    !renderStructuredDocumento(clase) &&
    !renderPlainTextDocumento(clase)
  ) {
    renderGeneratedStructure(clase);
  }

  renderSupportPanel(clase);
  bindReferencesUi();
  renderInlineCitations();
  renderReferencesSection();
  syncSavedSignatureFromDom();
}

/* =========================
   SAVE
========================= */

function getCurrentDocumentPayload() {
  const titulo = txt(els.docTitle?.textContent || "") || "Documento sin título";
  const objetivo = stripObjectivePrefix(txt(els.docObjective?.textContent || ""));
  const contenidoHtml = sanitizeHtml(els.docContent?.innerHTML || "");

  return {
    tituloDocumento: titulo,
    objetivoDocumento: objetivo,
    contenidoHtml,
    ultimoEditorUid: state.currentUser?.uid || "",
    ultimoEditorEmail: normalizeEmail(state.currentUser?.email || ""),
    updatedAt: serverTimestamp(),
  };
}

function getPayloadSignature(payload = {}) {
  return JSON.stringify({
    tituloDocumento: payload.tituloDocumento || "",
    objetivoDocumento: payload.objetivoDocumento || "",
    contenidoHtml: payload.contenidoHtml || "",
  });
}

function scheduleSave() {
  if (!state.currentClaseRef || !canEdit()) return;

  clearTimeout(state.saveTimer);
  setLastSaveLabel("Guardando...");

  state.saveTimer = setTimeout(() => {
    void saveDocumentEdits();
  }, CONFIG.saveDebounceMs);
}

async function writeDocumentPayload(payload) {
  try {
    await updateDoc(state.currentClaseRef, payload);
  } catch {
    await setDoc(state.currentClaseRef, payload, { merge: true });
  }
}

async function saveDocumentEdits(force = false) {
  if (!state.currentClaseRef || !canEdit()) return;
  if (state.isGeneratingDocument) return;

  const payload = getCurrentDocumentPayload();

  if (isTemporaryDocumentPlaceholder(payload.contenidoHtml)) {
    setLastSaveLabel("Esperando contenido final...");
    return;
  }

  const signature = getPayloadSignature(payload);

  if (!force && signature === state.lastSavedSignature) {
    setLastSaveLabel("Guardado automático");
    return;
  }

  if (state.saveInFlight) {
    state.queuedSave = true;
    return;
  }

  state.saveInFlight = true;

  try {
    await writeDocumentPayload(payload);

    state.currentClaseData = {
      ...(state.currentClaseData || {}),
      tituloDocumento: payload.tituloDocumento,
      objetivoDocumento: payload.objetivoDocumento,
      contenidoHtml: payload.contenidoHtml,
      ultimoEditorUid: payload.ultimoEditorUid,
      ultimoEditorEmail: payload.ultimoEditorEmail,
      updatedAt: new Date().toISOString(),
    };

    state.lastSavedSignature = signature;
    writeClaseToLocalStorage(state.currentClaseData, state.currentOwnerUid, state.currentClaseId);
    setLastSaveLabel("Guardado automático");
  } catch (error) {
    console.error("Error guardando documento:", error);
    setLastSaveLabel("No se pudo guardar");
  } finally {
    state.saveInFlight = false;

    if (state.queuedSave) {
      state.queuedSave = false;
      void saveDocumentEdits(true);
    }
  }
}

function handlePlainTextPaste(event) {
  if (!canEdit()) return;
  event.preventDefault();
  const text = event.clipboardData?.getData("text/plain") || "";
  document.execCommand("insertText", false, text);
}

function bindAutosave() {
  if (state.autosaveBound) return;
  state.autosaveBound = true;

  const onInput = () => {
    updateTopbarTitleFromEditor();
    scheduleSave();
  };

  [els.docTitle, els.docObjective, els.docContent].forEach((node) => {
    node?.addEventListener("input", onInput);
    node?.addEventListener("paste", handlePlainTextPaste);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      clearTimeout(state.saveTimer);
      void saveDocumentEdits(true);
    }
  });

  window.addEventListener("pagehide", () => {
    clearTimeout(state.saveTimer);
    void saveDocumentEdits(true);
  });
}

/* =========================
   SHARE
========================= */

function getShareUrl() {
  if (!state.currentClaseId || !state.currentOwnerUid) return window.location.href;

  const url = new URL(window.location.href);
  url.searchParams.set("id", state.currentClaseId);
  url.searchParams.set("owner", state.currentOwnerUid);

  if (state.currentClaseRef?.path?.includes("/documentos/")) {
    url.searchParams.set("source", "documentos");
  } else {
    url.searchParams.delete("source");
  }

  return url.toString();
}

function rebindShareElements() {
  els.openShareBtn = replaceNodeToClearListeners(els.openShareBtn);
  els.closeShareBtn = replaceNodeToClearListeners(els.closeShareBtn);
  els.copyLinkBtn = replaceNodeToClearListeners(els.copyLinkBtn);
  els.sendShareBtn = replaceNodeToClearListeners(els.sendShareBtn);
}

function bindShareUi() {
  if (state.shareBound || !els.shareModal) return;
  state.shareBound = true;

  rebindShareElements();

  const openModal = () => {
    if (els.docLinkInput) els.docLinkInput.value = getShareUrl();
    if (els.shareStatus) els.shareStatus.textContent = "";
    els.shareModal?.classList.add("show");
  };

  const closeModal = () => {
    els.shareModal?.classList.remove("show");
  };

  els.openShareBtn?.addEventListener("click", openModal);
  els.closeShareBtn?.addEventListener("click", closeModal);

  els.shareModal?.addEventListener("click", (event) => {
    if (event.target === els.shareModal) closeModal();
  });

  els.copyLinkBtn?.addEventListener("click", async () => {
    try {
      const url = getShareUrl();
      await navigator.clipboard.writeText(url);
      if (els.docLinkInput) els.docLinkInput.value = url;
      if (els.shareStatus) els.shareStatus.textContent = "Link copiado.";
    } catch {
      if (els.shareStatus) els.shareStatus.textContent = "No se pudo copiar el link.";
    }
  });

  els.sendShareBtn?.addEventListener("click", async () => {
    if (state.currentRole !== "owner") {
      if (els.shareStatus) els.shareStatus.textContent = "Solo el dueño puede compartir.";
      return;
    }

    const email = normalizeEmail(els.shareEmailInput?.value || "");
    const role = normalizeRole(els.shareRoleSelect?.value || "viewer");

    if (!email || !email.includes("@")) {
      if (els.shareStatus) els.shareStatus.textContent = "Escribí un email válido.";
      return;
    }

    if (!state.currentClaseRef || !state.currentClaseId || !state.currentOwnerUid) {
      if (els.shareStatus) els.shareStatus.textContent = "No se pudo identificar el documento.";
      return;
    }

    if (email === normalizeEmail(state.currentUser?.email || "")) {
      if (els.shareStatus) els.shareStatus.textContent = "Ese email ya es el dueño.";
      return;
    }

    try {
      const sharedUserKey = `sharedUsers.${emailToKey(email)}`;

      const updates = {
        sharedWithEmails: arrayUnion(email),
        [sharedUserKey]: {
          email,
          role,
          invitedBy: normalizeEmail(state.currentUser?.email || ""),
          invitedAt: new Date().toISOString(),
        },
        updatedAt: serverTimestamp(),
      };

      if (role === "editor") {
        updates.sharedEditorEmails = arrayUnion(email);
        updates.sharedViewerEmails = arrayRemove(email);
      } else {
        updates.sharedViewerEmails = arrayUnion(email);
        updates.sharedEditorEmails = arrayRemove(email);
      }

      await updateDoc(state.currentClaseRef, updates);

      state.currentClaseData = {
        ...(state.currentClaseData || {}),
        sharedWithEmails: Array.from(
          new Set([...(state.currentClaseData?.sharedWithEmails || []), email])
        ),
      };

      writeClaseToLocalStorage(state.currentClaseData, state.currentOwnerUid, state.currentClaseId);

      const shareUrl = getShareUrl();
      const subject = encodeURIComponent("Te compartieron un documento de Eduvia");
      const body = encodeURIComponent(
        `Hola.\n\nTe compartieron este documento de Eduvia:\n${shareUrl}\n\nPermiso: ${
          role === "editor" ? "Puede editar" : "Solo ver"
        }\n\nEse enlace te da acceso únicamente a este documento.`
      );

      window.open(
        `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
          email
        )}&su=${subject}&body=${body}`,
        "_blank"
      );

      if (els.shareStatus) {
        els.shareStatus.textContent = "Permiso guardado y Gmail abierto con la invitación.";
      }

      if (els.shareEmailInput) els.shareEmailInput.value = "";
      if (els.shareRoleSelect) els.shareRoleSelect.value = "viewer";
    } catch (error) {
      console.error("Error compartiendo documento:", error);
      if (els.shareStatus) els.shareStatus.textContent = "No se pudo compartir el documento.";
    }
  });
}

/* =========================
   ROLE RESOLUTION
========================= */

function resolveUserRole(clase, user, ownerUid) {
  if (!user) return null;
  if (user.uid === ownerUid) return "owner";

  const email = normalizeEmail(user.email || "");
  if (!email) return null;

  const viewerEmails = toArray(clase.sharedViewerEmails).map(normalizeEmail);
  const editorEmails = toArray(clase.sharedEditorEmails).map(normalizeEmail);
  const allEmails = toArray(clase.sharedWithEmails).map(normalizeEmail);

  if (editorEmails.includes(email)) return "editor";
  if (viewerEmails.includes(email)) return "viewer";
  if (allEmails.includes(email)) return "viewer";

  const sharedUsers =
    clase.sharedUsers && typeof clase.sharedUsers === "object" ? clase.sharedUsers : {};
  const sharedUser = sharedUsers[emailToKey(email)] || null;

  if (sharedUser?.role) return normalizeRole(sharedUser.role);

  const legacy = toArray(clase.sharedWith);
  const legacyEntry = legacy.find((item) => normalizeEmail(item?.email) === email);
  if (legacyEntry) return normalizeRole(legacyEntry.role);

  return null;
}

/* =========================
   API
========================= */

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = CONFIG.generateTimeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const rawText = await response.text();

    let data = null;
    try {
      data = rawText ? JSON.parse(rawText) : null;
    } catch {
      data = null;
    }

    if (!data) {
      console.error("Respuesta no JSON del servidor:", {
        status: response?.status,
        statusText: response?.statusText,
        preview: String(rawText || "").slice(0, 800),
      });

      throw new Error(
        `El servidor no devolvió JSON válido. HTTP ${response?.status || "desconocido"}.`
      );
    }

    return { response, data };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("La operación tardó demasiado y fue cancelada.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function generarDocumentoSiFalta(clase = {}) {
  if (state.generationPromise) return state.generationPromise;

  state.generationPromise = (async () => {
    if (hasDocumentoReal(clase)) {
      setLoadingStage("writing", "Cargando el contenido guardado del documento.");
      return clase;
    }

    if (!clase?.materia || !clase?.tema || !clase?.nivel) {
      throw new Error("Faltan materia, tema o nivel para generar el documento.");
    }

    state.isGeneratingDocument = true;

    try {
      renderGeneratingDocument(clase);
      setLoadingStage("sources", "Estamos buscando fuentes confiables para construir el documento.");

      const payload = {
        materia: clase.materia || "",
        tema: clase.tema || "",
        nivel: clase.nivel || "",
        duracion: clase.duracion || "",
        objetivo: clase.objetivo || clase.objetivoDocumento || "",
        investigacion: getInvestigacionDocumento(clase),
        fuentes: getFuentesDocumento(clase),
        contenidoBase: getDocumentoPlainTextRaw(clase),
      };

      console.log("CLASE BASE:", clase);
      console.log("INVESTIGACION ENVIADA:", payload.investigacion);
      console.log("FUENTES ENVIADAS:", payload.fuentes);
      console.log("TEXTO BASE:", payload.contenidoBase);

      const { response, data } = await fetchJsonWithTimeout("/api/generar-documento", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      console.log("RESPUESTA /api/generar-documento:", {
        status: response?.status,
        okHttp: response?.ok,
        okBody: data?.ok,
        error: data?.error,
        detail: data?.detail,
        hasDocumento: Boolean(data?.documento),
      });

      setLoadingStage(
        "analysis",
        "Ordenando la investigación y preparando la mejor versión del contenido."
      );

      if (!response.ok || !data?.ok || !data?.documento) {
        console.error("Respuesta completa del backend:", data);
        throw new Error(data?.detail || data?.error || "No se pudo generar el documento.");
      }

      const normalizedDoc = normalizeGeneratedDocumentResult(data.documento, clase);

      const documentoGeneradoValido =
        hasRealHtml(normalizedDoc.contenidoHtml) ||
        hasRealText(normalizedDoc.documentoTexto) ||
        hasRealStructuredDoc(normalizedDoc.documento);

      if (!documentoGeneradoValido) {
        console.error("Respuesta cruda del backend:", data);
        throw new Error(
          data?.detail || "La IA respondió, pero no devolvió contenido utilizable."
        );
      }

      setLoadingStage("writing", "Pegando el contenido final y terminando el documento.");

      const merged = {
        ...clase,
        tituloDocumento: normalizedDoc.tituloDocumento,
        objetivoDocumento: normalizedDoc.objetivoDocumento,
        contenidoHtml: normalizedDoc.contenidoHtml || "",
        documento: normalizedDoc.documento || null,
        documentoTexto: normalizedDoc.documentoTexto || "",
        resumenDocumento: normalizedDoc.resumenDocumento || "",
        investigacion: txt(data.investigacion || getInvestigacionDocumento(clase)),
        fuentes: toArray(data.fuentes).length ? data.fuentes : getFuentesDocumento(clase),
        updatedAt: new Date().toISOString(),
      };

      if (state.currentClaseRef && canEdit()) {
        try {
          await setDoc(
            state.currentClaseRef,
            {
              tituloDocumento: merged.tituloDocumento,
              objetivoDocumento: merged.objetivoDocumento,
              contenidoHtml: merged.contenidoHtml || "",
              documento: merged.documento || null,
              documentoTexto: merged.documentoTexto || "",
              resumenDocumento: merged.resumenDocumento || "",
              investigacion: merged.investigacion,
              fuentes: merged.fuentes,
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        } catch (error) {
          console.error("Error guardando documento generado:", error);
        }
      }

      state.currentClaseData = merged;
      writeClaseToLocalStorage(merged, state.currentOwnerUid, state.currentClaseId);
      return merged;
    } finally {
      state.isGeneratingDocument = false;
    }
  })();

  try {
    return await state.generationPromise;
  } finally {
    state.generationPromise = null;
  }
}

/* =========================
   LOAD DOC
========================= */
async function resolveClaseFromFirestoreOrLocal(user) {
  const fallbackOwner = state.currentOwnerUid || user.uid;
  const localClase = readClaseFromLocalStorage(fallbackOwner, state.currentClaseId);

  if (!state.currentClaseId && localClase?.id) state.currentClaseId = localClase.id;
  if (!state.currentOwnerUid) state.currentOwnerUid = localClase?.ownerUid || user.uid;

  if (!state.currentClaseId) {
  if (localClase) {
  state.currentClaseData = localClase;
  state.currentRole = state.currentOwnerUid === user.uid ? "owner" : "viewer";
  state.currentClaseRef = doc(
    db,
    "usuarios",
    state.currentOwnerUid,
    sourceParam === "documentos" ? DOCUMENTOS_COLLECTION : "clases",
    localClase.id
  );

  if (state.currentRole === "owner") clearSharedDocSession();
  else setSharedDocSession(state.currentRole, user, state.currentOwnerUid, localClase.id);

  return { clase: localClase, origin: "local" };
}

    throw new Error("No se encontró el identificador del documento.");
  }

  const refs = sourceParam === "documentos"
    ? [
        doc(db, "usuarios", state.currentOwnerUid, DOCUMENTOS_COLLECTION, state.currentClaseId),
        doc(db, "usuarios", state.currentOwnerUid, "clases", state.currentClaseId),
      ]
    : [
        doc(db, "usuarios", state.currentOwnerUid, "clases", state.currentClaseId),
        doc(db, "usuarios", state.currentOwnerUid, DOCUMENTOS_COLLECTION, state.currentClaseId),
      ];

  for (const ref of refs) {
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) continue;

      const claseData = {
        id: snap.id,
        ownerUid: state.currentOwnerUid,
        ...snap.data(),
      };

      const role = resolveUserRole(claseData, user, state.currentOwnerUid);

      if (!role) {
        return { denied: true };
      }

      state.currentClaseRef = ref;
      state.currentClaseData = claseData;
      state.currentRole = role;
      setSharedDocSession(role, user, state.currentOwnerUid, state.currentClaseId);

      return { clase: claseData, origin: "firestore" };
    } catch (error) {
      console.error("Error leyendo documento:", error);
    }
  }

  if (localClase) {
    state.currentClaseData = localClase;
    state.currentRole = state.currentOwnerUid === user.uid ? "owner" : "viewer";
    if (state.currentRole === "owner") clearSharedDocSession();
    else setSharedDocSession(state.currentRole, user, state.currentOwnerUid, localClase.id);

    return { clase: localClase, origin: "local" };
  }

  throw new Error("No se encontró el documento en Firestore.");
}

async function loadClase(user) {
  try {
    setLoadingStage("access", "Estamos validando tu acceso y buscando el documento.");

    const result = await resolveClaseFromFirestoreOrLocal(user);

    if (result?.denied) {
      showDenied();
      return;
    }

    const claseBase = result?.clase;
    if (!claseBase) throw new Error("No se encontró información de la clase.");

    els.accessGuard?.classList.remove("show");
    keepLoadingVisible();

    bindAutosave();
    bindShareUi();
    ensureSelectionAssistantUi();
    setupPresentationExport();

    const tieneDocumentoReal = hasDocumentoReal(claseBase);

    if (tieneDocumentoReal) {
      setLoadingStage("writing", "Cargando el documento guardado.");
    } else {
      setLoadingStage("sources", "Todavía no hay contenido final, así que vamos a generarlo.");
    }

if (isManualEmptyDocument(claseBase)) {
  state.currentClaseData = {
    ...claseBase,
    tituloDocumento: claseBase.tituloDocumento || claseBase.titulo || "Documento sin título",
    objetivoDocumento: claseBase.objetivoDocumento || "",
    contenidoHtml: claseBase.contenidoHtml || ""
  };

  writeClaseToLocalStorage(state.currentClaseData, state.currentOwnerUid, state.currentClaseId);
  setBasicMeta(state.currentClaseData);

  if (els.docContent) els.docContent.innerHTML = state.currentClaseData.contenidoHtml || "";

  clearSupportPanel();
  bindReferencesUi();
  renderReferencesSection();
  applyRoleUi(state.currentRole);
  syncSavedSignatureFromDom();
  setLastSaveLabel("Listo para editar");
  finishLoadingAndShowDocument();
  return;
}

const claseFinal = await generarDocumentoSiFalta(claseBase);

state.currentClaseData = claseFinal;
writeClaseToLocalStorage(claseFinal, state.currentOwnerUid, state.currentClaseId);

renderClase(claseFinal);
applyRoleUi(state.currentRole);
setLastSaveLabel("Guardado automático");
finishLoadingAndShowDocument();
  } catch (error) {
    console.error("Error al cargar la clase:", error);
    renderError(error?.message || "Hubo un problema al cargar la clase.");
  }
}

function normalizePresentationText(value = "") {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function chunkArray(items = [], size = 5) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function splitPresentationText(text = "", maxChars = 120) {
  const clean = normalizePresentationText(text);
  if (!clean) return [];

  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!sentences.length) return [clean.slice(0, maxChars)];

  const blocks = [];
  let current = "";

  const pushCurrent = () => {
    const value = normalizePresentationText(current);
    if (value) blocks.push(value);
    current = "";
  };

  for (const sentence of sentences) {
    if (sentence.length <= maxChars) {
      const next = current ? `${current} ${sentence}` : sentence;
      if (next.length <= maxChars) current = next;
      else {
        pushCurrent();
        current = sentence;
      }
      continue;
    }

    const words = sentence.split(/\s+/).filter(Boolean);
    let partial = "";

    for (const word of words) {
      const next = partial ? `${partial} ${word}` : word;
      if (next.length <= maxChars) partial = next;
      else {
        if (partial) blocks.push(partial);
        partial = word;
      }
    }

    if (partial) {
      const next = current ? `${current} ${partial}` : partial;
      if (next.length <= maxChars) current = next;
      else {
        pushCurrent();
        current = partial;
      }
    }
  }

  pushCurrent();
  return blocks.filter(Boolean);
}

function getPresentationMeta() {
  const clase = state.currentClaseData || {};
  return {
    titulo:
      normalizePresentationText(els.docTitle?.textContent || "") ||
      normalizePresentationText(getDocumentoTitle(clase)) ||
      "Presentación",
    objetivo:
      stripObjectivePrefix(normalizePresentationText(els.docObjective?.textContent || "")) ||
      normalizePresentationText(getDocumentoObjective(clase)),
    materia: normalizePresentationText(clase.materia || ""),
    nivel: normalizePresentationText(clase.nivel || ""),
    duracion: normalizePresentationText(clase.duracion || ""),
  };
}

function extractPresentationSectionsFromDom() {
  if (!els.docContent) return [];

  const sections = [];
  let currentSection = { title: "Contenido", bullets: [] };
  const children = Array.from(els.docContent.children || []);

  const pushSection = () => {
    const title = normalizePresentationText(currentSection.title);
    const bullets = currentSection.bullets
      .map((item) => normalizePresentationText(item))
      .filter(Boolean);

    if (title || bullets.length) sections.push({ title: title || "Contenido", bullets });
  };

  if (!children.length) {
    const fallbackText = normalizePresentationText(els.docContent.innerText || "");
    return fallbackText
      ? [{ title: "Contenido", bullets: splitPresentationText(fallbackText, 120) }]
      : [];
  }

  for (const child of children) {
    const tag = (child.tagName || "").toLowerCase();

    if (tag === "h1" || tag === "h2") {
      pushSection();
      currentSection = {
        title: normalizePresentationText(child.textContent || "Sección"),
        bullets: [],
      };
      continue;
    }

    if (tag === "h3") {
      const subtitle = normalizePresentationText(child.textContent || "");
      if (subtitle) currentSection.bullets.push(subtitle);
      continue;
    }

    if (tag === "p" || tag === "blockquote") {
      const text = normalizePresentationText(child.innerText || child.textContent || "");
      if (text) currentSection.bullets.push(...splitPresentationText(text, 120));
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      const items = Array.from(child.querySelectorAll(":scope > li"))
        .map((li) => normalizePresentationText(li.innerText || li.textContent || ""))
        .filter(Boolean);

      for (const item of items) currentSection.bullets.push(...splitPresentationText(item, 100));
      continue;
    }

    const fallback = normalizePresentationText(child.innerText || child.textContent || "");
    if (fallback) currentSection.bullets.push(...splitPresentationText(fallback, 120));
  }

  pushSection();
  return sections.filter((section) => section.bullets.length);
}

function addPresentationCoverSlide(pptx, meta) {
  const slide = pptx.addSlide();
  slide.background = { color: "F8F4EC" };

  slide.addText(meta.titulo || "Presentación", {
    x: 0.65,
    y: 0.8,
    w: 11.8,
    h: 1.0,
    fontFace: "Inter",
    fontSize: 24,
    bold: true,
    color: "2B2434",
    margin: 0,
    valign: "mid",
  });

  if (meta.objetivo) {
    slide.addText(meta.objetivo, {
      x: 0.65,
      y: 1.95,
      w: 11.3,
      h: 0.8,
      fontFace: "Inter",
      fontSize: 12,
      color: "6F6577",
      margin: 0,
    });
  }

  const chips = [
    meta.materia ? `Materia: ${meta.materia}` : "",
    meta.nivel ? `Nivel: ${meta.nivel}` : "",
    meta.duracion ? `Duración: ${meta.duracion}` : "",
  ].filter(Boolean);

  let chipX = 0.65;

  for (const chip of chips) {
    slide.addText(chip, {
      x: chipX,
      y: 3.0,
      w: 2.35,
      h: 0.38,
      fontFace: "Inter",
      fontSize: 9,
      bold: true,
      color: "5A4FCF",
      align: "center",
      valign: "mid",
      margin: 0.06,
      fill: { color: "EFEAFF" },
      line: { color: "EFEAFF" },
      radius: 0.1,
    });
    chipX += 2.5;
  }

  slide.addText("Eduvia", {
    x: 0.68,
    y: 6.65,
    w: 1.1,
    h: 0.2,
    fontFace: "Inter",
    fontSize: 9,
    bold: true,
    color: "8E7FE8",
    margin: 0,
  });
}

function addPresentationContentSlide(pptx, title, bullets = [], slideNumber = 1) {
  const slide = pptx.addSlide();
  slide.background = { color: "FFFDF8" };

  slide.addText(title || "Contenido", {
    x: 0.65,
    y: 0.45,
    w: 11.6,
    h: 0.5,
    fontFace: "Inter",
    fontSize: 20,
    bold: true,
    color: "2B2434",
    margin: 0,
  });

  slide.addText(
    bullets.map((item) => `• ${normalizePresentationText(item)}`).join("\n") || "• Contenido",
    {
      x: 0.85,
      y: 1.25,
      w: 11.25,
      h: 5.25,
      fontFace: "Inter",
      fontSize: 15,
      color: "3C3547",
      breakLine: false,
      margin: 0,
      valign: "top",
      paraSpaceAfterPt: 14,
    }
  );

  slide.addText(String(slideNumber), {
    x: 12.2,
    y: 6.85,
    w: 0.35,
    h: 0.18,
    fontFace: "Inter",
    fontSize: 8,
    color: "9A90A8",
    align: "right",
    margin: 0,
  });
}

function addPresentationSourcesSlide(pptx, sources = [], slideNumber = 1) {
  if (!sources.length) return;

  const bullets = sources.slice(0, 8).map((source, index) => {
    const title = normalizePresentationText(source.title || `Fuente ${index + 1}`);
    const url = normalizePresentationText((source.url || "").replace(/^https?:\/\//, ""));
    return url ? `${title} — ${url}` : title;
  });

  addPresentationContentSlide(pptx, "Fuentes consultadas", bullets, slideNumber);
}

function getPresentationFileName(title = "presentacion-eduvia") {
  const safe = String(title || "presentacion-eduvia")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 60);

  return `${safe || "presentacion-eduvia"}.pptx`;
}

async function exportDocumentToPresentation() {
  const PptxGenJS = window.PptxGenJS;

  if (!PptxGenJS) {
    alert("Falta cargar la librería de presentaciones en documento.html.");
    return;
  }

  if (!els.docContent || !normalizePresentationText(els.docContent.innerText || "")) {
    alert("No hay contenido suficiente en el documento para convertir.");
    return;
  }

  const targetLabel = els.exportPptBtn?.querySelector?.(".more-item-title");
  const originalText =
    targetLabel?.textContent || els.exportPptBtn?.textContent || "Pasar a presentación";

  try {
    window.closeMoreDropdown?.();
    setMoreStatus("Generando presentación...");

    if (els.exportPptBtn) {
      els.exportPptBtn.disabled = true;
      if (targetLabel) targetLabel.textContent = "Generando presentación...";
      else els.exportPptBtn.textContent = "Generando presentación...";
    }

    const meta = getPresentationMeta();
    const sections = extractPresentationSectionsFromDom();
    const sources = getFuentesDocumento(state.currentClaseData || {});

    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "Eduvia";
    pptx.company = "Eduvia";
    pptx.subject = meta.titulo || "Documento convertido a presentación";
    pptx.title = meta.titulo || "Presentación";
    pptx.lang = "es-AR";

    addPresentationCoverSlide(pptx, meta);

    const MAX_CONTENT_SLIDES = 8;
    const MAX_BULLETS_PER_SLIDE = 4;
    const MAX_BULLET_LENGTH = 120;

    let slideNumber = 2;
    let createdSlides = 0;

    for (const section of sections) {
      if (createdSlides >= MAX_CONTENT_SLIDES) break;

      const bullets = toArray(section.bullets)
        .map((item) => normalizePresentationText(item))
        .filter(Boolean)
        .map((item) =>
          item.length > MAX_BULLET_LENGTH ? `${item.slice(0, MAX_BULLET_LENGTH).trim()}...` : item
        );

      const grouped = chunkArray(bullets, MAX_BULLETS_PER_SLIDE);

      for (let i = 0; i < grouped.length; i++) {
        if (createdSlides >= MAX_CONTENT_SLIDES) break;

        addPresentationContentSlide(
          pptx,
          i === 0 ? section.title : `${section.title} (cont.)`,
          grouped[i],
          slideNumber
        );

        slideNumber += 1;
        createdSlides += 1;
      }
    }

    if (sources.length && createdSlides < MAX_CONTENT_SLIDES + 1) {
      addPresentationSourcesSlide(pptx, sources, slideNumber);
    }

    await pptx.writeFile({ fileName: getPresentationFileName(meta.titulo) });
    setMoreStatus("Presentación generada.");
  } catch (error) {
    console.error("Error exportando a presentación:", error);
    alert("No se pudo generar la presentación.");
    setMoreStatus("No se pudo generar la presentación.");
  } finally {
    if (els.exportPptBtn) {
      els.exportPptBtn.disabled = false;
      if (targetLabel) targetLabel.textContent = originalText;
      else els.exportPptBtn.textContent = originalText;
    }
  }
}

function setupPresentationExport() {
  if (state.pptBound || !els.exportPptBtn) return;
  state.pptBound = true;

  els.exportPptBtn = replaceNodeToClearListeners(els.exportPptBtn);

  els.exportPptBtn.addEventListener("click", () => {
    void exportDocumentToPresentation();
  });
}

/* =========================
   SELECTION ASSISTANT
========================= */

function setSelectionAssistantVisibility(visible) {
  const toolbar = $(CONFIG.selectionToolbarId);
  const panel = $(CONFIG.selectionResultId);

  if (toolbar) {
    toolbar.style.display = visible ? "" : "none";
    if (!visible) toolbar.classList.remove("show");
  }

  if (panel) {
    panel.style.display = visible ? "" : "none";
    if (!visible) panel.classList.remove("show");
  }
}

function injectSelectionAssistantStyles() {
  if ($(CONFIG.selectionStyleId)) return;

  const style = document.createElement("style");
  style.id = CONFIG.selectionStyleId;
  style.textContent = `
    #${CONFIG.selectionToolbarId}{
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

    #${CONFIG.selectionToolbarId}.show{ display:flex; }

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

    #${CONFIG.selectionResultId}{
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

    #${CONFIG.selectionResultId}.show{ display:block; }

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

    .doc-selection-result-section{ margin-top:14px; }

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
      #${CONFIG.selectionResultId}{
        right:14px;
        left:14px;
        top:auto;
        bottom:18px;
        width:auto;
        max-height:58vh;
      }

      #${CONFIG.selectionToolbarId}{
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

function nodeBelongsToDocument(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  if (!element) return false;

  return Boolean(
    els.docTitle?.contains(element) ||
      els.docObjective?.contains(element) ||
      els.docContent?.contains(element)
  );
}

function rangeBelongsToDocument(range) {
  return (
    range &&
    nodeBelongsToDocument(range.startContainer) &&
    nodeBelongsToDocument(range.endContainer)
  );
}

function getClosestEditableRoot(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  if (!element) return null;
  if (els.docTitle?.contains(element)) return els.docTitle;
  if (els.docObjective?.contains(element)) return els.docObjective;
  if (els.docContent?.contains(element)) return els.docContent;
  return null;
}

function getClosestBlockElement(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return element?.closest?.("p, li, h1, h2, h3, blockquote, div") || null;
}

function hideSelectionToolbar() {
  $(CONFIG.selectionToolbarId)?.classList.remove("show");
}

function hideSelectionResult() {
  $(CONFIG.selectionResultId)?.classList.remove("show");
}

function showSelectionToolbarAt(rect) {
  const toolbar = $(CONFIG.selectionToolbarId);
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

function trackSelectedTextForAssistant() {
  if (state.selectionActionBusy) return;

  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) {
    state.currentSelectedText = "";
    state.currentSelectedRange = null;
    hideSelectionToolbar();
    return;
  }

  const text = txt(selection.toString());
  const range = selection.getRangeAt(0);

  if (!text || !rangeBelongsToDocument(range)) {
    state.currentSelectedText = "";
    state.currentSelectedRange = null;
    hideSelectionToolbar();
    return;
  }

  const rect = range.getBoundingClientRect();
  if (!rect || (!rect.width && !rect.height)) {
    hideSelectionToolbar();
    return;
  }

  state.currentSelectedText = text.slice(0, 5000);
  state.currentSelectedRange = range.cloneRange();
  showSelectionToolbarAt(rect);
}

function getPlainDocumentText() {
  const titulo = txt(els.docTitle?.textContent || "");
  const objetivo = stripObjectivePrefix(txt(els.docObjective?.textContent || ""));
  const contenido = txt(els.docContent?.innerText || els.docContent?.textContent || "");
  return [titulo, objetivo, contenido].filter(Boolean).join("\n\n");
}

function getDocumentAssistantQuestion(action, selectedText = "") {
  const base = txt(selectedText);

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

function restoreStoredSelection() {
  if (!state.currentSelectedRange) return false;

  const selection = window.getSelection();
  if (!selection) return false;

  selection.removeAllRanges();
  selection.addRange(state.currentSelectedRange);

  const root = getClosestEditableRoot(state.currentSelectedRange.startContainer);
  root?.focus?.();

  return true;
}

function replaceSelectedTextWithResult(text = "") {
  if (!canEdit()) return;
  const clean = txt(text);
  if (!clean || !restoreStoredSelection()) return;

  document.execCommand("insertText", false, clean);
  scheduleSave();
  hideSelectionToolbar();
}

function insertResultBelowSelection(text = "") {
  if (!canEdit()) return;
  const clean = txt(text);
  if (!clean) return;

  const html = plainTextToBlocks(clean);
  if (!html) return;

  const startNode = state.currentSelectedRange?.startContainer || null;
  const root = getClosestEditableRoot(startNode);

  if (root === els.docContent) {
    const block = getClosestBlockElement(startNode);
    if (block && els.docContent.contains(block)) block.insertAdjacentHTML("afterend", html);
    else els.docContent.insertAdjacentHTML("beforeend", html);
  } else if (root === els.docObjective) {
    els.docObjective.insertAdjacentHTML("afterend", html);
  } else {
    els.docContent?.insertAdjacentHTML("afterbegin", html);
  }

  scheduleSave();
}

async function copyAssistantText(text = "") {
  const value = txt(text);
  if (!value) return false;

  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function normalizeAssistantResponse(raw = {}) {
  const response = raw?.respuesta && typeof raw.respuesta === "object" ? raw.respuesta : raw;

  return {
    subtitulo: txt(raw?.subtitulo || "Asistente del documento"),
    titulo: txt(response?.titulo || "Sugerencia"),
    modo: txt(response?.modo || "respuesta"),
    resumen: txt(response?.resumen || ""),
    cambios: toArray(response?.cambios),
    textoPropuesto: txt(response?.textoPropuesto || ""),
    preguntasSeguimiento: toArray(response?.preguntasSeguimiento),
  };
}

function renderSelectionResult(raw = {}, actionLabel = "Acción") {
  const panel = $(CONFIG.selectionResultId);
  if (!panel) return;

  const data = normalizeAssistantResponse(raw);
  state.assistantLastResponse = data;

  const copyValue = data.textoPropuesto || data.resumen || "";

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
      data.textoPropuesto
        ? `
          <div class="doc-selection-result-section">
            <div class="doc-selection-result-label">Texto propuesto</div>
            <pre class="doc-selection-proposed">${escapeHtml(data.textoPropuesto)}</pre>
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
      <button type="button" class="doc-selection-action-btn" data-copy-selection-result>Copiar</button>
      ${
        data.textoPropuesto && canEdit()
          ? `
            <button type="button" class="doc-selection-action-btn" data-insert-selection-result>Insertar debajo</button>
            <button type="button" class="doc-selection-action-btn primary" data-replace-selection-result>Reemplazar selección</button>
          `
          : ""
      }
    </div>
  `;

  panel
    .querySelector("[data-close-selection-panel]")
    ?.addEventListener("click", hideSelectionResult);
  panel
    .querySelector("[data-copy-selection-result]")
    ?.addEventListener("click", () => copyAssistantText(copyValue));
  panel
    .querySelector("[data-insert-selection-result]")
    ?.addEventListener("click", () => insertResultBelowSelection(data.textoPropuesto));
  panel
    .querySelector("[data-replace-selection-result]")
    ?.addEventListener("click", () => replaceSelectedTextWithResult(data.textoPropuesto));

  panel.classList.add("show");
}

async function runSelectionAction(action = "mejorar", label = "Mejorar") {
  if (state.selectionActionBusy || !state.currentSelectedText) return;

  state.selectionActionBusy = true;
  hideSelectionToolbar();

  const panel = $(CONFIG.selectionResultId);
  if (panel) {
    panel.innerHTML = `
      <div class="doc-selection-result-header">
        <div>
          <div class="doc-selection-result-chip">${escapeHtml(label)}</div>
          <h3>Generando propuesta...</h3>
        </div>
      </div>
      <p class="doc-selection-result-summary">Estamos analizando el fragmento seleccionado.</p>
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
        pregunta: getDocumentAssistantQuestion(action, state.currentSelectedText),
        accion: action,
        tituloDocumento: txt(els.docTitle?.textContent || ""),
        objetivoDocumento: stripObjectivePrefix(txt(els.docObjective?.textContent || "")),
        documentoActual: getPlainDocumentText(),
        textoSeleccionado: state.currentSelectedText,
        investigacion: getInvestigacionDocumento(state.currentClaseData || {}),
        fuentes: getFuentesDocumento(state.currentClaseData || {}),
        ultimaRespuesta: state.assistantLastResponse,
      }),
    });

    const data = await response.json().catch(() => null);

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
        ?.addEventListener("click", hideSelectionResult);
      panel.classList.add("show");
    }
  } finally {
    state.selectionActionBusy = false;
  }
}

function ensureSelectionAssistantUi() {
  if (state.selectionAssistantInitialized) return;
  state.selectionAssistantInitialized = true;

  injectSelectionAssistantStyles();

  const toolbar = document.createElement("div");
  toolbar.id = CONFIG.selectionToolbarId;
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
  resultPanel.id = CONFIG.selectionResultId;

  document.body.appendChild(toolbar);
  document.body.appendChild(resultPanel);

  toolbar.addEventListener("mousedown", (event) => event.preventDefault());

  toolbar.addEventListener("click", (event) => {
    const button = event.target.closest("[data-selection-action]");
    if (!button) return;
    void runSelectionAction(
      button.getAttribute("data-selection-action") || "mejorar",
      button.getAttribute("data-selection-label") || "Mejorar"
    );
  });

  document.addEventListener("selectionchange", () =>
    setTimeout(trackSelectedTextForAssistant, 0)
  );

  document.addEventListener(
    "scroll",
    () => {
      if (!state.currentSelectedRange) return;
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount) return;
      const rect = selection.getRangeAt(0).getBoundingClientRect();
      if (rect && (rect.width || rect.height)) showSelectionToolbarAt(rect);
    },
    true
  );

  document.addEventListener("mousedown", (event) => {
    const toolbarEl = $(CONFIG.selectionToolbarId);
    const resultEl = $(CONFIG.selectionResultId);

    if (
      toolbarEl?.contains(event.target) ||
      resultEl?.contains(event.target) ||
      els.docContent?.contains(event.target) ||
      els.docObjective?.contains(event.target) ||
      els.docTitle?.contains(event.target)
    ) {
      return;
    }

    hideSelectionToolbar();
  });
}

els.documentApp?.classList.add("hidden");
els.accessGuard?.classList.remove("show");
els.docLoading?.classList.add("show");
setLoadingStage("access", "Estamos validando acceso y preparando el documento.");

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    clearSharedDocSession();
    window.location.href = "login.html";
    return;
  }

  state.currentUser = user;
  await loadClase(user);
});

function limpiarTextoChatDocumento(value = "") {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function detectarAccionChatDocumento(message = "") {
  const text = limpiarTextoChatDocumento(message).toLowerCase();

  if (!text) return "";
  if (text.includes("explic")) return "explicar";
  if (text.includes("mejor")) return "mejorar";
  if (text.includes("alarg") || text.includes("ampli") || text.includes("profund")) return "alargar";
  if (text.includes("acort")) return "acortar";
  if (text.includes("claro") || text.includes("más simple") || text.includes("mas simple")) return "claro";
  if (text.includes("formal")) return "formal";
  if (text.includes("resum")) return "resumir";
  if (text.includes("reescrib") || text.includes("reformular")) return "reescritura";

  return "";
}

function obtenerTextoSeleccionadoParaChat() {
  const fromState = limpiarTextoChatDocumento(state?.currentSelectedText || "");
  if (fromState) return fromState;

  const selection = window.getSelection?.();
  if (!selection || selection.rangeCount === 0) return "";

  return limpiarTextoChatDocumento(selection.toString() || "");
}

function normalizarFuentesParaChat(fuentes = []) {
  return (Array.isArray(fuentes) ? fuentes : [])
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      return {
        title: limpiarTextoChatDocumento(item.title || item.titulo || item.name || "Fuente"),
        url: limpiarTextoChatDocumento(item.url || item.link || ""),
      };
    })
    .filter((item) => item && (item.title || item.url))
    .slice(0, 10);
}

function formatearRespuestaChatDocumento(payload) {
  if (!payload?.respuesta) {
    return "No pude interpretar la respuesta del asistente.";
  }

  const { subtitulo = "", respuesta = {} } = payload;
  const {
    titulo = "Respuesta",
    resumen = "",
    cambios = [],
    textoPropuesto = "",
    preguntasSeguimiento = [],
  } = respuesta;

  const partes = [];

  if (subtitulo) partes.push(subtitulo);
  if (titulo) partes.push(titulo);
  if (resumen) partes.push(resumen);

  if (Array.isArray(cambios) && cambios.length) {
    const bloqueCambios = cambios
      .map((item, index) => {
        const lineas = [];
        lineas.push(`${index + 1}. ${limpiarTextoChatDocumento(item?.titulo || "Mejora sugerida")}`);

        if (item?.detalle) {
          lineas.push(limpiarTextoChatDocumento(item.detalle));
        }

        if (item?.ejemplo) {
          lineas.push(`Ejemplo: ${limpiarTextoChatDocumento(item.ejemplo)}`);
        }

        return lineas.join("\n");
      })
      .join("\n\n");

    if (bloqueCambios) {
      partes.push(`Cambios sugeridos:\n${bloqueCambios}`);
    }
  }

  if (textoPropuesto) {
    partes.push(`Texto propuesto:\n${limpiarTextoChatDocumento(textoPropuesto)}`);
  }

  if (Array.isArray(preguntasSeguimiento) && preguntasSeguimiento.length) {
    partes.push(
      `Podés seguir con:\n${preguntasSeguimiento
        .map((item) => `- ${limpiarTextoChatDocumento(item)}`)
        .join("\n")}`
    );
  }

  return partes.filter(Boolean).join("\n\n");
}

window.handleEduviaDocChat = async function handleEduviaDocChat({
  message = "",
  title = "",
  objective = "",
  content = "",
} = {}) {
  const pregunta = limpiarTextoChatDocumento(message);
  const tituloDocumento =
    limpiarTextoChatDocumento(title) ||
    limpiarTextoChatDocumento(els.docTitle?.innerText || "") ||
    limpiarTextoChatDocumento(getDocumentoTitle(state.currentClaseData || {}));

  const objetivoDocumento =
    limpiarTextoChatDocumento(stripObjectivePrefix(objective || "")) ||
    limpiarTextoChatDocumento(stripObjectivePrefix(els.docObjective?.innerText || "")) ||
    limpiarTextoChatDocumento(getDocumentoObjective(state.currentClaseData || {}));

  const documentoActual =
    limpiarTextoChatDocumento(content) ||
    limpiarTextoChatDocumento(els.docContent?.innerText || "");

  const textoSeleccionado = obtenerTextoSeleccionadoParaChat();
  const accion = detectarAccionChatDocumento(pregunta);

  const investigacion =
    typeof getInvestigacionDocumento === "function"
      ? limpiarTextoChatDocumento(getInvestigacionDocumento(state.currentClaseData || {}))
      : "";

  const fuentes =
    typeof getFuentesDocumento === "function"
      ? normalizarFuentesParaChat(getFuentesDocumento(state.currentClaseData || {}))
      : [];

  if (!pregunta) {
    return "Escribí una consigna para analizar el documento.";
  }

  if (!documentoActual && !textoSeleccionado) {
    return "No encontré contenido suficiente en el documento para analizar.";
  }

  try {
    const { response, data } = await fetchJsonWithTimeout(
      "/api/preguntar-documento",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pregunta,
          accion,
          documentoActual,
          tituloDocumento,
          objetivoDocumento,
          textoSeleccionado,
          investigacion,
          fuentes,
          ultimaRespuesta: state.assistantLastResponse || null,
        }),
      },
      180000
    );

    if (!response?.ok || !data?.ok || !data?.respuesta) {
      return data?.error || "No se pudo analizar el documento.";
    }

    state.assistantLastResponse = data.respuesta;

    return formatearRespuestaChatDocumento(data.respuesta);
  } catch (error) {
    console.error("Error conectando el chat con /api/preguntar-documento:", error);
    return "Hubo un problema al conectar el chat del documento con la IA.";
  }
};
