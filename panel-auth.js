import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  try {
    const nombre = localStorage.getItem("registroNombre") || "";
    const apellido = localStorage.getItem("registroApellido") || "";

    await setDoc(
      doc(db, "users", user.uid),
      {
        uid: user.uid,
        email: user.email || "",
        nombre,
        apellido,
        creadoEn: serverTimestamp()
      },
      { merge: true }
    );

    console.log("USUARIO GUARDADO EN FIRESTORE");
    localStorage.removeItem("registroNombre");
    localStorage.removeItem("registroApellido");
  } catch (error) {
    console.error("ERROR FIRESTORE PANEL:", error);
    alert("Firestore falló en panel: " + error.code + " | " + error.message);
  }
});
