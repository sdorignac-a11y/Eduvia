import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const RESEARCH_MODEL = process.env.OPENAI_RESEARCH_MODEL || "gpt-5.4-mini";
const DOCUMENT_MODEL = process.env.OPENAI_MODEL || "gpt-5.4";

const MAX_SOURCE_COUNT = 10;
const MAX_INVESTIGACION_CHARS = 3500;
const MAX_FUENTES_TEXTO_CHARS = 900;
const MAX_CONTENIDO_BASE_CHARS = 5000;
const MAX_RETRY_DOCUMENTO = 2;

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

function buildResearchPrompt({
  materia,
  tema,
  nivel,
  duracion,
  objetivo,
  contenidoBase,
}) {
  return `
Investigá este tema para preparar un documento de estudio completo y serio.

Datos:
- Materia: ${materia}
- Tema: ${tema}
- Nivel: ${nivel}
- Duración: ${duracion || "No especificada"}
- Objetivo: ${objetivo || "No especificado"}

${contenidoBase ? `Contenido base ya disponible:\n${contenidoBase}\n` : ""}

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
  contenidoBase,
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

Contenido base previo:
${contenidoBase || "No disponible"}

Fuentes consultadas:
${fuentesTexto}

Requisitos:
- Hacé una introducción breve y clara.
- Desarrollá el tema por secciones bien organizadas.
- Explicá de forma útil para estudiar.
- Si hay contenido base previo útil, integralo y mejoralo.
- Incluí ejemplos o aplicaciones si corresponde.
- Cerrá con un repaso final.
- Adaptá la profundidad al nivel indicado.
- No pongas relleno.
- No repitas demasiado las mismas ideas.
- No agregues las fuentes dentro del HTML.
- El documento debe sentirse completo, no como un borrador.
- El contenidoHtml debe traer suficiente desarrollo real.

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

      if (!allowedTags.has(tag)) {
        return "";
      }

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

  if (!contenidoHtml || contenidoHtml.length < 80) {
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

function extraerJsonDesdeTexto(raw = "") {
  const texto = limpiarTexto(raw);
  if (!texto) throw new Error("La respuesta vino vacía.");

  try {
    return JSON.parse(texto);
  } catch {
    const start = texto.indexOf("{");
    const end = texto.lastIndexOf("}");

    if (start !== -1 && end !== -1 && end > start) {
      const fragment = texto.slice(start, end + 1);
      return JSON.parse(fragment);
    }

    throw new Error("La respuesta del modelo no fue JSON válido.");
  }
}

function parseDocumentoDesdeResponse(response) {
  const raw = limpiarTexto(response?.output_text || "");

  if (!raw) {
    console.error("Respuesta completa del documento sin output_text:", response);
    throw new Error(
      "OpenAI no devolvió output_text en la generación del documento."
    );
  }

  const parsed = extraerJsonDesdeTexto(raw);
  return validarDocumento(parsed);
}

function parseResearchDesdeResponse(response) {
  const raw = limpiarTexto(response?.output_text || "");

  if (!raw) {
    console.error("Respuesta completa de research sin output_text:", response);
    throw new Error("OpenAI no devolvió output_text en la investigación.");
  }

  const parsed = extraerJsonDesdeTexto(raw);
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
  contenidoBase,
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
        duracion,
        objetivo,
        contenidoBase,
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

    console.log("investigarTemaConWeb ok:", {
      model: RESEARCH_MODEL,
      hasOutputText: Boolean(researchResponse?.output_text),
      outputTextLen: String(researchResponse?.output_text || "").length,
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
    console.error(
      "Stack investigarTemaConWeb:",
      error?.stack || "sin stack"
    );
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
Respondé en español, breve.
    `.trim(),
    input: buildFuentesOnlyPrompt({
      materia,
      tema,
      nivel,
      contenidoBase,
    }),
  });

  return extractWebSources(response);
}

