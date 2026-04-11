import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function limpiarTexto(value = "") {
  return String(value || "").trim();
}

function limpiarLista(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => limpiarTexto(item))
    .filter(Boolean)
    .slice(0, 8);
}

function limpiarFormulas(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item) return null;

      if (typeof item === "string") {
        const formula = limpiarTexto(item);
        if (!formula) return null;
        return {
          nombre: "",
          formula,
          explicacion: "",
        };
      }

      const nombre = limpiarTexto(item.nombre);
      const formula = limpiarTexto(item.formula);
      const explicacion = limpiarTexto(item.explicacion);

      if (!nombre && !formula && !explicacion) return null;

      return {
        nombre,
        formula,
        explicacion,
      };
    })
    .filter(Boolean)
    .slice(0, 5);
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

function normalizarRespuesta(parsed = {}) {
  return {
    titulo: limpiarTexto(parsed.titulo) || "Respuesta de la IA",
    subtitulo: limpiarTexto(parsed.subtitulo) || "Duda respondida",
    introduccion:
      limpiarTexto(parsed.introduccion) ||
      limpiarTexto(parsed.explicacion) ||
      "Te explico esta duda de forma más clara.",
    ideaPrincipal:
      limpiarTexto(parsed.ideaPrincipal) ||
      limpiarTexto(parsed.resumen) ||
      limpiarTexto(parsed.introduccion) ||
      "Esta es la idea más importante de la respuesta.",
    puntos: limpiarLista(parsed.puntos),
    formulas: limpiarFormulas(parsed.formulas),
    pasos: limpiarLista(parsed.pasos),
    tips: limpiarLista(parsed.tips),
    errores: limpiarLista(parsed.errores),
    ejemplo: limpiarTexto(parsed.ejemplo),
    actividad:
      limpiarTexto(parsed.actividad) ||
      "Podés hacer otra pregunta desde el chat para seguir profundizando.",
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
    } = req.body || {};

    const preguntaLimpia = limpiarTexto(pregunta);

    if (!preguntaLimpia) {
      return res.status(400).json({
        ok: false,
        error: "Falta la pregunta del alumno.",
      });
    }

    const contexto = {
      claseGuardada: claseGuardada || {},
      claseGenerada: claseGenerada || {},
      ultimaRespuesta: ultimaRespuesta || {},
    };

    const response = await client.responses.create({
      model: "gpt-5.4",
      input: [
        {
          role: "developer",
          content: `
Sos un profesor de Eduvia.
Respondés dudas del alumno dentro de una clase ya iniciada.

Objetivo:
- Resolver la pregunta de forma clara, visual y útil.
- Mantener relación con la clase actual.
- Escribir como si la respuesta fuera a mostrarse en un pizarrón.

Reglas:
- Respondé en español rioplatense neutro.
- Sé didáctico, concreto y ordenado.
- No hables como chat informal.
- Si es matemática, incluí fórmulas y pasos cuando sirva.
- Si es inglés, incluí ejemplos claros y cortos.
- Si la pregunta es simple, no inventes contenido de más.
- Si falta información, igual ayudá con una explicación útil basada en el tema actual.
- Devolvé SOLO JSON válido.
          `.trim(),
        },
        {
          role: "user",
          content: `
CONTEXTO DE LA CLASE:
${JSON.stringify(contexto, null, 2)}

PREGUNTA DEL ALUMNO:
${preguntaLimpia}

Generá una respuesta con esta estructura:
- titulo
- subtitulo
- introduccion
- ideaPrincipal
- puntos
- formulas
- pasos
- tips
- errores
- ejemplo
- actividad
          `.trim(),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "respuesta_clase_eduvia",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              titulo: { type: "string" },
              subtitulo: { type: "string" },
              introduccion: { type: "string" },
              ideaPrincipal: { type: "string" },
              puntos: {
                type: "array",
                items: { type: "string" },
              },
              formulas: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    nombre: { type: "string" },
                    formula: { type: "string" },
                    explicacion: { type: "string" },
                  },
                  required: ["nombre", "formula", "explicacion"],
                },
              },
              pasos: {
                type: "array",
                items: { type: "string" },
              },
              tips: {
                type: "array",
                items: { type: "string" },
              },
              errores: {
                type: "array",
                items: { type: "string" },
              },
              ejemplo: { type: "string" },
              actividad: { type: "string" },
            },
            required: [
              "titulo",
              "subtitulo",
              "introduccion",
              "ideaPrincipal",
              "puntos",
              "formulas",
              "pasos",
              "tips",
              "errores",
              "ejemplo",
              "actividad",
            ],
          },
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
