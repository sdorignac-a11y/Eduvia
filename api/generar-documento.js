import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const RESEARCH_MODEL = process.env.OPENAI_RESEARCH_MODEL || "gpt-5.4-mini";
const DOCUMENT_MODEL = process.env.OPENAI_MODEL || "gpt-5.4";

const MAX_SOURCE_COUNT = 10;
const MAX_INVESTIGACION_CHARS = 3500;
const MAX_FUENTES_TEXTO_CHARS = 900;

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
  if (!Array.isArray(value)) return [];

  const seen = new Set();

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      const title = limitarTexto(
        item.title || item.titulo || item.name || "Fuente",
        180
      );
      const url = sanitizeUrl(item.url || item.link || "");

      if (!title && !url) return null;

      const key = `${title}|${url}`;
      if (seen.has(key)) return null;
      seen.add(key);

      return {
        title: title || "Fuente",
        url,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_SOURCE_COUNT);
}

function extractWebSources(response) {
  const encontrados = new Map();

  function pushSource(source) {
    if (!source || typeof source !== "object") return;

    const title =
      limitarTexto(source.title, 180) ||
      limitarTexto(source.name, 180) ||
      limitarTexto(source.display_name, 180);

    const url = sanitizeUrl(source.url || source.link || "");

    if (!title && !url) return;

    const key = url || title;
    if (!encontrados.has(key)) {
      encontrados.set(key, {
        title: title || "Fuente",
        url,
      });
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
  return Array.from(encontrados.values()).slice(0, MAX_SOURCE_COUNT);
}

function buildResearchPrompt({ materia, tema, nivel, duracion, objetivo }) {
  return `
Investigá este tema para preparar un documento de estudio completo y serio.

Datos:
- Materia: ${materia}
- Tema: ${tema}
- Nivel: ${nivel}
- Duración: ${duracion || "No especificada"}
- Objetivo: ${objetivo || "No especificado"}

Instrucciones:
- Buscá información confiable y útil para estudiar.
- Priorizá contenido educativo, académico o enciclopédico.
- Evitá foros, páginas pobres o contenido repetido.
- No redactes todavía el documento final.
- Respondé en español.
- Organizá la investigación de forma clara y compacta.
- Explicá el contenido como base de estudio para un alumno.
- Incluí datos concretos solo cuando aporten valor real.

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

function buildFuentesOnlyPrompt({ materia, tema, nivel }) {
  return `
Buscá fuentes confiables para estudiar este tema.

Datos:
- Materia: ${materia}
- Tema: ${tema}
- Nivel: ${nivel}

Instrucciones:
- Priorizá contenido educativo, académico o enciclopédico.
- Evitá foros, resultados duplicados o páginas débiles.
- Respondé en español con una síntesis muy breve del tema.
- Lo importante es encontrar buenas fuentes.
  `.trim();
}

function buildDocumentoPrompt({
  materia,
  tema,
  nivel,
  duracion,
  objetivo,
  investigacionFinal,
  fuentesTexto,
}) {
  return `
Creá un documento de estudio en español.

Datos:
- Materia: ${materia}
- Tema: ${tema}
- Nivel: ${nivel}
- Duración: ${duracion || "No especificada"}
- Objetivo: ${objetivo || "No especificado"}

Base de investigación:
${investigacionFinal || "No disponible"}

Fuentes consultadas:
${fuentesTexto}

Requisitos:
- Hacé una introducción breve y clara.
- Desarrollá el tema por secciones bien organizadas.
- Explicá de forma útil para estudiar.
- Incluí ejemplos o aplicaciones si corresponde.
- Cerrá con un repaso final.
- Adaptá la profundidad al nivel indicado.
- No pongas relleno.
- No repitas demasiado las mismas ideas.
- No agregues las fuentes dentro del HTML.

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

  output = output.replace(/<\s*(\/?)\s*([a-z0-9-]+)([^>]*)>/gi, (_, closing, tagName) => {
    const tag = String(tagName || "").toLowerCase();

    if (!allowedTags.has(tag)) {
      return "";
    }

    return closing ? `</${tag}>` : `<${tag}>`;
  });

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

  if (!contenidoHtml || contenidoHtml.length < 40) {
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

function parseDocumentoDesdeResponse(response) {
  const raw = limpiarTexto(response?.output_text || "");

  if (!raw) {
    throw new Error("OpenAI no devolvió output_text en la generación del documento.");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error("No se pudo parsear output_text del documento:", raw);
    throw new Error("La respuesta del modelo no fue JSON válido.");
  }

  return validarDocumento(parsed);
}

function parseResearchDesdeResponse(response) {
  const raw = limpiarTexto(response?.output_text || "");

  if (!raw) {
    throw new Error("OpenAI no devolvió output_text en la investigación.");
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    console.error("No se pudo parsear output_text de research:", raw);
    throw new Error("La investigación no vino en JSON válido.");
  }

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
    data.resumenInvestigacion
      ? `Resumen: ${data.resumenInvestigacion}`
      : "",
  ];

  return limitarTexto(
    bloques.filter(Boolean).join("\n"),
    MAX_INVESTIGACION_CHARS
  );
}

function construirFuentesTextoParaModelo(fuentes) {
  const texto = (Array.isArray(fuentes) ? fuentes : [])
    .slice(0, 6)
    .map((f, i) => {
      const title = limitarTexto(f?.title || "Fuente", 120);
      const dominio = extraerDominio(f?.url || "");
      return `${i + 1}. ${title}${dominio ? ` (${dominio})` : ""}`;
    })
    .join("\n");

  return texto.slice(0, MAX_FUENTES_TEXTO_CHARS) || "No disponibles";
}

async function investigarTemaConWeb({
  materia,
  tema,
  nivel,
  duracion,
  objetivo,
}) {
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
      duracion,
      objetivo,
    }),
    text: {
      format: {
        type: "json_schema",
        name: "research_eduvia",
        strict: true,
        schema: RESEARCH_SCHEMA,
      },
    },
  });

  const research = parseResearchDesdeResponse(researchResponse);
  const investigacionCompacta = construirInvestigacionCompacta(research);
  const fuentes = extractWebSources(researchResponse);

  return {
    investigacionCompacta,
    fuentes,
  };
}

