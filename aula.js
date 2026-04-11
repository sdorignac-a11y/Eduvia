import { auth, db } from "./firebase.js?v=7";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const loader = document.getElementById("loader");
const app = document.getElementById("app");
const errorBox = document.getElementById("error-box");

const classTitle = document.getElementById("class-title");
const classSubtitle = document.getElementById("class-subtitle");
const chipMateria = document.getElementById("chip-materia");
const chipTema = document.getElementById("chip-tema");
const chipNivel = document.getElementById("chip-nivel");
const chipDuracion = document.getElementById("chip-duracion");
const goalMain = document.getElementById("goal-main");

const boardMainTitle = document.getElementById("board-main-title");
const boardMainText = document.getElementById("board-main-text");
const boardGoal = document.getElementById("board-goal");
const boardSteps = document.getElementById("board-steps");
const boardExample = document.getElementById("board-example");

const chatMessages = document.getElementById("chat-messages");
const chatForm = document.getElementById("chat-form");
const chatInput = document.getElementById("chat-input");
const quickButtons = document.querySelectorAll(".quick-btn");
const logoutBtn = document.getElementById("logout");
const volverClaseLink = document.getElementById("volver-clase-link");

const params = new URLSearchParams(window.location.search);
const claseId = params.get("id");

let claseActual = null;
let chatState = [];

logoutBtn?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "login.html";
  } catch (error) {
    console.error("Error al cerrar sesión:", error);
    mostrarError("No se pudo cerrar sesión.");
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  if (!claseId) {
    mostrarError("No se encontró el ID de la clase.");
    ocultarLoader();
    return;
  }

  try {
    const ref = doc(db, "usuarios", user.uid, "clases", claseId);
    const snap = await getDoc(ref);

    if (!snap.exists()) {
      mostrarError("La clase no existe o no tenés acceso.");
      ocultarLoader();
      return;
    }

    claseActual = {
      id: snap.id,
      ...snap.data()
    };

    volverClaseLink.href = `clase.html?id=${encodeURIComponent(claseId)}`;

    cargarCabecera(claseActual);
    cargarPizarraInicial(claseActual);
    cargarChatGuardadoOInicial(claseActual);

    app.style.display = "grid";
    ocultarLoader();
  } catch (error) {
    console.error("Error al cargar el aula:", error);
    mostrarError("Error al cargar el aula.");
    ocultarLoader();
  }
});

chatForm?.addEventListener("submit", (e) => {
  e.preventDefault();

  const texto = chatInput.value.trim();
  if (!texto || !claseActual) return;

  agregarMensaje("user", texto);
  chatInput.value = "";

  const accionDetectada = detectarAccion(texto);
  const respuesta = generarRespuesta(accionDetectada, claseActual, texto);

  actualizarPizarraSegunAccion(accionDetectada, claseActual);
  agregarMensaje("assistant", respuesta);
});

quickButtons.forEach((btn) => {
  btn.addEventListener("click", () => {
    if (!claseActual) return;

    const accion = btn.dataset.action || "normal";
    const textoUsuario = textoUsuarioPorAccion(accion);
    const respuesta = generarRespuesta(accion, claseActual, textoUsuario);

    agregarMensaje("user", textoUsuario);
    actualizarPizarraSegunAccion(accion, claseActual);
    agregarMensaje("assistant", respuesta);
  });
});

function cargarCabecera(clase) {
  const tema = clase.tema || "tu tema";
  const materia = clase.materia || "Materia";
  const nivel = clase.nivel || "Nivel no definido";
  const duracion = clase.duracion || "No definida";
  const objetivo = clase.objetivo || "Entender mejor el tema paso a paso.";

  classTitle.innerHTML = `Trabajemos <span>${escapeHTML(tema)}</span>.`;
  classSubtitle.textContent = `Esta clase de ${materia} está preparada para nivel ${nivel}. La idea es avanzar con claridad, ejemplos y una explicación adaptada a lo que necesitás.`;

  chipMateria.textContent = materia;
  chipTema.textContent = tema;
  chipNivel.textContent = nivel;
  chipDuracion.textContent = duracion;
  goalMain.textContent = objetivo;
}

function cargarPizarraInicial(clase) {
  const contenido = generarContenidoPizarra("inicio", clase);
  renderizarPizarra(contenido);
}

function actualizarPizarraSegunAccion(accion, clase) {
  const contenido = generarContenidoPizarra(accion, clase);
  renderizarPizarra(contenido);
}

