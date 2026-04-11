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
          content: `
Sos un profesor claro, didáctico y visual de Eduvia.
Generá una clase breve para mostrar en un pizarrón digital.
Adaptá el lenguaje al nivel del alumno.
Nada de markdown.
Nada de texto fuera del JSON.
          `.trim(),
        },
        {
          role: "user",
          content: `
Generá una clase con estos datos:

- Materia: ${materia}
- Tema: ${tema}
- Nivel: ${nivel}
- Duración: ${duracion || "No especificada"}
- Objetivo: ${objetivo || "No especificado"}
          `.trim(),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "clase_eduvia",
          strict: true,
          schema: {
            type: "object",
            properties: {
              titulo: { type: "string" },
              introduccion: { type: "string" },
              puntos: {
                type: "array",
                items: { type: "string" },
                minItems: 3,
                maxItems: 5,
              },
              ejemplo: { type: "string" },
              actividad: { type: "string" },
            },
            required: ["titulo", "introduccion", "puntos", "ejemplo", "actividad"],
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
