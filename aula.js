const board = document.getElementById("board-content");

if (!board) {
  throw new Error('No se encontró el contenedor #board-content en aula.html');
}

const chatPanel = document.getElementById("chat-panel");
const toggleChatBtn = document.getElementById("toggle-chat-btn");
const closeChatBtn = document.getElementById("chat-close-btn");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const chatStatus = document.getElementById("chat-status");
const chatSendBtn = document.getElementById("chat-send-btn");

const FETCH_TIMEOUT_MS = 30000;

let claseGuardadaActual = null;
let claseGeneradaActual = null;
let ultimaRespuestaChat = null;
let fuentesClaseActual = [];
let investigacionClaseActual = "";

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function encodeAttr(value = "") {
  return escapeHtml(String(value));
}

function decodeStoredHtml(value = "") {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function renderError(message) {
  board.innerHTML = `
    <div class="board-error">
      ${escapeHtml(message)}
    </div>
  `;
}

function updateChatStatus(message) {
  if (chatStatus) {
    chatStatus.textContent = String(message || "");
  }
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchConTimeout(url, options = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

function normalizarLista(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function dedupeLista(items = []) {
  const seen = new Set();
  const result = [];

  for (const item of items) {
    const key = String(item || "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(String(item).trim());
  }

  return result;
}

function normalizarFormulas(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (!item) return null;

      if (typeof item === "string") {
        const texto = item.trim();
        if (!texto) return null;
        return {
          nombre: "",
          formula: texto,
          explicacion: "",
        };
      }

      const nombre = String(item.nombre || "").trim();
      const formula = String(item.formula || "").trim();
      const explicacion = String(item.explicacion || "").trim();

      if (!nombre && !formula && !explicacion) return null;

      return {
        nombre,
        formula,
        explicacion,
      };
    })
    .filter(Boolean);
}

function normalizarSecciones(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((section) => {
      const titulo = String(section?.titulo || "").trim();
      const texto = String(section?.texto || "").trim();
      const bullets = dedupeLista(normalizarLista(section?.bullets));

      if (!titulo && !texto && !bullets.length) return null;

      return {
        titulo: titulo || "Tema importante",
        texto,
        bullets,
      };
    })
    .filter(Boolean);
}

function normalizarVisuales(value) {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      const titulo = String(item?.titulo || "").trim();
      const lineas = dedupeLista(normalizarLista(item?.lineas)).slice(0, 4);
      const caption = String(item?.caption || "").trim();
      const estilo = ["blue", "green", "yellow", "red"].includes(item?.estilo || item?.color)
        ? (item.estilo || item.color)
        : "blue";

      if (!titulo && !lineas.length && !caption) return null;

      return {
        titulo: titulo || "Apoyo visual",
        lineas: lineas.length ? lineas : ["Idea importante", "Repasala antes de la prueba"],
        caption: caption || "Apoyo visual del tema",
        estilo,
      };
    })
    .filter(Boolean);
}

function normalizarFormulasComoBullets(formulas = []) {
  return formulas.map((formula) => {
    const nombre = formula.nombre ? `${formula.nombre}: ` : "";
    const formulaTxt = formula.formula || "";
    const explicacion = formula.explicacion ? ` — ${formula.explicacion}` : "";
    return `${nombre}${formulaTxt}${explicacion}`.trim();
  });
}

function fallbackSecciones(raw = {}) {
  const secciones = [];

  const resumenBase = String(raw.resumen || raw.introduccion || "").trim();
  const ideaPrincipal = String(raw.ideaPrincipal || "").trim();
  const ejemplo = String(raw.ejemplo || "").trim();
  const actividad = String(raw.actividad || "").trim();

  const formulas = normalizarFormulas(raw.formulas);
  const puntos = dedupeLista(normalizarLista(raw.puntos));
  const pasos = dedupeLista(normalizarLista(raw.pasos));
  const tips = dedupeLista(normalizarLista(raw.tips));
  const errores = dedupeLista(normalizarLista(raw.errores));

  if (resumenBase) {
    secciones.push({
      titulo: "Resumen general",
      texto: resumenBase,
      bullets: [],
    });
  }

  if (ideaPrincipal) {
    secciones.push({
      titulo: "Idea principal",
      texto: ideaPrincipal,
      bullets: [],
    });
  }

  if (formulas.length) {
    secciones.push({
      titulo: "Fórmulas clave",
      texto: "Estas fórmulas o reglas ayudan a resolver y reconocer mejor el tema.",
      bullets: normalizarFormulasComoBullets(formulas),
    });
  }

  if (pasos.length) {
    secciones.push({
      titulo: "Cómo pensarlo",
      texto: "Seguí este orden para entender o resolver mejor el tema.",
      bullets: pasos,
    });
  }

  if (puntos.length) {
    secciones.push({
      titulo: "Puntos clave",
      texto: "Estas son las ideas más importantes para estudiar.",
      bullets: puntos,
    });
  }

  if (tips.length) {
    secciones.push({
      titulo: "Tips rápidos",
      texto: "Estos consejos te ayudan a recordar y aplicar mejor el contenido.",
      bullets: tips,
    });
  }

  if (errores.length) {
    secciones.push({
      titulo: "Errores comunes",
      texto: "Prestá atención a estas confusiones frecuentes.",
      bullets: errores,
    });
  }

  if (ejemplo) {
    secciones.push({
      titulo: "Ejemplo",
      texto: ejemplo,
      bullets: [],
    });
  }

  if (actividad) {
    secciones.push({
      titulo: "Actividad",
      texto: actividad,
      bullets: [],
    });
  }

  if (!secciones.length) {
    secciones.push({
      titulo: "Resumen general",
      texto: "No se pudo construir el contenido completo de esta clase.",
      bullets: [],
    });
  }

  return secciones;
}

function fallbackCardsDerecha(clase = {}) {
  const resumenLineas = dedupeLista([
    ...partirEnLineas(clase.resumen || "", 26, 3),
    ...(clase.palabrasClave || []).slice(0, 2),
  ]).slice(0, 4);

  const card1 = {
    titulo: "Idea central",
    lineas: resumenLineas.length ? resumenLineas : ["Repasá el eje principal del tema."],
    caption: "Lo más importante para recordar",
    estilo: "blue",
  };

  const card2 = {
    titulo: clase.secciones[1]?.titulo || "Claves",
    lineas: clase.secciones[1]?.bullets?.slice(0, 4)
      || clase.secciones[0]?.bullets?.slice(0, 4)
      || ["Buscá relaciones", "Prestá atención a las reglas", "Volvé al ejemplo"],
    caption: "Puntos útiles para estudiar mejor",
    estilo: "green",
  };

  const card3 = {
    titulo: "Para la prueba",
    lineas: dedupeLista([
      ...(clase.palabrasClave || []).slice(0, 2),
      "Marcá conceptos clave",
      "Repasá antes de practicar",
    ]).slice(0, 4),
    caption: "Checklist rápido de repaso",
    estilo: "yellow",
  };

  return [card1, card2, card3];
}

function fallbackImagenesContenido(clase = {}) {
  const visuales = [];

  for (let i = 0; i < clase.secciones.length; i += 2) {
    const seccion = clase.secciones[i];
    if (!seccion) continue;

    const lineas = seccion.bullets.length
      ? seccion.bullets.slice(0, 4)
      : partirEnLineas(seccion.texto || "", 24, 3);

    visuales.push({
      titulo: seccion.titulo,
      lineas: lineas.length ? lineas : ["Idea importante del tema"],
      caption: "Apoyo visual para reforzar esta parte",
      estilo: i % 4 === 0 ? "blue" : i % 4 === 2 ? "green" : "yellow",
    });
  }

  return visuales.slice(0, 3);
}

function partirEnLineas(text = "", maxChars = 22, maxLineas = 4) {
  const palabras = String(text || "").split(/\s+/).filter(Boolean);
  const lineas = [];
  let actual = "";

  for (const palabra of palabras) {
    const candidato = actual ? `${actual} ${palabra}` : palabra;

    if (candidato.length <= maxChars) {
      actual = candidato;
    } else {
      if (actual) lineas.push(actual);
      actual = palabra;
    }
  }

  if (actual) lineas.push(actual);

  return lineas.slice(0, maxLineas);
}

function normalizarClase(raw = {}) {
  const titulo = String(raw.titulo || "Clase generada").trim();
  const resumen = String(raw.resumen || raw.introduccion || "").trim();

  const palabrasClave = dedupeLista(normalizarLista(raw.palabrasClave));
  const secciones = normalizarSecciones(raw.secciones);
  const cardsDerecha = normalizarVisuales(raw.cardsDerecha);
  const imagenesContenido = normalizarVisuales(raw.imagenesContenido);

  const clase = {
    titulo: titulo || "Clase generada",
    resumen: resumen || "Resumen no disponible.",
    palabrasClave,
    secciones: secciones.length ? secciones : fallbackSecciones(raw),
    cardsDerecha,
    imagenesContenido,
  };

  if (!clase.cardsDerecha.length) {
    clase.cardsDerecha = fallbackCardsDerecha(clase);
  }

  if (!clase.imagenesContenido.length) {
    clase.imagenesContenido = fallbackImagenesContenido(clase);
  }

  if (!clase.palabrasClave.length) {
    clase.palabrasClave = dedupeLista([
      clase.titulo,
      ...clase.secciones.flatMap((section) => section.bullets.slice(0, 2)),
    ]).slice(0, 8);
  }

  return clase;
}

function highlightKeywords(text = "", keywords = []) {
  let html = escapeHtml(text);
  const cleanKeywords = dedupeLista(keywords)
    .filter((k) => k.length >= 3)
    .sort((a, b) => b.length - a.length);

  for (const keyword of cleanKeywords) {
    const safeKeyword = escapeHtml(keyword);
    const regex = new RegExp(escapeRegExp(safeKeyword), "gi");
    html = html.replace(regex, (match) => `<mark class="board-highlight">${match}</mark>`);
  }

  return html;
}

function buildTypedText(text = "", keywords = []) {
  const plain = String(text || "").trim();
  const html = highlightKeywords(plain, keywords);

  return {
    plain,
    html,
    htmlEncoded: encodeURIComponent(html),
  };
}

function typedParagraph(text = "", keywords = [], extraClass = "") {
  const data = buildTypedText(text, keywords);
  const classes = ["type-target", extraClass].filter(Boolean).join(" ");

  return `
    <p
      class="${classes}"
      data-plain="${encodeAttr(data.plain)}"
      data-final-html="${encodeAttr(data.htmlEncoded)}"
    >${escapeHtml(data.plain)}</p>
  `;
}

function typedList(items = [], keywords = []) {
  if (!items.length) return "";

  return `
    <ul class="board-list">
      ${items.map((item) => {
        const data = buildTypedText(item, keywords);

        return `
          <li
            class="type-target"
            data-plain="${encodeAttr(data.plain)}"
            data-final-html="${encodeAttr(data.htmlEncoded)}"
          >${escapeHtml(data.plain)}</li>
        `;
      }).join("")}
    </ul>
  `;
}

function crearPosterDataUri({ titulo, lineas, estilo = "blue", variant = "card" }) {
  const palette = {
    blue: {
      bg1: "#EEF5FF",
      bg2: "#DDEBFF",
      accent: "#355D95",
      soft: "#B9D9FF",
    },
    green: {
      bg1: "#F2FAF4",
      bg2: "#DDF3E4",
      accent: "#2F7D55",
      soft: "#B9E7B0",
    },
    yellow: {
      bg1: "#FFFDF2",
      bg2: "#FFF3C7",
      accent: "#9B7A17",
      soft: "#F5E89C",
    },
    red: {
      bg1: "#FFF5F7",
      bg2: "#FFDCE3",
      accent: "#9B4F5D",
      soft: "#F4AAA5",
    },
  };

  const p = palette[estilo] || palette.blue;
  const width = variant === "wide" ? 960 : 640;
  const height = variant === "wide" ? 360 : 460;
  const lineYStart = variant === "wide" ? 160 : 190;
  const lineGap = variant === "wide" ? 52 : 56;

  const safeTitle = escapeHtml(titulo);
  const safeLines = (lineas || []).map((line) => escapeHtml(line));

  const linesSvg = safeLines.map((line, index) => {
    const y = lineYStart + index * lineGap;
    return `<text x="56" y="${y}" font-size="${variant === "wide" ? 30 : 32}" font-family="Arial" font-weight="700" fill="#2F3A44">${line}</text>`;
  }).join("");

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">
      <defs>
        <linearGradient id="g" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="${p.bg1}"/>
          <stop offset="100%" stop-color="${p.bg2}"/>
        </linearGradient>
      </defs>

      <rect width="${width}" height="${height}" rx="32" fill="url(#g)"/>
      <circle cx="${width - 90}" cy="84" r="42" fill="${p.soft}" opacity=".85"/>
      <circle cx="${width - 150}" cy="${height - 70}" r="26" fill="${p.soft}" opacity=".55"/>
      <rect x="42" y="34" width="${variant === "wide" ? 280 : 240}" height="58" rx="29" fill="${p.soft}"/>
      <text x="${variant === "wide" ? 182 : 162}" y="71" text-anchor="middle" font-size="30" font-family="Arial" font-weight="700" fill="${p.accent}">
        ${safeTitle}
      </text>
      <line x1="56" y1="${variant === "wide" ? 118 : 136}" x2="${width - 56}" y2="${variant === "wide" ? 118 : 136}" stroke="${p.accent}" stroke-width="8" stroke-linecap="round" opacity=".26"/>
      ${linesSvg}
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function renderRightCard(card) {
  return `
    <figure class="visual-box visual-${escapeHtml(card.estilo)}">
      <img
        class="visual-img"
        src="${crearPosterDataUri({
          titulo: card.titulo,
          lineas: card.lineas,
          estilo: card.estilo,
          variant: "card",
        })}"
        alt="${escapeHtml(card.titulo)}"
      />
      <figcaption class="visual-caption">${escapeHtml(card.caption)}</figcaption>
    </figure>
  `;
}

function renderInlineVisual(visual) {
  return `
    <figure class="inline-visual inline-${escapeHtml(visual.estilo)}">
      <img
        class="inline-visual-img"
        src="${crearPosterDataUri({
          titulo: visual.titulo,
          lineas: visual.lineas,
          estilo: visual.estilo,
          variant: "wide",
        })}"
        alt="${escapeHtml(visual.titulo)}"
      />
      <figcaption class="inline-visual-caption">${escapeHtml(visual.caption)}</figcaption>
    </figure>
  `;
}

function renderSection(section, keywords = []) {
  return `
    <section class="board-section">
      <h2>${escapeHtml(section.titulo)}</h2>
      ${section.texto ? typedParagraph(section.texto, keywords) : ""}
      ${typedList(section.bullets, keywords)}
    </section>
  `;
}

function renderSeccionesConVisuales(secciones = [], imagenesContenido = [], keywords = []) {
  let html = "";

  secciones.forEach((section, index) => {
    html += renderSection(section, keywords);

    const visualIndex = Math.floor(index / 2);
    const insertarVisual = index % 2 === 1 && imagenesContenido[visualIndex];

    if (insertarVisual) {
      html += renderInlineVisual(imagenesContenido[visualIndex]);
    }
  });

  if (secciones.length === 1 && imagenesContenido[0]) {
    html += renderInlineVisual(imagenesContenido[0]);
  }

  return html;
}

async function escribirTextoConHTML(el, plainText, finalHtml, velocidad = 18) {
  if (!el) return;

  const texto = String(plainText || "");
  el.textContent = "";
  el.classList.add("is-typing");

  for (let i = 0; i < texto.length; i++) {
    el.textContent += texto[i];
    await wait(velocidad);
  }

  el.classList.remove("is-typing");
  el.innerHTML = finalHtml || escapeHtml(texto);
}

async function animarTargets(root) {
  const targets = root.querySelectorAll(".type-target");

  for (const target of targets) {
    const plain = target.dataset.plain || target.textContent || "";
    const finalHtml = decodeStoredHtml(target.dataset.finalHtml || "");
    await escribirTextoConHTML(target, plain, finalHtml, 14);
    await wait(60);
  }
}

async function mostrarBloque(el, delay = 180) {
  if (!el) return;
  el.classList.add("is-visible");
  await wait(delay);
}

async function animarClase() {
  if (board.dataset.animando === "true") return;
  board.dataset.animando = "true";

  const title = board.querySelector(".board-title");
  const badge = board.querySelector(".board-badge");
  const summaryBox = board.querySelector(".board-summary");
  const sections = [...board.querySelectorAll(".board-section")];
  const rightCards = [...board.querySelectorAll(".visual-box")];
  const inlineVisuals = [...board.querySelectorAll(".inline-visual")];

  if (title) {
    const text = title.textContent;
    await mostrarBloque(title, 120);
    await escribirTextoConHTML(title, text, escapeHtml(text), 22);
  }

  if (badge) {
    const text = badge.textContent;
    await mostrarBloque(badge, 100);
    await escribirTextoConHTML(badge, text, escapeHtml(text), 10);
  }

  if (summaryBox) {
    await mostrarBloque(summaryBox, 120);
    await animarTargets(summaryBox);
  }

  for (let i = 0; i < rightCards.length; i++) {
    await mostrarBloque(rightCards[i], 90);
  }

  let inlineIndex = 0;

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    await mostrarBloque(section, 110);
    await animarTargets(section);

    if (i % 2 === 1 && inlineVisuals[inlineIndex]) {
      await mostrarBloque(inlineVisuals[inlineIndex], 120);
      inlineIndex += 1;
    }
  }

  while (inlineIndex < inlineVisuals.length) {
    await mostrarBloque(inlineVisuals[inlineIndex], 120);
    inlineIndex += 1;
  }
}

function renderLeccion(clase, meta = {}, options = {}) {
  delete board.dataset.animando;

  const badgeText = options.badgeText
    || `${meta.materia || "Eduvia"} · ${meta.nivel || "Clase"}`;

  const extraTop = options.pregunta
    ? `
      <section class="board-section">
        <h2>Pregunta del alumno</h2>
        ${typedParagraph(options.pregunta, clase.palabrasClave)}
      </section>
    `
    : "";

  const extraBottom = options.temaRelacionado
    ? `
      <section class="board-section">
        <h2>Conectado con la clase actual</h2>
        ${typedParagraph(`Esta respuesta se relaciona con el tema: ${options.temaRelacionado}.`, clase.palabrasClave)}
      </section>
    `
    : "";

  board.innerHTML = `
    <div class="board-lesson">
      <div class="board-layout">
        <div class="board-main">
          <div class="board-head">
            <h1 class="board-title">${escapeHtml(clase.titulo)}</h1>
            <div class="board-badge">${escapeHtml(badgeText)}</div>
          </div>

          <section class="board-summary">
            ${typedParagraph(clase.resumen, clase.palabrasClave)}
          </section>

          ${extraTop}
          ${renderSeccionesConVisuales(clase.secciones, clase.imagenesContenido, clase.palabrasClave)}
          ${extraBottom}
        </div>

        <aside class="board-side">
          ${clase.cardsDerecha.map(renderRightCard).join("")}
        </aside>
      </div>
    </div>
  `;

  animarClase().catch((error) => {
    console.error("Error animando la clase:", error);
  });
}

function renderClase(claseRaw, meta = {}, extras = {}) {
  const clase = normalizarClase(claseRaw);

  claseGeneradaActual = {
    ...clase,
    fuentes: Array.isArray(extras.fuentes) ? extras.fuentes : [],
    investigacion: String(extras.investigacion || "").trim(),
  };

  ultimaRespuestaChat = null;

  renderLeccion(clase, meta);
}

function normalizarRespuestaChat(raw, pregunta = "") {
  if (typeof raw === "string") {
    return {
      subtitulo: "Duda respondida",
      clase: normalizarClase({
        titulo: `Respuesta sobre: ${pregunta || "tu duda"}`,
        resumen: raw,
        secciones: [
          {
            titulo: "Respuesta clara",
            texto: raw,
            bullets: [],
          },
          {
            titulo: "Próximo paso",
            texto: "Podés hacer otra pregunta desde el chat para seguir profundizando.",
            bullets: [],
          },
        ],
        palabrasClave: [pregunta],
      }),
    };
  }

  const data = raw && typeof raw === "object" ? raw : {};

  const subtitulo = String(data.subtitulo || "Duda respondida").trim();

  const claseCandidata = data.clase && typeof data.clase === "object"
    ? data.clase
    : {
        titulo: data.titulo || `Respuesta sobre: ${pregunta || "tu duda"}`,
        resumen:
          data.resumen
          || data.introduccion
          || data.explicacion
          || data.respuestaBreve
          || data.ideaPrincipal
          || "",
        palabrasClave: data.palabrasClave || [pregunta],
        secciones: data.secciones,
        cardsDerecha: data.cardsDerecha,
        imagenesContenido: data.imagenesContenido,
        puntos: data.puntos || data.claves || data.conceptos,
        formulas: data.formulas || data.formulasClave,
        pasos: data.pasos || data.procedimiento,
        tips: data.tips || data.consejos,
        errores: data.errores || data.erroresComunes,
        ejemplo: data.ejemplo || data.ejemploResuelto,
        actividad: data.actividad || data.cierre,
      };

  return {
    subtitulo,
    clase: normalizarClase(claseCandidata),
  };
}

function renderRespuestaChat(respuestaRaw, pregunta) {
  const { subtitulo, clase } = normalizarRespuestaChat(respuestaRaw, pregunta);

  ultimaRespuestaChat = clase;

  renderLeccion(
    clase,
    {
      materia: claseGuardadaActual?.materia || "Eduvia",
      nivel: claseGuardadaActual?.nivel || "Clase",
    },
    {
      badgeText: subtitulo,
      pregunta,
      temaRelacionado: claseGuardadaActual?.tema || "",
    }
  );
}

function abrirChat() {
  if (!chatPanel) return;
  chatPanel.classList.add("is-open");
  chatPanel.setAttribute("aria-hidden", "false");
  setTimeout(() => {
    chatInput?.focus();
  }, 50);
}

function cerrarChat() {
  if (!chatPanel) return;
  chatPanel.classList.remove("is-open");
  chatPanel.setAttribute("aria-hidden", "true");
}

async function preguntarEnChat(pregunta) {
  let response;

  try {
    response = await fetchConTimeout("/api/preguntar-clase", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        pregunta,
        claseGuardada: claseGuardadaActual,
        claseGenerada: claseGeneradaActual,
        ultimaRespuesta: ultimaRespuestaChat,
        fuentes: fuentesClaseActual,
        investigacion: investigacionClaseActual,
      }),
    });
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("La respuesta tardó demasiado. Probá de nuevo.");
    }
    throw error;
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error("El servidor respondió con un formato inválido.");
  }

  if (!response.ok || !data?.ok) {
    throw new Error(data?.error || "Hubo un error al responder la pregunta.");
  }

  return data.respuesta;
}

