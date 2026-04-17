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

const DOCUMENTOS_COLLECTION = "documentos";
const params = new URLSearchParams(window.location.search);
const sourceParam = params.get("source") || "clases";

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
const toArray = (value) => (Array.isArray(value) ? value : []);
const emailToKey = (email = "") => normalizeEmail(email).replace(/[^a-z0-9]/gi, "_");

const localDocKey = (ownerUid, claseId) =>
  `claseActual:${ownerUid || "unknown"}:${claseId || "unknown"}`;

const sanitizeUrl = (value = "") => {
  try {
    const url = new URL(String(value), window.location.origin);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
    return "";
  } catch {
    return "";
  }
};

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

const stripObjectivePrefix = (value = "") =>
  String(value || "").replace(/^objetivo:\s*/i, "").trim();

const normalizeCompareText = (value = "") =>
  txt(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\w\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();

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
    id: String(item.id || index + 1),
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
    fuentes:
      toArray(apiDocumento.fuentes || apiDocumento.sources || apiDocumento.referencias).length
        ? toArray(apiDocumento.fuentes || apiDocumento.sources || apiDocumento.referencias)
        : toArray(claseBase.fuentes || claseBase.sources || claseBase.referencias),
    investigacion:
      txt(apiDocumento.investigacion || apiDocumento.research || apiDocumento.baseInvestigada) ||
      txt(claseBase.investigacion || claseBase.research || claseBase.baseInvestigada),
  };
}

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
  panel.style.display = "block";
}

function getSourceById(id, sources = []) {
  const stringId = String(id || "").trim();
  return sources.find((source) => String(source.id) === stringId) || null;
}

function formatSimpleReference(source) {
  const safeUrl = sanitizeUrl(source.url || "");
  const title = escapeHtml(source.title || "Fuente");
  const site = escapeHtml(source.site || "");
  const year = escapeHtml(source.year || "s.f.");

  return `
    <strong>${title}</strong>
    ${site ? ` — ${site}` : ""}
    ${year ? ` (${year})` : ""}
    ${
      safeUrl
        ? ` — <a class="reference-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(
            safeUrl.replace(/^https?:\/\//, "")
          )}</a>`
        : ""
    }
  `;
}

function formatApaReference(source) {
  const author = escapeHtml(source.author || "Autor desconocido");
  const year = escapeHtml(source.year || "s.f.");
  const title = escapeHtml(source.title || "Sin título");
  const site = escapeHtml(source.site || "");
  const safeUrl = sanitizeUrl(source.url || "");

  return `
    ${author}. (${year}). <em>${title}</em>${site ? `. ${site}` : ""}${
      safeUrl ? `. <a class="reference-link" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${escapeHtml(safeUrl)}</a>` : ""
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

function bindReferencesUi() {
  if (state.referencesBound) return;
  state.referencesBound = true;

  els.simpleViewBtn?.addEventListener("click", () => setReferenceMode("simple"));
  els.apaViewBtn?.addEventListener("click", () => setReferenceMode("apa"));
  els.toggleReferenceViewBtn?.addEventListener("click", () => {
    const next = state.referenceMode === "apa" ? "simple" : "apa";
    setReferenceMode(next);
  });
}

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

  const structured = getDocumentoStructuredRaw(clase);
  if (!structured) {
    els.docContent.innerHTML = "";
    return;
  }

  const parts = [];

  if (txt(structured.resumen)) {
    parts.push(`<p>${escapeHtml(structured.resumen)}</p>`);
  }

  if (txt(structured.explicacion)) {
    parts.push(`<h2>Explicación</h2><p>${escapeHtml(structured.explicacion)}</p>`);
  }

  const puntosClave = toArray(structured.puntosClave).filter((item) => txt(item));
  if (puntosClave.length) {
    parts.push(`
      <h2>Puntos clave</h2>
      <ul>
        ${puntosClave.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ul>
    `);
  }

  if (txt(structured.ejemplo)) {
    parts.push(`<h2>Ejemplo</h2><p>${escapeHtml(structured.ejemplo)}</p>`);
  }

  const preguntas = toArray(structured.preguntas).filter((item) => txt(item));
  if (preguntas.length) {
    parts.push(`
      <h2>Preguntas para estudiar</h2>
      <ol>
        ${preguntas.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
      </ol>
    `);
  }

  if (txt(structured.cierre)) {
    parts.push(`<h2>Cierre</h2><p>${escapeHtml(structured.cierre)}</p>`);
  }

  els.docContent.innerHTML = parts.join("") || "";
}

function renderClase(clase = {}) {
  setBasicMeta(clase);

  if (!els.docContent) return;

  const html = sanitizeHtml(getDocumentoHtmlRaw(clase));
  const text = getDocumentoPlainTextRaw(clase);

  if (html && !isTemporaryDocumentPlaceholder(html)) {
    els.docContent.innerHTML = html;
  } else if (text && !isTemporaryDocumentPlaceholder(text)) {
    const paragraphs = text
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
      .map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br>")}</p>`)
      .join("");
    els.docContent.innerHTML = paragraphs;
  } else {
    renderGeneratedStructure(clase);
  }

  renderSupportPanel(clase);
  bindReferencesUi();
  renderInlineCitations();
  renderReferencesSection();
  syncSavedSignatureFromDom();
}

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

