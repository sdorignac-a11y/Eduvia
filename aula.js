const classData = {
  materia: "Matemática",
  tema: "Fracciones",
  titulo: "Entendamos las fracciones",
  subtitulo:
    "Vamos a verlo de una forma clara, visual y fácil de seguir, como si el profesor lo estuviera escribiendo en el pizarrón.",
  explicacion: [
    "1. Una fracción representa una parte de un todo.",
    "2. El número de arriba se llama numerador.",
    "3. El número de abajo se llama denominador.",
    "4. Si tienen el mismo denominador, operamos directo arriba.",
    "5. Si no lo tienen, primero buscamos uno en común."
  ],
  ejemplo:
    "1/2 + 1/4. Primero buscamos el mismo denominador. 1/2 es igual a 2/4. Entonces 2/4 + 1/4 = 3/4.",
  objetivo:
    "Que el alumno entienda cómo leer, interpretar y operar fracciones simples sin memorizar mecánicamente.",
  ejercicio:
    "Calculá 3/4 - 1/4 y explicá por qué el denominador no cambia."
};

const scenes = {
  facil: {
    label: "Reescribiendo fácil",
    lines: [
      "1. Pensá la fracción como una pizza cortada.",
      "2. El denominador dice en cuántas partes está dividida.",
      "3. El numerador dice cuántas partes tomás.",
      "4. Si tenés 2/8, tomaste 2 partes de 8."
    ],
    example:
      "Si una torta tiene 6 porciones y comés 2, entonces comiste 2/6 de la torta."
  },
  ejemplo: {
    label: "Escribiendo otro ejemplo",
    lines: [
      "1. Probemos con 2/5 + 1/5.",
      "2. Los denominadores ya son iguales.",
      "3. Sumamos solo arriba: 2 + 1 = 3.",
      "4. El resultado final es 3/5."
    ],
    example:
      "2/5 + 1/5 = 3/5 porque seguimos hablando de quintos."
  },
  resumen: {
    label: "Resumiendo",
    lines: [
      "1. La fracción muestra partes de un total.",
      "2. Arriba está el numerador.",
      "3. Abajo está el denominador.",
      "4. Si el denominador coincide, operás directo.",
      "5. Si no coincide, primero lo igualás."
    ],
    example:
      "Idea clave: antes de sumar o restar, siempre mirá el denominador."
  }
};

const classNameEl = document.getElementById("class-name");
const classStatusEl = document.getElementById("class-status");
const boardTitleEl = document.getElementById("board-title");
const boardSubtitleEl = document.getElementById("board-subtitle");
const typedLinesEl = document.getElementById("typed-lines");
const goalTextEl = document.getElementById("goal-text");
const exerciseTextEl = document.getElementById("exercise-text");
const exampleTextEl = document.getElementById("example-text");
const writingLabelEl = document.getElementById("writing-label");
const fullscreenBtn = document.getElementById("fullscreen-btn");
const actionButtons = document.querySelectorAll(".tool-chip");

let writingTimer = null;

function setBaseContent() {
  classNameEl.textContent = `Clase de ${classData.materia} • ${classData.tema}`;
  classStatusEl.textContent = "Clase en curso";
  boardTitleEl.textContent = classData.titulo;
  boardSubtitleEl.textContent = classData.subtitulo;
  goalTextEl.textContent = classData.objetivo;
  exerciseTextEl.textContent = classData.ejercicio;
  exampleTextEl.textContent = classData.ejemplo;
}

function clearLines() {
  if (writingTimer) clearTimeout(writingTimer);
  typedLinesEl.innerHTML = "";
}

function finishWriting() {
  writingLabelEl.textContent = "Contenido listo";
}

function typeLines(lines = [], label = "Escribiendo en el pizarrón") {
  clearLines();
  writingLabelEl.textContent = label;

  let index = 0;

  function addLine() {
    if (index >= lines.length) {
      finishWriting();
      return;
    }

    const line = document.createElement("div");
    line.className = "typed-line";
    line.textContent = lines[index];
    typedLinesEl.appendChild(line);

    index += 1;
    writingTimer = setTimeout(addLine, 520);
  }

  addLine();
}

function applyScene(key) {
  const scene = scenes[key];
  if (!scene) return;

  typeLines(scene.lines, scene.label);
  exampleTextEl.textContent = scene.example;
}

function setupActions() {
  actionButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      applyScene(btn.dataset.action);
    });
  });
}

function setupFullscreen() {
  fullscreenBtn.addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch (error) {
      console.error("No se pudo activar pantalla completa:", error);
    }
  });

  document.addEventListener("fullscreenchange", () => {
    fullscreenBtn.textContent = document.fullscreenElement
      ? "Salir de pantalla completa"
      : "Pantalla completa";
  });
}

function init() {
  setBaseContent();
  typeLines(classData.explicacion);
  setupActions();
  setupFullscreen();
}

init();