function renderizarPizarra(contenido) {
  boardMainTitle.textContent = contenido.titulo;
  boardMainText.textContent = contenido.texto;
  boardGoal.textContent = contenido.objetivo;
  boardExample.textContent = contenido.ejemplo;

  boardSteps.innerHTML = "";
  contenido.pasos.forEach((paso) => {
    const li = document.createElement("li");
    li.textContent = paso;
    boardSteps.appendChild(li);
  });
}

function cargarChatGuardadoOInicial(clase) {
  const storageKey = obtenerStorageKey(clase.id);
  const guardado = sessionStorage.getItem(storageKey);

  if (guardado) {
    try {
      const mensajes = JSON.parse(guardado);
      if (Array.isArray(mensajes) && mensajes.length) {
        chatState = mensajes;
        renderizarMensajes();
        return;
      }
    } catch (error) {
      console.warn("No se pudo leer el chat guardado:", error);
    }
  }

  chatState = [];
  const bienvenida = generarBienvenidaInicial(clase);
  agregarMensaje("assistant", bienvenida, false);
  guardarChat();
  renderizarMensajes();
}

function agregarMensaje(role, text, guardar = true) {
  chatState.push({
    role,
    text,
    time: new Date().toLocaleTimeString("es-AR", {
      hour: "2-digit",
      minute: "2-digit"
    })
  });

  renderizarMensajes();

  if (guardar) {
    guardarChat();
  }
}

