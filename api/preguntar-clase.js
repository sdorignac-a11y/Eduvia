import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const RESPUESTA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    subtitulo: { type: "string" },
    clase: {
      type: "object",
      additionalProperties: false,
      properties: {
        titulo: { type: "string" },
        resumen: { type: "string" },
        palabrasClave: {
          type: "array",
          items: { type: "string" },
          minItems: 3,
          maxItems: 8,
        },
        secciones: {
          type: "array",
          minItems: 2,
          maxItems: 6,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              titulo: { type: "string" },
              texto: { type: "string" },
              bullets: {
                type: "array",
                items: { type: "string" },
                maxItems: 5,
              },
            },
            required: ["titulo", "texto", "bullets"],
          },
        },
        cardsDerecha: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              titulo: { type: "string" },
              lineas: {
                type: "array",
                items: { type: "string" },
                minItems: 2,
                maxItems: 4,
              },
              caption: { type: "string" },
              estilo: {
                type: "string",
                enum: ["blue", "green", "yellow", "red"],
              },
            },
            required: ["titulo", "lineas", "caption", "estilo"],
          },
          maxItems: 3,
        },
        imagenesContenido: {
          type: "array",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              titulo: { type: "string" },
              lineas: {
                type: "array",
                items: { type: "string" },
                minItems: 2,
                maxItems: 4,
              },
              caption: { type: "string" },
              estilo: {
                type: "string",
                enum: ["blue", "green", "yellow", "red"],
              },
            },
            required: ["titulo", "lineas", "caption", "estilo"],
          },
          maxItems: 3,
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
    },
  },
  required: ["subtitulo", "clase"],
};

function limpiarTexto(value = "") {
  return String(value || "").trim();
}

function limpiarLista(value, max = 8) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => limpiarTexto(item))
    .filter(Boolean)
    .slice(0, max);
}

function limpiarFuentes(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      const titulo = limpiarTexto(item.title || item.titulo || "Fuente");
      const url = limpiarTexto(item.url || "");

      if (!titulo && !url) return null;

      return {
        title: titulo || "Fuente",
        url,
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

function extraerOutputText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const parts = [];

  for (const item of response?.output || []) {
    if (!item || item.type !== "message") continue;

    for (const content of item.content || []) {
      if (content?.type === "output_text" && content.text) {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim();
}

function limpiarSecciones(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      const titulo = limpiarTexto(item.titulo);
      const texto = limpiarTexto(item.texto);
      const bullets = limpiarLista(item.bullets, 5);

      if (!titulo && !texto && !bullets.length) return null;

      return {
        titulo: titulo || "Idea importante",
        texto,
        bullets,
      };
    })
    .filter(Boolean)
    .slice(0, 6);
}

function limpiarVisuales(value, max = 3) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      const titulo = limpiarTexto(item.titulo);
      const lineas = limpiarLista(item.lineas, 4);
      const caption = limpiarTexto(item.caption);
      const estilo = ["blue", "green", "yellow", "red"].includes(item.estilo)
        ? item.estilo
        : "blue";

      if (!titulo && !lineas.length && !caption) return null;

      return {
        titulo: titulo || "Apoyo visual",
        lineas: lineas.length ? lineas : ["Idea importante", "Repaso rápido"],
        caption: caption || "Apoyo visual",
        estilo,
      };
    })
    .filter(Boolean)
    .slice(0, max);
}

function construirTextoFuentes(fuentes = []) {
  if (!fuentes.length) return "No hay fuentes explícitas disponibles.";

  return fuentes
    .map((fuente, index) => {
      const titulo = limpiarTexto(fuente.title || "Fuente");
      const url = limpiarTexto(fuente.url || "");
      return `${index + 1}. ${titulo}${url ? ` — ${url}` : ""}`;
    })
    .join("\n");
}

function fallbackSeccionesDesdeTexto(resumen = "") {
  const texto = limpiarTexto(resumen);

  if (!texto) {
    return [
      {
        titulo: "Explicación",
        texto: "No se pudo reconstruir bien la respuesta.",
        bullets: [],
      },
      {
        titulo: "Seguimos",
        texto: "Podés reformular la pregunta para profundizar mejor.",
        bullets: [],
      },
    ];
  }

  return [
    {
      titulo: "Explicación",
      texto,
      bullets: [],
    },
    {
      titulo: "Seguimos",
      texto: "Podés hacer otra pregunta para profundizar esta idea.",
      bullets: [],
    },
  ];
}

