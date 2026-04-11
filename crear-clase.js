import { auth, db } from "./firebase.js?v=7";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const form = document.getElementById("clase-form");
const archivoInput = document.getElementById("archivo");
const fileList = document.getElementById("file-list");

let currentUser = null;

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  currentUser = user;
});

form?.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!currentUser) {
    alert("Todavía no cargó el usuario. Probá de nuevo en un segundo.");
    return;
  }

  const materia = document.getElementById("materia")?.value.trim();
  const tema = document.getElementById("tema")?.value.trim();
  const nivel = document.getElementById("nivel")?.value;
  const duracion = document.getElementById("duracion")?.value;
  const objetivo = document.getElementById("objetivo")?.value.trim();

  if (!materia || !tema || !nivel) {
    alert("Completá materia, tema y nivel.");
    return;
  }

  try {
    const docRef = await addDoc(
      collection(db, "usuarios", currentUser.uid, "clases"),
      {
        materia,
        tema,
        nivel,
        duracion: duracion || "",
        objetivo: objetivo || "",
        creadoEn: serverTimestamp()
      }
    );

    console.log("Clase creada:", docRef.id);
    localStorage.setItem("claseActual", JSON.stringify({
  id: docRef.id,
  materia,
  tema,
  nivel,
  duracion: duracion || "",
  objetivo: objetivo || ""
}));
    window.location.href = `clase.html?id=${docRef.id}`;
  } catch (error) {
    console.error("Error al crear la clase:", error);
    alert("Error al crear la clase: " + error.message);
  }
});

if (archivoInput && fileList) {
  archivoInput.addEventListener("change", () => {
    fileList.innerHTML = "";

    const files = Array.from(archivoInput.files || []);

    files.forEach((file) => {
      const item = document.createElement("div");
      item.className = "file-item";
      item.textContent = `📄 ${file.name}`;
      fileList.appendChild(item);
    });
  });
}
