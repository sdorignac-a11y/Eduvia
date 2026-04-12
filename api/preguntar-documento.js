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

function normalizarModo(modo = "", accion = "", pregunta = "") {
  const modoLimpio = limpiarTexto(modo).toLowerCase();
  const accionLimpia = limpiarTexto(accion).toLowerCase();
  const preguntaLimpia = limpiarTexto(pregunta).toLowerCase();

  const validos = ["respuesta", "mejora", "expansion", "resumen", "reescritura"];
  if (validos.includes(modoLimpio)) return modoLimpio;

  if (["alargar", "expandir", "profundizar", "ampliar"].includes(accionLimpia)) {
    return "expansion";
  }

  if (["acortar", "resumir"].includes(accionLimpia)) {
    return "resumen";
  }

  if (["formal", "claro", "mejorar"].includes(accionLimpia)) {
    return "mejora";
  }

  if (["reescribir", "reescritura"].includes(accionLimpia)) {
    return "reescritura";
  }

  if (
    preguntaLimpia.includes("alarg") ||
    preguntaLimpia.includes("ampli") ||
    preguntaLimpia.includes("profund")
  ) {
    return "expansion";
  }

  if (
    preguntaLimpia.includes("resum") ||
    preguntaLimpia.includes("acort")
  ) {
    return "resumen";
  }

  if (
    preguntaLimpia.includes("reescrib") ||
    preguntaLimpia.includes("reformular")
  ) {
    return "reescritura";
  }

  if (
    preguntaLimpia.includes("mejor") ||
    preguntaLimpia.includes("más claro") ||
    preguntaLimpia.includes("mas claro") ||
    preguntaLimpia.includes("más formal") ||
    preguntaLimpia.includes("mas formal")
  ) {
    return "mejora";
  }

  return "respuesta";
}

function normalizarRespuesta(parsed = {}, accion = "", pregunta = "") {
  const subtitulo = limpiarTexto(parsed.subtitulo) || "Asistente del documento";
  const respuestaRaw =
    parsed.respuesta && typeof parsed.respuesta === "object" ? parsed.respuesta : {};

  const modo = normalizarModo(respuestaRaw.modo, accion, pregunta);

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

function construirInstruccionSegunAccion(accion = "") {
  const a = limpiarTexto(accion).toLowerCase();

  switch (a) {
    case "explicar":
      return `
Acción elegida: EXPLICAR.
- Explicá mejor el fragmento seleccionado.
- Priorizá claridad, contexto y facilidad de estudio.
- Si ayuda, incluí una versión mejor explicada en "textoPropuesto".
      `.trim();

    case "mejorar":
      return `
Acción elegida: MEJORAR.
- Mejorá la redacción sin cambiar la idea central.
- Hacelo más natural, fluido y prolijo.
- Devolvé un "textoPropuesto" mejorado.
      `.trim();

    case "alargar":
      return `
Acción elegida: ALARGAR.
- Expandí el fragmento con contenido útil.
- Agregá desarrollo real, no relleno.
- Devolvé un "textoPropuesto" más completo.
      `.trim();

    case "acortar":
      return `
Acción elegida: ACORTAR.
- Reducí el fragmento manteniendo la idea principal.
- Eliminá repeticiones y exceso.
- Devolvé un "textoPropuesto" más breve y claro.
      `.trim();

    case "claro":
      return `
Acción elegida: MÁS CLARO.
- Reescribí el fragmento para que sea más simple y fácil de entender.
- Pensá en alguien que está estudiando.
- Devolvé un "textoPropuesto" más claro.
      `.trim();

    case "formal":
      return `
Acción elegida: MÁS FORMAL.
- Reescribí el fragmento con tono más académico y prolijo.
- Sin volverlo rígido ni artificial.
- Devolvé un "textoPropuesto" más formal.
      `.trim();

    case "resumir":
      return `
Acción elegida: RESUMIR.
- Resumí el fragmento conservando lo esencial.
- Hacelo más directo.
- Devolvé un "textoPropuesto" resumido.
      `.trim();

    default:
      return `
Acción general.
- Respondé según el pedido del usuario.
- Si corresponde, proponé un nuevo texto en "textoPropuesto".
      `.trim();
  }
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
      accion = "",
      documentoActual = "",
      tituloDocumento = "",
      objetivoDocumento = "",
      textoSeleccionado = "",
      investigacion = "",
      fuentes = [],
      ultimaRespuesta = null,
    } = req.body || {};

    const preguntaLimpia = limpiarTexto(pregunta);
    const accionLimpia = limpiarTexto(accion);
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
- No hables como chat casual.
- No inventes contenido fuera del documento salvo que el usuario te pida explícitamente ampliarlo.
- Si el usuario pide alargar, expandí con contenido útil, no con relleno.
- Si el usuario pide acortar, conservá la idea central.
- Si el usuario pide mejorar estilo, hacelo más claro y natural.
- Si hay texto seleccionado, priorizalo por encima del resto del documento.
- Si hay objetivo del documento, tenelo en cuenta.
- Si hay investigación previa y fuentes, usalas para sostener mejor la respuesta.
- No reescribas todo el documento salvo que el usuario lo pida.
- Cuando propongas cambios, que sean accionables.
- "textoPropuesto" debe ser realmente usable cuando la acción implique modificar el texto.
- Devolvé SOLO JSON válido.

Interpretación de pedidos:
- Si pregunta algo sobre el contenido => modo "respuesta".
- Si pide mejorar o corregir => modo "mejora".
- Si pide alargar o profundizar => modo "expansion".
- Si pide resumir o achicar => modo "resumen".
- Si pide reescribir una parte => modo "reescritura".

${construirInstruccionSegunAccion(accionLimpia)}

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

    const respuesta = normalizarRespuesta(parsed, accionLimpia, preguntaLimpia);

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