function syncSavedSignatureFromDom() {
  const payload = getCurrentDocumentPayload();
  state.lastSavedSignature = getPayloadSignature(payload);
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

  window.addEventListener("beforeunload", () => {
    if (state.saveTimer) clearTimeout(state.saveTimer);
  });
}

function isValidEmail(email = "") {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(txt(email));
}

async function handleShareInvite({ email, role }) {
  if (!state.currentClaseRef) throw new Error("No hay documento cargado.");
  if (state.currentRole !== "owner") throw new Error("Solo el dueño puede compartir.");
  if (!isValidEmail(email)) throw new Error("Ingresá un email válido.");

  const normalizedEmail = normalizeEmail(email);
  const normalized = normalizeRole(role);

  const payload = {
    sharedWithEmails: arrayUnion(normalizedEmail),
    sharedUsers: {
      ...(state.currentClaseData?.sharedUsers || {}),
      [emailToKey(normalizedEmail)]: {
        email: normalizedEmail,
        role: normalized,
        invitedAt: new Date().toISOString(),
      },
    },
    sharedWith: arrayUnion({
      email: normalizedEmail,
      role: normalized,
    }),
    updatedAt: serverTimestamp(),
  };

  if (normalized === "editor") {
    payload.sharedEditorEmails = arrayUnion(normalizedEmail);
    payload.sharedViewerEmails = arrayRemove(normalizedEmail);
  } else {
    payload.sharedViewerEmails = arrayUnion(normalizedEmail);
    payload.sharedEditorEmails = arrayRemove(normalizedEmail);
  }

  await setDoc(state.currentClaseRef, payload, { merge: true });

  state.currentClaseData = {
    ...(state.currentClaseData || {}),
    sharedWithEmails: Array.from(
      new Set([...(state.currentClaseData?.sharedWithEmails || []), normalizedEmail])
    ),
    sharedViewerEmails:
      normalized === "viewer"
        ? Array.from(new Set([...(state.currentClaseData?.sharedViewerEmails || []), normalizedEmail]))
        : (state.currentClaseData?.sharedViewerEmails || []).filter(
            (item) => normalizeEmail(item) !== normalizedEmail
          ),
    sharedEditorEmails:
      normalized === "editor"
        ? Array.from(new Set([...(state.currentClaseData?.sharedEditorEmails || []), normalizedEmail]))
        : (state.currentClaseData?.sharedEditorEmails || []).filter(
            (item) => normalizeEmail(item) !== normalizedEmail
          ),
    sharedUsers: {
      ...(state.currentClaseData?.sharedUsers || {}),
      [emailToKey(normalizedEmail)]: {
        email: normalizedEmail,
        role: normalized,
        invitedAt: new Date().toISOString(),
      },
    },
  };

  writeClaseToLocalStorage(state.currentClaseData, state.currentOwnerUid, state.currentClaseId);
}

function openShareModal() {
  els.shareModal?.classList.add("show");
  if (els.docLinkInput) els.docLinkInput.value = window.location.href;
  if (els.shareStatus) els.shareStatus.textContent = "";
}

function closeShareModal() {
  els.shareModal?.classList.remove("show");
  if (els.shareStatus) els.shareStatus.textContent = "";
}

