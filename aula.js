const classData = {
  materia: "Matemática",
  tema: "Fracciones",
  nivel: "Secundaria",
  titulo: "Entendamos las fracciones",
  subtitulo:
    "Vamos a verlo de una forma clara, visual y fácil de seguir, como si el profesor lo estuviera escribiendo en el pizarrón.",
  lineas: [
    "1. Una fracción representa una parte de un todo.",
    "2. El número de arriba se llama numerador.",
    "3. El número de abajo se llama denominador.",
    "4. Si sumamos o restamos, primero miramos si tienen el mismo denominador.",
    "5. Si no lo tienen, buscamos una forma equivalente.",
    "6. Recién después operamos el numerador."
  ],
  ejemplo:
    "1/2 + 1/4. Primero llevamos ambas al mismo denominador. 1/2 también puede escribirse como 2/4. Entonces 2/4 + 1/4 = 3/4.",
  objetivo:
    "Que el alumno entienda cómo leer, interpretar y resolver fracciones básicas sin hacerlo de memoria.",
  ejercicio:
    "Resolvé 2/3 + 1/3. Después explicá por qué el resultado da 3/3 y qué significa eso.",
  bubble:
    "Hoy no importa memorizar. Importa entender qué representa cada parte de la fracción."
};

const bubbleByAction = {
  facil: {
    text: "Pensalo así: una fracción es como cortar una pizza en partes. El denominador dice en cuántas partes la cortaste y el numerador cuántas tomaste.",
    lines: [
      "1. Imaginá una pizza dividida en 4 partes.",
      "2. Si comés 1 parte, eso es 1/4.",
      "3. Si comés 2 partes, eso es 2/4.",
      "4. La fracción muestra partes de un total."
    ],
    example:
      "Si una torta tiene 8 porciones y comés 3, comiste 3/8 de la torta."
  },
  ejemplo: {
    text: "Perfecto. Vamos con otro ejemplo parecido pero más fácil de visualizar.",
    lines: [
      "1. Queremos sumar 2/5 + 1/5.",
      "2. Como el denominador ya es igual, no se cambia.",
      "3. Sumamos solamente los numeradores.",
      "4. 2 + 1 = 3.",
      "5. Resultado: 3/5."
    ],
    example:
      "2/5 + 1/5 = 3/5 porque seguimos hablando de quintos."
  },
  pregunta: {
    text: "Ahora te toca a vos. Probá responder mentalmente y después revisamos juntos.",
    lines: [
      "1. ¿Qué indica el numerador?",
      "2. ¿Qué indica el denominador?",
      "3. Si tengo 4/6, ¿de qué estoy hablando?",
      "4. ¿Cuándo puedo sumar directo los numeradores?"
    ],
    example:
      "Pregunta guía: en 3/7, ¿qué representa el 7?"
  },
  resumen: {
    text: "Te hago un resumen corto y ordenado para que te quede claro.",
    lines: [
      "1. La fracción representa partes de un total.",
      "2. Arriba va el numerador.",
      "3. Abajo va el denominador.",
      "4. Si el denominador es igual, operás arriba.",
      "5. Si es distinto, primero lo igualás."
    ],
    example:
      "Idea clave: siempre fijate primero en el denominador."
  },
  ejercicio: {
    text: "Buenísimo. Pasemos a practicar un poco.",
    lines: [
      "1. Resolvé 1/6 + 2/6.",
      "2. Resolvé 4/8 - 1/8.",
      "3. Explicá con palabras qué hiciste.",
      "4. Después compará si ambos tenían el mismo denominador."
    ],
    example:
      "Probá solo: 5/9 - 2/9 = ?"
  }
};

const typedLines = document.getElementById("typed-lines");
const boardTitle = document.getElementById("board-title");
const boardSubtitle = document.getElementById("board-subtitle");
const exampleBox = document.getElementById("example-box");
const goalBox = document.getElementById("goal-box");
const exerciseBox = document.getElementById("exercise-box");
const teacherBubble = document.getElementById("teacher-bubble");
const toolbarClassName = document.getElementById("toolbar-class-name");
const writingState = document.getElementById("writing-state");
const toolbarStatus = document.getElementById("toolbar-status");
const sendBtn = document.getElementById("send-btn");
const chatInput = document.getElementById("chat-input");
const quickButtons = document.querySelectorAll(".quick-btn");
const btnFullscreen = document.getElementById("btn-fullscreen");