function renderizarMensajes() {
  chatMessages.innerHTML = "";

  chatState.forEach((msg) => {
    const div = document.createElement("div");
    div.className = `msg ${msg.role}`;
    div.textContent = msg.text;

    const small = document.createElement("small");
    small.textContent = msg.role === "assistant" ? `Eduvia · ${msg.time}` : `Vos · ${msg.time}`;
    div.appendChild(small);

    chatMessages.appendChild(div);
  });

  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function guardarChat() {
  if (!claseActual?.id) return;
  sessionStorage.setItem(obtenerStorageKey(claseActual.id), JSON.stringify(chatState));
}

function obtenerStorageKey(id) {
  return `eduvia_aula_chat_${id}`;
}

function generarBienvenidaInicial(clase) {
  const materia = clase.materia || "la materia";
  const tema = clase.tema || "este tema";
  const nivel = clase.nivel || "tu nivel";
  const objetivo = clase.objetivo || "entender el tema con claridad";

  return `¡Arranquemos! Hoy vamos a trabajar ${tema} en ${materia}, adaptado para nivel ${nivel}. El objetivo principal es ${objetivo}. Podemos ir paso a paso, usar ejemplos o pasar directo a ejercicios según lo que necesites.`;
}

function detectarAccion(texto) {
  const t = normalizar(texto);

  if (t.includes("facil") || t.includes("simple") || t.includes("mas facil")) return "facil";
  if (t.includes("ejemplo")) return "ejemplo";
  if (t.includes("pregunta") || t.includes("prueba") || t.includes("quiz")) return "preguntas";
  if (t.includes("resumen") || t.includes("resum")) return "resumen";
  if (t.includes("ejercicio") || t.includes("practica") || t.includes("practicar")) return "ejercicio";

  return "normal";
}

function textoUsuarioPorAccion(accion) {
  if (accion === "facil") return "Explicamelo más fácil";
  if (accion === "ejemplo") return "Dame un ejemplo";
  if (accion === "preguntas") return "Haceme preguntas para practicar";
  if (accion === "resumen") return "Resumilo";
  if (accion === "ejercicio") return "Pasemos a un ejercicio";
  return "Quiero seguir con la clase";
}

function generarRespuesta(accion, clase, textoOriginal = "") {
  const materia = clase.materia || "la materia";
  const tema = clase.tema || "este tema";
  const nivel = clase.nivel || "tu nivel";
  const objetivo = clase.objetivo || "entenderlo bien";

  if (accion === "facil") {
    return `Claro. Vamos a bajar un cambio: en ${tema}, dentro de ${materia}, lo importante primero es entender la idea base, no memorizar. Pensemos esto como un concepto que se construye en capas: primero qué significa, después cómo se reconoce y recién después cómo se aplica. Para nivel ${nivel}, te conviene enfocarte en una sola idea por vez.`;
  }

  if (accion === "ejemplo") {
    return `Perfecto. Te doy un ejemplo guiado de ${tema}: ${ejemploPorTema(tema)} La idea no es solo ver el resultado, sino entender por qué se hace cada paso así.`;
  }

  if (accion === "preguntas") {
    return `Vamos con una mini práctica sobre ${tema}. 1) ¿Cómo explicarías con tus palabras de qué trata este tema? 2) ¿Qué dato o concepto aparece primero? 3) ¿Qué error pensás que alguien podría cometer al resolverlo? Respondeme una y seguimos corrigiendo juntos.`;
  }

  if (accion === "resumen") {
    return `Resumen rápido: estamos viendo ${tema} en ${materia}, adaptado a ${nivel}. El foco de esta clase es ${objetivo}. La estructura ideal es: entender la idea principal, ver un ejemplo simple y después practicar con una consigna guiada.`;
  }

  if (accion === "ejercicio") {
    return `Vamos a práctica. Te propongo este ejercicio inicial sobre ${tema}: ${ejercicioPorTema(tema)} Intentá resolverlo y después lo revisamos juntos paso a paso.`;
  }

  return `Entiendo. Sobre "${textoOriginal}", lo más útil es conectarlo con el objetivo de la clase: ${objetivo}. Si querés, puedo explicarlo más fácil, darte un ejemplo o transformarlo en ejercicio para practicar dentro de ${tema}.`;
}

function generarContenidoPizarra(tipo, clase) {
  const tema = clase.tema || "este tema";
  const materia = clase.materia || "la materia";
  const nivel = clase.nivel || "tu nivel";
  const objetivo = clase.objetivo || "entender mejor el tema";

  if (tipo === "facil") {
    return {
      titulo: `Versión fácil de ${tema}`,
      texto: `Vamos a explicarlo de la manera más simple posible. En ${materia}, este tema no se resuelve de golpe: primero entendemos la idea base, después vemos cómo aparece en un caso fácil y por último lo aplicamos.`,
      objetivo,
      pasos: [
        `Identificar qué significa ${tema} con una definición simple.`,
        "Reconocer qué dato o idea principal aparece primero.",
        "Separar el problema en pasos cortos y claros.",
        "Recién después pasar a una aplicación concreta."
      ],
      ejemplo: ejemploSimplePorTema(tema)
    };
  }

  if (tipo === "ejemplo") {
    return {
      titulo: `Ejemplo guiado de ${tema}`,
      texto: `Ahora pasamos del concepto a un caso concreto. La idea es mirar un ejemplo corto y entender la lógica detrás de cada paso, no solo copiar el resultado.`,
      objetivo,
      pasos: [
        "Leer el ejemplo sin apurarse.",
        "Marcar qué dato cambia y qué dato se mantiene.",
        "Resolver un paso por vez.",
        "Revisar por qué el resultado tiene sentido."
      ],
      ejemplo: ejemploPorTema(tema)
    };
  }

  if (tipo === "preguntas") {
    return {
      titulo: `Mini práctica sobre ${tema}`,
      texto: `Te voy a ayudar a pensar el tema con preguntas. Esto sirve mucho para detectar si ya entendiste la idea o si todavía hay una parte para reforzar.`,
      objetivo,
      pasos: [
        `Definí con tus palabras qué es ${tema}.`,
        `Explicá qué parte de ${tema} te parece más difícil.`,
        "Decí cuál sería el primer paso para resolver algo relacionado.",
        "Compará tu respuesta con el ejemplo de la clase."
      ],
      ejemplo: "No busques responder perfecto. La idea es pensar, equivocarte si hace falta y corregir con la explicación."
    };
  }

  if (tipo === "resumen") {
    return {
      titulo: `Resumen rápido de ${tema}`,
      texto: `Este bloque condensa lo más importante de la clase para que puedas repasar sin perderte. Ideal para volver a mirar antes de una prueba o antes de practicar.`,
      objetivo,
      pasos: [
        `${tema} se entiende mejor si primero captás la idea principal.`,
        `En ${materia}, no alcanza con memorizar: hay que entender la lógica.`,
        `Para nivel ${nivel}, conviene combinar explicación + ejemplo + práctica.`,
        "Después del resumen, lo ideal es hacer un ejercicio corto."
      ],
      ejemplo: `Idea central para recordar: ${tema} no se estudia aislado, sino viendo cómo funciona en un caso real.`
    };
  }

  if (tipo === "ejercicio") {
    return {
      titulo: `Práctica guiada de ${tema}`,
      texto: `Ahora sí pasamos a una actividad. La clave es que no la resuelvas de memoria: tratá de justificar cada paso, incluso si dudás.`,
      objetivo,
      pasos: [
        "Leé la consigna completa.",
        "Subrayá qué te están pidiendo.",
        "Separá los pasos antes de resolver.",
        "Terminá y verificá si tu resultado tiene lógica."
      ],
      ejemplo: ejercicioPorTema(tema)
    };
  }

  return {
    titulo: `Arranquemos con ${tema}`,
    texto: `Esta clase de ${materia} está preparada para ${nivel}. Vamos a construir una explicación clara, con una base simple, un ejemplo concreto y una práctica guiada para que no quede solo en teoría.`,
    objetivo,
    pasos: [
      "Entender la idea principal del tema.",
      "Ver cómo se aplica en un ejemplo simple.",
      "Detectar los pasos importantes.",
      "Practicar con una consigna corta."
    ],
    ejemplo: ejemploPorTema(tema)
  };
}

function ejemploPorTema(tema) {
  const t = normalizar(tema);

  if (t.includes("algebra")) {
    return "Ejemplo: si x + 3 = 7, primero aislamos la variable. Restamos 3 a ambos lados y queda x = 4.";
  }

  if (t.includes("ecuacion")) {
    return "Ejemplo: 2x = 10. Para encontrar x, dividimos ambos lados por 2 y obtenemos x = 5.";
  }

  if (t.includes("fraccion")) {
    return "Ejemplo: 1/2 + 1/4. Llevamos ambas fracciones al mismo denominador: 1/2 = 2/4. Entonces 2/4 + 1/4 = 3/4.";
  }

  if (t.includes("porcentaje")) {
    return "Ejemplo: el 20% de 150 es 30, porque 150 × 0,20 = 30.";
  }

  if (t.includes("historia")) {
    return "Ejemplo: para estudiar un proceso histórico, conviene ubicar primero cuándo pasó, quiénes participaron y qué consecuencias dejó.";
  }

  if (t.includes("biologia")) {
    return "Ejemplo: si vemos la célula, primero diferenciamos sus partes y después analizamos qué función cumple cada una.";
  }

  if (t.includes("quimica")) {
    return "Ejemplo: antes de resolver una reacción, primero identificamos reactivos, productos y si la ecuación está balanceada.";
  }

  return `Ejemplo: tomamos una situación simple relacionada con ${tema}, identificamos la idea principal y resolvemos un paso por vez.`;
}

function ejemploSimplePorTema(tema) {
  const t = normalizar(tema);

  if (t.includes("algebra")) {
    return "Pensalo así: una letra como x representa un valor que todavía no sabemos. El trabajo consiste en descubrir cuánto vale.";
  }

  if (t.includes("fraccion")) {
    return "Una fracción muestra partes de un todo. Por ejemplo, 1/2 significa una de dos partes iguales.";
  }

  if (t.includes("historia")) {
    return "Para entender un hecho histórico, pensá primero qué pasó, después por qué pasó y recién ahí qué cambió.";
  }

  return `Versión simple: ${tema} se entiende mejor si primero lo describís con una idea corta y después lo ves aplicado.`;
}

function ejercicioPorTema(tema) {
  const t = normalizar(tema);

  if (t.includes("algebra")) {
    return "Resolvé: x + 5 = 12. Después explicá por qué hiciste ese paso.";
  }

  if (t.includes("ecuacion")) {
    return "Resolvé: 3x = 18. Intentá mostrar cada paso por separado.";
  }

  if (t.includes("fraccion")) {
    return "Calculá: 3/4 - 1/4. Después explicá por qué no tuviste que cambiar el denominador.";
  }

  if (t.includes("porcentaje")) {
    return "Calculá el 15% de 200 y explicá qué operación usaste.";
  }

  if (t.includes("historia")) {
    return "Elegí un acontecimiento relacionado con el tema y respondé: qué pasó, por qué pasó y qué consecuencias tuvo.";
  }

  if (t.includes("biologia")) {
    return "Nombrá tres partes clave del tema que estamos viendo y explicá una función de cada una.";
  }

  return `Hacé una actividad corta vinculada con ${tema}: definí la idea principal y aplicala en un caso simple.`;
}

function normalizar(texto = "") {
  return texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function escapeHTML(texto = "") {
  return String(texto).replace(/[&<>"']/g, (match) => {
    const escapes = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };
    return escapes[match];
  });
}

function mostrarError(texto) {
  errorBox.style.display = "block";
  errorBox.textContent = texto;
}

function ocultarLoader() {
  loader.style.display = "none";
}