function bindShareUi() {
  if (state.shareBound) return;
  state.shareBound = true;

  if (els.docLinkInput) els.docLinkInput.value = window.location.href;

  window.handleEduviaShareInvite = async ({ email, role }) => {
    await handleShareInvite({ email, role });
    if (els.shareEmailInput) els.shareEmailInput.value = "";
    if (els.shareRoleSelect) els.shareRoleSelect.value = "viewer";
  };

  window.openEduviaShareModal = openShareModal;
  window.closeEduviaShareModal = closeShareModal;
}

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

async function requestDocumentGeneration(clase = {}) {
  const body = {
    materia: clase.materia || "",
    tema: clase.tema || clase.titulo || "",
    nivel: clase.nivel || "",
    duracion: clase.duracion || "",
    objetivo: clase.objetivo || clase.objetivoDocumento || "",
    fuentes: toArray(clase.fuentes || clase.sources || clase.referencias),
    contenidoBase:
      txt(clase.contenido || "") ||
      txt(clase.documentoTexto || "") ||
      txt(clase.investigacion || ""),
    documentId: state.currentClaseId,
    ownerUid: state.currentOwnerUid,
    source: sourceParam,
  };

  const endpoints = [
    "/api/generar-documento",
    "/api/generate-document",
    "/api/documento/generar",
    "/api/crear-documento",
  ];

  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const { data } = await fetchJsonWithTimeout(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const payload = data?.documento || data?.result || data?.data || data;
      if (payload && typeof payload === "object") return payload;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("No se pudo generar el documento.");
}

function buildFallbackGeneratedDocument(clase = {}) {
  const tema = txt(clase.tema || clase.titulo || "este tema");
  const objetivo = txt(clase.objetivo || clase.objetivoDocumento || "");
  const materia = txt(clase.materia || "la materia");
  const nivel = txt(clase.nivel || "el nivel indicado");
  const investigacion = txt(clase.investigacion || "");

  const safeInvestigacion = investigacion
    ? investigacion
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];

  const html = `
    <h2>Introducción</h2>
    <p>${escapeHtml(
      `Este documento desarrolla ${tema} dentro de ${materia}, pensado para ${nivel}.`
    )}</p>
    ${
      objetivo
        ? `<p>${escapeHtml(`El objetivo principal es ${objetivo}.`)}</p>`
        : ""
    }
    <h2>Desarrollo</h2>
    ${
      safeInvestigacion.length
        ? safeInvestigacion.map((block) => `<p>${escapeHtml(block)}</p>`).join("")
        : `<p>${escapeHtml(
            `Todavía no llegó una generación completa desde el backend, pero esta base ya te deja el documento editable para seguir trabajando ${tema}.`
          )}</p>`
    }
    <h2>Cierre</h2>
    <p>${escapeHtml(
      `Como síntesis, ${tema} puede estudiarse retomando sus ideas principales, ejemplos y relaciones con el resto del contenido.`
    )}</p>
  `;

  return {
    tituloDocumento: getDocumentoTitle(clase),
    objetivoDocumento: getDocumentoObjective(clase),
    contenidoHtml: sanitizeHtml(html),
    documentoTexto: "",
    documento: null,
    resumenDocumento: "",
    investigacion: clase.investigacion || "",
    fuentes: toArray(clase.fuentes || clase.sources || clase.referencias),
  };
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

      let generatedRaw = null;
      try {
        generatedRaw = await requestDocumentGeneration(clase);
      } catch (error) {
        console.warn("No se pudo generar desde backend. Se usa fallback local.", error);
      }

      const normalized = generatedRaw
        ? normalizeGeneratedDocumentResult(generatedRaw, clase)
        : buildFallbackGeneratedDocument(clase);

      const claseFinal = {
        ...clase,
        ...normalized,
        updatedAt: new Date().toISOString(),
      };

      if (state.currentClaseRef) {
        await setDoc(
          state.currentClaseRef,
          {
            tituloDocumento: claseFinal.tituloDocumento,
            objetivoDocumento: claseFinal.objetivoDocumento,
            contenidoHtml: claseFinal.contenidoHtml || "",
            documentoTexto: claseFinal.documentoTexto || "",
            documento: claseFinal.documento || null,
            resumenDocumento: claseFinal.resumenDocumento || "",
            investigacion: claseFinal.investigacion || "",
            fuentes: toArray(claseFinal.fuentes),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
      }

      return claseFinal;
    } finally {
      state.isGeneratingDocument = false;
      state.generationPromise = null;
    }
  })();

  return state.generationPromise;
}