async function manejarPreguntaChat(event) {
  event.preventDefault();

  const pregunta = String(chatInput?.value || "").trim();

  if (!pregunta) {
    updateChatStatus("Escribí una pregunta primero.");
    chatInput?.focus();
    return;
  }

  if (!claseGuardadaActual && !claseGeneradaActual) {
    updateChatStatus("Primero cargá una clase.");
    return;
  }

  if (chatSendBtn) chatSendBtn.disabled = true;
  if (chatInput) chatInput.disabled = true;

  updateChatStatus("Pensando...");
  board.innerHTML = `<div class="board-loading">Respondiendo tu duda...</div>`;
  delete board.dataset.animando;

  try {
    const respuesta = await preguntarEnChat(pregunta);
    renderRespuestaChat(respuesta, pregunta);

    if (chatInput) {
      chatInput.value = "";
    }

    updateChatStatus("Pregunta enviada.");
    cerrarChat();
  } catch (error) {
    console.error("Error respondiendo pregunta del chat:", error);
    updateChatStatus(error.message || "Error al responder.");

    if (claseGeneradaActual) {
      renderLeccion(claseGeneradaActual, {
        materia: claseGuardadaActual?.materia || "",
        nivel: claseGuardadaActual?.nivel || "",
        tema: claseGuardadaActual?.tema || "",
        objetivo: claseGuardadaActual?.objetivo || "",
      });
    } else {
      renderError(error.message || "Error al responder la pregunta.");
    }
  } finally {
    if (chatSendBtn) chatSendBtn.disabled = false;
    if (chatInput) chatInput.disabled = false;
  }
}