async function generarDocumentoConIA({
  materia,
  tema,
  nivel,
  duracion,
  objetivo,
  investigacionFinal,
  contenidoBase,
  fuentesTexto,
  intento = 1,
}) {
  const refuerzo =
    intento > 1
      ? `
Ajuste adicional para este intento:
- El contenidoHtml anterior quedó corto o incompleto.
- Esta vez devolvé un documento más desarrollado y mejor explicado.
- Asegurate de que haya desarrollo real del tema en varias secciones.
      `.trim()
      : "";

  try {
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
${refuerzo ? `- ${refuerzo.replace(/\n/g, "\n- ")}` : ""}
      `.trim(),
      input: buildDocumentoPrompt({
        materia,
        tema,
        nivel,
        duracion,
        objetivo,
        investigacionFinal,
        contenidoBase,
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

    const outputText = limpiarTexto(documentoResponse?.output_text || "");

    console.log("generarDocumentoConIA ok:", {
      model: DOCUMENT_MODEL,
      intento,
      hasOutputText: Boolean(outputText),
      outputTextLen: outputText.length,
      preview: outputText.slice(0, 300),
    });

    if (!outputText) {
      console.error("documentoResponse sin output_text:", documentoResponse);
      throw new Error(
        "OpenAI no devolvió output_text en la generación del documento."
      );
    }

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
      contenidoBase = "",
    } = req.body || {};

    const materiaLimpia = limitarTexto(materia, 180);
    const temaLimpio = limitarTexto(tema, 220);
    const nivelLimpio = limitarTexto(nivel, 120);
    const duracionLimpia = limitarTexto(duracion, 120);
    const objetivoLimpio = limitarTexto(objetivo, 400);
    const contenidoBaseLimpio = limpiarContenidoBase(contenidoBase);

    if (!materiaLimpia || !temaLimpio || !nivelLimpio) {
      return res.status(400).json({
        ok: false,
        error: "Faltan materia, tema o nivel.",
      });
    }

    let investigacionFinal = limitarTexto(
      investigacion,
      MAX_INVESTIGACION_CHARS
    );
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
        contenidoBase: contenidoBaseLimpio,
      });

      investigacionFinal =
        researchData.investigacionCompacta || investigacionFinal;

      if (faltanFuentes) {
        fuentesFinales = limpiarFuentes(researchData.fuentes);
      }

      console.timeEnd("research_web");
    } else if (faltanFuentes) {
      console.time("buscar_fuentes_web");

      fuentesFinales = await buscarFuentesConWeb({
        materia: materiaLimpia,
        tema: temaLimpio,
        nivel: nivelLimpio,
        contenidoBase: contenidoBaseLimpio,
      });

      fuentesFinales = limpiarFuentes(fuentesFinales);

      console.timeEnd("buscar_fuentes_web");
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
      tieneObjetivo: Boolean(objetivoLimpio),
      investigacionLen: investigacionFinal.length,
      contenidoBaseLen: contenidoBaseLimpio.length,
      fuentesCount: fuentesFinales.length,
    });

    console.time("documento_ia");

    let documento = null;
    let ultimoErrorDocumento = null;

    for (let intento = 1; intento <= MAX_RETRY_DOCUMENTO; intento += 1) {
      try {
        documento = await generarDocumentoConIA({
          materia: materiaLimpia,
          tema: temaLimpio,
          nivel: nivelLimpio,
          duracion: duracionLimpia,
          objetivo: objetivoLimpio,
          investigacionFinal: contextoDocumento || investigacionFinal,
          contenidoBase: contenidoBaseLimpio,
          fuentesTexto,
          intento,
        });

        if (documento?.contenidoHtml && documento.contenidoHtml.length >= 80) {
          break;
        }

        throw new Error("El documento generado quedó demasiado corto.");
      } catch (error) {
        ultimoErrorDocumento = error;
        console.error(
          `Intento ${intento} de documento falló:`,
          error?.message || error
        );
        console.error(
          `Stack intento ${intento}:`,
          error?.stack || "sin stack"
        );

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
      detail: limpiarTexto(error?.message || "Error desconocido"),
    });
  }
}
