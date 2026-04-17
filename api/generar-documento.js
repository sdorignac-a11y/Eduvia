import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const RESEARCH_MODEL = process.env.OPENAI_RESEARCH_MODEL || "gpt-5.4-mini";
const DOCUMENT_MODEL = process.env.OPENAI_MODEL || "gpt-5.4";

const MAX_SOURCE_COUNT = 18;
const MAX_SOURCES_FOR_MODEL = 8;
const MAX_INVESTIGACION_CHARS = 3500;
const MAX_FUENTES_TEXTO_CHARS = 2200;
const MAX_CONTENIDO_BASE_CHARS = 5000;
const MAX_RETRY_DOCUMENTO = toPositiveInt(
  process.env.EDUVIA_MAX_RETRY_DOCUMENTO,
  3
);

const DOCUMENT_MAX_OUTPUT_TOKENS_INITIAL = toPositiveInt(
  process.env.OPENAI_DOCUMENT_MAX_OUTPUT_TOKENS,
  12000
);

const DOCUMENT_MAX_OUTPUT_TOKENS_CAP = toPositiveInt(
  process.env.OPENAI_DOCUMENT_MAX_OUTPUT_TOKENS_CAP,
  24000
);

const RESEARCH_MAX_OUTPUT_TOKENS = toPositiveInt(
  process.env.OPENAI_RESEARCH_MAX_OUTPUT_TOKENS,
  5000
);

const DOCUMENT_MIN_HTML_CHARS = 80;

const DOCUMENTO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tituloDocumento: { type: "string" },
    objetivoDocumento: { type: "string" },
    contenidoHtml: { type: "string" },
    resumenCorto: { type: "string" },
  },
  required: [
    "tituloDocumento",
    "objetivoDocumento",
    "contenidoHtml",
    "resumenCorto",
  ],
};

const RESEARCH_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    ideaCentral: { type: "string" },
    conceptosClave: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
    puntosImportantes: {
      type: "array",
      items: { type: "string" },
      maxItems: 8,
    },
    ejemplos: {
      type: "array",
      items: { type: "string" },
      maxItems: 5,
    },
    erroresComunes: {
      type: "array",
      items: { type: "string" },
      maxItems: 5,
    },
    paraLaPrueba: {
      type: "array",
      items: { type: "string" },
      maxItems: 6,
    },
    resumenInvestigacion: { type: "string" },
  },
  required: [
    "ideaCentral",
    "conceptosClave",
    "puntosImportantes",
    "ejemplos",
    "erroresComunes",
    "paraLaPrueba",
    "resumenInvestigacion",
  ],
};

class ResponseIncompleteError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ResponseIncompleteError";
    this.reason = details.reason || "";
    this.status = details.status || "";
    this.partialOutput = details.partialOutput || "";
  }
}

class StructuredOutputParseError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "StructuredOutputParseError";
    this.rawLength = details.rawLength || 0;
    this.head = details.head || "";
    this.tail = details.tail || "";
    this.parseMessage = details.parseMessage || "";
  }
}

function limpiarTexto(value = "") {
  return String(value || "").trim();
}

function limitarTexto(value = "", max = 1000) {
  return limpiarTexto(value).slice(0, max);
}

function sanitizeUrl(value = "") {
  try {
    const url = new URL(String(value || "").trim());
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.href;
    }
    return "";
  } catch {
    return "";
  }
}