async function resolveClaseFromFirestoreOrLocal(user) {
  const ownerFromQuery = params.get("owner");
  const localOwner = ownerFromQuery || user.uid;
  const localClase = readClaseFromLocalStorage(localOwner, state.currentClaseId);

  state.currentOwnerUid = ownerFromQuery || localClase?.ownerUid || user.uid;

  if (!state.currentClaseId) {
    if (localClase?.id) {
      state.currentClaseId = localClase.id;
      state.currentClaseData = localClase;
      state.currentRole = state.currentOwnerUid === user.uid ? "owner" : "viewer";

      if (state.currentRole === "owner") clearSharedDocSession();
      else setSharedDocSession(state.currentRole, user, state.currentOwnerUid, localClase.id);

      return { clase: localClase, origin: "local" };
    }

    throw new Error("No se encontró el identificador del documento.");
  }

  const refs =
    sourceParam === "documentos"
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
        contenidoHtml: claseBase.contenidoHtml || "",
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
    if (currentSection.bullets.length || currentSection.title !== "Contenido") {
      sections.push({
        title: currentSection.title,
        bullets: currentSection.bullets.slice(0, 12),
      });
    }
  };

  const pushTextAsBullets = (text) => {
    splitPresentationText(text, 120).forEach((block) => {
      if (block) currentSection.bullets.push(block);
    });
  };

  for (const node of children) {
    const tag = String(node.tagName || "").toUpperCase();
    const text = normalizePresentationText(node.innerText || node.textContent || "");
    if (!text) continue;

    if (tag === "H2" || tag === "H3") {
      pushSection();
      currentSection = { title: text, bullets: [] };
      continue;
    }

    if (tag === "UL" || tag === "OL") {
      Array.from(node.querySelectorAll("li")).forEach((li) => {
        const liText = normalizePresentationText(li.innerText || li.textContent || "");
        if (liText) currentSection.bullets.push(liText);
      });
      continue;
    }

    pushTextAsBullets(text);
  }

  pushSection();

  if (!sections.length) {
    const fallbackText = normalizePresentationText(els.docContent.innerText || "");
    if (fallbackText) {
      sections.push({
        title: "Contenido",
        bullets: splitPresentationText(fallbackText, 120),
      });
    }
  }

  return sections.slice(0, 12);
}

function addSlideHeader(slide, title = "", number = "") {
  slide.addText(title, {
    x: 0.7,
    y: 0.45,
    w: 10.4,
    h: 0.55,
    fontFace: "Aptos",
    fontSize: 24,
    bold: true,
    color: "1F2937",
  });

  if (number) {
    slide.addText(String(number), {
      x: 12.05,
      y: 0.42,
      w: 0.6,
      h: 0.4,
      fontFace: "Aptos",
      fontSize: 11,
      bold: true,
      align: "right",
      color: "64748B",
    });
  }

  slide.addShape(window.PptxGenJS.ShapeType.line, {
    x: 0.7,
    y: 1.08,
    w: 12,
    h: 0,
    line: { color: "DCE3EA", pt: 1.2 },
  });
}

function addPresentationCoverSlide(pptx, meta) {
  const slide = pptx.addSlide();
  slide.background = { color: "F7FAFC" };

  slide.addShape(window.PptxGenJS.ShapeType.rect, {
    x: 0,
    y: 0,
    w: 13.333,
    h: 0.38,
    line: { color: "3B82F6", pt: 0 },
    fill: { color: "3B82F6" },
  });

  slide.addText(meta.titulo || "Presentación", {
    x: 0.85,
    y: 1.15,
    w: 11.6,
    h: 1.0,
    fontFace: "Aptos",
    fontSize: 28,
    bold: true,
    color: "0F172A",
  });

  if (meta.objetivo) {
    slide.addText(meta.objetivo, {
      x: 0.9,
      y: 2.2,
      w: 11.3,
      h: 1.2,
      fontFace: "Aptos",
      fontSize: 16,
      color: "334155",
      breakLine: false,
      valign: "mid",
    });
  }

  const chips = [meta.materia, meta.nivel, meta.duracion].filter(Boolean);
  let currentX = 0.9;

  chips.forEach((chip) => {
    const width = Math.min(Math.max(chip.length * 0.09, 1.4), 3.4);

    slide.addShape(window.PptxGenJS.ShapeType.roundRect, {
      x: currentX,
      y: 4.35,
      w: width,
      h: 0.48,
      rectRadius: 0.08,
      line: { color: "DBEAFE", pt: 1 },
      fill: { color: "EFF6FF" },
    });

    slide.addText(chip, {
      x: currentX + 0.12,
      y: 4.45,
      w: width - 0.24,
      h: 0.18,
      fontFace: "Aptos",
      fontSize: 10.5,
      bold: true,
      color: "1D4ED8",
      align: "center",
    });

    currentX += width + 0.18;
  });

  slide.addText("Generado desde Eduvia", {
    x: 0.9,
    y: 6.7,
    w: 4.4,
    h: 0.28,
    fontFace: "Aptos",
    fontSize: 10.5,
    color: "64748B",
  });
}

