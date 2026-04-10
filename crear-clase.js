import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const form = document.getElementById("clase-form");
let currentUser = null;

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "login.html";
  } else {
    currentUser = user;
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!currentUser) {
    alert("Todavía no cargó el usuario.");
    return;
  }

  const materia = document.getElementById("materia").value.trim();
  const tema = document.getElementById("tema").value.trim();
  const nivel = document.getElementById("nivel").value;

  try {
    const docRef = await addDoc(
      collection(db, "usuarios", currentUser.uid, "clases"),
      {
        materia,
        tema,
        nivel,
        creadoEn: serverTimestamp()
      }
    );

    console.log("Clase creada:", docRef.id);
    window.location.href = `clase.html?id=${docRef.id}`;
  } catch (error) {
    console.error(error);
    alert("Error al crear la clase: " + error.message);
  }
});

const archivoInput = document.getElementById("archivo");
const fileList = document.getElementById("file-list");

if (archivoInput && fileList) {
  archivoInput.addEventListener("change", () => {
    fileList.innerHTML = "";
    const files = Array.from(archivoInput.files || []);

    files.forEach(file => {
      const item = document.createElement("div");
      item.className = "file-item";
      item.textContent = `📄 ${file.name}`;
      fileList.appendChild(item);
    });
  });
}
