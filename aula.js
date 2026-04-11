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

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

async function escribirTexto(el, texto, velocidad = 18) {
  if (!el) return;

  const contenido = String(texto || "");
  el.textContent = "";
  el.classList.add("is-typing");

  for (let i = 0; i < contenido.length; i++) {
    el.textContent += contenido[i];
    await wait(velocidad);
  }

  el.classList.remove("is-typing");
}

async function mostrarBloque(el, delay = 180) {
  if (!el) return;
  el.classList.add("is-visible");
  await wait(delay);
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

function construirIdeaPrincipal(clase = {}) {
  if (clase.ideaPrincipal) return clase.ideaPrincipal;

  const intro = String(clase.introduccion || "").trim();
  if (intro) return intro;

  const primerPunto = Array.isArray(clase.puntos) ? clase.puntos[0] : "";
  if (primerPunto) return primerPunto;

  return "Este tema tiene ideas importantes que ayudan a entenderlo mejor.";
}

function construirPasos(clase = {}) {
  const pasos = normalizarLista(clase.pasos);
  if (pasos.length) return pasos;

  const puntos = normalizarLista(clase.puntos);
  if (puntos.length >= 3) {
    return [
      "Leé con atención qué se está pidiendo.",
      "Identificá la regla o idea principal del tema.",
      "Comprobá la respuesta usando el ejemplo o los puntos clave.",
    ];
  }

  return [
    "Leé el tema con atención.",
    "Buscá la idea principal o la regla.",
    "Comprobá con un ejemplo sencillo.",
  ];
}

function construirTips(clase = {}) {
  const tips = normalizarLista(clase.tips);
  if (tips.length) return tips;

  return [
    "Buscá siempre el patrón o la idea que se repite.",
    "Probá con un ejemplo corto antes de pasar a uno más difícil.",
    "Revisá si el resultado tiene sentido antes de terminar.",
  ];
}

function construirErrores(clase = {}) {
  const errores = normalizarLista(clase.errores);
  if (errores.length) return errores;

  return [
    "Confundir la regla principal con un caso aislado.",
    "Hacer cuentas rápido sin comprobar el resultado.",
    "Olvidar leer bien qué pide el ejercicio.",
  ];
}

function normalizarClase(clase = {}) {
  const titulo = String(clase.titulo || "Clase generada").trim();
  const introduccion = String(clase.introduccion || "").trim();
  const ejemplo = String(clase.ejemplo || "").trim();
  const actividad = String(clase.actividad || "").trim();

  const claseBase = {
    titulo,
    introduccion,
    ideaPrincipal: String(clase.ideaPrincipal || "").trim(),
    puntos: dedupeLista(normalizarLista(clase.puntos)),
    formulas: normalizarFormulas(clase.formulas),
    pasos: dedupeLista(normalizarLista(clase.pasos)),
    tips: dedupeLista(normalizarLista(clase.tips)),
    errores: dedupeLista(normalizarLista(clase.errores)),
    ejemplo,
    actividad,
  };

  claseBase.ideaPrincipal = construirIdeaPrincipal(claseBase);
  claseBase.pasos = construirPasos(claseBase);
  claseBase.tips = construirTips(claseBase);
  claseBase.errores = construirErrores(claseBase);

  return claseBase;
}

function renderLista(items = [], emptyText = "No disponible en esta clase.") {
  if (!items.length) {
    return `<p>${escapeHtml(emptyText)}</p>`;
  }

  return `
    <ul class="board-list">
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  `;
}

function renderFormulas(formulas = []) {
  if (!formulas.length) {
    return `<p>En esta clase no se cargaron fórmulas específicas.</p>`;
  }

  return `
    <ul class="board-list">
      ${formulas.map((formula) => {
        const nombre = formula.nombre ? `<strong>${escapeHtml(formula.nombre)}:</strong> ` : "";
        const formulaTxt = formula.formula ? `${escapeHtml(formula.formula)} ` : "";
        const explicacion = formula.explicacion ? `— ${escapeHtml(formula.explicacion)}` : "";
        return `<li>${nombre}${formulaTxt}${explicacion}</li>`;
      }).join("")}
    </ul>
  `;
}

function crearPanelesVisuales(clase) {
  const formulaPrincipal = clase.formulas[0]
    ? `${clase.formulas[0].nombre ? `${clase.formulas[0].nombre}: ` : ""}${clase.formulas[0].formula || ""}`.trim()
    : clase.ideaPrincipal || "Idea clave del tema";

  const formulaCaption = clase.formulas[0]?.explicacion
    || "Este bloque resume lo más importante que tenés que recordar.";

  return [
    {
      tipo: "formula",
      color: clase.formulas.length ? "blue" : "green",
      titulo: clase.formulas.length ? "Fórmula clave" : "Idea clave",
      badge: "01",
      formula: formulaPrincipal,
      caption: formulaCaption,
    },
    {
      tipo: "steps",
      color: "green",
      titulo: "Cómo pensarlo",
      badge: "02",
      pasos: clase.pasos.slice(0, 3),
      caption: "Seguí estos pasos para entender o resolver mejor el tema.",
    },
    {
      tipo: "list",
      color: "yellow",
      titulo: "Tips y alertas",
      badge: "03",
      lineas: [...clase.tips.slice(0, 2), ...clase.errores.slice(0, 2).map((e) => `Ojo: ${e}`)].slice(0, 4),
      caption: "Sirve para recordar rápido y evitar errores comunes.",
    },
  ];
}

function renderPanelVisual(panel) {
  if (panel.tipo === "formula") {
    return `
      <figure class="visual-box visual-${escapeHtml(panel.color)}">
        <div class="visual-top">
          <div class="visual-title">${escapeHtml(panel.titulo)}</div>
          <div class="visual-badge">${escapeHtml(panel.badge)}</div>
        </div>

        <div class="visual-main">
          <div class="visual-formula">${escapeHtml(panel.formula)}</div>
        </div>

        <figcaption class="visual-caption">${escapeHtml(panel.caption || "")}</figcaption>
      </figure>
    `;
  }

  if (panel.tipo === "steps") {
    return `
      <figure class="visual-box visual-${escapeHtml(panel.color)}">
        <div class="visual-top">
          <div class="visual-title">${escapeHtml(panel.titulo)}</div>
          <div class="visual-badge">${escapeHtml(panel.badge)}</div>
        </div>

        <div class="visual-main">
          <div class="visual-steps">
            ${(panel.pasos || []).map((paso, index) => `
              <div class="visual-step">
                <div class="visual-step-num">${index + 1}</div>
                <div class="visual-step-text">${escapeHtml(paso)}</div>
              </div>
            `).join("")}
          </div>
        </div>

        <figcaption class="visual-caption">${escapeHtml(panel.caption || "")}</figcaption>
      </figure>
    `;
  }

  return `
    <figure class="visual-box visual-${escapeHtml(panel.color)}">
      <div class="visual-top">
        <div class="visual-title">${escapeHtml(panel.titulo)}</div>
        <div class="visual-badge">${escapeHtml(panel.badge)}</div>
      </div>

      <div class="visual-main">
        <div class="visual-lines">
          ${(panel.lineas || []).map((linea) => `
            <div class="visual-line">${escapeHtml(linea)}</div>
          `).join("")}
        </div>
      </div>

      <figcaption class="visual-caption">${escapeHtml(panel.caption || "")}</figcaption>
    </figure>
  `;
}

async function animarClase() {
  if (board.dataset.animando === "true") return;
  board.dataset.animando = "true";

  const title = board.querySelector(".board-title");
  const badge = board.querySelector(".board-badge");
  const sections = board.querySelectorAll(".board-section");
  const visuales = board.querySelectorAll(".visual-box");

  if (title) {
    const text = title.textContent;
    await mostrarBloque(title, 120);
    await escribirTexto(title, text, 22);
  }

  if (badge) {
    const text = badge.textContent;
    await mostrarBloque(badge, 100);
    await escribirTexto(badge, text, 10);
  }

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];

    if (i < visuales.length) {
      await mostrarBloque(visuales[i], 120);
    }

    await mostrarBloque(section, 110);

    const paragraphs = section.querySelectorAll("p");
    const items = section.querySelectorAll("li");

    for (const p of paragraphs) {
      const text = p.textContent;
      await escribirTexto(p, text, 14);
    }

    for (const item of items) {
      const text = item.textContent;
      item.textContent = "";
      item.classList.add("is-visible");
      await escribirTexto(item, text, 11);
      await wait(80);
    }
  }

  for (let i = sections.length; i < visuales.length; i++) {
    await mostrarBloque(visuales[i], 120);
  }
}