function addPresentationContentSlide(pptx, title, bullets = [], slideNumber = "") {
  const slide = pptx.addSlide();
  slide.background = { color: "FFFFFF" };

  addSlideHeader(slide, title || "Contenido", slideNumber);

  const bulletRuns = bullets.slice(0, 5).map((item) => ({
    text: item,
    options: {
      bullet: { indent: 14 },
      hanging: 3,
      breakLine: true,
    },
  }));

  slide.addText(bulletRuns, {
    x: 1.0,
    y: 1.45,
    w: 10.9,
    h: 4.9,
    fontFace: "Aptos",
    fontSize: 18,
    color: "1F2937",
    breakLine: false,
    paraSpaceAfterPt: 10,
    valign: "top",
  });
}

function addPresentationSourcesSlide(pptx, sources = [], slideNumber = "") {
  const bullets = sources.slice(0, 8).map((source) => {
    const base = [
      txt(source.author || "Autor"),
      txt(source.year || "s.f."),
      txt(source.title || "Fuente"),
      txt(source.site || ""),
    ]
      .filter(Boolean)
      .join(" — ");

    return source.url ? `${base} — ${source.url}` : base;
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
    setMoreStatus("Presentación lista.");
  } catch (error) {
    console.error("Error exportando presentación:", error);
    setMoreStatus("No se pudo generar la presentación.");
    alert("No se pudo generar la presentación.");
  } finally {
    if (els.exportPptBtn) {
      els.exportPptBtn.disabled = false;
      if (targetLabel) targetLabel.textContent = originalText;
      else els.exportPptBtn.textContent = originalText;
    }
  }
}

function setupPresentationExport() {
  if (state.pptBound) return;
  state.pptBound = true;

  window.exportEduviaPresentation = exportDocumentToPresentation;

  els.exportPptBtn?.addEventListener("click", async (event) => {
    event.preventDefault();
    await exportDocumentToPresentation();
  });
}

function injectSelectionAssistantStyles() {
  if ($(CONFIG.selectionStyleId)) return;

  const style = document.createElement("style");
  style.id = CONFIG.selectionStyleId;
  style.textContent = `
    #${CONFIG.selectionToolbarId}{
      position:fixed;
      z-index:220;
      display:none;
      align-items:center;
      gap:8px;
      flex-wrap:wrap;
      padding:10px;
      border-radius:18px;
      background:rgba(255,255,255,.98);
      border:1px solid rgba(15,23,42,.08);
      box-shadow:0 18px 40px rgba(15,23,42,.14);
      backdrop-filter:blur(10px);
      max-width:min(92vw,680px);
    }
    #${CONFIG.selectionToolbarId}.show{ display:flex; }
    .doc-selection-tool-btn{
      border:none;
      border-radius:999px;
      padding:9px 12px;
      background:#eef4ff;
      color:#0b57d0;
      font-weight:700;
      cursor:pointer;
    }
    .doc-selection-tool-btn:hover{ background:#e2edff; }
    #${CONFIG.selectionResultId}{
      position:fixed;
      z-index:219;
      display:none;
      max-width:min(92vw,560px);
      min-width:280px;
      padding:16px;
      border-radius:22px;
      background:#ffffff;
      border:1px solid rgba(15,23,42,.08);
      box-shadow:0 22px 50px rgba(15,23,42,.16);
    }
    #${CONFIG.selectionResultId}.show{ display:block; }
    #${CONFIG.selectionResultId} h4{
      margin:0 0 8px;
      font-size:1rem;
      color:#0f172a;
    }
    #${CONFIG.selectionResultId} p{
      margin:0;
      line-height:1.7;
      color:#334155;
      white-space:pre-wrap;
    }
    .doc-selection-result-actions{
      display:flex;
      gap:10px;
      flex-wrap:wrap;
      margin-top:14px;
    }
    .doc-selection-result-btn{
      border:none;
      border-radius:12px;
      padding:10px 12px;
      font-weight:700;
      cursor:pointer;
      background:#f1f5f9;
      color:#0f172a;
    }
    .doc-selection-result-btn.primary{
      background:#c2e7ff;
      color:#0b57d0;
    }
  `;
  document.head.appendChild(style);
}

function hideSelectionToolbar() {
  $(CONFIG.selectionToolbarId)?.classList.remove("show");
}

function hideSelectionResult() {
  $(CONFIG.selectionResultId)?.classList.remove("show");
}

function setSelectionAssistantVisibility(visible) {
  if (!visible) {
    hideSelectionToolbar();
    hideSelectionResult();
  }
}

function showSelectionToolbarAt(rect) {
  const toolbar = $(CONFIG.selectionToolbarId);
  if (!toolbar) return;

  const top = Math.max(10, rect.top + window.scrollY - 58);
  const left = Math.max(10, rect.left + window.scrollX);

  toolbar.style.top = `${top}px`;
  toolbar.style.left = `${left}px`;
  toolbar.classList.add("show");
}

function showSelectionResult(content, rect) {
  const panel = $(CONFIG.selectionResultId);
  if (!panel) return;

  panel.innerHTML = `
    <h4>Resultado</h4>
    <p>${escapeHtml(content)}</p>
    <div class="doc-selection-result-actions">
      <button type="button" class="doc-selection-result-btn primary" data-selection-apply>Aplicar texto</button>
      <button type="button" class="doc-selection-result-btn" data-selection-copy>Copiar</button>
      <button type="button" class="doc-selection-result-btn" data-selection-close>Cerrar</button>
    </div>
  `;

  const top = Math.max(10, rect.bottom + window.scrollY + 12);
  const left = Math.max(10, rect.left + window.scrollX);

  panel.style.top = `${top}px`;
  panel.style.left = `${left}px`;
  panel.classList.add("show");

  panel.querySelector("[data-selection-close]")?.addEventListener("click", hideSelectionResult);
  panel.querySelector("[data-selection-copy]")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      // no-op
    }
  });

  panel.querySelector("[data-selection-apply]")?.addEventListener("click", () => {
    applySelectionReplacement(content);
    hideSelectionResult();
  });
}

