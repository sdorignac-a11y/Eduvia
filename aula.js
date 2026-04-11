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

async function animarClase() {
  if (board.dataset.animando === "true") return;
  board.dataset.animando = "true";

  const title = board.querySelector(".board-title");
  const badge = board.querySelector(".board-badge");

  const sections = board.querySelectorAll(".board-section");
  const introSection = sections[0];
  const puntosSection = sections[1];

  const introText = introSection?.querySelector("p");

  const puntosItems = puntosSection?.querySelectorAll("li") || [];
  const puntosTextoVacio =
    puntosItems.length === 0 ? puntosSection?.querySelector("p") : null;

  const cards = board.querySelectorAll(".board-card");
  const ejemploCard = cards[0];
  const actividadCard = cards[1];

  const ejemploText = ejemploCard?.querySelector("p");
  const actividadText = actividadCard?.querySelector("p");

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

  if (introSection) {
    await mostrarBloque(introSection, 120);
  }

  if (introText) {
    const text = introText.textContent;
    await escribirTexto(introText, text, 14);
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
      await wait(100);
    }
  } else if (puntosTextoVacio) {
    const text = puntosTextoVacio.textContent;
    await escribirTexto(puntosTextoVacio, text, 14);
  }

  if (ejemploCard) {
    await mostrarBloque(ejemploCard, 120);
  }

  if (ejemploText) {
    const text = ejemploText.textContent;
    await escribirTexto(ejemploText, text, 14);
  }

  if (actividadCard) {
    await mostrarBloque(actividadCard, 120);
  }

  if (actividadText) {
    const text = actividadText.textContent;
    await escribirTexto(actividadText, text, 14);
  }
}

function renderClase(clase, meta = {}) {
  const puntos = Array.isArray(clase?.puntos) ? clase.puntos : [];

  board.innerHTML = `
    <div class="board-lesson">
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

      <div class="board-grid">
        <section class="board-card">
          <h3>Ejemplo</h3>
          <p>${escapeHtml(clase?.ejemplo || "")}</p>
        </section>

        <section class="board-card">
          <h3>Actividad</h3>
          <p>${escapeHtml(clase?.actividad || "")}</p>
        </section>
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