let writingTimer = null;

function setBasicInfo() {
  boardTitle.textContent = classData.titulo;
  boardSubtitle.textContent = classData.subtitulo;
  exampleBox.textContent = classData.ejemplo;
  goalBox.textContent = classData.objetivo;
  exerciseBox.textContent = classData.ejercicio;
  toolbarClassName.textContent = `Clase de ${classData.materia} • ${classData.tema}`;
  teacherBubble.innerHTML = `
    <strong>Profe Eduvia</strong>
    ${classData.bubble}
  `;
}

function clearLines() {
  typedLines.innerHTML = "";
}

function setWriting(active = true, label = "Escribiendo en el pizarrón") {
  writingState.textContent = label;
  toolbarStatus.textContent = active ? "Clase en curso" : "Clase pausada";
}

function typeLines(lines = []) {
  clearTimeout(writingTimer);
  clearLines();
  setWriting(true, "Escribiendo en el pizarrón");

  let index = 0;

  function addNextLine() {
    if (index >= lines.length) {
      setWriting(false, "Contenido listo");
      return;
    }

    const line = document.createElement("div");
    line.className = "typed-line show";
    line.textContent = lines[index];
    typedLines.appendChild(line);

    index += 1;
    writingTimer = setTimeout(addNextLine, 480);
  }

  addNextLine();
}

function applyScene(scene) {
  if (!scene) return;

  teacherBubble.innerHTML = `
    <strong>Profe Eduvia</strong>
    ${scene.text}
  `;

  if (scene.example) exampleBox.textContent = scene.example;
  if (scene.lines) typeLines(scene.lines);
}

function handleQuickAction(action) {
  const scene = bubbleByAction[action];
  applyScene(scene);
}

function handleUserMessage() {
  const value = chatInput.value.trim();
  if (!value) return;

  const text = value.toLowerCase();

  if (text.includes("fácil") || text.includes("facil")) {
    handleQuickAction("facil");
  } else if (text.includes("ejemplo")) {
    handleQuickAction("ejemplo");
  } else if (text.includes("resumen")) {
    handleQuickAction("resumen");
  } else if (text.includes("ejercicio")) {
    handleQuickAction("ejercicio");
  } else if (text.includes("pregunta")) {
    handleQuickAction("pregunta");
  } else {
    teacherBubble.innerHTML = `
      <strong>Profe Eduvia</strong>
      Entiendo tu duda. Voy a reformular esta parte con una explicación más clara y ordenada.
    `;

    typeLines([
      "1. Primero identificamos cuál es la idea principal.",
      "2. Después la explicamos con palabras simples.",
      "3. Luego la conectamos con un ejemplo.",
      "4. Finalmente practicamos con un ejercicio corto."
    ]);

    exampleBox.textContent =
      "Ejemplo reformulado: si una barra de chocolate tiene 6 pedazos y comés 2, comiste 2/6.";
  }

  chatInput.value = "";
}

function setupQuickButtons() {
  quickButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      handleQuickAction(action);
    });
  });
}

function setupInput() {
  sendBtn?.addEventListener("click", handleUserMessage);

  chatInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleUserMessage();
    }
  });
}

function setupFullscreen() {
  btnFullscreen?.addEventListener("click", async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        btnFullscreen.textContent = "Salir de pantalla completa";
      } else {
        await document.exitFullscreen();
        btnFullscreen.textContent = "Pantalla completa";
      }
    } catch (error) {
      console.error("No se pudo cambiar el modo pantalla completa:", error);
    }
  });

  document.addEventListener("fullscreenchange", () => {
    btnFullscreen.textContent = document.fullscreenElement
      ? "Salir de pantalla completa"
      : "Pantalla completa";
  });
}

function init() {
  setBasicInfo();
  typeLines(classData.lineas);
  setupQuickButtons();
  setupInput();
  setupFullscreen();
}

init();
