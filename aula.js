const board = document.getElementById("board-content");

if (!board) {
  throw new Error('No se encontró el contenedor #board-content en aula.html');
}

const FETCH_TIMEOUT_MS = 30000;

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
      `Leé con atención qué se está pidiendo.`,
      `Identificá la regla o idea principal del tema.`,
      `Comprobá la respuesta usando el ejemplo o los puntos clave.`,
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
  const clase = normalizarClase(claseRaw);
  const panelesVisuales = crearPanelesVisuales(clase);

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

async function cargarClaseEnPizarron() {
  try {
    board.innerHTML = `<div class="board-loading">Generando clase...</div>`;
    delete board.dataset.animando;

    const raw = localStorage.getItem("claseActual");
    if (!raw) {
      renderError("No se encontró la clase actual en el navegador.");
      return;
    }

    let claseGuardada;
    try {
      claseGuardada = JSON.parse(raw);
    } catch {
      renderError("La clase guardada está dañada o tiene un formato inválido.");
      return;
    }

    const {
      materia = "",
      tema = "",
      nivel = "",
      duracion = "",
      objetivo = "",
    } = claseGuardada || {};

    if (!materia || !tema || !nivel) {
      renderError("Faltan datos clave de la clase: materia, tema o nivel.");
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
        return;
      }

      throw error;
    }

    let data;
    try {
      data = await response.json();
    } catch {
      renderError("El servidor respondió con un formato inválido.");
      return;
    }

    if (!response.ok || !data?.ok || !data?.clase) {
      renderError(data?.error || "Hubo un error al generar la clase.");
      return;
    }

    renderClase(data.clase, { materia, nivel, tema, objetivo });
  } catch (err) {
    console.error("Error cargando clase:", err);
    renderError("Error al cargar la clase en el pizarrón.");
  }
}

cargarClaseEnPizarron();
