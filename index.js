import express from "express";
import dotenv from "dotenv";
import OpenAI from "openai";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ruta de prueba
app.get("/", (req, res) => {
  res.send("Backend de Eduvia funcionando");
});

// ruta para generar la clase
app.post("/api/generar-clase", async (req, res) => {
  try {
    const { materia, tema, nivel, duracion, objetivo } = req.body || {};

    if (!materia || !tema || !nivel) {
      return res.status(400).json({
        ok: false,
        error: "Faltan materia, tema o nivel.",
      });
    }

    const prompt = `
Sos un profesor claro, didáctico y visual de Eduvia.

Generá una clase breve para mostrar en un pizarrón digital.
Adaptá el lenguaje al nivel del alumno.

Datos:
- Materia: ${materia}
- Tema: ${tema}
- Nivel: ${nivel}
- Duración: ${duracion || "No especificada"}
- Objetivo: ${objetivo || "No especificado"}

Respondé SOLO en JSON válido con esta estructura:
{
  "titulo": "string",
  "introduccion": "string",
  "puntos": ["string", "string", "string"],
  "ejemplo": "string",
  "actividad": "string"
}

Reglas:
- Explicación clara y pedagógica.
- Nada de markdown.
- Nada de texto fuera del JSON.
- Los puntos tienen que ser concretos.
`;

    const response = await client.responses.create({
      model: "gpt-5.4",
      input: prompt,
    });

    const rawText = response.output_text;

    let clase;
    try {
      clase = JSON.parse(rawText);
    } catch (parseError) {
      console.error("La respuesta no vino en JSON válido:", rawText);
      return res.status(500).json({
        ok: false,
        error: "La IA devolvió un formato inválido.",
      });
    }

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