async function buscarFuentesConWeb({
  materia,
  tema,
  nivel,
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
Respondé en español, breve.
    `.trim(),
    input: buildFuentesOnlyPrompt({
      materia,
      tema,
      nivel,
    }),
  });

  return extractWebSources(response);
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
      objetivo = "",
      investigacion = "",
      fuentes = [],
    } = req.body || {};

    const materiaLimpia = limitarTexto(materia, 180);
    const temaLimpio = limitarTexto(tema, 220);
    const nivelLimpio = limitarTexto(nivel, 120);
    const duracionLimpia = limitarTexto(duracion, 120);
    const objetivoLimpio = limitarTexto(objetivo, 400);

    if (!materiaLimpia || !temaLimpio || !nivelLimpio) {
      return res.status(400).json({
        ok: false,
        error: "Faltan materia, tema o nivel.",
      });
    }

    let investigacionFinal = limitarTexto(investigacion, MAX_INVESTIGACION_CHARS);
    let fuentesFinales = limpiarFuentes(fuentes);

    const faltaInvestigacion = !investigacionFinal;
    const faltanFuentes = !fuentesFinales.length;

    if (faltaInvestigacion) {
      console.time("research_web");

      const researchData = await investigarTemaConWeb({
        materia: materiaLimpia,
        tema: temaLimpio,
        nivel: nivelLimpio,
        duracion: duracionLimpia,
        objetivo: objetivoLimpio,
      });

      investigacionFinal = researchData.investigacionCompacta || investigacionFinal;

      if (faltanFuentes) {
        fuentesFinales = researchData.fuentes;
      }

      console.timeEnd("research_web");
    } else if (faltanFuentes) {
      console.time("buscar_fuentes_web");

      fuentesFinales = await buscarFuentesConWeb({
        materia: materiaLimpia,
        tema: temaLimpio,
        nivel: nivelLimpio,
      });

      console.timeEnd("buscar_fuentes_web");
    }

    const fuentesTexto = construirFuentesTextoParaModelo(fuentesFinales);

    console.time("documento_ia");

    const documentoResponse = await client.responses.create({
      model: DOCUMENT_MODEL,
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
      `.trim(),
      input: buildDocumentoPrompt({
        materia: materiaLimpia,
        tema: temaLimpio,
        nivel: nivelLimpio,
        duracion: duracionLimpia,
        objetivo: objetivoLimpio,
        investigacionFinal,
        fuentesTexto,
      }),
      text: {
        format: {
          type: "json_schema",
          name: "documento_eduvia",
          strict: true,
          schema: DOCUMENTO_SCHEMA,
        },
      },
      max_output_tokens: 2200,
    });

    console.timeEnd("documento_ia");

    const documento = parseDocumentoDesdeResponse(documentoResponse);

    console.timeEnd("generar_documento_total");

    return res.status(200).json({
      ok: true,
      documento,
      investigacion: investigacionFinal,
      fuentes: fuentesFinales,
    });
  } catch (error) {
    console.error("Error en /api/generar-documento:", error);

    return res.status(500).json({
      ok: false,
      error: "No se pudo generar el documento.",
      detail:
        process.env.NODE_ENV !== "production"
          ? limpiarTexto(error?.message || "Error desconocido")
          : undefined,
    });
  }
}
