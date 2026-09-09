import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./design/index.css";
import "./design/tailwind.css";

/**
 * MENU CONTEXTUEL NATIF DE WEBVIEW2 SUPPRIMÉ (ticket 28). Sans ça, un clic droit
 * n'importe où sert le menu de navigateur de WebView2 (« Actualiser »,
 * « Inspecter »…), qui n'a aucun sens dans une app desktop et masque nos propres
 * menus. On l'annule au niveau du document, en phase de bulle : nos déclencheurs
 * `ContextMenu` (Base UI) ont déjà ouvert LEUR menu sur l'élément visé quand
 * l'événement remonte jusqu'ici, donc les annuler ici n'empêche rien — ça ne
 * fait que retirer le menu du navigateur qui se serait ajouté par-dessus.
 *
 * EXCEPTION : les champs de SAISIE gardent leur menu natif copier/coller, seul
 * endroit où il rend service. La cible peut être un nœud imbriqué (l'`input`
 * d'un `contenteditable`, un enfant d'un `textarea` custom), d'où le `closest`.
 *
 * PAS de condition sur `import.meta.env.DEV` (décision ticket 28) : un menu qui
 * diffère entre dev et prod est un défaut qu'on ne voit qu'en prod. « Inspecter »
 * reste joignable en dev par F12 / le port CDP.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest("input, textarea, [contenteditable]:not([contenteditable=\"false\"])") !== null
  );
}
document.addEventListener("contextmenu", (event) => {
  if (isEditableTarget(event.target)) return;
  event.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
