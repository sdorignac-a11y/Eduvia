import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function limpiarTexto(value = "") {
  return String(value || "").trim();
}

function limpiarFuentes(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      const title = limpiarTexto(item.title || item.titulo || item.name || "Fuente");
      const url = limpiarTexto(item.url || item.link || "");

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
    .slice(0, 10);
}

function extractWebSources(response) {
  const encontrados = new Map();

  function pushSource(source) {
    if (!source || typeof source !== "object") return;

    const title =
      limpiarTexto(source.title) ||
      limpiarTexto(source.name) ||
      limpiarTexto(source.display_name);

    const url = limpiarTexto(source.url) || limpiarTexto(source.link);

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
  return Array.from(encontrados.values()).slice(0, 10);
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
- No hagas todavía el documento final.
- Entregá una investigación clara en español.

Quiero:
1. idea central del tema
2. conceptos clave
3. reglas, fechas, fórmulas o procedimientos si aplican
4. ejemplos concretos si aplican
5. errores comunes o confusiones frecuentes si aplican
6. qué es lo más importante para estudiar para una prueba
  `.trim();
}

const DOCUMENTO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    tituloDocumento: { type: "string" },
    objetivoDocumento: { type: "string" },
    contenidoHtml: { type: "string" },
    resumenCorto: { type: "string" },
  },
  required: ["tituloDocumento", "objetivoDocumento", "contenidoHtml", "resumenCorto"],
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Método no permitido.",
    });
  }

  try {
    const {
      materia = "",
      tema = "",
      nivel = "",
      duracion = "",
      objetivo = "",
      investigacion = "",
      fuentes = [],
    } = req.body || {};

    if (!materia || !tema || !nivel) {
      return res.status(400).json({
        ok: false,
        error: "Faltan materia, tema o nivel.",
      });
    }

    let investigacionFinal = limpiarTexto(investigacion);
    let fuentesFinales = limpiarFuentes(fuentes);

    if (!investigacionFinal) {
      const researchResponse = await client.responses.create({
        model: process.env.OPENAI_RESEARCH_MODEL || "gpt-5.4-mini",
        reasoning: { effort: "low" },
        tools: [{ type: "web_search" }],
        tool_choice: "auto",
        include: ["web_search_call.action.sources"],
        instructions: `
Sos el investigador de Eduvia.
Primero investigás y ordenás la información.
No escribas todavía el documento final.
        `.trim(),
        input: buildResearchPrompt({
          materia,
          tema,
          nivel,
          duracion,
          objetivo,
        }),
      });

      investigacionFinal = limpiarTexto(researchResponse.output_text || "");
      fuentesFinales = extractWebSources(researchResponse);
    }

    const fuentesTexto = fuentesFinales.length
      ? fuentesFinales
          .map((f, i) => `${i + 1}. ${f.title}${f.url ? ` — ${f.url}` : ""}`)
          .join("\n")
      : "No disponibles";

    const documentoResponse = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.4",
      instructions: `
Sos un profesor excelente de Eduvia.
Tu tarea es transformar una investigación previa en un documento de estudio claro, largo, serio y útil.

Reglas:
- Escribí en español claro.
- Adaptá el nivel al alumno.
- No inventes temas fuera del contexto.
- El resultado tiene que sentirse como un apunte limpio y bien redactado.
- Devolvé SOLO JSON válido.
- El campo contenidoHtml debe contener HTML seguro y limpio.
- Usá únicamente etiquetas como: h1, h2, h3, p, ul, ol, li, blockquote, strong, em.
- No uses style, script, iframe ni atributos inline.
- No agregues las fuentes dentro de contenidoHtml.
      `.trim(),
      input: `
Generá un documento de estudio con estos datos:

- Materia: ${materia}
- Tema: ${tema}
- Nivel: ${nivel}
- Duración: ${duracion || "No especificada"}
- Objetivo: ${objetivo || "No especificado"}

Investigación previa:
${investigacionFinal || "No disponible"}

Fuentes:
${fuentesTexto}

Quiero un documento tipo apunte, bien organizado, con:
- introducción
- desarrollo por secciones
- puntos importantes
- ejemplo o aplicación si corresponde
- cierre o repaso final

El JSON debe tener:
- tituloDocumento
- objetivoDocumento
- contenidoHtml
- resumenCorto
      `.trim(),
      text: {
        format: {
          type: "json_schema",
          name: "documento_eduvia",
          strict: true,
          schema: DOCUMENTO_SCHEMA,
        },
      },
    });

    const documento = JSON.parse(documentoResponse.output_text);

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
    });
  }
}