function renderClase(claseRaw, meta = {}) {
  delete board.dataset.animando;

  const clase = normalizarClase(claseRaw);
  const panelesVisuales = crearPanelesVisuales(clase);

  claseGeneradaActual = clase;
  ultimaRespuestaChat = null;

  board.innerHTML = `
    <div class="board-lesson">
      <div class="board-layout">
        <div class="board-main">
          <div class="board-head">
            <h1 class="board-title">${escapeHtml(clase.titulo)}</h1>
            <div class="board-badge">${escapeHtml(meta.materia || "Eduvia")} · ${escapeHtml(meta.nivel || "Clase")}</div>
          </div>

          <section class="board-section">
            <h2>Introducción</h2>
            <p>${escapeHtml(clase.introduccion || "No disponible.")}</p>
          </section>

          <section class="board-section">
            <h2>Idea principal</h2>
            <p>${escapeHtml(clase.ideaPrincipal || "No disponible.")}</p>
          </section>

          <section class="board-section">
            <h2>Fórmulas clave</h2>
            ${renderFormulas(clase.formulas)}
          </section>

          <section class="board-section">
            <h2>Cómo identificar este tema</h2>
            ${renderLista(clase.pasos, "No se cargaron pasos en esta clase.")}
          </section>

          <section class="board-section">
            <h2>Puntos clave</h2>
            ${renderLista(clase.puntos, "No se cargaron puntos clave en esta clase.")}
          </section>

          <section class="board-section">
            <h2>Tips rápidos</h2>
            ${renderLista(clase.tips, "No se cargaron tips en esta clase.")}
          </section>

          <section class="board-section">
            <h2>Errores comunes</h2>
            ${renderLista(clase.errores, "No se cargaron errores comunes en esta clase.")}
          </section>

          <section class="board-section">
            <h2>Ejemplo</h2>
            <p>${escapeHtml(clase.ejemplo || "No disponible.")}</p>
          </section>

          <section class="board-section">
            <h2>Actividad</h2>
            <p>${escapeHtml(clase.actividad || "No disponible.")}</p>
          </section>
        </div>

        <aside class="board-side">
          ${panelesVisuales.map(renderPanelVisual).join("")}
        </aside>
      </div>
    </div>
  `;

  animarClase().catch((error) => {
    console.error("Error animando la clase:", error);
  });
}

