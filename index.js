import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static("."));

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

app.post("/api/generar-clase", async (req, res) => {
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

Tu tarea es generar una clase breve para mostrar en un pizarrón digital.
Adaptá siempre el lenguaje al nivel del alumno.
La explicación debe ser clara, concreta y útil para estudiar.
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

    return res.json({
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
});

app.listen(PORT, () => {
  console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
