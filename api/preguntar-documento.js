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
    const raw = String(value || "").trim();

    if (!raw) return "";

    const url = new URL(raw);
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

  if (preguntaLimpia.includes("resum") || preguntaLimpia.includes("acort")) {
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

function stripHtml(html = "") {
  return String(html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectarPedidoGenerativo(pregunta = "", accion = "") {
  const accionLimpia = limpiarTexto(accion).toLowerCase();
  const texto = limpiarTexto(pregunta).toLowerCase();

  const accionesGenerativas = new Set([
    "explicar",
    "mejorar",
    "alargar",
    "acortar",
    "claro",
    "formal",
    "resumir",
    "reescribir",
    "reescritura",
    "ampliar",
    "expandir",
    "profundizar",
    "generar",
  ]);

  if (accionesGenerativas.has(accionLimpia)) return true;

  const patrones = [
    /\bhaceme\b/,
    /\bhazme\b/,
    /\bgener(a|ame|ame una|ame un)\b/,
    /\bescrib(i|ime)\b/,
    /\bcre(a|ame)\b/,
    /\barm(a|ame)\b/,
    /\bdesarroll(a|ame)\b/,
    /\bintroducci[oó]n\b/,
    /\bconclusi[oó]n\b/,
    /\bresumen\b/,
    /\bexplic(a|ame|alo|arlo)\b/,
    /\bdesarrollo\b/,
    /\bp[aá]rrafo\b/,
    /\bampli(a|ame|arlo)\b/,
    /\bprofundiz(a|ame|arlo)\b/,
    /\breescrib(i|ime|ilo|irlo)\b/,
    /\breformul(a|ame|arlo)\b/,
    /\bmejor(a|ame|arlo)\b/,
  ];

  return patrones.some((regex) => regex.test(texto));
}

function respuestaIndicaFaltaDeContexto(texto = "") {
  const t = limpiarTexto(texto).toLowerCase();

  if (!t) return false;

  return [
    "no tengo suficiente información",
    "no tengo suficiente informacion",
    "no cuento con suficiente información",
    "no cuento con suficiente informacion",
    "no hay suficiente información",
    "no hay suficiente informacion",
    "no hay contenido del documento",
    "falta contexto",
    "no dispongo de suficiente contexto",
    "no puedo responder con el contenido disponible",
    "no hay contenido suficiente",
    "necesito más información",
    "necesito mas informacion",
  ].some((frase) => t.includes(frase));
}

function obtenerBaseUrl(req) {
  const forwardedProto = limpiarTexto(req.headers["x-forwarded-proto"]);
  const forwardedHost = limpiarTexto(req.headers["x-forwarded-host"]);
  const host = forwardedHost || limpiarTexto(req.headers.host);

  const protocol =
    forwardedProto ||
    (host.includes("localhost") || host.startsWith("127.0.0.1") ? "http" : "https");

  if (!host) {
    return "http://localhost:3000";
  }

  return `${protocol}://${host}`;
}

function construirPayloadGenerador({
  pregunta,
  documentoActual,
  tituloDocumento,
  objetivoDocumento,
  textoSeleccionado,
  investigacion,
  fuentes,
}) {
  const tema = limpiarTexto(textoSeleccionado || tituloDocumento || pregunta || "Tema general");
  const contenidoBase = limpiarTexto(
    [textoSeleccionado, documentoActual].filter(Boolean).join("\n\n")
  );

  return {
    materia: limpiarTexto(tituloDocumento || "Documento"),
    tema,
    nivel: "general",
    objetivo:
      limpiarTexto(objetivoDocumento) ||
      `Generar contenido útil para este pedido del usuario: ${limpiarTexto(pregunta)}`,
    investigacion: limpiarTexto(investigacion),
    fuentes: limpiarFuentes(fuentes),
    contenidoBase,
    sourceMode: "general",
    sourceLinks: [],
  };
}

async function llamarGeneradorDocumento(req, payload) {
  const baseUrl = obtenerBaseUrl(req);

  const response = await fetch(`${baseUrl}/api/generar-documento`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      cookie: req.headers.cookie || "",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok || !data?.ok) {
    throw new Error(
      data?.detail || data?.error || "No se pudo obtener contexto desde generar-documento."
    );
  }

  return data;
}

async function generarRespuestaIA({
  preguntaLimpia,
  accionLimpia,
  documentoLimpio,
  tituloLimpio,
  objetivoLimpio,
  seleccionadoLimpio,
  investigacionLimpia,
  fuentesLimpias,
  ultimaRespuesta,
  contextoGenerado = "",
  documentoDeApoyo = "",
  pedidoGenerativo = false,
}) {
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
- Si el usuario pregunta sobre el documento, priorizá el documento actual.
- Si hay texto seleccionado, priorizalo por encima del resto del documento.
- Si hay objetivo del documento, tenelo en cuenta.
- Si hay investigación previa y fuentes, usalas para sostener mejor la respuesta.
- Si el usuario pide generar contenido nuevo y el documento actual no alcanza, podés apoyarte en la investigación previa, las fuentes y el contexto generado.
- No inventes hechos específicos si no están respaldados por el documento, la investigación o las fuentes.
- No reescribas todo el documento salvo que el usuario lo pida.
- Cuando propongas cambios, que sean accionables.
- "textoPropuesto" debe ser realmente usable cuando la acción implique modificar o generar texto.
- Si el pedido es generativo, intentá devolver un "textoPropuesto" útil siempre que haya contexto suficiente.
- Devolvé SOLO JSON válido.

Interpretación de pedidos:
- Si pregunta algo sobre el contenido => modo "respuesta".
- Si pide mejorar o corregir => modo "mejora".
- Si pide alargar o profundizar => modo "expansion".
- Si pide resumir o achicar => modo "resumen".
- Si pide reescribir una parte => modo "reescritura".

${construirInstruccionSegunAccion(accionLimpia)}

Contexto adicional:
- Pedido generativo detectado: ${pedidoGenerativo ? "sí" : "no"}
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

CONTEXTO GENERADO DE APOYO:
${contextoGenerado || "No disponible."}

BORRADOR / DOCUMENTO DE APOYO GENERADO:
${documentoDeApoyo || "No disponible."}

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
    throw new Error("La IA no devolvió contenido.");
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (error) {
    console.error("JSON inválido devuelto por la IA:", rawText);
    throw new Error("La IA respondió con un formato inválido.");
  }

  return normalizarRespuesta(parsed, accionLimpia, preguntaLimpia);
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

    let documentoLimpio = limpiarTexto(documentoActual);
    const tituloLimpio = limpiarTexto(tituloDocumento);
    const objetivoLimpio = limpiarTexto(objetivoDocumento);
    const seleccionadoLimpio = limpiarTexto(textoSeleccionado);
    let investigacionLimpia = limpiarTexto(investigacion);
    let fuentesLimpias = limpiarFuentes(fuentes);

    if (!preguntaLimpia) {
      return res.status(400).json({
        ok: false,
        error: "Falta la pregunta del usuario.",
      });
    }

    const hayContextoDocumento = Boolean(documentoLimpio || seleccionadoLimpio);
    const hayContextoExtra = Boolean(
      tituloLimpio || objetivoLimpio || investigacionLimpia || fuentesLimpias.length
    );

    if (!hayContextoDocumento && !hayContextoExtra) {
      return res.status(400).json({
        ok: false,
        error: "No hay suficiente contexto para responder o generar contenido.",
      });
    }

    const pedidoGenerativo = detectarPedidoGenerativo(preguntaLimpia, accionLimpia);

    let contextoGenerado = "";
    let documentoDeApoyo = "";

    const necesitaEnriquecerAntes =
      pedidoGenerativo && (!hayContextoDocumento || !investigacionLimpia);

    if (necesitaEnriquecerAntes) {
      try {
        const dataGenerador = await llamarGeneradorDocumento(
          req,
          construirPayloadGenerador({
            pregunta: preguntaLimpia,
            documentoActual: documentoLimpio,
            tituloDocumento: tituloLimpio,
            objetivoDocumento: objetivoLimpio,
            textoSeleccionado: seleccionadoLimpio,
            investigacion: investigacionLimpia,
            fuentes: fuentesLimpias,
          })
        );

        contextoGenerado = limpiarTexto(dataGenerador?.investigacion || "");
        documentoDeApoyo = stripHtml(dataGenerador?.documento?.contenidoHtml || "");

        if (!investigacionLimpia && contextoGenerado) {
          investigacionLimpia = contextoGenerado;
        }

        if ((!fuentesLimpias || !fuentesLimpias.length) && Array.isArray(dataGenerador?.fuentes)) {
          fuentesLimpias = limpiarFuentes(dataGenerador.fuentes);
        }

        if (!documentoLimpio && documentoDeApoyo) {
          documentoLimpio = documentoDeApoyo;
        }
      } catch (error) {
        console.error("No se pudo enriquecer contexto antes de responder:", error);
      }
    }

    let respuesta = await generarRespuestaIA({
      preguntaLimpia,
      accionLimpia,
      documentoLimpio,
      tituloLimpio,
      objetivoLimpio,
      seleccionadoLimpio,
      investigacionLimpia,
      fuentesLimpias,
      ultimaRespuesta,
      contextoGenerado,
      documentoDeApoyo,
      pedidoGenerativo,
    });

    const textoEvaluable = [
      respuesta?.respuesta?.resumen || "",
      respuesta?.respuesta?.textoPropuesto || "",
    ]
      .join("\n")
      .trim();

    const necesitaFallback =
      pedidoGenerativo &&
      respuestaIndicaFaltaDeContexto(textoEvaluable) &&
      (hayContextoExtra || hayContextoDocumento) &&
      !contextoGenerado;

    if (necesitaFallback) {
      try {
        const dataGenerador = await llamarGeneradorDocumento(
          req,
          construirPayloadGenerador({
            pregunta: preguntaLimpia,
            documentoActual: documentoLimpio,
            tituloDocumento: tituloLimpio,
            objetivoDocumento: objetivoLimpio,
            textoSeleccionado: seleccionadoLimpio,
            investigacion: investigacionLimpia,
            fuentes: fuentesLimpias,
          })
        );

        contextoGenerado = limpiarTexto(dataGenerador?.investigacion || "");
        documentoDeApoyo = stripHtml(dataGenerador?.documento?.contenidoHtml || "");

        if (!investigacionLimpia && contextoGenerado) {
          investigacionLimpia = contextoGenerado;
        }

        if ((!fuentesLimpias || !fuentesLimpias.length) && Array.isArray(dataGenerador?.fuentes)) {
          fuentesLimpias = limpiarFuentes(dataGenerador.fuentes);
        }

        respuesta = await generarRespuestaIA({
          preguntaLimpia,
          accionLimpia,
          documentoLimpio,
          tituloLimpio,
          objetivoLimpio,
          seleccionadoLimpio,
          investigacionLimpia,
          fuentesLimpias,
          ultimaRespuesta,
          contextoGenerado,
          documentoDeApoyo,
          pedidoGenerativo,
        });
      } catch (error) {
        console.error("Falló el fallback con generar-documento:", error);
      }
    }

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
