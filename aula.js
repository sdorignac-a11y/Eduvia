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
