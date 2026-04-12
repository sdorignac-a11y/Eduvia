import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const RESPUESTA_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    subtitulo: { type: "string" },
    respuesta: {
      type: "object",
      additionalProperties: false,
      properties: {
        titulo: { type: "string" },
        modo: {
          type: "string",
          enum: ["respuesta", "mejora", "expansion", "resumen", "reescritura"],
        },
        resumen: { type: "string" },
        cambios: {
          type: "array",
          maxItems: 6,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              tipo: {
                type: "string",
                enum: [
                  "agregar",
                  "aclarar",
                  "recortar",
                  "corregir",
                  "reordenar",
                  "mejorar_estilo",
                ],
              },
              titulo: { type: "string" },
              detalle: { type: "string" },
              ejemplo: { type: "string" },
            },
            required: ["tipo", "titulo", "detalle", "ejemplo"],
          },
        },
        textoPropuesto: { type: "string" },
        preguntasSeguimiento: {
          type: "array",
          maxItems: 4,
          items: { type: "string" },
        },
      },
      required: [
        "titulo",
        "modo",
        "resumen",
        "cambios",
        "textoPropuesto",
        "preguntasSeguimiento",
      ],
    },
  },
  required: ["subtitulo", "respuesta"],
};

function limpiarTexto(value = "") {
  return String(value || "").trim();
}

function limpiarLista(value, max = 6) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => limpiarTexto(item))
    .filter(Boolean)
    .slice(0, max);
}

function sanitizeUrl(value = "") {
  try {
    const url = new URL(String(value), "https://example.com");
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.href;
    }
    return "";
  } catch {
    return "";
  }
}

function limpiarFuentes(value) {
  if (!Array.isArray(value)) return [];

  const seen = new Set();

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      const titulo = limpiarTexto(item.title || item.titulo || item.name || "Fuente");
      const url = sanitizeUrl(item.url || item.link || "");
      const key = `${titulo}|${url}`;

      if (!titulo && !url) return null;
      if (seen.has(key)) return null;

      seen.add(key);

      return {
        title: titulo || "Fuente",
        url,
      };
    })
    .filter(Boolean)
    .slice(0, 10);
}

function construirTextoFuentes(fuentes = []) {
  if (!fuentes.length) return "No hay fuentes disponibles.";

  return fuentes
    .map((fuente, index) => {
      const titulo = limpiarTexto(fuente.title || "Fuente");
      const url = limpiarTexto(fuente.url || "");
      return `${index + 1}. ${titulo}${url ? ` — ${url}` : ""}`;
    })
    .join("\n");
}

function extraerOutputText(response) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const partes = [];

  for (const item of response?.output || []) {
    if (!item || item.type !== "message") continue;

    for (const content of item.content || []) {
      if (content?.type === "output_text" && content.text) {
        partes.push(content.text);
      }
    }
  }

  return partes.join("\n").trim();
}

function normalizarCambios(value) {
  if (!Array.isArray(value)) return [];

  const tiposValidos = [
    "agregar",
    "aclarar",
    "recortar",
    "corregir",
    "reordenar",
    "mejorar_estilo",
  ];

  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;

      const tipo = tiposValidos.includes(item.tipo) ? item.tipo : "mejorar_estilo";
      const titulo = limpiarTexto(item.titulo) || "Mejora sugerida";
      const detalle = limpiarTexto(item.detalle);
      const ejemplo = limpiarTexto(item.ejemplo);

      if (!detalle && !ejemplo) return null;

      return {
        tipo,
        titulo,
        detalle: detalle || "Conviene ajustar esta parte para que quede más clara.",
        ejemplo: ejemplo || "Podés reformular esta parte con mayor claridad.",
      };
    })
    .filter(Boolean)
    .slice(0, 6);
}