function extraerDominio(url = "") {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function puntuarAutoridadFuente(url = "", title = "") {
  const domain = extraerDominio(url).toLowerCase();
  const titleLower = String(title || "").toLowerCase();

  if (!domain) return 35;

  const veryHighHosts = [
    "who.int",
    "un.org",
    "unesco.org",
    "oecd.org",
    "worldbank.org",
    "nih.gov",
    "ncbi.nlm.nih.gov",
    "pubmed.ncbi.nlm.nih.gov",
    "nature.com",
    "science.org",
    "britannica.com",
    "sciencedirect.com",
    "springer.com",
    "jstor.org",
  ];

  if (
    veryHighHosts.some(
      (host) => domain === host || domain.endsWith(`.${host}`)
    )
  ) {
    return 95;
  }

  if (
    domain.endsWith(".gov") ||
    domain.endsWith(".gob.ar") ||
    domain.endsWith(".edu") ||
    domain.endsWith(".edu.ar") ||
    domain.endsWith(".ac.uk")
  ) {
    return 92;
  }

  if (domain.endsWith(".org") || domain.endsWith(".int")) {
    return 82;
  }

  if (domain.includes("wikipedia.org")) {
    return 72;
  }

  if (
    domain.includes("medium.com") ||
    domain.includes("blogspot.com") ||
    titleLower.includes("blog")
  ) {
    return 48;
  }

  return 65;
}

function puntuarRecencia(publishedAt = "") {
  if (!publishedAt) return 8;

  const ts = new Date(publishedAt).getTime();
  if (!Number.isFinite(ts)) return 8;

  const days = Math.floor((Date.now() - ts) / 86400000);

  if (days <= 30) return 15;
  if (days <= 180) return 12;
  if (days <= 365) return 9;
  if (days <= 730) return 6;
  return 3;
}

function normalizarFuente(source = {}) {
  const title = limitarTexto(
    source.title ||
      source.titulo ||
      source.name ||
      source.display_name ||
      "Fuente",
    180
  );

  const url = sanitizeUrl(source.url || source.link || "");
  const snippet = limitarTexto(
    source.snippet || source.summary || source.description || "",
    220
  );
  const publishedAt = limpiarTexto(
    source.published_at || source.publishedAt || source.date || ""
  );
  const domain = extraerDominio(url);

  const authorityScore =
    Number.isFinite(source.authorityScore) && source.authorityScore >= 0
      ? Math.min(100, Math.floor(source.authorityScore))
      : puntuarAutoridadFuente(url, title);

  const freshnessScore =
    Number.isFinite(source.freshnessScore) && source.freshnessScore >= 0
      ? Math.min(20, Math.floor(source.freshnessScore))
      : puntuarRecencia(publishedAt);

  const detailScore =
    Number.isFinite(source.detailScore) && source.detailScore >= 0
      ? Math.min(10, Math.floor(source.detailScore))
      : snippet
        ? 8
        : 4;

  const trustScore =
    Number.isFinite(source.trustScore) && source.trustScore >= 0
      ? Math.min(100, Math.floor(source.trustScore))
      : Math.min(100, authorityScore + freshnessScore + detailScore);

  return {
    title,
    url,
    domain,
    snippet,
    publishedAt,
    authorityScore,
    freshnessScore,
    detailScore,
    trustScore,
  };
}

function rankearFuentes(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();

  return value
    .map((item) => normalizarFuente(item))
    .filter((item) => item.title || item.url)
    .filter((item) => {
      const key = `${item.title}|${item.url}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => {
      if (b.trustScore !== a.trustScore) return b.trustScore - a.trustScore;
      if ((b.authorityScore || 0) !== (a.authorityScore || 0)) {
        return (b.authorityScore || 0) - (a.authorityScore || 0);
      }
      return (a.title || "").localeCompare(b.title || "");
    })
    .slice(0, MAX_SOURCE_COUNT);
}

function limpiarListaStrings(value, maxItems = 8, maxItemChars = 220) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();

  return value
    .map((item) => limitarTexto(item, maxItemChars))
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, maxItems);
}

function limpiarFuentes(value) {
  return rankearFuentes(value);
}

function limpiarLinksUsuario(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();

  return value
    .map((item) => sanitizeUrl(item))
    .filter(Boolean)
    .filter((url) => {
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    })
    .slice(0, MAX_SOURCE_COUNT);
}

function construirFuentesDesdeLinks(links = []) {
  return rankearFuentes(
    links.map((url) => ({
      title: extraerDominio(url) || "Fuente",
      url,
    }))
  );
}

function construirLinksUsuarioTexto(links = []) {
  const texto = links
    .slice(0, MAX_SOURCE_COUNT)
    .map((url, i) => {
      const dominio = extraerDominio(url);
      return `${i + 1}. ${dominio || "Fuente"} - ${url}`;
    })
    .join("\n");

  return texto.slice(0, MAX_FUENTES_TEXTO_CHARS) || "No disponibles";
}

function extractWebSources(response) {
  const encontrados = new Map();

  function pushSource(source) {
    if (!source || typeof source !== "object") return;

    const normalized = normalizarFuente(source);
    if (!normalized.title && !normalized.url) return;

    const key = normalized.url || normalized.title;
    if (!encontrados.has(key)) {
      encontrados.set(key, normalized);
    }
  }

  function walk(node) {
    if (!node) return;

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    if (typeof node !== "object") return;

    if (Array.isArray(node.sources)) {
      for (const source of node.sources) pushSource(source);
    }

    if (node.action && Array.isArray(node.action.sources)) {
      for (const source of node.action.sources) pushSource(source);
    }

    for (const value of Object.values(node)) {
      walk(value);
    }
  }

  walk(response);
  return rankearFuentes(Array.from(encontrados.values()));
}

function limpiarContenidoBase(value = "") {
  return limitarTexto(value, MAX_CONTENIDO_BASE_CHARS);
}

function combinarContextoBase({ investigacion = "", contenidoBase = "" }) {
  const partes = [];

  const investigacionLimpia = limitarTexto(
    investigacion,
    MAX_INVESTIGACION_CHARS
  );
  const contenidoBaseLimpio = limpiarContenidoBase(contenidoBase);

  if (investigacionLimpia) {
    partes.push(`Base de investigación:\n${investigacionLimpia}`);
  }

  if (contenidoBaseLimpio) {
    partes.push(
      `Contenido base ya analizado o redactado previamente:\n${contenidoBaseLimpio}`
    );
  }

  return partes.join("\n\n").trim();
}

function construirExtensionDeseada({
  palabrasMin = "",
  palabrasMax = "",
  duracion = "",
}) {
  const min = limpiarTexto(palabrasMin);
  const max = limpiarTexto(palabrasMax);
  const rangoDesdeDuracion = limpiarTexto(duracion);

  if (min && max) return `Entre ${min} y ${max} palabras`;
  if (min) return `Mínimo ${min} palabras`;
  if (max) return `Máximo ${max} palabras`;

  if (rangoDesdeDuracion) {
    if (/palabra/i.test(rangoDesdeDuracion)) return rangoDesdeDuracion;
    return rangoDesdeDuracion;
  }

  return "No especificada";
}

function buildResearchPrompt({
  materia,
  tema,
  nivel,
  extensionDeseada,
  objetivo,
  contenidoBase,
  sourceMode = "general",
  sourceLinksTexto = "",
}) {
  const bloqueLinks =
    sourceMode === "exclusive" && sourceLinksTexto
      ? `Links obligatorios del usuario:\n${sourceLinksTexto}\n`
      : "";

  const reglasExtras =
    sourceMode === "exclusive" && sourceLinksTexto
      ? `
- Usá únicamente los links proporcionados por el usuario como base externa.
- No uses otras fuentes, aunque encuentres resultados relacionados.
- Si los links no alcanzan, decilo claramente.
`
      : `
- En modo general, analizá idealmente entre 12 y 20 fuentes distintas.
- Priorizá organismos oficiales, universidades, material académico y enciclopedias reconocidas.
- Compará varias fuentes y basate sobre todo en lo que coincida entre las más confiables.
- Si dos fuentes se contradicen, priorizá la más confiable y reciente.
`;

  return `
Investigá este tema para preparar un documento de estudio completo y serio.

Datos:
- Materia: ${materia}
- Tema: ${tema}
- Nivel: ${nivel}
- Extensión deseada: ${extensionDeseada || "No especificada"}
- Objetivo: ${objetivo || "No especificado"}

${contenidoBase ? `Contenido base ya disponible:\n${contenidoBase}\n` : ""}
${bloqueLinks}

Instrucciones:
- Buscá información confiable y útil para estudiar.
- Priorizá contenido educativo, académico o enciclopédico.
- Evitá foros, páginas pobres o contenido repetido.
- No redactes todavía el documento final.
- Respondé en español.
- Organizá la investigación de forma clara y compacta.
- Explicá el contenido como base de estudio para un alumno.
- Si ya hay contenido base, usalo para orientar la investigación y completarlo.
- Incluí datos concretos solo cuando aporten valor real.
- Ajustá la cantidad de desarrollo según la extensión deseada.
${reglasExtras}

Necesito:
1. idea central del tema
2. conceptos clave
3. puntos importantes que el alumno tiene que entender
4. ejemplos concretos si aplican
5. errores comunes o confusiones frecuentes
6. qué es lo más importante para estudiar para una prueba
7. un resumen final breve y útil
  `.trim();
}

function buildFuentesOnlyPrompt({ materia, tema, nivel, contenidoBase }) {
  return `
Buscá fuentes confiables para estudiar este tema.

Datos:
- Materia: ${materia}
- Tema: ${tema}
- Nivel: ${nivel}

${contenidoBase ? `Contenido base para orientar la búsqueda:\n${contenidoBase}\n` : ""}

Instrucciones:
- Priorizá contenido educativo, académico o enciclopédico.
- Evitá foros, resultados duplicados o páginas débiles.
- Intentá reunir una base amplia y variada de fuentes.
- Priorizá universidades, organismos oficiales, enciclopedias serias y material académico.
- Respondé en español con una síntesis muy breve del tema.
- Lo importante es encontrar buenas fuentes.
  `.trim();
}

function buildDocumentoPrompt({
  materia,
  tema,
  nivel,
  extensionDeseada,
  objetivo,
  investigacionFinal,
  contenidoBase,
  fuentesTexto,
  sourceMode = "general",
  sourceLinksTexto = "",
}) {
  const bloqueLinks =
    sourceMode === "exclusive" && sourceLinksTexto
      ? `Links obligatorios del usuario:\n${sourceLinksTexto}\n`
      : "";

  const reglasExtras =
    sourceMode === "exclusive" && sourceLinksTexto
      ? `
- Usá únicamente la información respaldada por los links proporcionados por el usuario.
- No agregues conocimiento general ni otras fuentes externas.
- Si algo no está en esos links o en el contenido base, decilo claramente.
`
      : `
- Las fuentes listadas ya están ordenadas de mayor a menor confiabilidad.
- Priorizá las primeras fuentes para sostener la explicación.
- Cuando varias fuentes fuertes coincidan, dale más peso a esa idea.
- Evitá apoyarte demasiado en una sola fuente débil o secundaria.
`;

  return `
Creá un documento de estudio en español.

Datos:
- Materia: ${materia}
- Tema: ${tema}
- Nivel: ${nivel}
- Extensión deseada: ${extensionDeseada || "No especificada"}
- Objetivo: ${objetivo || "No especificado"}

Base de investigación:
${investigacionFinal || "No disponible"}

Contenido base previo:
${contenidoBase || "No disponible"}

Fuentes consultadas:
${fuentesTexto}

${bloqueLinks}

Requisitos:
- Hacé una introducción breve y clara.
- Desarrollá el tema por secciones bien organizadas.
- Explicá de forma útil para estudiar.
- Si hay contenido base previo útil, integralo y mejoralo.
- Incluí ejemplos o aplicaciones si corresponde.
- Cerrá con un repaso final.
- Adaptá la profundidad al nivel indicado.
- Respetá la extensión deseada.
- No pongas relleno.
- No repitas demasiado las mismas ideas.
- No agregues las fuentes dentro del HTML.
- El documento debe sentirse completo, no como un borrador.
- El contenidoHtml debe traer suficiente desarrollo real.
${reglasExtras}

Devolvé SOLO JSON válido con:
tituloDocumento, objetivoDocumento, contenidoHtml, resumenCorto
  `.trim();
}

function sanitizeContenidoHtml(html = "") {
  let output = String(html || "");

  if (!output.trim()) return "";

  output = output.replace(/<!--[\s\S]*?-->/g, "");
  output = output.replace(
    /<(script|style|iframe|object|embed|meta|link)[^>]*>[\s\S]*?<\/\1>/gi,
    ""
  );
  output = output.replace(
    /<(script|style|iframe|object|embed|meta|link)[^>]*\/?>/gi,
    ""
  );

  output = output.replace(/<\s*b\s*>/gi, "<strong>");
  output = output.replace(/<\s*\/\s*b\s*>/gi, "</strong>");
  output = output.replace(/<\s*i\s*>/gi, "<em>");
  output = output.replace(/<\s*\/\s*i\s*>/gi, "</em>");

  const allowedTags = new Set([
    "h1",
    "h2",
    "h3",
    "p",
    "ul",
    "ol",
    "li",
    "blockquote",
    "strong",
    "em",
  ]);

  output = output.replace(
    /<\s*(\/?)\s*([a-z0-9-]+)([^>]*)>/gi,
    (_, closing, tagName) => {
      const tag = String(tagName || "").toLowerCase();
      if (!allowedTags.has(tag)) return "";
      return closing ? `</${tag}>` : `<${tag}>`;
    }
  );

  output = output.replace(/\n{3,}/g, "\n\n");
  return output.trim();
}

function validarDocumento(documento) {
  if (!documento || typeof documento !== "object" || Array.isArray(documento)) {
    throw new Error("El documento generado no tiene formato de objeto.");
  }

  const tituloDocumento = limitarTexto(documento.tituloDocumento, 220);
  const objetivoDocumento = limitarTexto(documento.objetivoDocumento, 400);
  const resumenCorto = limitarTexto(documento.resumenCorto, 600);
  const contenidoHtml = sanitizeContenidoHtml(documento.contenidoHtml);

  if (!tituloDocumento) {
    throw new Error("Falta tituloDocumento.");
  }

  if (!objetivoDocumento) {
    throw new Error("Falta objetivoDocumento.");
  }

  if (!resumenCorto) {
    throw new Error("Falta resumenCorto.");
  }

  if (!contenidoHtml || contenidoHtml.length < DOCUMENT_MIN_HTML_CHARS) {
    throw new Error("contenidoHtml llegó vacío o demasiado corto.");
  }

  return {
    tituloDocumento,
    objetivoDocumento,
    contenidoHtml,
    resumenCorto,
  };
}

function validarResearch(research) {
  if (!research || typeof research !== "object" || Array.isArray(research)) {
    throw new Error("La investigación no tiene formato válido.");
  }

  return {
    ideaCentral: limitarTexto(research.ideaCentral, 350),
    conceptosClave: limpiarListaStrings(research.conceptosClave, 8, 180),
    puntosImportantes: limpiarListaStrings(research.puntosImportantes, 8, 220),
    ejemplos: limpiarListaStrings(research.ejemplos, 5, 220),
    erroresComunes: limpiarListaStrings(research.erroresComunes, 5, 220),
    paraLaPrueba: limpiarListaStrings(research.paraLaPrueba, 6, 220),
    resumenInvestigacion: limitarTexto(research.resumenInvestigacion, 1400),
  };
}

function getResponseOutputText(response) {
  const helperText = limpiarTexto(response?.output_text || "");
  if (helperText) return helperText;

  const parts = [];

  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (item?.type !== "message") continue;

    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === "output_text" && content?.text) {
        parts.push(String(content.text));
      }
    }
  }

  return limpiarTexto(parts.join("\n"));
}

function getResponseRefusal(response) {
  for (const item of Array.isArray(response?.output) ? response.output : []) {
    if (item?.type !== "message") continue;

    for (const content of Array.isArray(item?.content) ? item.content : []) {
      if (content?.type === "refusal" && content?.refusal) {
        return limpiarTexto(content.refusal);
      }
    }
  }

  return "";
}

function buildRawPreview(raw = "") {
  const text = String(raw || "");
  return {
    rawLength: text.length,
    head: text.slice(0, 700),
    tail: text.slice(-700),
  };
}

function assertResponseOkBeforeParse(response, label = "respuesta") {
  if (!response || typeof response !== "object") {
    throw new Error(`${label}: OpenAI devolvió una respuesta vacía.`);
  }

  if (response.error?.message) {
    throw new Error(`${label}: OpenAI devolvió error: ${response.error.message}`);
  }

  const refusal = getResponseRefusal(response);
  if (refusal) {
    throw new Error(`${label}: el modelo rechazó la solicitud. ${refusal}`);
  }

  if (
    response.status === "incomplete" ||
    (response.incomplete_details &&
      typeof response.incomplete_details === "object")
  ) {
    const reason = limpiarTexto(response?.incomplete_details?.reason || "unknown");
    const partialOutput = getResponseOutputText(response);

    console.error(`${label}: respuesta incompleta`, {
      status: response?.status || null,
      incomplete_details: response?.incomplete_details || null,
      outputTextLen: partialOutput.length,
      preview: partialOutput.slice(0, 300),
    });

    throw new ResponseIncompleteError(
      `${label}: la respuesta quedó incompleta (${reason}).`,
      {
        reason,
        status: response?.status || "",
        partialOutput,
      }
    );
  }
}

function parseStructuredJson(raw = "", label = "respuesta") {
  const texto = limpiarTexto(String(raw || "").replace(/^\uFEFF/, ""));
  if (!texto) {
    throw new StructuredOutputParseError(`${label}: la respuesta vino vacía.`, {
      rawLength: 0,
    });
  }

  const textoSinFences = texto
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(textoSinFences);
  } catch (error) {
    const preview = buildRawPreview(textoSinFences);

    console.error(`${label}: JSON.parse falló`, {
      message: error?.message || "Sin mensaje",
      rawLength: preview.rawLength,
      head: preview.head,
      tail: preview.tail,
    });

    throw new StructuredOutputParseError(
      `${label}: el JSON no pudo parsearse (${error?.message || "error desconocido"}).`,
      {
        rawLength: preview.rawLength,
        head: preview.head,
        tail: preview.tail,
        parseMessage: error?.message || "",
      }
    );
  }
}

function parseDocumentoDesdeResponse(response) {
  assertResponseOkBeforeParse(response, "Documento");

  const raw = getResponseOutputText(response);
  if (!raw) {
    console.error("Documento sin output_text utilizable:", response);
    throw new Error("Documento: OpenAI no devolvió output_text.");
  }

  const parsed = parseStructuredJson(raw, "Documento");
  return validarDocumento(parsed);
}

function parseResearchDesdeResponse(response) {
  assertResponseOkBeforeParse(response, "Investigación");

  const raw = getResponseOutputText(response);
  if (!raw) {
    console.error("Investigación sin output_text utilizable:", response);
    throw new Error("Investigación: OpenAI no devolvió output_text.");
  }

  const parsed = parseStructuredJson(raw, "Investigación");
  return validarResearch(parsed);
}

function construirInvestigacionCompacta(data) {
  if (!data || typeof data !== "object") return "";

  const bloques = [
    data.ideaCentral ? `Idea central: ${data.ideaCentral}` : "",
    data.conceptosClave?.length
      ? `Conceptos clave: ${data.conceptosClave.join("; ")}`
      : "",
    data.puntosImportantes?.length
      ? `Puntos importantes: ${data.puntosImportantes.join("; ")}`
      : "",
    data.ejemplos?.length ? `Ejemplos: ${data.ejemplos.join("; ")}` : "",
    data.erroresComunes?.length
      ? `Errores comunes: ${data.erroresComunes.join("; ")}`
      : "",
    data.paraLaPrueba?.length
      ? `Para la prueba: ${data.paraLaPrueba.join("; ")}`
      : "",
    data.resumenInvestigacion ? `Resumen: ${data.resumenInvestigacion}` : "",
  ];

  return limitarTexto(
    bloques.filter(Boolean).join("\n"),
    MAX_INVESTIGACION_CHARS
  );
}

function construirFuentesTextoParaModelo(fuentes) {
  const texto = (Array.isArray(fuentes) ? fuentes : [])
    .slice(0, MAX_SOURCES_FOR_MODEL)
    .map((f, i) => {
      const title = limitarTexto(f?.title || "Fuente", 120);
      const dominio = extraerDominio(f?.url || "");
      const score =
        Number.isFinite(f?.trustScore) ? ` | score ${f.trustScore}` : "";
      return `${i + 1}. ${title}${dominio ? ` (${dominio})` : ""}${score}`;
    })
    .join("\n");

  return texto.slice(0, MAX_FUENTES_TEXTO_CHARS) || "No disponibles";
}

function buildUsageLog(usage) {
  if (!usage || typeof usage !== "object") return null;

  return {
    input_tokens: usage.input_tokens ?? null,
    output_tokens: usage.output_tokens ?? null,
    total_tokens: usage.total_tokens ?? null,
    reasoning_tokens: usage.output_tokens_details?.reasoning_tokens ?? null,
  };
}

async function investigarTemaConWeb({
  materia,
  tema,
  nivel,
  extensionDeseada,
  objetivo,
  contenidoBase,
  sourceMode = "general",
  sourceLinksTexto = "",
}) {
  try {
    const researchResponse = await client.responses.create({
      model: RESEARCH_MODEL,
      reasoning: { effort: "low" },
      tools: [{ type: "web_search" }],
      tool_choice: "auto",
      include: ["web_search_call.action.sources"],
      truncation: "auto",
      instructions: `
Sos el investigador de Eduvia.
Investigás con web y organizás la información.
No redactes todavía el documento final.
Respondé en español.
Devolvé SOLO JSON válido.
      `.trim(),
      input: buildResearchPrompt({
        materia,
        tema,
        nivel,
        extensionDeseada,
        objetivo,
        contenidoBase,
        sourceMode,
        sourceLinksTexto,
      }),
      text: {
        format: {
          type: "json_schema",
          name: "research_eduvia",
          strict: true,
          schema: RESEARCH_SCHEMA,
        },
      },
      max_output_tokens: RESEARCH_MAX_OUTPUT_TOKENS,
    });

    const researchOutputText = getResponseOutputText(researchResponse);

    console.log("investigarTemaConWeb ok:", {
      model: RESEARCH_MODEL,
      status: researchResponse?.status || null,
      incomplete_details: researchResponse?.incomplete_details || null,
      hasOutputText: Boolean(researchOutputText),
      outputTextLen: researchOutputText.length,
      usage: buildUsageLog(researchResponse?.usage),
    });

    const research = parseResearchDesdeResponse(researchResponse);
    const investigacionCompacta = construirInvestigacionCompacta(research);
    const fuentes = extractWebSources(researchResponse);

    console.log("investigarTemaConWeb parsed:", {
      investigacionLen: investigacionCompacta.length,
      fuentesCount: fuentes.length,
    });

    return {
      investigacionCompacta,
      fuentes,
    };
  } catch (error) {
    console.error("Error en investigarTemaConWeb:", error?.message || error);
    console.error("Stack investigarTemaConWeb:", error?.stack || "sin stack");
    throw error;
  }
}

async function buscarFuentesConWeb({
  materia,
  tema,
  nivel,
  contenidoBase,
}) {
  const response = await client.responses.create({
    model: RESEARCH_MODEL,
    reasoning: { effort: "low" },
    tools: [{ type: "web_search" }],
    tool_choice: "auto",
    include: ["web_search_call.action.sources"],
    truncation: "auto",
    instructions: `
Sos el investigador de Eduvia.
Tu objetivo principal es encontrar buenas fuentes web.
Priorizá amplitud, calidad y diversidad.
Respondé en español, breve.
    `.trim(),
    input: buildFuentesOnlyPrompt({
      materia,
      tema,
      nivel,
      contenidoBase,
    }),
    max_output_tokens: 2500,
  });

  assertResponseOkBeforeParse(response, "Fuentes web");
  return extractWebSources(response);
}

async function generarDocumentoConIA({
  materia,
  tema,
  nivel,
  extensionDeseada,
  objetivo,
  investigacionFinal,
  contenidoBase,
  fuentesTexto,
  sourceMode = "general",
  sourceLinksTexto = "",
  intento = 1,
  maxOutputTokens = DOCUMENT_MAX_OUTPUT_TOKENS_INITIAL,
}) {
  const refuerzo =
    intento > 1
      ? `
Ajuste adicional para este intento:
- El intento anterior falló o quedó corto/incompleto.
- Priorizá claridad y completitud.
- Desarrollá el tema en secciones con párrafos reales.
- Evitá adornos innecesarios.
      `.trim()
      : "";

  try {
    const documentoResponse = await client.responses.create({
      model: DOCUMENT_MODEL,
      reasoning: { effort: "low" },
      truncation: "auto",
      instructions: `
Sos un profesor excelente de Eduvia.
Tu tarea es convertir una base de investigación en un documento de estudio claro, serio y útil.

Reglas:
- Escribí en español claro.
- Adaptá la profundidad al alumno.
- No inventes contenido fuera del contexto.
- El resultado debe sentirse como un apunte limpio y bien redactado.
- Devolvé SOLO JSON válido.
- El campo contenidoHtml debe contener HTML seguro y limpio.
- Usá únicamente estas etiquetas: h1, h2, h3, p, ul, ol, li, blockquote, strong, em.
- No uses style, script, iframe ni atributos inline.
- No agregues las fuentes dentro de contenidoHtml.
${refuerzo ? `- ${refuerzo.replace(/\n/g, "\n- ")}` : ""}
      `.trim(),
      input: buildDocumentoPrompt({
        materia,
        tema,
        nivel,
        extensionDeseada,
        objetivo,
        investigacionFinal,
        contenidoBase,
        fuentesTexto,
        sourceMode,
        sourceLinksTexto,
      }),
      text: {
        format: {
          type: "json_schema",
          name: "documento_eduvia",
          strict: true,
          schema: DOCUMENTO_SCHEMA,
        },
      },
      max_output_tokens: maxOutputTokens,
    });

    const outputText = getResponseOutputText(documentoResponse);

    console.log("generarDocumentoConIA ok:", {
      model: DOCUMENT_MODEL,
      intento,
      maxOutputTokens,
      status: documentoResponse?.status || null,
      incomplete_details: documentoResponse?.incomplete_details || null,
      hasOutputText: Boolean(outputText),
      outputTextLen: outputText.length,
      preview: outputText.slice(0, 300),
      usage: buildUsageLog(documentoResponse?.usage),
    });

    return parseDocumentoDesdeResponse(documentoResponse);
  } catch (error) {
    console.error(
      `Error en generarDocumentoConIA (intento ${intento}):`,
      error?.message || error
    );
    console.error(
      `Stack generarDocumentoConIA (intento ${intento}):`,
      error?.stack || "sin stack"
    );
    throw error;
  }
}

function normalizarErrorPublico(error) {
  if (error instanceof ResponseIncompleteError) {
    if (error.reason === "max_output_tokens") {
      return "La respuesta del modelo quedó incompleta por límite de tokens.";
    }

    return `La respuesta del modelo quedó incompleta (${error.reason || "sin detalle"}).`;
  }

  if (error instanceof StructuredOutputParseError) {
    return error.message;
  }

  return limpiarTexto(error?.message || "Error desconocido");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Método no permitido.",
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({
      ok: false,
      error: "Falta configurar OPENAI_API_KEY en el servidor.",
    });
  }

  try {
    console.time("generar_documento_total");

    const {
      materia = "",
      tema = "",
      nivel = "",
      duracion = "",
      palabrasMin = "",
      palabrasMax = "",
      objetivo = "",
      investigacion = "",
      fuentes = [],
      contenidoBase = "",
      sourceMode = "general",
      sourceLinks = [],
    } = req.body || {};

    const materiaLimpia = limitarTexto(materia, 180);
    const temaLimpio = limitarTexto(tema, 220);
    const nivelLimpio = limitarTexto(nivel, 120);
    const duracionLimpia = limitarTexto(duracion, 120);
    const palabrasMinLimpias = limitarTexto(palabrasMin, 20);
    const palabrasMaxLimpias = limitarTexto(palabrasMax, 20);
    const objetivoLimpio = limitarTexto(objetivo, 400);
    const contenidoBaseLimpio = limpiarContenidoBase(contenidoBase);

    const extensionDeseada = construirExtensionDeseada({
      palabrasMin: palabrasMinLimpias,
      palabrasMax: palabrasMaxLimpias,
      duracion: duracionLimpia,
    });

    if (!materiaLimpia || !temaLimpio || !nivelLimpio) {
      return res.status(400).json({
        ok: false,
        error: "Faltan materia, tema o nivel.",
      });
    }

    const sourceLinksLimpios = limpiarLinksUsuario(sourceLinks);
    const sourceModeFinal =
      sourceMode === "exclusive" && sourceLinksLimpios.length
        ? "exclusive"
        : "general";

    const sourceLinksTexto = construirLinksUsuarioTexto(sourceLinksLimpios);

    let investigacionFinal = limitarTexto(
      investigacion,
      MAX_INVESTIGACION_CHARS
    );

    let fuentesFinales =
      sourceModeFinal === "exclusive"
        ? construirFuentesDesdeLinks(sourceLinksLimpios)
        : limpiarFuentes(fuentes);

    const faltaInvestigacion = !investigacionFinal;
    const faltanFuentes = !fuentesFinales.length;

    if (faltaInvestigacion) {
      console.time("research_web");

      const researchData = await investigarTemaConWeb({
        materia: materiaLimpia,
        tema: temaLimpio,
        nivel: nivelLimpio,
        extensionDeseada,
        objetivo: objetivoLimpio,
        contenidoBase: contenidoBaseLimpio,
        sourceMode: sourceModeFinal,
        sourceLinksTexto,
      });

      investigacionFinal =
        researchData.investigacionCompacta || investigacionFinal;

      if (sourceModeFinal !== "exclusive") {
        const fuentesExtra = await buscarFuentesConWeb({
          materia: materiaLimpia,
          tema: temaLimpio,
          nivel: nivelLimpio,
          contenidoBase: contenidoBaseLimpio,
        });

        fuentesFinales = rankearFuentes([
          ...fuentesFinales,
          ...researchData.fuentes,
          ...fuentesExtra,
        ]);
      }

      console.timeEnd("research_web");
    } else if (faltanFuentes && sourceModeFinal !== "exclusive") {
      console.time("buscar_fuentes_web");

      fuentesFinales = await buscarFuentesConWeb({
        materia: materiaLimpia,
        tema: temaLimpio,
        nivel: nivelLimpio,
        contenidoBase: contenidoBaseLimpio,
      });

      fuentesFinales = limpiarFuentes(fuentesFinales);

      console.timeEnd("buscar_fuentes_web");
    } else if (sourceModeFinal !== "exclusive") {
      fuentesFinales = rankearFuentes(fuentesFinales);
    }

    const fuentesTexto = construirFuentesTextoParaModelo(fuentesFinales);
    const contextoDocumento = combinarContextoBase({
      investigacion: investigacionFinal,
      contenidoBase: contenidoBaseLimpio,
    });

    console.log("REQ /api/generar-documento", {
      materia: materiaLimpia,
      tema: temaLimpio,
      nivel: nivelLimpio,
      extensionDeseada,
      tieneObjetivo: Boolean(objetivoLimpio),
      investigacionLen: investigacionFinal.length,
      contenidoBaseLen: contenidoBaseLimpio.length,
      fuentesCount: fuentesFinales.length,
      sourceMode: sourceModeFinal,
      sourceLinksCount: sourceLinksLimpios.length,
      topSources: fuentesFinales.slice(0, 5).map((f) => ({
        title: f.title,
        domain: f.domain,
        trustScore: f.trustScore,
      })),
    });

    console.time("documento_ia");

    let documento = null;
    let ultimoErrorDocumento = null;
    let currentMaxOutputTokens = DOCUMENT_MAX_OUTPUT_TOKENS_INITIAL;

    for (let intento = 1; intento <= MAX_RETRY_DOCUMENTO; intento += 1) {
      try {
        documento = await generarDocumentoConIA({
          materia: materiaLimpia,
          tema: temaLimpio,
          nivel: nivelLimpio,
          extensionDeseada,
          objetivo: objetivoLimpio,
          investigacionFinal: contextoDocumento || investigacionFinal,
          contenidoBase: contenidoBaseLimpio,
          fuentesTexto,
          sourceMode: sourceModeFinal,
          sourceLinksTexto,
          intento,
          maxOutputTokens: currentMaxOutputTokens,
        });

        if (
          documento?.contenidoHtml &&
          documento.contenidoHtml.length >= DOCUMENT_MIN_HTML_CHARS
        ) {
          break;
        }

        throw new Error("El documento generado quedó demasiado corto.");
      } catch (error) {
        ultimoErrorDocumento = error;

        console.error(
          `Intento ${intento} de documento falló:`,
          error?.message || error
        );
        console.error(`Stack intento ${intento}:`, error?.stack || "sin stack");

        const puedeSubirTokens =
          error instanceof ResponseIncompleteError &&
          error.reason === "max_output_tokens";

        if (puedeSubirTokens) {
          const nuevoLimite = Math.min(
            currentMaxOutputTokens * 2,
            DOCUMENT_MAX_OUTPUT_TOKENS_CAP
          );

          if (nuevoLimite > currentMaxOutputTokens) {
            console.warn("Aumentando max_output_tokens para reintentar", {
              intento,
              anterior: currentMaxOutputTokens,
              nuevo: nuevoLimite,
            });

            currentMaxOutputTokens = nuevoLimite;
          }
        }

        if (intento === MAX_RETRY_DOCUMENTO) {
          throw error;
        }
      }
    }

    console.timeEnd("documento_ia");

    if (!documento) {
      throw (
        ultimoErrorDocumento ||
        new Error("No se pudo construir el documento.")
      );
    }

    console.timeEnd("generar_documento_total");

    return res.status(200).json({
      ok: true,
      documento,
      investigacion: investigacionFinal,
      fuentes: fuentesFinales,
    });
  } catch (error) {
    console.error("Error en /api/generar-documento:", error);
    console.error("STACK:", error?.stack || "sin stack");

    return res.status(500).json({
      ok: false,
      error: "No se pudo generar el documento.",
      detail: normalizarErrorPublico(error),
    });
  }
}
