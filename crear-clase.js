import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const form = document.getElementById("clase-form");

let currentUser = null;

// asegurar que esté logueado
onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "login.html";
  } else {
    currentUser = user;
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const materia = document.getElementById("materia").value;
  const tema = document.getElementById("tema").value;
  const nivel = document.getElementById("nivel").value;

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

    // redirigir a la clase
    window.location.href = `clase.html?id=${docRef.id}`;

  } catch (error) {
    console.error(error);
    alert("Error al crear la clase");
  }
});
