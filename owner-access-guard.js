import { auth } from "./firebase.js?v=7";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const SHARED_DOC_KEY = "eduvia_shared_doc_access";

function readSharedDocSession() {
  try {
    return JSON.parse(sessionStorage.getItem(SHARED_DOC_KEY) || "null");
  } catch {
    return null;
  }
}

function buildDocUrl(shared) {
  if (!shared?.claseId || !shared?.ownerUid) {
    return "login.html";
  }

  return `documento.html?id=${encodeURIComponent(shared.claseId)}&owner=${encodeURIComponent(shared.ownerUid)}`;
}

const sharedSession = readSharedDocSession();

onAuthStateChanged(auth, (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const isSharedGuest =
    sharedSession &&
    sharedSession.userUid === user.uid &&
    sharedSession.ownerUid !== user.uid;

  if (isSharedGuest) {
    window.location.replace(buildDocUrl(sharedSession));
    return;
  }

  document.body.style.visibility = "visible";
  document.body.style.opacity = "1";
});