function getAllowedSelectionContainer(node) {
  if (!node) return null;
  if (els.docTitle?.contains(node)) return els.docTitle;
  if (els.docObjective?.contains(node)) return els.docObjective;
  if (els.docContent?.contains(node)) return els.docContent;
  return null;
}

function trackSelectedTextForAssistant() {
  if (!canEdit()) {
    hideSelectionToolbar();
    return;
  }

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    state.currentSelectedText = "";
    state.currentSelectedRange = null;
    hideSelectionToolbar();
    return;
  }

  const range = selection.getRangeAt(0);
  const common = range.commonAncestorContainer;
  const container = getAllowedSelectionContainer(common);

  if (!container) {
    state.currentSelectedText = "";
    state.currentSelectedRange = null;
    hideSelectionToolbar();
    return;
  }

  const text = txt(selection.toString());
  if (!text || text.length < 2) {
    state.currentSelectedText = "";
    state.currentSelectedRange = null;
    hideSelectionToolbar();
    return;
  }

  state.currentSelectedText = text;
  state.currentSelectedRange = range.cloneRange();

  const rect = range.getBoundingClientRect();
  if (rect && (rect.width || rect.height)) showSelectionToolbarAt(rect);
}

function applySelectionReplacement(content = "") {
  if (!state.currentSelectedRange || !content) return;

  const range = state.currentSelectedRange.cloneRange();
  const selection = window.getSelection();

  selection.removeAllRanges();
  selection.addRange(range);

  range.deleteContents();
  range.insertNode(document.createTextNode(content));

  selection.removeAllRanges();
  state.currentSelectedRange = null;
  state.currentSelectedText = "";
  hideSelectionToolbar();
  scheduleSave();
}