async function cargarClaseEnPizarron() {
  try {
    board.innerHTML = `<div class="board-loading">Generando clase...</div>`;
    delete board.dataset.animando;

    const raw = localStorage.getItem("claseActual");
    if (!raw) {
      fuentesClaseActual = [];
      investigacionClaseActual = "";
      renderError("No se encontró la clase actual en el navegador.");
      updateChatStatus("No hay clase cargada.");
      return;
    }

    let claseGuardada;
    try {
      claseGuardada = JSON.parse(raw);
    } catch {
      fuentesClaseActual = [];
      investigacionClaseActual = "";
      renderError("La clase guardada está dañada o tiene un formato inválido.");
      updateChatStatus("Clase inválida.");
      return;
    }

    claseGuardadaActual = claseGuardada;

    const {
      materia = "",
      tema = "",
      nivel = "",
      duracion = "",
      objetivo = "",
    } = claseGuardada || {};

    if (!materia || !tema || !nivel) {
      fuentesClaseActual = [];
      investigacionClaseActual = "";
      renderError("Faltan datos clave de la clase: materia, tema o nivel.");
      updateChatStatus("Faltan datos de la clase.");
      return;
    }

    let response;
    try {
      response = await fetchConTimeout("/api/generar-clase", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          materia,
          tema,
          nivel,
          duracion,
          objetivo,
        }),
      });
    } catch (error) {
      if (error.name === "AbortError") {
        renderError("La generación de la clase tardó demasiado. Probá de nuevo.");
        updateChatStatus("La clase tardó demasiado.");
        return;
      }

      throw error;
    }

    let data;
    try {
      data = await response.json();
    } catch {
      renderError("El servidor respondió con un formato inválido.");
      updateChatStatus("Error del servidor.");
      return;
    }

    if (!response.ok || !data?.ok || !data?.clase) {
      fuentesClaseActual = [];
      investigacionClaseActual = "";
      renderError(data?.error || "Hubo un error al generar la clase.");
      updateChatStatus("No se pudo generar la clase.");
      return;
    }

    fuentesClaseActual = Array.isArray(data.fuentes) ? data.fuentes : [];
    investigacionClaseActual = String(data.investigacion || "").trim();

    renderClase(
      data.clase,
      { materia, nivel, tema, objetivo },
      {
        fuentes: fuentesClaseActual,
        investigacion: investigacionClaseActual,
      }
    );

    updateChatStatus("Listo para preguntar.");
  } catch (err) {
    console.error("Error cargando clase:", err);
    renderError("Error al cargar la clase en el pizarrón.");
    updateChatStatus("Error al cargar.");
  }
}

toggleChatBtn?.addEventListener("click", () => {
  if (chatPanel?.classList.contains("is-open")) {
    cerrarChat();
  } else {
    abrirChat();
  }
});

closeChatBtn?.addEventListener("click", cerrarChat);

chatForm?.addEventListener("submit", manejarPreguntaChat);

chatInput?.addEventListener("keydown", (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
    event.preventDefault();
    chatForm?.requestSubmit();
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    cerrarChat();
  }
});

cargarClaseEnPizarron();
