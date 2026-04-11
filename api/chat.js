import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Método no permitido" });
    }

    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Falta el prompt" });
    }

    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "Sos un profesor virtual claro, útil y didáctico.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const texto = completion.choices?.[0]?.message?.content || "Sin respuesta";

    res.status(200).json({ result: texto });
  } catch (error) {
    console.error("ERROR OPENAI:", error);
    res.status(500).json({
      error: "Error interno del servidor",
      detalle: error.message,
    });
  }
}