function localSelectionTransform(action, text) {
  const clean = txt(text);
  if (!clean) return "";

  switch (action) {
    case "resumir":
      return clean.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
    case "explicar":
      return `Explicación simple: ${clean}`;
    case "mejorar":
      return clean;
    case "alargar":
      return `${clean} Además, este punto puede profundizarse con una explicación más desarrollada y un ejemplo concreto para que quede más claro.`;
    case "acortar":
      return clean.length > 180 ? `${clean.slice(0, 177).trim()}...` : clean;
    case "claro":
      return clean
        .replace(/\s+/g, " ")
        .replace(/, /g, ". ")
        .replace(/\.\s*\./g, ". ");
    case "formal":
      return clean.replace(/\bvos\b/gi, "usted");
    default:
      return clean;
  }
}

async function runSelectionAction(action, label) {
  if (state.selectionActionBusy || !state.currentSelectedText) return;
  state.selectionActionBusy = true;

  try {
    let output = "";

    if (typeof window.handleEduviaSelectionAction === "function") {
      const response = await window.handleEduviaSelectionAction({
        action,
        label,
        selectedText: state.currentSelectedText,
        title: txt(els.docTitle?.textContent || ""),
        objective: txt(els.docObjective?.textContent || ""),
        content: txt(stripHtmlTags(els.docContent?.innerHTML || "")),
      });
      output = txt(typeof response === "string" ? response : response?.text || "");
    }

    if (!output) {
      output = localSelectionTransform(action, state.currentSelectedText);
    }

    const rect = state.currentSelectedRange?.getBoundingClientRect?.();
    showSelectionResult(output, rect || { left: 20, bottom: 80 });
  } catch (error) {
    console.error("Error en acción de selección:", error);
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

function localDocChatReply(message) {
  const normalized = normalizeCompareText(message);
  const content = txt(stripHtmlTags(els.docContent?.innerHTML || ""));
  const title = txt(els.docTitle?.textContent || "documento");

  if (!content) {
    return "Todavía no hay contenido suficiente en el documento. Primero cargá o generá el texto y después pedime cambios.";
  }

  const sentences = content.split(/(?<=[.!?])\s+/).filter(Boolean);

  if (normalized.includes("resum")) {
    return `Resumen rápido: ${sentences.slice(0, 3).join(" ") || content.slice(0, 260)}`;
  }

  if (normalized.includes("conclusion")) {
    return `Podés cerrar el documento con una conclusión que retome ${title.toLowerCase()} y resuma las ideas principales trabajadas.`;
  }

  if (normalized.includes("ejemplo")) {
    return "Podés sumar un ejemplo concreto después del concepto principal, explicando el caso y cómo se relaciona con la idea teórica.";
  }

  if (normalized.includes("simple") || normalized.includes("facil")) {
    return "Para hacerlo más simple, conviene usar oraciones más cortas, menos palabras técnicas y explicar cada concepto con una idea central por párrafo.";
  }

  if (normalized.includes("alarg")) {
    return "Para alargarlo bien, agregá una explicación más profunda por sección, un ejemplo por tema y una mini conclusión al final de cada bloque importante.";
  }

  return "Ya quedó armado el puente del chat lateral con documento.js. Ahora podés pedir resumen, conclusión, mejoras o una explicación más clara.";
}

window.handleEduviaDocChat = async ({ message, title, objective, content }) => {
  const body = {
    message,
    title: txt(title),
    objective: txt(objective),
    content: txt(content),
    ownerUid: state.currentOwnerUid,
    documentId: state.currentClaseId,
  };

  const endpoints = ["/api/chat-documento", "/api/documento/chat", "/api/chat"];

  for (const endpoint of endpoints) {
    try {
      const { data } = await fetchJsonWithTimeout(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }, 45000);

      const reply =
        data?.reply ||
        data?.respuesta ||
        data?.message ||
        data?.output ||
        data?.text;

      if (txt(reply)) return txt(reply);
    } catch {
      // sigue al próximo endpoint
    }
  }

  return localDocChatReply(message);
};

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
