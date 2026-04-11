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

function crearVisuales(meta = {}, clase = {}) {
  const materia = `${meta.materia || ""}`.toLowerCase();
  const tema = `${clase.titulo || ""} ${clase.introduccion || ""}`.toLowerCase();

  const esMatematica =
    materia.includes("mat") ||
    tema.includes("suces") ||
    tema.includes("aritm") ||
    tema.includes("geom") ||
    tema.includes("cuadrát") ||
    tema.includes("cuadrat");

  if (esMatematica) {
    return [
      {
        alt: "Patrón numérico",
        caption: "Patrones que crecen paso a paso",
        src: svgToDataUri(`
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 420">
            <rect width="600" height="420" rx="28" fill="#F4F8FF"/>
            <circle cx="110" cy="210" r="56" fill="#BFE0FF"/>
            <circle cx="250" cy="210" r="56" fill="#CDECBF"/>
            <circle cx="390" cy="210" r="56" fill="#FFE49D"/>
            <circle cx="530" cy="210" r="56" fill="#F9B7B0"/>
            <text x="110" y="226" text-anchor="middle" font-size="44" font-family="Arial" font-weight="700" fill="#2D4F76">2</text>
            <text x="250" y="226" text-anchor="middle" font-size="44" font-family="Arial" font-weight="700" fill="#2D4F76">4</text>
            <text x="390" y="226" text-anchor="middle" font-size="44" font-family="Arial" font-weight="700" fill="#2D4F76">8</text>
            <text x="530" y="226" text-anchor="middle" font-size="44" font-family="Arial" font-weight="700" fill="#2D4F76">16</text>
            <path d="M166 210 L194 210" stroke="#355D95" stroke-width="8" stroke-linecap="round"/>
            <path d="M306 210 L334 210" stroke="#355D95" stroke-width="8" stroke-linecap="round"/>
            <path d="M446 210 L474 210" stroke="#355D95" stroke-width="8" stroke-linecap="round"/>
            <text x="178" y="184" text-anchor="middle" font-size="26" font-family="Arial" fill="#355D95">x2</text>
            <text x="318" y="184" text-anchor="middle" font-size="26" font-family="Arial" fill="#355D95">x2</text>
            <text x="458" y="184" text-anchor="middle" font-size="26" font-family="Arial" fill="#355D95">x2</text>
          </svg>
        `)
      },
      {
        alt: "Gráfico de sucesión",
        caption: "Ver el dibujo ayuda a entender mejor",
        src: svgToDataUri(`
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 420">
            <rect width="600" height="420" rx="28" fill="#FFFDF6"/>
            <line x1="90" y1="330" x2="530" y2="330" stroke="#33414D" stroke-width="6" stroke-linecap="round"/>
            <line x1="100" y1="340" x2="100" y2="80" stroke="#33414D" stroke-width="6" stroke-linecap="round"/>
            <path d="M120 300 C180 260 220 220 280 180 C340 140 400 120 500 100" fill="none" stroke="#355D95" stroke-width="10" stroke-linecap="round"/>
            <circle cx="150" cy="286" r="10" fill="#2F7D55"/>
            <circle cx="220" cy="236" r="10" fill="#2F7D55"/>
            <circle cx="300" cy="170" r="10" fill="#2F7D55"/>
            <circle cx="390" cy="128" r="10" fill="#2F7D55"/>
            <circle cx="490" cy="104" r="10" fill="#2F7D55"/>
            <text x="440" y="60" font-size="30" font-family="Arial" font-weight="700" fill="#9B4F5D">Sube cada vez más</text>
          </svg>
        `)
      },
      {
        alt: "Elementos matemáticos",
        caption: "Números, formas y reglas",
        src: svgToDataUri(`
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 420">
            <rect width="600" height="420" rx="28" fill="#F8F7FF"/>
            <rect x="70" y="70" width="170" height="110" rx="18" fill="#BFE0FF"/>
            <rect x="260" y="70" width="110" height="110" rx="18" fill="#CDECBF"/>
            <circle cx="470" cy="125" r="55" fill="#FFE49D"/>
            <path d="M130 280 L220 210 L310 280 L220 350 Z" fill="#F9B7B0"/>
            <text x="155" y="138" text-anchor="middle" font-size="44" font-family="Arial" font-weight="700" fill="#2D4F76">+3</text>
            <text x="315" y="138" text-anchor="middle" font-size="44" font-family="Arial" font-weight="700" fill="#2F7D55">x2</text>
            <text x="470" y="140" text-anchor="middle" font-size="42" font-family="Arial" font-weight="700" fill="#7A5A0E">n²</text>
            <text x="220" y="390" text-anchor="middle" font-size="28" font-family="Arial" font-weight="700" fill="#9B4F5D">cada regla cambia la sucesión</text>
          </svg>
        `)
      }
    ];
  }

  return [
    {
      alt: "Libro y estrella",
      caption: "Aprender también entra por los ojos",
      src: svgToDataUri(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 420">
          <rect width="600" height="420" rx="28" fill="#F4F8FF"/>
          <rect x="110" y="110" width="160" height="180" rx="18" fill="#BFE0FF"/>
          <rect x="290" y="110" width="160" height="180" rx="18" fill="#FFE49D"/>
          <line x1="280" y1="120" x2="280" y2="280" stroke="#355D95" stroke-width="6"/>
          <text x="190" y="210" text-anchor="middle" font-size="40" font-family="Arial" font-weight="700" fill="#2D4F76">A</text>
          <text x="370" y="210" text-anchor="middle" font-size="40" font-family="Arial" font-weight="700" fill="#7A5A0E">★</text>
        </svg>
      `)
    },
    {
      alt: "Idea visual",
      caption: "Explicar con dibujos ayuda más",
      src: svgToDataUri(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 420">
          <rect width="600" height="420" rx="28" fill="#FFFDF6"/>
          <circle cx="170" cy="210" r="72" fill="#CDECBF"/>
          <circle cx="320" cy="180" r="56" fill="#BFE0FF"/>
          <circle cx="430" cy="245" r="62" fill="#F9B7B0"/>
          <text x="300" y="90" text-anchor="middle" font-size="32" font-family="Arial" font-weight="700" fill="#355D95">Idea + imagen</text>
        </svg>
      `)
    },
    {
      alt: "Aprendizaje",
      caption: "Texto corto y apoyo visual",
      src: svgToDataUri(`
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 420">
          <rect width="600" height="420" rx="28" fill="#F8F7FF"/>
          <rect x="120" y="110" width="360" height="200" rx="26" fill="#FFFFFF"/>
          <line x1="160" y1="170" x2="430" y2="170" stroke="#355D95" stroke-width="10" stroke-linecap="round"/>
          <line x1="160" y1="215" x2="390" y2="215" stroke="#2F7D55" stroke-width="10" stroke-linecap="round"/>
          <line x1="160" y1="260" x2="350" y2="260" stroke="#9B4F5D" stroke-width="10" stroke-linecap="round"/>
        </svg>
      `)
    }
  ];
}