function normalizarRespuesta(parsed = {}) {
  const subtitulo = limpiarTexto(parsed.subtitulo) || "Duda respondida";
  const claseRaw = parsed.clase && typeof parsed.clase === "object" ? parsed.clase : {};

  const titulo = limpiarTexto(claseRaw.titulo) || "Respuesta de la IA";
  const resumen =
    limpiarTexto(claseRaw.resumen) ||
    "Te explico esta duda de forma más clara.";

  const palabrasClave = limpiarLista(claseRaw.palabrasClave, 8);
  const secciones = limpiarSecciones(claseRaw.secciones);
  const cardsDerecha = limpiarVisuales(claseRaw.cardsDerecha, 3);
  const imagenesContenido = limpiarVisuales(claseRaw.imagenesContenido, 3);

  return {
    subtitulo,
    clase: {
      titulo,
      resumen,
      palabrasClave: palabrasClave.length
        ? palabrasClave
        : ["idea principal", "contexto", "repaso"],
      secciones: secciones.length ? secciones : fallbackSeccionesDesdeTexto(resumen),
      cardsDerecha,
      imagenesContenido,
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      ok: false,
      error: "Método no permitido.",
    });
  }

  try {
    const {
      pregunta = "",
      claseGuardada = null,
      claseGenerada = null,
      ultimaRespuesta = null,
      fuentes = [],
      investigacion = "",
    } = req.body || {};

    const preguntaLimpia = limpiarTexto(pregunta);

    if (!preguntaLimpia) {
      return res.status(400).json({
        ok: false,
        error: "Falta la pregunta del alumno.",
      });
    }

    const fuentesLimpias = limpiarFuentes(fuentes);
    const investigacionLimpia = limpiarTexto(investigacion);

    const contexto = {
      claseGuardada: claseGuardada || {},
      claseGenerada: claseGenerada || {},
      ultimaRespuesta: ultimaRespuesta || {},
      investigacion: investigacionLimpia,
      fuentes: fuentesLimpias,
    };

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
      input: [
        {
          role: "developer",
          content: `
Sos un profesor de Eduvia.
Respondés dudas del alumno dentro de una clase ya iniciada.

Objetivo:
- Resolver la pregunta de forma clara, visual y útil.
- Mantener relación con la clase actual cuando sea relevante.
- Escribir como si la respuesta fuera a mostrarse en un pizarrón.
- Apoyarte en la investigación previa y en las fuentes ya usadas para la clase.

Reglas:
- Respondé en español rioplatense neutro.
- Sé didáctico, concreto y ordenado.
- No hables como chat informal.
- No uses una estructura fija.
- Adaptá la respuesta al tipo de pregunta.
- Solo incluí fórmulas si la pregunta realmente las necesita.
- Solo incluí pasos si la pregunta realmente los necesita.
- Si la pregunta es histórica, cultural, social o teórica, priorizá explicación, contexto, comparación, causas, relaciones y ejemplos.
- Si la pregunta es matemática o procedural, priorizá reglas, fórmulas, procedimiento y errores comunes.
- Si la pregunta es simple, no agregues secciones innecesarias.
- Priorizá la investigación previa antes que inventar.
- Si falta información exacta, explicalo con prudencia.
- No contradigas el contenido base de la clase.
- Devolvé SOLO JSON válido.

Formato esperado:
- "subtitulo": una etiqueta breve para mostrar arriba.
- "clase": objeto con contenido flexible y útil para estudiar.

Dentro de "clase":
- "titulo": claro y específico.
- "resumen": explicación principal.
- "palabrasClave": entre 3 y 8.
- "secciones": entre 2 y 6, elegidas según el tema.
- "cardsDerecha": opcionalmente 0 a 3 apoyos visuales si suman valor real.
- "imagenesContenido": opcionalmente 0 a 3 apoyos visuales si suman valor real.

Muy importante:
- No armes secciones vacías.
- No inventes una sección de fórmulas si no corresponde.
- No inventes una sección de pasos si no corresponde.
- Las secciones deben surgir del contenido real de la pregunta.
          `.trim(),
        },
        {
          role: "user",
          content: `
CONTEXTO DE LA CLASE:
${JSON.stringify(
  {
    claseGuardada: contexto.claseGuardada,
    claseGenerada: contexto.claseGenerada,
    ultimaRespuesta: contexto.ultimaRespuesta,
  },
  null,
  2
)}

INVESTIGACIÓN PREVIA DE LA CLASE:
${investigacionLimpia || "No disponible."}

FUENTES USADAS:
${construirTextoFuentes(fuentesLimpias)}

PREGUNTA DEL ALUMNO:
${preguntaLimpia}

Respondé adaptando la estructura a esta pregunta concreta.
          `.trim(),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "respuesta_clase_eduvia_flexible",
          strict: true,
          schema: RESPUESTA_SCHEMA,
        },
      },
    });

    const rawText = extraerOutputText(response);

    if (!rawText) {
      return res.status(500).json({
        ok: false,
        error: "La IA no devolvió contenido.",
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(rawText);
    } catch (error) {
      console.error("JSON inválido devuelto por la IA:", rawText);
      return res.status(500).json({
        ok: false,
        error: "La IA respondió con un formato inválido.",
      });
    }

    const respuesta = normalizarRespuesta(parsed);

    return res.status(200).json({
      ok: true,
      respuesta,
    });
  } catch (error) {
    console.error("Error en /api/preguntar-clase:", error);

    return res.status(500).json({
      ok: false,
      error: "No se pudo responder la pregunta del alumno.",
    });
  }
}