function normalizarRespuestaChat(raw, pregunta = "") {
  if (typeof raw === "string") {
    return {
      subtitulo: "Duda respondida",
      clase: normalizarClase({
        titulo: "Respuesta de la IA",
        introduccion: raw,
        ideaPrincipal: raw,
        puntos: [raw],
        formulas: [],
        pasos: [],
        tips: [],
        errores: [],
        ejemplo: "",
        actividad: "Podés hacer otra pregunta desde el chat para seguir profundizando.",
      }),
    };
  }

  const data = raw && typeof raw === "object" ? raw : {};

  const titulo = String(
    data.titulo || `Respuesta sobre: ${pregunta || "tu duda"}`
  ).trim();

  const subtitulo = String(
    data.subtitulo || "Duda respondida"
  ).trim();

  const introduccion = String(
    data.introduccion || data.explicacion || data.respuestaBreve || data.ideaPrincipal || ""
  ).trim();

  const ideaPrincipal = String(
    data.ideaPrincipal || data.explicacion || data.resumen || introduccion || "Esta es la idea más importante de la respuesta."
  ).trim();

  const puntos = dedupeLista(
    normalizarLista(data.puntos || data.conceptos || data.claves)
  );

  const formulas = normalizarFormulas(
    data.formulas || data.formulasClave
  );

  const pasos = dedupeLista(
    normalizarLista(data.pasos || data.procedimiento)
  );

  const tips = dedupeLista(
    normalizarLista(data.tips || data.consejos)
  );

  const errores = dedupeLista(
    normalizarLista(data.errores || data.erroresComunes)
  );

  const ejemplo = String(
    data.ejemplo || data.ejemploResuelto || ""
  ).trim();

  const actividad = String(
    data.actividad || data.cierre || data.resumen || "Podés hacer otra pregunta desde el chat para seguir profundizando."
  ).trim();

  return {
    subtitulo,
    clase: normalizarClase({
      titulo,
      introduccion,
      ideaPrincipal,
      puntos,
      formulas,
      pasos,
      tips,
      errores,
      ejemplo,
      actividad,
    }),
  };
}

