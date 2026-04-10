import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const form = document.getElementById("clase-form");
let currentUser = null;

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  currentUser = user;
  console.log("Usuario logueado:", user.uid);
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  if (!currentUser) {
    alert("Todavía no cargó el usuario. Probá de nuevo en un segundo.");
    return;
  }

  const materia = document.getElementById("materia").value.trim();
  const tema = document.getElementById("tema").value.trim();
  const nivel = document.getElementById("nivel").value;

  if (!materia || !tema || !nivel) {
    alert("Completá todos los campos.");
    return;
  }

  try {
    const docRef = await addDoc(
      collection(db, "users", currentUser.uid, "clases"),
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
    console.error("Error al crear la clase:", error);
    alert("Error al crear la clase: " + error.message);
  }
});
