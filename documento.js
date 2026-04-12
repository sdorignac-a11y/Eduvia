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

/* =========================
   CONFIG
========================= */

const CONFIG = {
  sharedDocKey: "eduvia_shared_doc_access",
  referenceViewKey: "eduvia_reference_view",
  supportPanelId: "document-support-panel",
  saveDebounceMs: 900,
  generateTimeoutMs: 90000,
  selectionStyleId: "doc-selection-style",
  selectionToolbarId: "doc-selection-toolbar",
  selectionResultId: "doc-selection-result",
  maxSources: 20,
};

const params = new URLSearchParams(window.location.search);

/* =========================
   HELPERS
========================= */

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
    if (specific) {
      const parsed = safeJsonParse(specific, null);
      if (parsed && typeof parsed === "object") return parsed;
    }

    const legacy = localStorage.getItem("claseActual");
    if (legacy) {
      const parsed = safeJsonParse(legacy, null);
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {
    // no-op
  }

  return null;
}

function writeClaseToLocalStorage(clase, ownerUid, claseId) {
  try {
    if (!clase || !ownerUid || !claseId) return;
    const value = JSON.stringify(clase);
    localStorage.setItem(localDocKey(ownerUid, claseId), value);
    localStorage.setItem("claseActual", value);
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
  const author = txt(item.author || item.autor || item.authors?.[0] || item.autores?.[0] || site || "Autor desconocido");

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
    <span>${escapeHtml(source.author)} · ${escapeHtml(source.year)}${source.site ? ` · ${escapeHtml(source.site)}` : ""}</span>
    ${url ? `<br><a class="reference-link" href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>` : ""}
  `;
}

function formatApaReference(source) {
  const url = sanitizeUrl(source.url || "");
  return `
    <span>${escapeHtml(source.author)}. (${escapeHtml(source.year || "s.f.")}). <em>${escapeHtml(source.title)}</em>${source.site ? `. ${escapeHtml(source.site)}` : ""}.</span>
    ${url ? `<a class="reference-link" href="${url}" target="_blank" rel="noopener noreferrer">${escapeHtml(url)}</a>` : ""}
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
  const rawHtml = clase.contenidoHtml || clase.documentoHtml || clase.htmlDocumento || "";
  if (!hasRealHtml(rawHtml) || !els.docContent) return false;

  const safeHtml = sanitizeHtml(rawHtml);
  if (!safeHtml) return false;

  els.docContent.innerHTML = safeHtml;
  return true;
}

function renderStructuredDocumento(clase = {}) {
  if (!els.docContent) return false;

  const content = clase.documento || clase.contenidoDocumento || clase.contenido;
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

  const rawText =
    clase.documentoTexto || clase.textoDocumento || clase.contenidoTexto || "";

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

  if (!renderRichHtmlDocumento(clase) && !renderStructuredDocumento(clase) && !renderPlainTextDocumento(clase)) {
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

  const payload = getCurrentDocumentPayload();
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
    const data = await response.json().catch(() => null);

    if (!data) throw new Error("El servidor devolvió un JSON inválido.");
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
    const alreadyExists =
      hasRealHtml(clase.contenidoHtml) ||
      hasRealHtml(clase.documentoHtml) ||
      hasRealHtml(clase.htmlDocumento) ||
      hasRealText(clase.documentoTexto) ||
      hasRealText(clase.textoDocumento) ||
      hasRealText(clase.contenidoTexto) ||
      hasRealStructuredDoc(clase.documento) ||
      hasRealStructuredDoc(clase.contenidoDocumento) ||
      hasRealStructuredDoc(clase.contenido);

    if (alreadyExists) {
      setLoadingStage("writing", "Cargando el contenido guardado del documento.");
      return clase;
    }

    if (!clase?.materia || !clase?.tema || !clase?.nivel) {
      throw new Error("Faltan materia, tema o nivel para generar el documento.");
    }

    renderGeneratingDocument(clase);
    setLoadingStage("sources", "Estamos buscando fuentes confiables para construir el documento.");

    const payload = {
      materia: clase.materia || "",
      tema: clase.tema || "",
      nivel: clase.nivel || "",
      duracion: clase.duracion || "",
      objetivo: clase.objetivo || "",
      investigacion: clase.investigacion || "",
      fuentes: toArray(clase.fuentes),
    };

    const { response, data } = await fetchJsonWithTimeout("/api/generar-documento", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    setLoadingStage("analysis", "Ordenando la investigación y preparando la mejor versión del contenido.");

    if (!response.ok || !data?.ok || !data?.documento) {
      throw new Error(data?.error || "No se pudo generar el documento.");
    }

    const safeHtml = sanitizeHtml(data.documento.contenidoHtml || "");
    if (!safeHtml) {
      throw new Error("La IA respondió, pero no devolvió contenido utilizable.");
    }

    setLoadingStage("writing", "Pegando el contenido final y terminando el documento.");

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
      fuentes: toArray(data.fuentes).length ? data.fuentes : toArray(clase.fuentes),
      updatedAt: new Date().toISOString(),
    };

    if (state.currentClaseRef && canEdit()) {
      try {
        await setDoc(
          state.currentClaseRef,
          {
            tituloDocumento: merged.tituloDocumento,
            objetivoDocumento: merged.objetivoDocumento,
            contenidoHtml: merged.contenidoHtml,
            resumenDocumento: merged.resumenDocumento,
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
      state.currentClaseRef = doc(db, "usuarios", state.currentOwnerUid, "clases", localClase.id);

      if (state.currentRole === "owner") clearSharedDocSession();
      else setSharedDocSession(state.currentRole, user, state.currentOwnerUid, localClase.id);

      return { clase: localClase, origin: "local" };
    }

    throw new Error("No se encontró el identificador de la clase.");
  }

  const claseRef = doc(db, "usuarios", state.currentOwnerUid, "clases", state.currentClaseId);

  try {
    const snap = await getDoc(claseRef);

    if (!snap.exists()) {
      if (!localClase) throw new Error("La clase no existe o no se pudo encontrar en Firestore.");

      state.currentClaseRef = claseRef;
      state.currentClaseData = localClase;
      state.currentRole = state.currentOwnerUid === user.uid ? "owner" : "viewer";

      if (state.currentRole === "owner") clearSharedDocSession();
      else setSharedDocSession(state.currentRole, user, state.currentOwnerUid, state.currentClaseId);

      return { clase: localClase, origin: "local" };
    }

    const claseData = {
      id: snap.id,
      ownerUid: state.currentOwnerUid,
      ...snap.data(),
    };

    const role = resolveUserRole(claseData, user, state.currentOwnerUid);
    if (!role) return { denied: true };

    state.currentClaseRef = claseRef;
    state.currentClaseData = claseData;
    state.currentRole = role;
    setSharedDocSession(role, user, state.currentOwnerUid, state.currentClaseId);

    return { clase: claseData, origin: "firestore" };
  } catch (error) {
    if (!localClase) throw error;

    state.currentClaseRef = claseRef;
    state.currentClaseData = localClase;
    state.currentRole = state.currentOwnerUid === user.uid ? "owner" : "viewer";

    if (state.currentRole === "owner") clearSharedDocSession();
    else setSharedDocSession(state.currentRole, user, state.currentOwnerUid, state.currentClaseId);

    return { clase: localClase, origin: "local" };
  }
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

    const tieneDocumentoReal =
      hasRealHtml(claseBase.contenidoHtml) ||
      hasRealHtml(claseBase.documentoHtml) ||
      hasRealHtml(claseBase.htmlDocumento) ||
      hasRealText(claseBase.documentoTexto) ||
      hasRealText(claseBase.textoDocumento) ||
      hasRealText(claseBase.contenidoTexto) ||
      hasRealStructuredDoc(claseBase.documento) ||
      hasRealStructuredDoc(claseBase.contenidoDocumento) ||
      hasRealStructuredDoc(claseBase.contenido);

    if (tieneDocumentoReal) {
      setLoadingStage("writing", "Cargando el documento guardado.");
    } else {
      setLoadingStage("sources", "Todavía no hay contenido final, así que vamos a generarlo.");
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

/* =========================
   PRESENTATION EXPORT
========================= */

const PRESENTATION_THEME_KEYWORDS = {
  sport: [
    "futbol", "fútbol", "gol", "equipo", "jugador", "cancha", "liga", "mundial",
    "deporte", "deportivo", "torneo", "partido", "club", "entrenamiento"
  ],
  history: [
    "historia", "revolucion", "revolución", "imperio", "guerra", "edad", "siglo",
    "monarquia", "monarquía", "antigua", "roma", "grecia", "francia", "independencia",
    "cronologia", "cronología"
  ],
  science: [
    "biologia", "biología", "quimica", "química", "fisica", "física", "célula",
    "celula", "energia", "energía", "ecosistema", "átomo", "atomo", "molécula",
    "molecula", "sistema solar", "planeta", "cientifico", "científico"
  ],
  literature: [
    "literatura", "poema", "poesía", "poesia", "novela", "cuento", "autor",
    "personaje", "narrador", "obra", "teatro", "metafora", "metáfora", "lenguaje",
    "análisis literario", "analisis literario"
  ],
  geography: [
    "geografia", "geografía", "mapa", "territorio", "continente", "paisaje", "relieve",
    "clima", "región", "region", "océano", "oceano", "población", "poblacion"
  ],
  business: [
    "economia", "economía", "empresa", "mercado", "finanzas", "negocio", "marketing",
    "costos", "demanda", "oferta", "administración", "administracion", "emprendimiento"
  ],
  tech: [
    "tecnologia", "tecnología", "programacion", "programación", "algoritmo", "software",
    "internet", "inteligencia artificial", "ia", "computadora", "redes", "sistema",
    "base de datos", "codigo", "código"
  ],
};

const PRESENTATION_THEMES = {
  neutral: {
    key: "neutral",
    label: "Académico moderno",
    bg: "F4F0E8",
    surface: "FFFDF8",
    surfaceAlt: "F7F1E7",
    accent: "7C6CF2",
    accentSoft: "E9E4FF",
    accent2: "FFE89C",
    text: "2B2434",
    muted: "6F6577",
    line: "D9D0E6",
    coverTag: "Presentación de estudio",
  },
  sport: {
    key: "sport",
    label: "Deportivo",
    bg: "0E1B18",
    surface: "122A24",
    surfaceAlt: "17352D",
    accent: "3DDC84",
    accentSoft: "CFF8E0",
    accent2: "D6FF75",
    text: "F7FFFB",
    muted: "CBE5DA",
    line: "255847",
    coverTag: "Ambiente deportivo",
  },
  history: {
    key: "history",
    label: "Histórico editorial",
    bg: "F4E9D9",
    surface: "FFF8F1",
    surfaceAlt: "F2E2CF",
    accent: "8B5E3C",
    accentSoft: "E9D7C1",
    accent2: "C7985E",
    text: "3B2A1E",
    muted: "6E5A49",
    line: "D8B996",
    coverTag: "Contexto histórico",
  },
  science: {
    key: "science",
    label: "Científico limpio",
    bg: "0C1726",
    surface: "11233A",
    surfaceAlt: "16324D",
    accent: "4CC9F0",
    accentSoft: "B9F0FF",
    accent2: "90F2D2",
    text: "F4FBFF",
    muted: "C6D9E7",
    line: "2A5875",
    coverTag: "Enfoque científico",
  },
  literature: {
    key: "literature",
    label: "Editorial literario",
    bg: "2A2135",
    surface: "3B3047",
    surfaceAlt: "4B3C58",
    accent: "E8A7FF",
    accentSoft: "F4D9FF",
    accent2: "FFC6D6",
    text: "FFF8FF",
    muted: "E5D8EE",
    line: "8E72A8",
    coverTag: "Lectura y análisis",
  },
  geography: {
    key: "geography",
    label: "Territorial",
    bg: "0E2430",
    surface: "173847",
    surfaceAlt: "1E4C5F",
    accent: "F4B860",
    accentSoft: "FFE2B4",
    accent2: "8CE6C8",
    text: "F8FCFD",
    muted: "D5E6EA",
    line: "487284",
    coverTag: "Mirada territorial",
  },
  business: {
    key: "business",
    label: "Profesional",
    bg: "101827",
    surface: "172033",
    surfaceAlt: "1E2A42",
    accent: "7DD3FC",
    accentSoft: "D8F4FF",
    accent2: "A7F3D0",
    text: "F7FBFF",
    muted: "D9E3F1",
    line: "334967",
    coverTag: "Análisis estratégico",
  },
  tech: {
    key: "tech",
    label: "Tecnológico",
    bg: "0A1020",
    surface: "111A30",
    surfaceAlt: "172544",
    accent: "8B5CF6",
    accentSoft: "E2D7FF",
    accent2: "5EEAD4",
    text: "F8F7FF",
    muted: "D8D6F4",
    line: "324362",
    coverTag: "Tecnología y sistemas",
  },
};

const PRESENTATION_STOPWORDS = new Set([
  "de","la","el","los","las","y","en","del","un","una","unos","unas","que","se","para",
  "con","por","como","sobre","desde","hasta","entre","sin","más","mas","muy","pero","esto",
  "esta","este","estos","estas","esa","ese","esas","esos","son","era","eran","ser","estar",
  "haber","tiene","tienen","puede","pueden","tema","documento","contenido","clase","materia",
  "nivel","duracion","duración","objetivo","parte","partes","principal","principales","tipo",
  "tipos","idea","ideas","concepto","conceptos","explica","explicación","explicacion","también",
  "tambien","porque","donde","cuando","cada","otra","otras","otro","otros","según","segun"
]);

function normalizePresentationText(value = "") {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePresentationComparable(value = "") {
  return normalizePresentationText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function chunkArray(items = [], size = 5) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function compactPresentationText(text = "", maxChars = 220) {
  const clean = normalizePresentationText(text);
  if (!clean) return "";
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars).trim().replace(/[,:;.\-–—]*$/, "")}…`;
}

function splitPresentationText(text = "", maxChars = 120) {
  const clean = normalizePresentationText(text);
  if (!clean) return [];

  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (!sentences.length) return [compactPresentationText(clean, maxChars)];

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

function splitPresentationParagraphs(text = "", maxChars = 340) {
  return splitPresentationText(text, maxChars).slice(0, 3);
}

function dedupePresentationText(items = []) {
  const seen = new Set();
  return items.filter((item) => {
    const normalized = normalizePresentationComparable(item);
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function createEmptyPresentationSection(title = "Contenido") {
  return {
    title: normalizePresentationText(title) || "Contenido",
    subtitles: [],
    paragraphs: [],
    bullets: [],
    quotes: [],
    rawText: "",
  };
}

function finalizePresentationSection(section) {
  const merged = dedupePresentationText([
    ...section.subtitles,
    ...section.paragraphs,
    ...section.bullets,
    ...section.quotes,
  ]);

  const rawText = merged.join(" ");
  return {
    title: normalizePresentationText(section.title) || "Contenido",
    subtitles: dedupePresentationText(section.subtitles),
    paragraphs: dedupePresentationText(section.paragraphs),
    bullets: dedupePresentationText(section.bullets),
    quotes: dedupePresentationText(section.quotes),
    rawText: normalizePresentationText(rawText),
  };
}

function extractPresentationSectionsFromDom() {
  if (!els.docContent) return [];

  const children = Array.from(els.docContent.children || []);
  const sections = [];
  let currentSection = createEmptyPresentationSection("Introducción");

  const pushSection = () => {
    const finalSection = finalizePresentationSection(currentSection);
    if (
      finalSection.title ||
      finalSection.paragraphs.length ||
      finalSection.bullets.length ||
      finalSection.quotes.length
    ) {
      if (finalSection.rawText) sections.push(finalSection);
    }
  };

  if (!children.length) {
    const fallbackText = normalizePresentationText(els.docContent.innerText || "");
    if (!fallbackText) return [];

    return [
      {
        title: "Contenido",
        subtitles: [],
        paragraphs: splitPresentationParagraphs(fallbackText, 300),
        bullets: [],
        quotes: [],
        rawText: fallbackText,
      },
    ];
  }

  for (const child of children) {
    const tag = (child.tagName || "").toLowerCase();

    if (tag === "h1" || tag === "h2") {
      pushSection();
      currentSection = createEmptyPresentationSection(child.textContent || "Sección");
      continue;
    }

    if (tag === "h3") {
      const subtitle = normalizePresentationText(child.textContent || "");
      if (subtitle) currentSection.subtitles.push(subtitle);
      continue;
    }

    if (tag === "p") {
      const text = normalizePresentationText(child.innerText || child.textContent || "");
      if (text) currentSection.paragraphs.push(text);
      continue;
    }

    if (tag === "blockquote") {
      const text = normalizePresentationText(child.innerText || child.textContent || "");
      if (text) currentSection.quotes.push(text);
      continue;
    }

    if (tag === "ul" || tag === "ol") {
      const items = Array.from(child.querySelectorAll(":scope > li"))
        .map((li) => normalizePresentationText(li.innerText || li.textContent || ""))
        .filter(Boolean);

      currentSection.bullets.push(...items);
      continue;
    }

    const fallback = normalizePresentationText(child.innerText || child.textContent || "");
    if (fallback) currentSection.paragraphs.push(fallback);
  }

  pushSection();

  return sections.filter((section) => section.rawText);
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

function pickPresentationKeywords(text = "", max = 6) {
  const tokens = normalizePresentationComparable(text)
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4 && !PRESENTATION_STOPWORDS.has(item));

  const score = new Map();

  for (const token of tokens) {
    score.set(token, (score.get(token) || 0) + 1);
  }

  return Array.from(score.entries())
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([token]) => token.charAt(0).toUpperCase() + token.slice(1));
}

function detectPresentationTheme(meta, sections = []) {
  const combinedText = normalizePresentationComparable(
    [
      meta.titulo,
      meta.objetivo,
      meta.materia,
      meta.nivel,
      sections.map((section) => `${section.title} ${section.rawText}`).join(" "),
    ].join(" ")
  );

  let bestKey = "neutral";
  let bestScore = 0;

  for (const [themeKey, keywords] of Object.entries(PRESENTATION_THEME_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (combinedText.includes(normalizePresentationComparable(keyword))) score += 1;
    }
    if (score > bestScore) {
      bestScore = score;
      bestKey = themeKey;
    }
  }

  return PRESENTATION_THEMES[bestKey] || PRESENTATION_THEMES.neutral;
}

function sectionContentPool(section) {
  return dedupePresentationText([
    ...section.subtitles,
    ...section.paragraphs,
    ...section.bullets,
    ...section.quotes,
  ]).filter(Boolean);
}

function getSectionLeadText(section) {
  const paragraph = section.paragraphs[0] || section.bullets[0] || section.rawText || "";
  return compactPresentationText(paragraph, 330);
}

function getSectionSupportText(section) {
  const supportPool = dedupePresentationText([
    section.paragraphs[1] || "",
    section.bullets[0] || "",
    section.bullets[1] || "",
    section.subtitles[0] || "",
  ]).filter(Boolean);

  return compactPresentationText(supportPool.join(" "), 210);
}

function getSectionSummaryParagraphs(section) {
  const paragraphBase = dedupePresentationText([
    ...section.paragraphs,
    ...section.bullets.map((item) => compactPresentationText(item, 180)),
  ]);

  if (!paragraphBase.length && section.rawText) {
    return splitPresentationParagraphs(section.rawText, 280).slice(0, 2);
  }

  const merged = paragraphBase
    .slice(0, 4)
    .join(" ");

  return splitPresentationParagraphs(merged, 280).slice(0, 2);
}

function buildPresentationCardItems(section) {
  const pool = sectionContentPool(section);
  return pool
    .slice(0, 4)
    .map((item, index) => ({
      title:
        section.subtitles[index] ||
        (index === 0 ? "Idea central" : `Punto ${index + 1}`),
      body: compactPresentationText(item, 130),
    }))
    .filter((card) => card.body);
}

function buildPresentationTimelineItems(section) {
  const pool = dedupePresentationText([
    ...section.bullets,
    ...section.paragraphs,
    ...splitPresentationText(section.rawText, 170),
  ]).slice(0, 4);

  return pool.map((item, index) => {
    const yearMatch = item.match(/\b(1[0-9]{3}|20[0-9]{2})\b/);
    const stepMatch = item.match(/\b(paso|etapa|fase)\s+\d+\b/i);

    return {
      label:
        yearMatch?.[0] ||
        stepMatch?.[0] ||
        `Etapa ${index + 1}`,
      body: compactPresentationText(item, 120),
    };
  });
}

function buildPresentationColumns(section) {
  const pool = sectionContentPool(section).slice(0, 6);

  if (!pool.length) {
    return {
      leftTitle: "Idea 1",
      leftText: compactPresentationText(section.rawText, 180),
      rightTitle: "Idea 2",
      rightText: compactPresentationText(section.rawText, 180),
    };
  }

  const midpoint = Math.ceil(pool.length / 2);
  const leftItems = pool.slice(0, midpoint);
  const rightItems = pool.slice(midpoint);

  return {
    leftTitle: section.subtitles[0] || "Bloque A",
    leftText: compactPresentationText(leftItems.join(" "), 220),
    rightTitle: section.subtitles[1] || "Bloque B",
    rightText: compactPresentationText(
      (rightItems.length ? rightItems : leftItems.slice(1)).join(" "),
      220
    ),
  };
}

function isPresentationTimelineSection(section) {
  const title = normalizePresentationComparable(section.title);
  const text = normalizePresentationComparable(section.rawText);

  const yearMatches = text.match(/\b(1[0-9]{3}|20[0-9]{2})\b/g) || [];

  return (
    /historia|evolucion|evolución|proceso|etapas|cronologia|cronología|linea de tiempo|línea de tiempo/.test(title) ||
    yearMatches.length >= 2
  );
}

function isPresentationComparisonSection(section) {
  const title = normalizePresentationComparable(section.title);
  const text = normalizePresentationComparable(section.rawText);

  return (
    /compar|diferenc|similitud|ventajas|desventajas|tipos|clasificacion|clasificación|vs\b|versus/.test(title) ||
    /por un lado|por otro lado|en cambio|mientras que/.test(text)
  );
}

function isPresentationQuoteSection(section) {
  return section.quotes.length > 0 || /cita|frase|reflexion|reflexión/.test(normalizePresentationComparable(section.title));
}

function isPresentationCardsSection(section) {
  return section.bullets.length >= 3 || (section.paragraphs.length >= 2 && section.rawText.length < 650);
}

function buildPresentationSlides(meta, sections = []) {
  const slides = [];

  const allText = sections.map((section) => section.rawText).join(" ");
  const keywords = pickPresentationKeywords(
    [meta.titulo, meta.objetivo, meta.materia, allText].join(" "),
    6
  );

  if (meta.objetivo || sections.length) {
    const firstSection = sections[0] || createEmptyPresentationSection("Introducción");
    slides.push({
      type: "intro",
      title: meta.titulo || "Introducción",
      text:
        compactPresentationText(meta.objetivo, 280) ||
        compactPresentationText(firstSection.rawText, 280) ||
        "Esta presentación organiza las ideas principales del documento en una secuencia visual clara.",
      sideTitle: meta.materia || "Contexto",
      sideText: compactPresentationText(
        [
          meta.nivel ? `Nivel: ${meta.nivel}.` : "",
          meta.duracion ? `Duración estimada: ${meta.duracion}.` : "",
          keywords.length ? `Palabras clave: ${keywords.slice(0, 3).join(", ")}.` : "",
        ].filter(Boolean).join(" "),
        180
      ),
    });
  }

  const MAX_DYNAMIC_SLIDES = 9;

  for (const section of sections) {
    if (slides.length >= MAX_DYNAMIC_SLIDES + 1) break;

    if (isPresentationQuoteSection(section)) {
      slides.push({
        type: "quote",
        title: section.title || "Idea destacada",
        quote: compactPresentationText(section.quotes[0] || getSectionLeadText(section), 220),
        text: compactPresentationText(
          [getSectionLeadText(section), getSectionSupportText(section)].filter(Boolean).join(" "),
          220
        ),
      });
      continue;
    }

    if (isPresentationTimelineSection(section)) {
      slides.push({
        type: "timeline",
        title: section.title || "Proceso",
        intro: compactPresentationText(getSectionLeadText(section), 170),
        items: buildPresentationTimelineItems(section).slice(0, 4),
      });
      continue;
    }

    if (isPresentationComparisonSection(section)) {
      const columns = buildPresentationColumns(section);
      slides.push({
        type: "columns",
        title: section.title || "Comparación",
        leftTitle: columns.leftTitle,
        leftText: columns.leftText,
        rightTitle: columns.rightTitle,
        rightText: columns.rightText,
      });
      continue;
    }

    if (isPresentationCardsSection(section)) {
      slides.push({
        type: "cards",
        title: section.title || "Puntos principales",
        intro: compactPresentationText(getSectionLeadText(section), 170),
        cards: buildPresentationCardItems(section).slice(0, 4),
      });
      continue;
    }

    const paragraphs = getSectionSummaryParagraphs(section);

    slides.push({
      type: "narrative",
      title: section.title || "Desarrollo",
      paragraphs: paragraphs.length ? paragraphs : [compactPresentationText(section.rawText, 280)],
      sideTitle: section.subtitles[0] || "Clave",
      sideText: getSectionSupportText(section) || compactPresentationText(section.rawText, 170),
    });
  }

  if (slides.length < MAX_DYNAMIC_SLIDES + 1) {
    slides.push({
      type: "closing",
      title: "Cierre",
      text: compactPresentationText(
        [
          meta.objetivo ? `En síntesis, el objetivo central fue ${meta.objetivo}.` : "",
          sections[sections.length - 1]?.rawText || allText,
        ].filter(Boolean).join(" "),
        300
      ),
      chips: keywords.slice(0, 5),
    });
  }

  return {
    keywords,
    slides: slides.slice(0, MAX_DYNAMIC_SLIDES + 2),
  };
}

function getPresentationShapeType(pptx, type, fallback = "rect") {
  return pptx?.ShapeType?.[type] || window.PptxGenJS?.ShapeType?.[type] || fallback;
}

function addPresentationBackground(slide, pptx, theme, variant = "default") {
  slide.background = { color: theme.bg };

  slide.addShape(getPresentationShapeType(pptx, "rect"), {
    x: 0,
    y: 0,
    w: 13.333,
    h: 7.5,
    line: { color: theme.bg, transparency: 100 },
    fill: { color: theme.bg },
  });

  slide.addShape(getPresentationShapeType(pptx, "ellipse"), {
    x: 9.7,
    y: -0.85,
    w: 4.2,
    h: 3.1,
    line: { color: theme.accent, transparency: 100 },
    fill: { color: theme.accentSoft, transparency: variant === "cover" ? 18 : 42 },
  });

  slide.addShape(getPresentationShapeType(pptx, "ellipse"), {
    x: -0.9,
    y: 5.75,
    w: 3.6,
    h: 2.5,
    line: { color: theme.accent2, transparency: 100 },
    fill: { color: theme.accent2, transparency: variant === "cover" ? 25 : 55 },
  });

  slide.addShape(getPresentationShapeType(pptx, "line"), {
    x: 0.7,
    y: 0.7,
    w: 11.9,
    h: 0,
    line: { color: theme.line, pt: 1.1 },
  });

  if (variant !== "cover") {
    slide.addShape(getPresentationShapeType(pptx, "roundRect"), {
      x: 0.65,
      y: 0.9,
      w: 12.0,
      h: 5.9,
      rectRadius: 0.06,
      line: { color: theme.line, pt: 1.1 },
      fill: { color: theme.surface, transparency: 0 },
    });
  }
}

function addPresentationFooter(slide, theme, slideNumber) {
  slide.addText(String(slideNumber), {
    x: 12.1,
    y: 7.03,
    w: 0.55,
    h: 0.2,
    fontFace: "Inter",
    fontSize: 8,
    color: theme.muted,
    bold: true,
    align: "right",
    margin: 0,
  });
}

function addPresentationCoverSlide(pptx, meta, theme, keywords = []) {
  const slide = pptx.addSlide();
  addPresentationBackground(slide, pptx, theme, "cover");

  slide.addShape(getPresentationShapeType(pptx, "roundRect"), {
    x: 0.8,
    y: 0.95,
    w: 2.45,
    h: 0.42,
    rectRadius: 0.08,
    line: { color: theme.accent, transparency: 100 },
    fill: { color: theme.accentSoft, transparency: 0 },
  });

  slide.addText(theme.coverTag || "Presentación", {
    x: 0.95,
    y: 1.03,
    w: 2.1,
    h: 0.18,
    fontFace: "Inter",
    fontSize: 10,
    bold: true,
    color: theme.accent,
    margin: 0,
  });

  slide.addText(meta.titulo || "Presentación", {
    x: 0.8,
    y: 1.65,
    w: 8.25,
    h: 1.45,
    fontFace: "Sora",
    fontSize: 24,
    bold: true,
    color: theme.text,
    margin: 0,
    breakLine: false,
    valign: "mid",
  });

  slide.addText(
    compactPresentationText(
      meta.objetivo ||
        `Una presentación visual y mejor estructurada sobre ${meta.titulo || "el tema analizado"}.`,
      220
    ),
    {
      x: 0.82,
      y: 3.05,
      w: 6.75,
      h: 0.9,
      fontFace: "Inter",
      fontSize: 14,
      color: theme.muted,
      margin: 0,
      valign: "mid",
    }
  );

  const chips = [
    meta.materia ? `Materia: ${meta.materia}` : "",
    meta.nivel ? `Nivel: ${meta.nivel}` : "",
    meta.duracion ? `Duración: ${meta.duracion}` : "",
  ].filter(Boolean);

  let chipY = 4.25;
  for (const chip of chips.slice(0, 3)) {
    slide.addShape(getPresentationShapeType(pptx, "roundRect"), {
      x: 0.82,
      y: chipY,
      w: 2.35,
      h: 0.42,
      rectRadius: 0.08,
      line: { color: theme.line, pt: 1 },
      fill: { color: theme.surfaceAlt },
    });

    slide.addText(chip, {
      x: 0.98,
      y: chipY + 0.1,
      w: 2.0,
      h: 0.16,
      fontFace: "Inter",
      fontSize: 9,
      bold: true,
      color: theme.text,
      margin: 0,
    });

    chipY += 0.55;
  }

  slide.addShape(getPresentationShapeType(pptx, "roundRect"), {
    x: 8.8,
    y: 1.7,
    w: 3.4,
    h: 3.55,
    rectRadius: 0.08,
    line: { color: theme.line, pt: 1.1 },
    fill: { color: theme.surfaceAlt },
  });

  slide.addText("Enfoque visual", {
    x: 9.08,
    y: 2.0,
    w: 2.2,
    h: 0.2,
    fontFace: "Inter",
    fontSize: 10,
    bold: true,
    color: theme.accent,
    margin: 0,
  });

  slide.addText(theme.label || "Estilo", {
    x: 9.08,
    y: 2.35,
    w: 2.4,
    h: 0.5,
    fontFace: "Sora",
    fontSize: 17,
    bold: true,
    color: theme.text,
    margin: 0,
  });

  slide.addText(
    compactPresentationText(
      keywords.length
        ? `Palabras guía: ${keywords.slice(0, 4).join(", ")}.`
        : "La composición se adapta al tema y al tipo de contenido del documento.",
      135
    ),
    {
      x: 9.08,
      y: 2.95,
      w: 2.45,
      h: 0.8,
      fontFace: "Inter",
      fontSize: 11,
      color: theme.muted,
      margin: 0,
    }
  );

  slide.addShape(getPresentationShapeType(pptx, "line"), {
    x: 9.08,
    y: 4.0,
    w: 2.45,
    h: 0,
    line: { color: theme.line, pt: 1 },
  });

  slide.addText("Eduvia", {
    x: 9.08,
    y: 4.23,
    w: 2.0,
    h: 0.22,
    fontFace: "Inter",
    fontSize: 10,
    bold: true,
    color: theme.text,
    margin: 0,
  });

  slide.addText("Documento convertido en una narrativa visual más rica.", {
    x: 9.08,
    y: 4.55,
    w: 2.55,
    h: 0.55,
    fontFace: "Inter",
    fontSize: 10,
    color: theme.muted,
    margin: 0,
  });

  addPresentationFooter(slide, theme, 1);
}

function addPresentationIntroSlide(pptx, theme, slideData, slideNumber) {
  const slide = pptx.addSlide();
  addPresentationBackground(slide, pptx, theme);

  slide.addText(slideData.title || "Introducción", {
    x: 1.0,
    y: 1.15,
    w: 6.7,
    h: 0.52,
    fontFace: "Sora",
    fontSize: 21,
    bold: true,
    color: theme.text,
    margin: 0,
  });

  slide.addText(compactPresentationText(slideData.text, 300), {
    x: 1.0,
    y: 1.95,
    w: 6.45,
    h: 2.4,
    fontFace: "Inter",
    fontSize: 14,
    color: theme.text,
    margin: 0,
    breakLine: false,
    valign: "top",
    paraSpaceAfterPt: 10,
  });

  slide.addShape(getPresentationShapeType(pptx, "roundRect"), {
    x: 8.15,
    y: 1.55,
    w: 3.6,
    h: 2.9,
    rectRadius: 0.06,
    line: { color: theme.line, pt: 1 },
    fill: { color: theme.surfaceAlt },
  });

  slide.addText(slideData.sideTitle || "Contexto", {
    x: 8.45,
    y: 1.9,
    w: 2.8,
    h: 0.26,
    fontFace: "Inter",
    fontSize: 10,
    bold: true,
    color: theme.accent,
    margin: 0,
  });

  slide.addText(compactPresentationText(slideData.sideText, 180), {
    x: 8.45,
    y: 2.3,
    w: 2.75,
    h: 1.55,
    fontFace: "Inter",
    fontSize: 11,
    color: theme.text,
    margin: 0,
  });

  addPresentationFooter(slide, theme, slideNumber);
}

function addPresentationNarrativeSlide(pptx, theme, slideData, slideNumber) {
  const slide = pptx.addSlide();
  addPresentationBackground(slide, pptx, theme);

  slide.addText(slideData.title || "Desarrollo", {
    x: 1.0,
    y: 1.12,
    w: 6.9,
    h: 0.52,
    fontFace: "Sora",
    fontSize: 21,
    bold: true,
    color: theme.text,
    margin: 0,
  });

  const text = (slideData.paragraphs || [])
    .map((paragraph) => compactPresentationText(paragraph, 240))
    .filter(Boolean)
    .join("\n\n");

  slide.addText(text || "No hay contenido suficiente para esta sección.", {
    x: 1.0,
    y: 1.9,
    w: 6.5,
    h: 3.5,
    fontFace: "Inter",
    fontSize: 13,
    color: theme.text,
    margin: 0,
    breakLine: false,
    valign: "top",
    paraSpaceAfterPt: 9,
  });

  slide.addShape(getPresentationShapeType(pptx, "roundRect"), {
    x: 8.05,
    y: 1.78,
    w: 3.75,
    h: 2.8,
    rectRadius: 0.06,
    line: { color: theme.line, pt: 1 },
    fill: { color: theme.surfaceAlt },
  });

  slide.addText(slideData.sideTitle || "Dato clave", {
    x: 8.32,
    y: 2.08,
    w: 2.75,
    h: 0.24,
    fontFace: "Inter",
    fontSize: 10,
    bold: true,
    color: theme.accent,
    margin: 0,
  });

  slide.addText(compactPresentationText(slideData.sideText, 180), {
    x: 8.32,
    y: 2.45,
    w: 2.95,
    h: 1.55,
    fontFace: "Inter",
    fontSize: 11,
    color: theme.text,
    margin: 0,
  });

  addPresentationFooter(slide, theme, slideNumber);
}

function addPresentationCardsSlide(pptx, theme, slideData, slideNumber) {
  const slide = pptx.addSlide();
  addPresentationBackground(slide, pptx, theme);

  slide.addText(slideData.title || "Puntos principales", {
    x: 1.0,
    y: 1.1,
    w: 7.0,
    h: 0.52,
    fontFace: "Sora",
    fontSize: 21,
    bold: true,
    color: theme.text,
    margin: 0,
  });

  slide.addText(compactPresentationText(slideData.intro, 160), {
    x: 1.0,
    y: 1.78,
    w: 7.3,
    h: 0.5,
    fontFace: "Inter",
    fontSize: 12,
    color: theme.muted,
    margin: 0,
  });

  const cards = (slideData.cards || []).slice(0, 4);
  const positions = [
    { x: 1.0, y: 2.45 },
    { x: 6.25, y: 2.45 },
    { x: 1.0, y: 4.6 },
    { x: 6.25, y: 4.6 },
  ];

  cards.forEach((card, index) => {
    const pos = positions[index];
    slide.addShape(getPresentationShapeType(pptx, "roundRect"), {
      x: pos.x,
      y: pos.y,
      w: 4.7,
      h: 1.6,
      rectRadius: 0.05,
      line: { color: theme.line, pt: 1 },
      fill: { color: index % 2 === 0 ? theme.surfaceAlt : theme.surface },
    });

    slide.addText(card.title || `Punto ${index + 1}`, {
      x: pos.x + 0.24,
      y: pos.y + 0.22,
      w: 3.4,
      h: 0.22,
      fontFace: "Inter",
      fontSize: 10,
      bold: true,
      color: theme.accent,
      margin: 0,
    });

    slide.addText(compactPresentationText(card.body, 110), {
      x: pos.x + 0.24,
      y: pos.y + 0.56,
      w: 4.05,
      h: 0.72,
      fontFace: "Inter",
      fontSize: 11,
      color: theme.text,
      margin: 0,
    });
  });

  addPresentationFooter(slide, theme, slideNumber);
}

function addPresentationColumnsSlide(pptx, theme, slideData, slideNumber) {
  const slide = pptx.addSlide();
  addPresentationBackground(slide, pptx, theme);

  slide.addText(slideData.title || "Comparación", {
    x: 1.0,
    y: 1.1,
    w: 7.0,
    h: 0.52,
    fontFace: "Sora",
    fontSize: 21,
    bold: true,
    color: theme.text,
    margin: 0,
  });

  [
    {
      x: 1.0,
      title: slideData.leftTitle || "Bloque A",
      text: compactPresentationText(slideData.leftText, 220),
    },
    {
      x: 6.5,
      title: slideData.rightTitle || "Bloque B",
      text: compactPresentationText(slideData.rightText, 220),
    },
  ].forEach((column) => {
    slide.addShape(getPresentationShapeType(pptx, "roundRect"), {
      x: column.x,
      y: 2.0,
      w: 4.8,
      h: 3.2,
      rectRadius: 0.05,
      line: { color: theme.line, pt: 1 },
      fill: { color: theme.surfaceAlt },
    });

    slide.addText(column.title, {
      x: column.x + 0.25,
      y: 2.3,
      w: 3.6,
      h: 0.24,
      fontFace: "Inter",
      fontSize: 11,
      bold: true,
      color: theme.accent,
      margin: 0,
    });

    slide.addText(column.text, {
      x: column.x + 0.25,
      y: 2.75,
      w: 4.0,
      h: 1.95,
      fontFace: "Inter",
      fontSize: 12,
      color: theme.text,
      margin: 0,
    });
  });

  addPresentationFooter(slide, theme, slideNumber);
}

function addPresentationQuoteSlide(pptx, theme, slideData, slideNumber) {
  const slide = pptx.addSlide();
  addPresentationBackground(slide, pptx, theme);

  slide.addText(slideData.title || "Idea destacada", {
    x: 1.0,
    y: 1.05,
    w: 7.0,
    h: 0.52,
    fontFace: "Sora",
    fontSize: 21,
    bold: true,
    color: theme.text,
    margin: 0,
  });

  slide.addShape(getPresentationShapeType(pptx, "roundRect"), {
    x: 1.0,
    y: 1.95,
    w: 10.8,
    h: 2.3,
    rectRadius: 0.05,
    line: { color: theme.line, pt: 1 },
    fill: { color: theme.surfaceAlt },
  });

  slide.addText(`“${compactPresentationText(slideData.quote, 170)}”`, {
    x: 1.35,
    y: 2.35,
    w: 10.0,
    h: 1.0,
    fontFace: "Sora",
    fontSize: 18,
    italic: true,
    color: theme.text,
    margin: 0,
    align: "center",
    valign: "mid",
  });

  slide.addText(compactPresentationText(slideData.text, 210), {
    x: 1.3,
    y: 4.8,
    w: 10.1,
    h: 0.8,
    fontFace: "Inter",
    fontSize: 12,
    color: theme.muted,
    margin: 0,
    align: "center",
  });

  addPresentationFooter(slide, theme, slideNumber);
}

function addPresentationTimelineSlide(pptx, theme, slideData, slideNumber) {
  const slide = pptx.addSlide();
  addPresentationBackground(slide, pptx, theme);

  slide.addText(slideData.title || "Proceso", {
    x: 1.0,
    y: 1.05,
    w: 7.0,
    h: 0.52,
    fontFace: "Sora",
    fontSize: 21,
    bold: true,
    color: theme.text,
    margin: 0,
  });

  slide.addText(compactPresentationText(slideData.intro, 160), {
    x: 1.0,
    y: 1.72,
    w: 7.2,
    h: 0.45,
    fontFace: "Inter",
    fontSize: 12,
    color: theme.muted,
    margin: 0,
  });

  slide.addShape(getPresentationShapeType(pptx, "line"), {
    x: 1.3,
    y: 3.5,
    w: 10.2,
    h: 0,
    line: { color: theme.accent, pt: 1.8 },
  });

  const items = (slideData.items || []).slice(0, 4);
  const startX = 1.15;
  const gap = 2.55;

  items.forEach((item, index) => {
    const x = startX + gap * index;

    slide.addShape(getPresentationShapeType(pptx, "ellipse"), {
      x,
      y: 3.18,
      w: 0.42,
      h: 0.42,
      line: { color: theme.accent, pt: 1 },
      fill: { color: theme.accent },
    });

    slide.addShape(getPresentationShapeType(pptx, "roundRect"), {
      x: x - 0.15,
      y: 4.0,
      w: 2.15,
      h: 1.55,
      rectRadius: 0.04,
      line: { color: theme.line, pt: 1 },
      fill: { color: theme.surfaceAlt },
    });

    slide.addText(item.label || `Etapa ${index + 1}`, {
      x: x - 0.02,
      y: 4.18,
      w: 1.75,
      h: 0.22,
      fontFace: "Inter",
      fontSize: 10,
      bold: true,
      color: theme.accent,
      margin: 0,
    });

    slide.addText(compactPresentationText(item.body, 72), {
      x: x - 0.02,
      y: 4.48,
      w: 1.76,
      h: 0.7,
      fontFace: "Inter",
      fontSize: 9.5,
      color: theme.text,
      margin: 0,
    });
  });

  addPresentationFooter(slide, theme, slideNumber);
}

function addPresentationClosingSlide(pptx, theme, slideData, slideNumber) {
  const slide = pptx.addSlide();
  addPresentationBackground(slide, pptx, theme);

  slide.addText(slideData.title || "Cierre", {
    x: 1.0,
    y: 1.1,
    w: 6.5,
    h: 0.52,
    fontFace: "Sora",
    fontSize: 21,
    bold: true,
    color: theme.text,
    margin: 0,
  });

  slide.addText(compactPresentationText(slideData.text, 300), {
    x: 1.0,
    y: 1.95,
    w: 7.0,
    h: 2.0,
    fontFace: "Inter",
    fontSize: 14,
    color: theme.text,
    margin: 0,
    paraSpaceAfterPt: 10,
  });

  slide.addShape(getPresentationShapeType(pptx, "roundRect"), {
    x: 8.0,
    y: 1.85,
    w: 3.85,
    h: 2.95,
    rectRadius: 0.06,
    line: { color: theme.line, pt: 1 },
    fill: { color: theme.surfaceAlt },
  });

  slide.addText("Conceptos para recordar", {
    x: 8.28,
    y: 2.16,
    w: 2.9,
    h: 0.22,
    fontFace: "Inter",
    fontSize: 10,
    bold: true,
    color: theme.accent,
    margin: 0,
  });

  const chips = (slideData.chips || []).slice(0, 5);
  let chipX = 8.28;
  let chipY = 2.58;

  chips.forEach((chip, index) => {
    const width = Math.min(1.65, Math.max(1.05, chip.length * 0.085));

    if (chipX + width > 11.35) {
      chipX = 8.28;
      chipY += 0.52;
    }

    slide.addShape(getPresentationShapeType(pptx, "roundRect"), {
      x: chipX,
      y: chipY,
      w: width,
      h: 0.34,
      rectRadius: 0.07,
      line: { color: theme.line, pt: 1 },
      fill: { color: theme.surface },
    });

    slide.addText(chip, {
      x: chipX + 0.1,
      y: chipY + 0.09,
      w: width - 0.18,
      h: 0.14,
      fontFace: "Inter",
      fontSize: 8.5,
      bold: true,
      color: theme.text,
      align: "center",
      margin: 0,
    });

    chipX += width + 0.12;
  });

  addPresentationFooter(slide, theme, slideNumber);
}

function addPresentationSourcesSlide(pptx, theme, sources = [], slideNumber = 1) {
  if (!sources.length) return;

  const slide = pptx.addSlide();
  addPresentationBackground(slide, pptx, theme);

  slide.addText("Fuentes consultadas", {
    x: 1.0,
    y: 1.12,
    w: 7.0,
    h: 0.52,
    fontFace: "Sora",
    fontSize: 21,
    bold: true,
    color: theme.text,
    margin: 0,
  });

  const rows = sources.slice(0, 8).map((source, index) => {
    const title = compactPresentationText(source.title || `Fuente ${index + 1}`, 85);
    const domain = compactPresentationText(
      (source.url || "").replace(/^https?:\/\//, "") || source.site || source.author || "",
      50
    );

    return `${index + 1}. ${title}${domain ? ` — ${domain}` : ""}`;
  });

  const columns = chunkArray(rows, 4);

  columns.forEach((colItems, colIndex) => {
    slide.addShape(getPresentationShapeType(pptx, "roundRect"), {
      x: colIndex === 0 ? 1.0 : 6.55,
      y: 2.0,
      w: 4.75,
      h: 3.65,
      rectRadius: 0.05,
      line: { color: theme.line, pt: 1 },
      fill: { color: theme.surfaceAlt },
    });

    slide.addText(colItems.join("\n\n"), {
      x: colIndex === 0 ? 1.28 : 6.83,
      y: 2.35,
      w: 4.1,
      h: 2.9,
      fontFace: "Inter",
      fontSize: 11,
      color: theme.text,
      margin: 0,
      paraSpaceAfterPt: 10,
    });
  });

  addPresentationFooter(slide, theme, slideNumber);
}

function renderPresentationSlides(pptx, meta, theme, presentationPlan, sources = []) {
  addPresentationCoverSlide(pptx, meta, theme, presentationPlan.keywords || []);

  let slideNumber = 2;

  for (const slideData of presentationPlan.slides || []) {
    if (slideData.type === "intro") {
      addPresentationIntroSlide(pptx, theme, slideData, slideNumber);
    } else if (slideData.type === "narrative") {
      addPresentationNarrativeSlide(pptx, theme, slideData, slideNumber);
    } else if (slideData.type === "cards") {
      addPresentationCardsSlide(pptx, theme, slideData, slideNumber);
    } else if (slideData.type === "columns") {
      addPresentationColumnsSlide(pptx, theme, slideData, slideNumber);
    } else if (slideData.type === "quote") {
      addPresentationQuoteSlide(pptx, theme, slideData, slideNumber);
    } else if (slideData.type === "timeline") {
      addPresentationTimelineSlide(pptx, theme, slideData, slideNumber);
    } else if (slideData.type === "closing") {
      addPresentationClosingSlide(pptx, theme, slideData, slideNumber);
    } else {
      addPresentationNarrativeSlide(pptx, theme, slideData, slideNumber);
    }
    slideNumber += 1;
  }

  if (sources.length) {
    addPresentationSourcesSlide(pptx, theme, sources, slideNumber);
  }
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
    targetLabel?.textContent ||
    els.exportPptBtn?.textContent ||
    "Pasar a presentación";

  try {
    window.closeMoreDropdown?.();
    setMoreStatus("Armando una presentación más visual...");
    setLastSaveLabel("Preparando presentación...");

    if (els.exportPptBtn) {
      els.exportPptBtn.disabled = true;
      if (targetLabel) targetLabel.textContent = "Generando presentación...";
      else els.exportPptBtn.textContent = "Generando presentación...";
    }

    const meta = getPresentationMeta();
    const sections = extractPresentationSectionsFromDom();
    const sources = getFuentesDocumento(state.currentClaseData || {});
    const theme = detectPresentationTheme(meta, sections);
    const presentationPlan = buildPresentationSlides(meta, sections);

    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "Eduvia";
    pptx.company = "Eduvia";
    pptx.subject = meta.titulo || "Documento convertido a presentación";
    pptx.title = meta.titulo || "Presentación";
    pptx.lang = "es-AR";
    pptx.theme = {
      headFontFace: "Sora",
      bodyFontFace: "Inter",
      lang: "es-AR",
    };

    renderPresentationSlides(pptx, meta, theme, presentationPlan, sources);

    await pptx.writeFile({ fileName: getPresentationFileName(meta.titulo) });

    setMoreStatus(`Presentación generada con estilo "${theme.label}".`);
    setLastSaveLabel("Guardado automático");
  } catch (error) {
    console.error("Error exportando a presentación:", error);
    alert("No se pudo generar la presentación.");
    setMoreStatus("No se pudo generar la presentación.");
    setLastSaveLabel("Guardado automático");
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

  panel.querySelector("[data-close-selection-panel]")?.addEventListener("click", hideSelectionResult);
  panel.querySelector("[data-copy-selection-result]")?.addEventListener("click", () => copyAssistantText(copyValue));
  panel.querySelector("[data-insert-selection-result]")?.addEventListener("click", () => insertResultBelowSelection(data.textoPropuesto));
  panel.querySelector("[data-replace-selection-result]")?.addEventListener("click", () => replaceSelectedTextWithResult(data.textoPropuesto));

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

      panel.querySelector("[data-close-selection-panel]")?.addEventListener("click", hideSelectionResult);
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

  document.addEventListener("selectionchange", () => setTimeout(trackSelectedTextForAssistant, 0));

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

/* =========================
   INIT
========================= */

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