function renderRespuestaChat(respuestaRaw, pregunta) {
  delete board.dataset.animando;

  const { subtitulo, clase } = normalizarRespuestaChat(respuestaRaw, pregunta);
  const panelesVisuales = crearPanelesVisuales(clase);

  const materiaActual = claseGuardadaActual?.materia || "Eduvia";
  const nivelActual = claseGuardadaActual?.nivel || "Clase";
  const temaActual = claseGuardadaActual?.tema || "";

  board.innerHTML = `
    <div class="board-lesson">
      <div class="board-layout">
        <div class="board-main">
          <div class="board-head">
            <h1 class="board-title">${escapeHtml(clase.titulo)}</h1>
            <div class="board-badge">${escapeHtml(subtitulo || `${materiaActual} · ${nivelActual}`)}</div>
          </div>

          <section class="board-section">
            <h2>Pregunta del alumno</h2>
            <p>${escapeHtml(pregunta || "Sin pregunta registrada.")}</p>
          </section>

          <section class="board-section">
            <h2>Respuesta clara</h2>
            <p>${escapeHtml(clase.introduccion || "No disponible.")}</p>
          </section>

          <section class="board-section">
            <h2>Idea principal</h2>
            <p>${escapeHtml(clase.ideaPrincipal || "No disponible.")}</p>
          </section>

          <section class="board-section">
            <h2>Fórmulas clave</h2>
            ${renderFormulas(clase.formulas)}
          </section>

          <section class="board-section">
            <h2>Cómo pensarlo</h2>
            ${renderLista(clase.pasos, "No se cargaron pasos para esta respuesta.")}
          </section>

          <section class="board-section">
            <h2>Puntos clave</h2>
            ${renderLista(clase.puntos, "No se cargaron puntos clave en esta respuesta.")}
          </section>

          <section class="board-section">
            <h2>Tips rápidos</h2>
            ${renderLista(clase.tips, "No se cargaron tips en esta respuesta.")}
          </section>

          <section class="board-section">
            <h2>Errores comunes</h2>
            ${renderLista(clase.errores, "No se cargaron errores comunes en esta respuesta.")}
          </section>

          <section class="board-section">
            <h2>Ejemplo</h2>
            <p>${escapeHtml(clase.ejemplo || "No disponible.")}</p>
          </section>

          <section class="board-section">
            <h2>Próximo paso</h2>
            <p>${escapeHtml(clase.actividad || "Podés hacer otra pregunta desde el chat.")}</p>
          </section>

          ${
            temaActual
              ? `
                <section class="board-section">
                  <h2>Conectado con la clase actual</h2>
                  <p>Esta respuesta se relaciona con el tema: ${escapeHtml(temaActual)}.</p>
                </section>
              `
              : ""
          }
        </div>

        <aside class="board-side">
          ${panelesVisuales.map(renderPanelVisual).join("")}
        </aside>
      </div>
    </div>
  `;

  ultimaRespuestaChat = clase;

  animarClase().catch((error) => {
    console.error("Error animando la respuesta del chat:", error);
  });
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
    if (chatInput) chatInput.value = "";
    updateChatStatus("Pregunta enviada.");
    cerrarChat();
  } catch (error) {
    console.error("Error respondiendo pregunta del chat:", error);
    updateChatStatus(error.message || "Error al responder.");
    if (claseGeneradaActual) {
      renderClase(claseGeneradaActual, {
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
      renderError("No se encontró la clase actual en el navegador.");
      updateChatStatus("No hay clase cargada.");
      return;
    }

    let claseGuardada;
    try {
      claseGuardada = JSON.parse(raw);
    } catch {
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
      renderError(data?.error || "Hubo un error al generar la clase.");
      updateChatStatus("No se pudo generar la clase.");
      return;
    }

    renderClase(data.clase, { materia, nivel, tema, objetivo });
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
