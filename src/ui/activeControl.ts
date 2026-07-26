import { useEffect } from "react";

export interface ControlHandle {
  value: number;
  min: number;
  max: number;
  /** Pas propre au contrôle (clavier flèches) — PAS utilisé par la molette,
   *  qui avance de 1% de la plage (min..max) quel que soit ce step. */
  step: number;
  onChange: (value: number) => void;
  onCommit?: () => void;
}

/**
 * Registre du « dernier contrôle numérique modifié ». Permet à un raccourci
 * global (Ctrl+molette n'importe où dans la fenêtre) d'ajuster un slider sans
 * que la souris le survole — utile en peignant (souris sur le canvas) pour
 * régler la taille du pinceau sans aller-retour vers l'inspecteur.
 *
 * `handles` mappe id→handle et est réécrit à CHAQUE RENDU de chaque `Slider`
 * monté (mutation de module, pas de state React) : lecture toujours fraîche,
 * coût = un `Map.set` par rendu, négligeable. `activeId` ne change que sur
 * une vraie modification de valeur (wheel propre au slider ou onChange), pas
 * au survol ni au focus — "dernière valeur MODIFIÉE", pas "dernière survolée".
 */
const handles = new Map<string, ControlHandle>();
let activeId: string | null = null;

export function registerControl(id: string, handle: ControlHandle): void {
  handles.set(id, handle);
}

export function unregisterControl(id: string): void {
  handles.delete(id);
}

export function markControlActive(id: string): void {
  activeId = id;
}

/** Exportée pour les tests (logique pure, pas de rendu de hook React) —
 *  reste un détail interne pour le reste de l'app, seul `useGlobalControlWheel`
 *  la consomme en usage réel. */
export function getActiveControl(): ControlHandle | null {
  return activeId ? (handles.get(activeId) ?? null) : null;
}

/** Arrondit à 6 décimales pour éviter les artefacts flottants (0.1+0.2…). */
function roundClean(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Un cran normal de molette (magnitude ~100, un clic de molette physique) =
 *  1% de la plage (max-min), indépendant du `step` déclaré. Un scroll plus
 *  FORT/RAPIDE (deltaY plus grand — molette qui s'emballe, ou trackpad)
 *  avance proportionnellement plus vite, jusqu'à 5% par évènement — parcourir
 *  toute la plage d'un slider à la molette ne demande plus des dizaines de
 *  crans (retour direct : "trop long de scroller toute la barre"). */
export function wheelTickValue(handle: Pick<ControlHandle, "value" | "min" | "max">, deltaY: number): number {
  const direction = deltaY < 0 ? 1 : -1; // molette vers le haut = augmente
  const magnitude = Math.min(5, Math.max(1, Math.abs(deltaY) / 100));
  const tick = (handle.max - handle.min) * 0.01 * magnitude;
  return roundClean(Math.min(handle.max, Math.max(handle.min, handle.value + direction * tick)));
}

export interface WheelAdjustContext {
  disabled: boolean;
  /** Le focus clavier est-il DANS le contrôle (thumb du slider ou champ de
   *  valeur) ? Base UI focalise l'`input[type=range]` caché du thumb au
   *  pointerdown (`SliderControl.js:248` focusThumb), donc « après un clic »
   *  vaut true au même titre qu'« après une tabulation ». */
  hasFocusWithin: boolean;
  /** Ctrl enfoncé ⇒ le geste appartient à `useGlobalControlWheel` (écouteur
   *  window), PAS au contrôle survolé. */
  ctrlKey: boolean;
}

/**
 * Décide si un évènement `wheel` reçu par un contrôle doit AJUSTER sa valeur
 * (true) ou être laissé au défilement du panneau (false).
 *
 * Le survol seul ne suffit PAS : sans focus, la molette au-dessus d'un panneau
 * dérèglait des paramètres pendant un simple défilement (le contenu glissant
 * sous le curseur, un seul geste pouvait toucher plusieurs contrôles). Le
 * contrôle doit avoir été délibérément saisi — clic ou tabulation.
 *
 * Ctrl+molette est EXCLU : ce geste appartient à `useGlobalControlWheel`
 * (écouteur window), qui doit de toute façon tirer sur chaque Ctrl+molette
 * pour bloquer le zoom natif de WebView2 — on ne peut donc pas le rendre
 * inerte sans rouvrir ce trou. Sans cette exclusion les deux écouteurs
 * tiraient ensemble : valeur avancée de deux crans et deux timers de commit
 * concurrents.
 */
export function shouldWheelAdjust({ disabled, hasFocusWithin, ctrlKey }: WheelAdjustContext): boolean {
  if (disabled) return false;
  if (ctrlKey) return false;
  return hasFocusWithin;
}

/** Hook à monter UNE FOIS à la racine de l'app : Ctrl+molette n'importe où
 *  dans la fenêtre ajuste le dernier contrôle modifié. `preventDefault()`
 *  bloque aussi le zoom de page natif de WebView2 sur Ctrl+molette. */
export function useGlobalControlWheel(): void {
  useEffect(() => {
    let commitTimer: number | undefined;
    function handleWheel(event: WheelEvent) {
      if (!event.ctrlKey) return;
      // Blocage du zoom natif WebView2 AVANT toute autre condition : tant
      // que ce preventDefault vivait après `if (!handle) return`, Ctrl+molette
      // zoomait toute l'application tant qu'aucun contrôle n'avait été
      // modifié dans la session — exactement l'inverse de l'intention
      // annoncée. `preventDefault` n'annule que l'action par défaut du
      // navigateur, il n'empêche AUCUN autre écouteur de recevoir
      // l'évènement : un futur zoom molette sur le canvas (PRD pan/zoom,
      // non implémenté) reste donc possible — et le voudra de toute façon,
      // puisqu'un zoom canvas n'a aucun intérêt si la page zoome en même
      // temps.
      event.preventDefault();
      const handle = getActiveControl();
      if (!handle) return;
      handle.onChange(wheelTickValue(handle, event.deltaY));
      if (handle.onCommit) {
        window.clearTimeout(commitTimer);
        commitTimer = window.setTimeout(handle.onCommit, 400);
      }
    }
    window.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      window.removeEventListener("wheel", handleWheel);
      window.clearTimeout(commitTimer);
    };
  }, []);
}
