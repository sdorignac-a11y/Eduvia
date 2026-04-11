import { auth, db } from "./firebase.js?v=7";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const topbarTitle = document.getElementById("topbar-title");
const docTitle = document.getElementById("doc-title");

const chipMateria = document.getElementById("chip-materia");
const chipNivel = document.getElementById("chip-nivel");
const chipDuracion = document.getElementById("chip-duracion");

const metaMateria = document.getElementById("meta-materia");
const metaNivel = document.getElementById("meta-nivel");
const metaDuracion = document.getElementById("meta-duracion");

const docObjective = document.getElementById("doc-objective");
const docContent = document.getElementById("doc-content");

const params = new URLSearchParams(window.location.search);
const claseId = params.get("id");

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function readClaseFromLocalStorage() {
  try {
    return JSON.parse(localStorage.getItem("claseActual") || "null");
  } catch {
    return null;
  }
}

function setBasicMeta(clase = {}) {
  const tema = clase.tema || "Documento sin título";
  const materia = clase.materia || "Sin materia";
  const nivel = clase.nivel || "No definido";
  const duracion = clase.duracion || "No definida";
  const objetivo = clase.objetivo || "";

  if (topbarTitle) topbarTitle.textContent = tema;
  if (docTitle) docTitle.textContent = tema;

  if (chipMateria) chipMateria.textContent = `Materia: ${materia}`;
  if (chipNivel) chipNivel.textContent = `Nivel: ${nivel}`;
  if (chipDuracion) chipDuracion.textContent = `Duración: ${duracion}`;

  if (metaMateria) metaMateria.textContent = `Materia: ${materia}`;
  if (metaNivel) metaNivel.textContent = `Nivel: ${nivel}`;
  if (metaDuracion) metaDuracion.textContent = `Duración: ${duracion}`;

  if (docObjective) {
    docObjective.textContent = objetivo
      ? `Objetivo: ${objetivo}`
      : "Objetivo: todavía no se definió un objetivo para esta clase.";
  }
}

function renderError(message) {
  if (!docContent) return;

  docContent.innerHTML = `
    <div class="doc-placeholder">
      <p><strong>No se pudo cargar el documento.</strong></p>
      <p>${escapeHtml(message)}</p>
    </div>
  `;
}

function renderGeneratedStructure(clase = {}) {
  if (!docContent) return;

  const materia = escapeHtml(clase.materia || "la materia");
  const tema = escapeHtml(clase.tema || "este tema");
  const nivel = escapeHtml(clase.nivel || "el nivel seleccionado");
  const duracion = escapeHtml(clase.duracion || "la duración indicada");
  const objetivo = escapeHtml(clase.objetivo || "comprender mejor el contenido trabajado");

  docContent.innerHTML = `
    <h2>Resumen</h2>
    <p>
      Este documento organiza la clase de <strong>${materia}</strong> sobre
      <strong>${tema}</strong> en un formato claro y fácil de estudiar.
      Está pensado para una explicación adaptada a <strong>${nivel}</strong>,
      con una duración estimada de <strong>${duracion}</strong>.
    </p>

    <p>
      El foco principal de esta clase es <strong>${objetivo}</strong>.
      Por eso, el contenido debería avanzar de forma ordenada, con definiciones,
      explicación paso a paso y ejemplos simples antes de pasar a ideas más complejas.
    </p>

    <h2>Desarrollo del tema</h2>
    <p>
      En esta sección la IA va a volcar la explicación principal del tema. La idea es que
      se vea como un apunte serio: limpio, entendible y útil para repasar después.
    </p>

    <p>
      Según la materia y el nivel, acá después pueden aparecer fórmulas, conceptos,
      definiciones, reglas, vocabulario, fechas importantes, procesos, ejemplos o análisis.
    </p>

    <h2>Puntos clave</h2>
    <ul>
      <li>La clase está centrada en el tema: <strong>${tema}</strong>.</li>
      <li>El contenido debe estar adaptado al nivel: <strong>${nivel}</strong>.</li>
      <li>El objetivo principal es: <strong>${objetivo}</strong>.</li>
      <li>Este formato documento sirve para leer, repasar y estudiar con más claridad.</li>
    </ul>

    <h2>Ejemplo o aplicación</h2>
    <p>
      Más adelante, esta parte puede mostrar un ejemplo guiado o una aplicación concreta
      del contenido para que el alumno no solo lea teoría, sino que también vea cómo se usa.
    </p>

    <blockquote>
      Este documento es una base visual. El próximo paso es conectar la generación real
      del contenido con IA para que acá aparezca la explicación completa automáticamente.
    </blockquote>

    <h2>Cierre</h2>
    <p>
      Al final de la clase, este mismo documento puede resumir lo más importante y servir
      como punto de partida para crear ejercicios, tarjetas de memoria o un resumen más corto.
    </p>
  `;
}

