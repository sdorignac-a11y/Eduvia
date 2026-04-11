const board = document.getElementById("board-content");

async function cargarClaseEnPizarron() {
  try {
    board.innerHTML = `<div class="placeholder-text">Generando clase...</div>`;

    const claseGuardada = JSON.parse(localStorage.getItem("claseActual"));

    if (!claseGuardada) {
      board.innerHTML = `<div class="placeholder-text">No se encontró la clase.</div>`;
      return;
    }

    const res = await fetch("/api/generar-clase", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(claseGuardada)
    });

    const data = await res.json();

    if (!data.ok) {
      board.innerHTML = `<div class="placeholder-text">Hubo un error al generar la clase.</div>`;
      return;
    }

    const clase = data.clase;

    board.innerHTML = `
      <div class="board-lesson">
        <h1>${clase.titulo}</h1>
        <p>${clase.introduccion}</p>

        <ul>
          ${clase.puntos.map(p => `<li>${p}</li>`).join("")}
        </ul>

        <div class="board-block">
          <strong>Ejemplo:</strong>
          <p>${clase.ejemplo}</p>
        </div>

        <div class="board-block">
          <strong>Actividad:</strong>
          <p>${clase.actividad}</p>
        </div>
      </div>
    `;
  } catch (err) {
    console.error(err);
    board.innerHTML = `<div class="placeholder-text">Error al cargar la clase.</div>`;
  }
}

cargarClaseEnPizarron();