async function animarClase() {
  if (board.dataset.animando === "true") return;
  board.dataset.animando = "true";

  const title = board.querySelector(".board-title");
  const badge = board.querySelector(".board-badge");

  const sections = board.querySelectorAll(".board-section");
  const introSection = sections[0];
  const puntosSection = sections[1];
  const ejemploSection = sections[2];
  const actividadSection = sections[3];

  const introText = introSection?.querySelector("p");
  const puntosItems = puntosSection?.querySelectorAll("li") || [];
  const puntosTextoVacio =
    puntosItems.length === 0 ? puntosSection?.querySelector("p") : null;

  const ejemploText = ejemploSection?.querySelector("p");
  const actividadText = actividadSection?.querySelector("p");

  const visuales = board.querySelectorAll(".visual-box");

  if (title) {
    const text = title.textContent;
    await mostrarBloque(title, 120);
    await escribirTexto(title, text, 24);
  }

  if (badge) {
    const text = badge.textContent;
    await mostrarBloque(badge, 100);
    await escribirTexto(badge, text, 10);
  }

  if (visuales[0]) {
    await mostrarBloque(visuales[0], 150);
  }

  if (introSection) {
    await mostrarBloque(introSection, 120);
  }

  if (introText) {
    const text = introText.textContent;
    await escribirTexto(introText, text, 14);
  }

  if (visuales[1]) {
    await mostrarBloque(visuales[1], 140);
  }

  if (puntosSection) {
    await mostrarBloque(puntosSection, 120);
  }

  if (puntosItems.length) {
    for (const item of puntosItems) {
      const text = item.textContent;
      item.textContent = "";
      item.classList.add("is-visible");
      await escribirTexto(item, text, 12);
      await wait(90);
    }
  } else if (puntosTextoVacio) {
    const text = puntosTextoVacio.textContent;
    await escribirTexto(puntosTextoVacio, text, 14);
  }

  if (ejemploSection) {
    await mostrarBloque(ejemploSection, 120);
  }

  if (ejemploText) {
    const text = ejemploText.textContent;
    await escribirTexto(ejemploText, text, 14);
  }

  if (visuales[2]) {
    await mostrarBloque(visuales[2], 140);
  }

  if (actividadSection) {
    await mostrarBloque(actividadSection, 120);
  }

  if (actividadText) {
    const text = actividadText.textContent;
    await escribirTexto(actividadText, text, 14);
  }
}

function renderClase(clase, meta = {}) {
  const puntos = Array.isArray(clase?.puntos) ? clase.puntos : [];
  const visuales = crearVisuales(meta, clase);

  board.innerHTML = `
    <div class="board-lesson">
      <div class="board-layout">
        <div class="board-main">
          <div class="board-head">
            <h1 class="board-title">${escapeHtml(clase?.titulo || "Clase generada")}</h1>
            <div class="board-badge">${escapeHtml(meta.materia || "Eduvia")} · ${escapeHtml(meta.nivel || "Clase")}</div>
          </div>

          <section class="board-section">
            <h2>Introducción</h2>
            <p>${escapeHtml(clase?.introduccion || "")}</p>
          </section>

          <section class="board-section">
            <h2>Puntos clave</h2>
            ${
              puntos.length
                ? `<ul class="board-list">
                    ${puntos.map((p) => `<li>${escapeHtml(p)}</li>`).join("")}
                  </ul>`
                : `<p>No se recibieron puntos clave para esta clase.</p>`
            }
          </section>

          <section class="board-section">
            <h2>Ejemplo</h2>
            <p>${escapeHtml(clase?.ejemplo || "")}</p>
          </section>

          <section class="board-section">
            <h2>Actividad</h2>
            <p>${escapeHtml(clase?.actividad || "")}</p>
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
