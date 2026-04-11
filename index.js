// server.js o index.js
import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

app.post("/api/generar-clase", async (req, res) => {
  try {
    const { materia, tema, nivel, duracion, objetivo } = req.body;

    const prompt = `
Sos un profesor claro, didáctico y visual de Eduvia.
Generá una clase para mostrar en un pizarrón digital.

Datos:
- Materia: ${materia}
- Tema: ${tema}
- Nivel: ${nivel}
- Duración: ${duracion}
- Objetivo: ${objetivo}

Quiero que respondas en formato JSON con esta estructura exacta:
{
  "titulo": "string",
  "introduccion": "string",
  "puntos": ["string", "string", "string"],
  "ejemplo": "string",
  "actividad": "string"
}

Reglas:
- Explicá según el nivel del alumno.
- Sé claro, concreto y pedagógico.
- Nada de texto demasiado largo.
- Que quede bien para mostrarse visualmente en un pizarrón.
`;

    const response = await openai.responses.create({
      model: "gpt-5.4",
      input: prompt,
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
                items: { type: "string" }
              },
              ejemplo: { type: "string" },
              actividad: { type: "string" }
            },
            required: ["titulo", "introduccion", "puntos", "ejemplo", "actividad"],
            additionalProperties: false
          }
        }
      }
    });

    const data = JSON.parse(response.output_text);
    res.json({ ok: true, clase: data });

  } catch (error) {
    console.error("Error generando clase:", error);
    res.status(500).json({ ok: false, error: "No se pudo generar la clase" });
  }
});

app.listen(3000, () => {
  console.log("Servidor corriendo en http://localhost:3000");
});
