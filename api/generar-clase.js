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
    const { materia, tema, nivel, duracion, objetivo } = req.body || {};

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
          content: [
            {
              type: "input_text",
              text: `
Sos un profesor excelente de Eduvia, muy claro, didáctico, visual y pedagógico.

Tu tarea es generar una clase COMPLETA para mostrar dentro de un pizarrón digital dirigido a chicos y jóvenes.

Objetivos de la respuesta:
- Explicar el tema de forma clara, no superficial.
- Dar una explicación útil para aprender de verdad, no un resumen corto.
- Si el tema tiene fórmulas, reglas o estructuras, incluirlas sí o sí.
- Dar pasos para reconocer o resolver el tema.
- Dar tips útiles y errores comunes.
- Proponer visuales relacionados con el contenido real de la clase.

Reglas importantes:
- Adaptá el lenguaje al nivel del alumno.
- Nada de markdown.
- Nada de texto fuera del JSON.
- No uses símbolos raros innecesarios.
- Las fórmulas deben ser claras y simples de leer.
- En los visuales, pensá ideas concretas que ayuden a entender el tema.
- No repitas exactamente lo mismo en todas las secciones.
              `.trim(),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: `
Generá una clase con estos datos:

- Materia: ${materia}
- Tema: ${tema}
- Nivel: ${nivel}
- Duración: ${duracion || "No especificada"}
- Objetivo: ${objetivo || "No especificado"}

Quiero que la clase sea clara, completa y útil.
Si el tema incluye fórmulas, patrones, reglas, pasos o formas de identificación, incluilos.
              `.trim(),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "clase_eduvia_completa",
          description: "Clase estructurada para mostrar en el pizarrón de Eduvia",
          strict: true,
          schema: {
            type: "object",
            properties: {
              titulo: {
                type: "string",
              },
              introduccion: {
                type: "string",
              },
              ideaPrincipal: {
                type: "string",
              },
              formulas: {
                type: "array",
                minItems: 0,
                maxItems: 5,
                items: {
                  type: "object",
                  properties: {
                    nombre: { type: "string" },
                    formula: { type: "string" },
                    explicacion: { type: "string" },
                  },
                  required: ["nombre", "formula", "explicacion"],
                  additionalProperties: false,
                },
              },
              pasos: {
                type: "array",
                minItems: 2,
                maxItems: 6,
                items: { type: "string" },
              },
              puntos: {
                type: "array",
                minItems: 3,
                maxItems: 7,
                items: { type: "string" },
              },
              tips: {
                type: "array",
                minItems: 2,
                maxItems: 5,
                items: { type: "string" },
              },
              errores: {
                type: "array",
                minItems: 2,
                maxItems: 5,
                items: { type: "string" },
              },
              ejemplo: {
                type: "string",
              },
              actividad: {
                type: "string",
              },
              visuales: {
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
                    color: {
                      type: "string",
                      enum: ["blue", "green", "yellow", "red"],
                    },
                  },
                  required: ["titulo", "lineas", "caption", "color"],
                  additionalProperties: false,
                },
              },
            },
            required: [
              "titulo",
              "introduccion",
              "ideaPrincipal",
              "formulas",
              "pasos",
              "puntos",
              "tips",
              "errores",
              "ejemplo",
              "actividad",
              "visuales",
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
