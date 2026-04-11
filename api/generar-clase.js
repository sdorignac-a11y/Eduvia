import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const CLASE_SCHEMA = {
  type: "object",
  properties: {
    titulo: { type: "string" },
    resumen: { type: "string" },
    palabrasClave: {
      type: "array",
      minItems: 5,
      maxItems: 10,
      items: { type: "string" },
    },
    secciones: {
      type: "array",
      minItems: 4,
      maxItems: 8,
      items: {
        type: "object",
        properties: {
          titulo: { type: "string" },
          texto: { type: "string" },
          bullets: {
            type: "array",
            minItems: 0,
            maxItems: 5,
            items: { type: "string" },
          },
        },
        required: ["titulo", "texto", "bullets"],
        additionalProperties: false,
      },
    },
    cardsDerecha: {
      type: "array",
      minItems: 3,
      maxItems: 3,
      items: {
        type: "object",
        properties: {
          titulo: { type: "string" },
          lineas: {
            type: "array",
            minItems: 2,
            maxItems: 4,
            items: { type: "string" },
          },
          caption: { type: "string" },
          estilo: {
            type: "string",
            enum: ["blue", "green", "yellow", "red"],
          },
        },
        required: ["titulo", "lineas", "caption", "estilo"],
        additionalProperties: false,
      },
    },
    imagenesContenido: {
      type: "array",
      minItems: 2,
      maxItems: 4,
      items: {
        type: "object",
        properties: {
          titulo: { type: "string" },
          lineas: {
            type: "array",
            minItems: 2,
            maxItems: 4,
            items: { type: "string" },
          },
          caption: { type: "string" },
          estilo: {
            type: "string",
            enum: ["blue", "green", "yellow", "red"],
          },
        },
        required: ["titulo", "lineas", "caption", "estilo"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "titulo",
    "resumen",
    "palabrasClave",
    "secciones",
    "cardsDerecha",
    "imagenesContenido",
  ],
  additionalProperties: false,
};

function limpiarTexto(value = "") {
  return String(value).trim();
}

function buildSearchPrompt({ materia, tema, nivel, duracion, objetivo }) {
  return `
Investigá este tema para preparar una clase de estudio de alta calidad.

Datos:
- Materia: ${materia}
- Tema: ${tema}
- Nivel: ${nivel}
- Duración: ${duracion || "No especificada"}
- Objetivo: ${objetivo || "No especificado"}

Instrucciones:
- Buscá información web confiable y actual.
- Priorizá contenido educativo, enciclopédico o académico.
- Evitá foros, contenido pobre, clickbait o páginas repetidas.
- No escribas una clase final todavía.
- Entregá una investigación breve y útil en español.

Quiero que armes un informe con estas partes:
1. Definición o idea central del tema.
2. Conceptos clave.
3. Fórmulas, fechas, reglas o procedimientos si aplican.
4. Ejemplos concretos si aplican.
5. Errores comunes o confusiones frecuentes si aplican.
6. Relación con otros conceptos importantes.
7. Qué sería lo más importante para estudiar para una prueba.

Sé claro, concreto y útil.
`.trim();
}

function buildLessonInput({
  materia,
  tema,
  nivel,
  duracion,
  objetivo,
  investigacion,
  fuentes,
}) {
  const fuentesTexto = fuentes.length
    ? fuentes
        .map((f, i) => `${i + 1}. ${f.title}${f.url ? ` — ${f.url}` : ""}`)
        .join("\n")
    : "No disponibles";

  return `
Generá el resumen de estudio con estos datos:

- Materia: ${materia}
- Tema: ${tema}
- Nivel: ${nivel}
- Duración: ${duracion || "No especificada"}
- Objetivo: ${objetivo || "No especificado"}

Investigación previa validada:
${investigacion}

Fuentes utilizadas:
${fuentesTexto}

Quiero que quede completo, claro, útil y bien explicado.
Basate en la investigación previa.
No inventes datos que contradigan o se alejen de esa base.
`.trim();
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
      encontrados.set(key, { title: title || "Fuente", url });
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

  return Array.from(encontrados.values()).slice(0, 8);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Método no permitido",
    });
  }

  try {
    const {
      materia = "",
      tema = "",
      nivel = "",
      duracion = "",
      objetivo = "",
    } = req.body || {};

    if (!materia || !tema || !nivel) {
      return res.status(400).json({
        ok: false,
        error: "Faltan materia, tema o nivel.",
      });
    }

    // 1) INVESTIGACIÓN CON WEB SEARCH
    const researchResponse = await client.responses.create({
      model: process.env.OPENAI_RESEARCH_MODEL || "gpt-5.4-mini",
      reasoning: { effort: "low" },
      tools: [{ type: "web_search" }],
      tool_choice: "auto",
      include: ["web_search_call.action.sources"],
      instructions: `
Sos un investigador académico de Eduvia.
Tu trabajo es investigar primero y explicar después.
No hagas relleno.
No inventes fuentes.
`.trim(),
      input: buildSearchPrompt({
        materia,
        tema,
        nivel,
        duracion,
        objetivo,
      }),
    });

    const investigacion = limpiarTexto(researchResponse.output_text);

    if (!investigacion) {
      return res.status(500).json({
        ok: false,
        error: "No se pudo construir la investigación previa.",
      });
    }

    const fuentes = extractWebSources(researchResponse);

    // 2) GENERACIÓN FINAL EN JSON ESTRICTO
    const lessonResponse = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.4",
      instructions: `
Sos un profesor excelente de Eduvia.
Explicás de forma clara, didáctica, visual, precisa y útil para estudiar para una prueba.

Tu tarea es generar un resumen de estudio completo para mostrar en un pizarrón digital.
El contenido está orientado a chicos y jóvenes.

REGLAS:
- Tratá únicamente el tema indicado por el usuario.
- No inventes otro tema distinto.
- Adaptá el lenguaje al nivel del alumno.
- No uses markdown.
- No escribas nada fuera del JSON.
- No hagas texto relleno.
- El contenido debe servir para estudiar de verdad.
- Basate en la investigación previa.
- Si falta algo en la investigación, priorizá prudencia antes que inventar.

MUY IMPORTANTE:
- No uses una estructura fija.
- Elegí las secciones según lo que el tema necesite.
- Si el tema requiere fórmulas, incluilas.
- Si el tema requiere causas y consecuencias, incluilas.
- Si el tema requiere pasos, procedimiento, fechas, comparaciones o errores comunes, incluilos.
- Si el tema es más teórico, priorizá explicación, ideas clave, relaciones y ejemplos.
- Si el tema es más práctico, priorizá reglas, procedimiento, aplicación y errores comunes.

QUÉ TENÉS QUE DEVOLVER:
1. "titulo"
- Claro y específico.

2. "resumen"
- Un resumen principal más completo, claro y útil.
- Debe explicar bien de qué trata el tema y por qué importa.

3. "palabrasClave"
- Entre 5 y 10 palabras o frases cortas que sean esenciales para este tema.
- Sirven para resaltarlas visualmente.

4. "secciones"
- Entre 4 y 8 secciones.
- Cada sección debe tener:
  - "titulo"
  - "texto"
  - "bullets"
- Las secciones deben surgir del tema, no de una plantilla fija.
- "texto" debe explicar.
- "bullets" debe resumir puntos fuertes si hace falta.

5. "cardsDerecha"
- 3 cards visuales pensadas para estar a la derecha.
- Cada una debe tener:
  - "titulo"
  - "lineas" (2 a 4)
  - "caption"
  - "estilo" (blue, green, yellow o red)
- Deben ser visuales, claras y realmente útiles para estudiar.

6. "imagenesContenido"
- Entre 2 y 4 apoyos visuales para intercalar entre secciones.
- Cada uno debe tener:
  - "titulo"
  - "lineas" (2 a 4)
  - "caption"
  - "estilo" (blue, green, yellow o red)
- Deben representar ideas importantes del contenido, no decoración vacía.

ESTILO:
- Claro
- Pedagógico
- Preciso
- Visual
- Útil para preparar una prueba
      `.trim(),
      input: buildLessonInput({
        materia,
        tema,
        nivel,
        duracion,
        objetivo,
        investigacion,
        fuentes,
      }),
      text: {
        format: {
          type: "json_schema",
          name: "resumen_estudio_eduvia",
          strict: true,
          schema: CLASE_SCHEMA,
        },
      },
    });

    const clase = JSON.parse(lessonResponse.output_text);

    return res.status(200).json({
      ok: true,
      clase,
      fuentes,
      investigacion,
    });
  } catch (error) {
    console.error("Error en /api/generar-clase:", error);

    return res.status(500).json({
      ok: false,
      error: "No se pudo generar la clase.",
      detalle:
        process.env.NODE_ENV === "development" ? String(error?.message || error) : undefined,
    });
  }
}
