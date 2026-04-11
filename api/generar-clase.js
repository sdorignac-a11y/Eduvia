import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

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

    const response = await client.responses.create({
      model: "gpt-5.4",
      input: [
        {
          role: "developer",
          content: `
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
- Las sections deben surgir del tema, no de una plantilla fija.
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
        },
        {
          role: "user",
          content: `
Generá el resumen de estudio con estos datos:

- Materia: ${materia}
- Tema: ${tema}
- Nivel: ${nivel}
- Duración: ${duracion || "No especificada"}
- Objetivo: ${objetivo || "No especificado"}

Quiero que quede completo, claro, útil y bien explicado.
          `.trim(),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "resumen_estudio_eduvia",
          strict: true,
          schema: {
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
          },
        },
      },
    });

    const clase = JSON.parse(response.output_text);

    return res.status(200).json({
      ok: true,
      clase,
    });
  } catch (error) {
    console.error("Error en /api/generar-clase:", error);
    return res.status(500).json({
      ok: false,
      error: "No se pudo generar la clase.",
    });
  }
}