function renderStructuredDocumento(clase = {}) {
  if (!docContent) return false;

  const contenido = clase.documento || clase.contenidoDocumento || clase.contenido || null;

  if (!contenido || typeof contenido !== "object" || Array.isArray(contenido)) {
    return false;
  }

  const resumen = escapeHtml(contenido.resumen || "");
  const explicacion = escapeHtml(contenido.explicacion || "");
  const ejemplo = escapeHtml(contenido.ejemplo || "");
  const cierre = escapeHtml(contenido.cierre || "");

  const puntosClave = Array.isArray(contenido.puntosClave) ? contenido.puntosClave : [];
  const preguntas = Array.isArray(contenido.preguntas) ? contenido.preguntas : [];

  let html = "";

  if (resumen) {
    html += `
      <h2>Resumen</h2>
      <p>${resumen}</p>
    `;
  }

  if (explicacion) {
    html += `
      <h2>Desarrollo del tema</h2>
      <p>${explicacion}</p>
    `;
  }

  if (puntosClave.length) {
    html += `<h2>Puntos clave</h2><ul>`;
    html += puntosClave
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
    html += `</ul>`;
  }

  if (ejemplo) {
    html += `
      <h2>Ejemplo o aplicación</h2>
      <p>${ejemplo}</p>
    `;
  }

  if (preguntas.length) {
    html += `<h2>Preguntas para practicar</h2><ol>`;
    html += preguntas
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
    html += `</ol>`;
  }

  if (cierre) {
    html += `
      <h2>Cierre</h2>
      <p>${cierre}</p>
    `;
  }

  if (!html.trim()) return false;

  docContent.innerHTML = html;
  return true;
}

function renderPlainTextDocumento(clase = {}) {
  if (!docContent) return false;

  const rawText =
    clase.documentoTexto ||
    clase.textoDocumento ||
    clase.contenidoTexto ||
    "";

  if (!rawText || typeof rawText !== "string") return false;

  const blocks = rawText
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (!blocks.length) return false;

  docContent.innerHTML = blocks
    .map((block, index) => {
      if (index === 0) {
        return `<p><strong>${escapeHtml(block)}</strong></p>`;
      }
      return `<p>${escapeHtml(block)}</p>`;
    })
    .join("");

  return true;
}

function renderClase(clase = {}) {
  setBasicMeta(clase);

  const renderedStructured = renderStructuredDocumento(clase);
  if (renderedStructured) return;

  const renderedText = renderPlainTextDocumento(clase);
  if (renderedText) return;

  renderGeneratedStructure(clase);
}

async function loadClase(user) {
  const localClase = readClaseFromLocalStorage();

  if (!claseId) {
    if (localClase) {
      renderClase(localClase);
      return;
    }

    renderError("No se encontró el identificador de la clase.");
    return;
  }

  try {
    const claseRef = doc(db, "usuarios", user.uid, "clases", claseId);
    const claseSnap = await getDoc(claseRef);

    if (claseSnap.exists()) {
      const claseData = {
        id: claseSnap.id,
        ...claseSnap.data()
      };

      localStorage.setItem("claseActual", JSON.stringify(claseData));
      renderClase(claseData);
      return;
    }

    if (localClase) {
      renderClase(localClase);
      return;
    }

    renderError("La clase no existe o no se pudo encontrar en Firestore.");
  } catch (error) {
    console.error("Error al cargar la clase:", error);

    if (localClase) {
      renderClase(localClase);
      return;
    }

    renderError(error.message || "Hubo un problema al cargar la clase.");
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  await loadClase(user);
});
