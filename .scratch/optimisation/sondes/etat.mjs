// Etat de la fenetre : document ouvert, taille image, taille canvas, calques.
import { connecter } from "./cdp.mjs";

const c = await connecter();
const etat = await c.evaluer(`(() => {
  const d = window.__shaderlabDebug;
  const cv = document.querySelector("canvas");
  const rect = cv ? cv.getBoundingClientRect() : null;
  return {
    pontDebug: !!d,
    canvas: cv ? { w: cv.width, h: cv.height, cssW: Math.round(rect.width), cssH: Math.round(rect.height) } : null,
    ratioPixels: cv && rect ? (cv.width * cv.height) / Math.max(1, rect.width * rect.height) : null,
    calques: d && d.state ? d.state().layers : null,
    developpement: d && d.developpement ? d.developpement() : null,
    dpr: window.devicePixelRatio,
  };
})()`);
console.log(JSON.stringify(etat, null, 2));
c.fermer();
