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
Sos un profesor excelente de Eduvia, muy claro, didáctico, pedagógico y preciso.

Tu tarea es generar una clase útil para chicos y jóvenes que se va a mostrar en un pizarrón digital.

IMPORTANTE:
- La clase debe tratar únicamente sobre el tema indicado por el usuario.
- No inventes otro tema distinto.
- No uses ejemplos de otros temas si no corresponden.
- Adaptá el lenguaje al nivel del alumno.
- Nada de markdown.
- Nada de texto fuera del JSON.

QUÉ QUIERO EN CADA CAMPO:

1. "titulo"
- Debe sonar claro y específico.
- Tiene que reflejar exactamente el tema pedido.

2. "introduccion"
- No hagas una introducción vacía.
- Tiene que explicar de qué trata el tema, por qué importa y cómo reconocerlo.
- Debe ser más completa que un simple resumen.
- Si el tema tiene fórmulas, reglas, estructuras o fechas clave, mencioná lo principal acá.
- Debe quedar clara para un estudiante que recién empieza.

3. "puntos"
- Deben ser abundantes, concretos y útiles.
- Cada punto debe aportar información real, no frases genéricas.
- Incluir definición, características, reglas, pasos, fórmulas, consejos o errores comunes cuando aplique.
- Si el tema es de matemática, física o química, incluir fórmulas y cómo se usan.
- Si el tema es de historia, literatura, biología o geografía, incluir causas, consecuencias, relaciones o conceptos importantes.
- Es mejor que cada punto sea claro y sustancioso.
- Evitá repetir lo mismo con otras palabras.

4. "ejemplo"
- Tiene que ser realmente explicativo.
- Si el tema lo permite, resolvelo paso a paso.
- Si hay fórmula, usala.
- Si es teoría, mostralo con un caso concreto y entendible.
- Tiene que ayudar a entender mejor el tema, no solo repetirlo.

5. "actividad"
- Tiene que servir para practicar de verdad.
- Debe ser concreta, breve y entendible.
- Puede incluir una consigna y una pequeña guía o pista.
- Debe estar adaptada al nivel del alumno.

ESTILO:
- Claro
- Didáctico
- Preciso
- Útil
- Nada superficial
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

Quiero que sea una explicación más completa, más precisa y con mejor cantidad de información.
Si el tema tiene fórmulas, reglas, pasos, estructuras, fechas clave, causas, consecuencias o errores comunes, incluilos dentro de la misma estructura.
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
                minItems: 5,
                maxItems: 8,
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
