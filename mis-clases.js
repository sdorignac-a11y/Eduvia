import { auth, db } from "./firebase.js?v=7";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  getDocs,
  query,
  orderBy,
  deleteDoc,
  doc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const loadingState = document.getElementById("loading-state");
const emptyState = document.getElementById("empty-state");
const classesGrid = document.getElementById("classes-grid");
const totalClases = document.getElementById("total-clases");
const logoutBtn = document.getElementById("logout");

let currentUser = null;

logoutBtn?.addEventListener("click", async () => {
  try {
    await signOut(auth);
    window.location.href = "login.html";
  } catch (error) {
    console.error("Error al cerrar sesión:", error);
    alert("No se pudo cerrar sesión.");
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  currentUser = user;
  await cargarClases(user.uid);
});

async function cargarClases(uid) {
  mostrarCargando();

  try {
    const clasesRef = collection(db, "usuarios", uid, "clases");
    const q = query(clasesRef, orderBy("creadoEn", "desc"));
    const snapshot = await getDocs(q);

    totalClases.textContent = String(snapshot.size);

    if (snapshot.empty) {
      mostrarVacio();
      return;
    }

    classesGrid.innerHTML = "";
    classesGrid.style.display = "grid";
    loadingState.style.display = "none";
    emptyState.style.display = "none";

    snapshot.forEach((docSnap) => {
      const clase = docSnap.data() || {};
      const claseId = docSnap.id;
      const formato = normalizarFormato(clase.formato);

      const materia = clase.materia || "Sin materia";
      const tema = clase.tema || "Sin tema";
      const nivel = clase.nivel || "Sin nivel";
      const duracion = clase.duracion || "No definida";
      const objetivo = clase.objetivo || "Todavía no se agregó un objetivo.";
      const fechaTexto = formatearFecha(clase.creadoEn);

      const destino = buildClaseUrl(formato, claseId, uid);
      const textoBoton = formato === "documento" ? "Abrir documento" : "Abrir clase";
      const emoji = formato === "documento" ? "📄" : "📘";

      const article = document.createElement("article");
      article.className = "class-card";
      article.innerHTML = `
        <div class="class-top">
          <div class="badge">${emoji}</div>
          <div class="class-title">
            <h3>${escapeHTML(tema)}</h3>
            <p>${escapeHTML(materia)}</p>
          </div>
        </div>

        <div class="meta">
          <div class="meta-box">
            <span>Nivel</span>
            <strong>${escapeHTML(nivel)}</strong>
          </div>

          <div class="meta-box">
            <span>Duración</span>
            <strong>${escapeHTML(duracion)}</strong>
          </div>

          <div class="meta-box">
            <span>Fecha</span>
            <strong>${escapeHTML(fechaTexto)}</strong>
          </div>

          <div class="meta-box">
            <span>Formato</span>
            <strong>${escapeHTML(capitalizar(formato))}</strong>
          </div>
        </div>

        <div class="objective">
          <strong style="display:block; margin-bottom:6px; color:#352d43;">Objetivo</strong>
          ${escapeHTML(objetivo)}
        </div>

        <div class="card-actions">
          <a href="${destino}" class="btn btn-primary">${textoBoton}</a>
          <button
            type="button"
            class="btn btn-danger delete-class-btn"
            data-id="${claseId}"
            data-title="${escapeHTML(tema)}"
          >
            Eliminar
          </button>
        </div>
      `;

      classesGrid.appendChild(article);
    });
  } catch (error) {
    console.error("Error al cargar clases:", error);
    mostrarError();
  }
}

classesGrid?.addEventListener("click", async (e) => {
  const deleteBtn = e.target.closest(".delete-class-btn");
  if (!deleteBtn || !currentUser) return;

  const classId = deleteBtn.dataset.id;
  const classTitle = deleteBtn.dataset.title || "esta clase";

  const confirmar = window.confirm(
    `¿Seguro que querés eliminar "${classTitle}"?\n\nEsta acción no se puede deshacer.`
  );

  if (!confirmar) return;

  const textoOriginal = deleteBtn.textContent;
  deleteBtn.disabled = true;
  deleteBtn.textContent = "Eliminando...";

  try {
    await deleteDoc(doc(db, "usuarios", currentUser.uid, "clases", classId));

    const card = deleteBtn.closest(".class-card");
    if (card) {
      card.remove();
    }

    const totalActual = Number(totalClases.textContent || "0");
    totalClases.textContent = String(Math.max(0, totalActual - 1));

    if (!classesGrid.children.length) {
      mostrarVacio();
      if (totalClases) totalClases.textContent = "0";
    }
  } catch (error) {
    console.error("Error al eliminar clase:", error);
    alert("No se pudo eliminar la clase.");
    deleteBtn.disabled = false;
    deleteBtn.textContent = textoOriginal;
  }
});

function mostrarCargando() {
  if (loadingState) loadingState.style.display = "block";
  if (emptyState) emptyState.style.display = "none";
  if (classesGrid) {
    classesGrid.style.display = "none";
    classesGrid.innerHTML = "";
  }
  if (totalClases) totalClases.textContent = "0";
}

function mostrarVacio() {
  if (loadingState) loadingState.style.display = "none";
  if (emptyState) emptyState.style.display = "block";
  if (classesGrid) classesGrid.style.display = "none";
}

function mostrarError() {
  if (!loadingState) return;

  loadingState.style.display = "block";
  loadingState.innerHTML = `
    <strong>Error al cargar las clases</strong>
    Revisá la consola y confirmá que la colección exista en Firestore.
  `;

  if (emptyState) emptyState.style.display = "none";
  if (classesGrid) classesGrid.style.display = "none";
}

function normalizarFormato(formato = "") {
  return String(formato || "").trim().toLowerCase() === "documento"
    ? "documento"
    : "pizarron";
}

function buildClaseUrl(formato, claseId, ownerUid) {
  const base = formato === "documento" ? "documento.html" : "clase.html";
  return `${base}?id=${encodeURIComponent(claseId)}&owner=${encodeURIComponent(ownerUid)}`;
}

function capitalizar(texto = "") {
  const limpio = String(texto || "").trim();
  if (!limpio) return "";
  return limpio.charAt(0).toUpperCase() + limpio.slice(1);
}

function formatearFecha(timestamp) {
  if (!timestamp || typeof timestamp.toDate !== "function") {
    return "Recién creada";
  }

  const fecha = timestamp.toDate();

  return fecha.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function escapeHTML(valor) {
  return String(valor).replace(/[&<>"']/g, (match) => {
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
