import { auth, db } from "./firebase.js?v=7";
import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  getDocs,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const loadingState = document.getElementById("loading-state");
const emptyState = document.getElementById("empty-state");
const classesGrid = document.getElementById("classes-grid");
const totalClases = document.getElementById("total-clases");
const logoutBtn = document.getElementById("logout");

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

  await cargarClases(user.uid);
});

async function cargarClases(uid) {
  try {
    const clasesRef = collection(db, "usuarios", uid, "clases");
    const q = query(clasesRef, orderBy("creadoEn", "desc"));
    const snapshot = await getDocs(q);

    loadingState.style.display = "none";
    totalClases.textContent = snapshot.size;

    if (snapshot.empty) {
      emptyState.style.display = "block";
      classesGrid.style.display = "none";
      return;
    }

    classesGrid.innerHTML = "";
    classesGrid.style.display = "grid";

    snapshot.forEach((docSnap) => {
      const clase = docSnap.data();
      const claseId = docSnap.id;

      const materia = clase.materia || "Sin materia";
      const tema = clase.tema || "Sin tema";
      const nivel = clase.nivel || "Sin nivel";
      const duracion = clase.duracion || "No definida";
      const objetivo = clase.objetivo || "Todavía no se agregó un objetivo.";
      const fechaTexto = formatearFecha(clase.creadoEn);

      const article = document.createElement("article");
      article.className = "class-card";
      article.innerHTML = `
        <div class="class-top">
          <div class="badge">📘</div>
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
            <span>ID de clase</span>
            <strong>${escapeHTML(claseId)}</strong>
          </div>
        </div>

        <div class="objective">
          <strong style="display:block; margin-bottom:6px; color:#352d43;">Objetivo</strong>
          ${escapeHTML(objetivo)}
        </div>

        <div class="card-actions">
          <a href="clase.html?id=${encodeURIComponent(claseId)}" class="btn btn-primary">Abrir clase</a>
          <a href="crear-clase.html" class="btn btn-soft">Crear otra</a>
        </div>
      `;

      classesGrid.appendChild(article);
    });
  } catch (error) {
    console.error("Error al cargar clases:", error);
    loadingState.innerHTML = `
      <strong>Error al cargar las clases</strong>
      Revisá la consola y confirmá que la colección exista en Firestore.
    `;
  }
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
