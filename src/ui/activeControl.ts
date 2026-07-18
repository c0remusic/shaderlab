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

function getActiveControl(): ControlHandle | null {
  return activeId ? (handles.get(activeId) ?? null) : null;
}

/** Arrondit à 6 décimales pour éviter les artefacts flottants (0.1+0.2…). */
function roundClean(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** Un cran de molette = 1% de la plage (max-min), indépendant du `step`
 *  déclaré (permet d'avancer vite sur les grandes plages comme Taille 2-200). */
export function wheelTickValue(handle: Pick<ControlHandle, "value" | "min" | "max">, deltaY: number): number {
  const direction = deltaY < 0 ? 1 : -1; // molette vers le haut = augmente
  const tick = (handle.max - handle.min) * 0.01;
  return roundClean(Math.min(handle.max, Math.max(handle.min, handle.value + direction * tick)));
}

/** Hook à monter UNE FOIS à la racine de l'app : Ctrl+molette n'importe où
 *  dans la fenêtre ajuste le dernier contrôle modifié. `preventDefault()`
 *  bloque aussi le zoom de page natif de WebView2 sur Ctrl+molette. */
export function useGlobalControlWheel(): void {
  useEffect(() => {
    let commitTimer: number | undefined;
    function handleWheel(event: WheelEvent) {
      if (!event.ctrlKey) return;
      const handle = getActiveControl();
      if (!handle) return;
      event.preventDefault();
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