function normalizarRespuesta(parsed = {}) {
  const subtitulo = limpiarTexto(parsed.subtitulo) || "Asistente del documento";
  const respuestaRaw =
    parsed.respuesta && typeof parsed.respuesta === "object" ? parsed.respuesta : {};

  const modosValidos = ["respuesta", "mejora", "expansion", "resumen", "reescritura"];
  const modo = modosValidos.includes(respuestaRaw.modo)
    ? respuestaRaw.modo
    : "respuesta";

  const titulo = limpiarTexto(respuestaRaw.titulo) || "Respuesta sobre el documento";
  const resumen =
    limpiarTexto(respuestaRaw.resumen) ||
    "Analicé el texto y preparé una respuesta útil para seguir mejorándolo.";

  const cambios = normalizarCambios(respuestaRaw.cambios);
  const textoPropuesto = limpiarTexto(respuestaRaw.textoPropuesto);
  const preguntasSeguimiento = limpiarLista(respuestaRaw.preguntasSeguimiento, 4);

  return {
    subtitulo,
    respuesta: {
      titulo,
      modo,
      resumen,
      cambios,
      textoPropuesto,
      preguntasSeguimiento,
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
      documentoActual = "",
      tituloDocumento = "",
      objetivoDocumento = "",
      textoSeleccionado = "",
      investigacion = "",
      fuentes = [],
      ultimaRespuesta = null,
    } = req.body || {};

    const preguntaLimpia = limpiarTexto(pregunta);
    const documentoLimpio = limpiarTexto(documentoActual);
    const tituloLimpio = limpiarTexto(tituloDocumento);
    const objetivoLimpio = limpiarTexto(objetivoDocumento);
    const seleccionadoLimpio = limpiarTexto(textoSeleccionado);
    const investigacionLimpia = limpiarTexto(investigacion);
    const fuentesLimpias = limpiarFuentes(fuentes);

    if (!preguntaLimpia) {
      return res.status(400).json({
        ok: false,
        error: "Falta la pregunta del usuario.",
      });
    }

    if (!documentoLimpio && !seleccionadoLimpio) {
      return res.status(400).json({
        ok: false,
        error: "No hay contenido del documento para analizar.",
      });
    }

    const response = await client.responses.create({
      model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
      input: [
        {
          role: "developer",
          content: `
Sos el asistente editorial de Eduvia dentro de documento.html.

Tu trabajo:
- responder preguntas sobre el documento,
- detectar partes flojas, cortas, confusas, repetitivas o mejorables,
- sugerir cambios concretos,
- proponer una nueva versión de un fragmento cuando haga falta.

Reglas:
- Respondé en español rioplatense neutro.
- Sé claro, didáctico y útil.
- No hables como un chat casual.
- No inventes contenido fuera del documento salvo que el usuario te pida explícitamente ampliarlo.
- Si el usuario pide alargar, expandí con contenido útil, no con relleno.
- Si el usuario pide acortar, conservá la idea central.
- Si el usuario pide mejorar estilo, hacelo más claro y natural.
- Si hay texto seleccionado, priorizalo por encima del resto del documento.
- Si hay objetivo del documento, tenelo en cuenta.
- Si hay investigación previa y fuentes, usalas para sostener mejor la respuesta.
- No reescribas todo el documento salvo que el usuario lo pida.
- Cuando propongas cambios, que sean accionables.
- Devolvé SOLO JSON válido.

Interpretación de pedidos:
- Si pregunta algo sobre el contenido => modo "respuesta".
- Si pide mejorar o corregir => modo "mejora".
- Si pide alargar o profundizar => modo "expansion".
- Si pide resumir o achicar => modo "resumen".
- Si pide reescribir una parte => modo "reescritura".

Formato:
- subtitulo: etiqueta breve.
- respuesta.titulo: encabezado principal.
- respuesta.modo: uno de los modos válidos.
- respuesta.resumen: explicación principal.
- respuesta.cambios: lista concreta de sugerencias.
- respuesta.textoPropuesto: texto nuevo o reformulado cuando aporte valor real.
- respuesta.preguntasSeguimiento: preguntas cortas para seguir mejorando el documento.
          `.trim(),
        },
        {
          role: "user",
          content: `
TÍTULO DEL DOCUMENTO:
${tituloLimpio || "Sin título"}

OBJETIVO DEL DOCUMENTO:
${objetivoLimpio || "No especificado."}

TEXTO SELECCIONADO:
${seleccionadoLimpio || "No hay texto seleccionado."}

DOCUMENTO COMPLETO:
${documentoLimpio || "No disponible."}

INVESTIGACIÓN PREVIA:
${investigacionLimpia || "No disponible."}

FUENTES:
${construirTextoFuentes(fuentesLimpias)}

ÚLTIMA RESPUESTA DEL ASISTENTE:
${JSON.stringify(ultimaRespuesta || {}, null, 2)}

PEDIDO DEL USUARIO:
${preguntaLimpia}
          `.trim(),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "respuesta_documento_eduvia",
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
    console.error("Error en /api/preguntar-documento:", error);

    return res.status(500).json({
      ok: false,
      error: "No se pudo analizar el documento.",
    });
  }
}
