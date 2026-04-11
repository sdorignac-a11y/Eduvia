const board = document.getElementById("board-content");

if (!board) {
  throw new Error("No se encontró el contenedor #board-content en aula.html");
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeSvg(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
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

function svgToDataUri(svg) {
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

function partirTextoEnLineas(texto = "", max = 26) {
  const palabras = String(texto).split(/\s+/).filter(Boolean);
  const lineas = [];
  let actual = "";

  for (const palabra of palabras) {
    const candidato = actual ? `${actual} ${palabra}` : palabra;
    if (candidato.length <= max) {
      actual = candidato;
    } else {
      if (actual) lineas.push(actual);
      actual = palabra;
    }
  }

  if (actual) lineas.push(actual);
  return lineas.slice(0, 4);
}

function crearNotaVisual({ titulo = "", lineas = [], color = "blue" }) {
  const paletas = {
    blue: { bg: "#EEF5FF", accent: "#355D95", chip: "#B9D9FF" },
    green: { bg: "#F2FAF4", accent: "#2F7D55", chip: "#B9E7B0" },
    yellow: { bg: "#FFFBEA", accent: "#9B7A17", chip: "#F5E89C" },
    red: { bg: "#FFF3F2", accent: "#9B4F5D", chip: "#F4AAA5" }
  };

  const p = paletas[color] || paletas.blue;
  const safeTitulo = escapeSvg(titulo);
  const safeLineas = lineas.map((l) => escapeSvg(l));

  const textoSvg = safeLineas
    .map((linea, i) => {
      const y = 130 + i * 54;
      return `<text x="40" y="${y}" font-size="30" font-family="Arial" font-weight="700" fill="#2F3A44">${linea}</text>`;
    })
    .join("");

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 420">
      <rect width="600" height="420" rx="30" fill="${p.bg}"/>
      <rect x="30" y="26" width="210" height="54" rx="27" fill="${p.chip}"/>
      <text x="135" y="61" text-anchor="middle" font-size="28" font-family="Arial" font-weight="700" fill="${p.accent}">
        ${safeTitulo}
      </text>
      <line x1="40" y1="105" x2="560" y2="105" stroke="${p.accent}" stroke-width="8" stroke-linecap="round" opacity=".28"/>
      ${textoSvg}
    </svg>
  `;

  return svgToDataUri(svg);
}

function normalizarLista(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizarClase(clase = {}) {
  return {
    titulo: clase?.titulo || "Clase generada",
    introduccion: clase?.introduccion || "",
    ideaPrincipal: clase?.ideaPrincipal || "",
    puntos: normalizarLista(clase?.puntos),
    formulas: Array.isArray(clase?.formulas) ? clase.formulas.filter(Boolean) : [],
    pasos: normalizarLista(clase?.pasos),
    tips: normalizarLista(clase?.tips),
    errores: normalizarLista(clase?.errores),
    ejemplo: clase?.ejemplo || "",
    actividad: clase?.actividad || "",
    visuales: Array.isArray(clase?.visuales) ? clase.visuales.filter(Boolean) : []
  };
}

function crearVisualesDesdeClase(clase, meta = {}) {
  const visualesBackend = Array.isArray(clase.visuales) ? clase.visuales : [];

  if (visualesBackend.length) {
    return visualesBackend.slice(0, 3).map((visual, index) => {
      const color =
        visual?.color === "green" || visual?.color === "yellow" || visual?.color === "red"
          ? visual.color
          : index === 0
            ? "blue"
            : index === 1
              ? "green"
              : "yellow";

      const lineas = Array.isArray(visual?.lineas)
        ? visual.lineas.slice(0, 4)
        : partirTextoEnLineas(visual?.texto || "", 24);

      return {
        alt: visual?.titulo || `Visual ${index + 1}`,
        caption: visual?.caption || visual?.titulo || `Visual ${index + 1}`,
        src: crearNotaVisual({
          titulo: visual?.titulo || `Visual ${index + 1}`,
          lineas,
          color
        })
      };
    });
  }

  const formulasTexto = clase.formulas.slice(0, 3).map((f) => {
    if (typeof f === "string") return f;
    const nombre = f?.nombre ? `${f.nombre}: ` : "";
    return `${nombre}${f?.formula || ""}`.trim();
  });

  const tipsTexto = clase.tips.slice(0, 3);
  const pasosTexto = clase.pasos.slice(0, 3);

  const materia = meta?.materia || "Clase";
  const visuales = [];

  if (formulasTexto.length) {
    visuales.push({
      alt: "Fórmulas clave",
      caption: "Fórmulas importantes del tema",
      src: crearNotaVisual({
        titulo: "Fórmulas",
        lineas: formulasTexto.length ? formulasTexto : ["No aplica"],
        color: "blue"
      })
    });
  }

  if (pasosTexto.length) {
    visuales.push({
      alt: "Cómo reconocerlo",
      caption: "Pasos para identificarlo",
      src: crearNotaVisual({
        titulo: "Cómo reconocer",
        lineas: pasosTexto,
        color: "green"
      })
    });
  }

  if (tipsTexto.length) {
    visuales.push({
      alt: "Tips rápidos",
      caption: "Tips para recordarlo mejor",
      src: crearNotaVisual({
        titulo: "Tips",
        lineas: tipsTexto,
        color: "yellow"
      })
    });
  }

  while (visuales.length < 3) {
    visuales.push({
      alt: materia,
      caption: `Apoyo visual de ${materia}`,
      src: crearNotaVisual({
        titulo: materia,
        lineas: partirTextoEnLineas(clase.titulo || "Tema principal", 24),
        color: visuales.length === 0 ? "blue" : visuales.length === 1 ? "green" : "yellow"
      })
    });
  }

  return visuales.slice(0, 3);
}

function renderLista(items = []) {
  if (!items.length) return `<p>No disponible en esta clase.</p>`;
  return `
    <ul class="board-list">
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  `;
}

function renderFormulas(formulas = []) {
  if (!formulas.length) {
    return `<p>En este tema no se cargaron fórmulas específicas.</p>`;
  }

  return `
    <ul class="board-list">
      ${formulas.map((formula) => {
        if (typeof formula === "string") {
          return `<li>${escapeHtml(formula)}</li>`;
        }

        const nombre = formula?.nombre ? `<strong>${escapeHtml(formula.nombre)}:</strong> ` : "";
        const formulaTxt = formula?.formula ? `${escapeHtml(formula.formula)} ` : "";
        const exp = formula?.explicacion ? `— ${escapeHtml(formula.explicacion)}` : "";
        return `<li>${nombre}${formulaTxt}${exp}</li>`;
      }).join("")}
    </ul>
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

  if (visuales[0]) await mostrarBloque(visuales[0], 120);

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    await mostrarBloque(section, 110);

    const parrafos = section.querySelectorAll("p");
    const items = section.querySelectorAll("li");

    for (const p of parrafos) {
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

    if (i === 1 && visuales[1]) await mostrarBloque(visuales[1], 130);
    if (i === 3 && visuales[2]) await mostrarBloque(visuales[2], 130);
  }
}

function renderClase(claseRaw, meta = {}) {
  const clase = normalizarClase(claseRaw);
  const visuales = crearVisualesDesdeClase(clase, meta);

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
            ${renderLista(clase.pasos)}
          </section>

          <section class="board-section">
            <h2>Puntos clave</h2>
            ${renderLista(clase.puntos)}
          </section>

          <section class="board-section">
            <h2>Tips rápidos</h2>
            ${renderLista(clase.tips)}
          </section>

          <section class="board-section">
            <h2>Errores comunes</h2>
            ${renderLista(clase.errores)}
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
          ${visuales.map((visual) => `
            <figure class="visual-box">
              <img class="visual-img" src="${visual.src}" alt="${escapeHtml(visual.alt)}">
              <figcaption class="visual-caption">${escapeHtml(visual.caption)}</figcaption>
            </figure>
          `).join("")}
        </aside>
      </div>
    </div>
  `;

  animarClase();
}

async function cargarClaseEnPizarron() {
  try {
    board.innerHTML = `<div class="board-loading">Generando clase...</div>`;

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

    const { materia, tema, nivel, duracion, objetivo } = claseGuardada || {};

    if (!materia || !tema || !nivel) {
      renderError("Faltan datos clave de la clase: materia, tema o nivel.");
      return;
    }

    const res = await fetch("/api/generar-clase", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        materia,
        tema,
        nivel,
        duracion: duracion || "",
        objetivo: objetivo || ""
      })
    });

    let data;
    try {
      data = await res.json();
    } catch {
      renderError("El servidor respondió algo inválido.");
      return;
    }

    if (!res.ok || !data?.ok || !data?.clase) {
      renderError(data?.error || "Hubo un error al generar la clase.");
      return;
    }

    renderClase(data.clase, { materia, nivel });
  } catch (err) {
    console.error("Error cargando clase:", err);
    renderError("Error al cargar la clase en el pizarrón.");
  }
}

cargarClaseEnPizarron();
