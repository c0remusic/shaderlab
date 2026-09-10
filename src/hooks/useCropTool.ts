import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyRatioToRect,
  cropRatioValue,
  DEFAULT_CROP_RATIO,
  initialCropRect,
  type CropRatioId,
  type CropRect,
} from "../ui/cropTool";
import type { CanvasFrameState } from "../layers/canvasFrame";

interface Params {
  /** L'outil Recadrer est-il actif (`canvasMode.kind === "canvasCrop"`) ? */
  active: boolean;
  imageSize: { width: number; height: number };
  /** Cadre committé courant, lu À L'ACTIVATION pour poser le rectangle de départ
   *  (le cadre courant s'il existe, pour l'agrandir, sinon la toile entière). */
  getCurrentCadre: () => CanvasFrameState;
  /** Valide le recadrage : `rect` est en pixels de la toile d'ORIGINE (l'image
   *  entière est montrée pendant l'outil, donc le rect EST absolu). App pose le
   *  cadre en absolu et committe. */
  onCommit: (rect: CropRect) => void;
}

/**
 * OUTIL DE RECADRAGE — l'état et le clavier de l'outil (ticket 32, tranche B).
 *
 * Extrait d'`App` dans un hook parce qu'`App.tsx` est déjà à la limite où
 * ajouter deux cents lignes fait ABANDONNER le compilateur React sur toute la
 * racine de composition (leçon `app-tsx-fait-abandonner-le-compilateur`). Toute
 * la géométrie vit dans `ui/cropTool.ts` (pur, testé) ; ce hook ne fait que
 * porter le rectangle de travail, le ratio, et brancher `Entrée`/double-clic.
 *
 * `Échap` n'est PAS géré ici : il est l'Échap global d'`App` qui QUITTE l'outil
 * (`escapeAction`), et quitter sans valider EST l'annulation — l'effet d'écran
 * repose alors le cadre committé, le rectangle de travail est simplement jeté.
 */
export function useCropTool({ active, imageSize, getCurrentCadre, onCommit }: Params) {
  const [rect, setRect] = useState<CropRect | null>(null);
  const [ratio, setRatioState] = useState<CropRatioId>(DEFAULT_CROP_RATIO);

  // (Ré)initialise à l'activation, par le patron « ajuster l'état pendant le
  // rendu » (React) plutôt qu'un effet : on compare l'activité courante à celle
  // du rendu précédent, et on repose le rectangle sur la transition. Un effet
  // ferait un rendu de plus et heurterait la règle `set-state-in-effect`.
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    setRect(
      active && imageSize.width > 0 && imageSize.height > 0
        ? initialCropRect(getCurrentCadre(), imageSize)
        : null,
    );
  }

  const setRatio = useCallback(
    (next: CropRatioId) => {
      setRatioState(next);
      setRect((current) =>
        current ? applyRatioToRect(current, cropRatioValue(next, imageSize), imageSize) : current,
      );
    },
    [imageSize],
  );

  /** Repose le rectangle de travail sur la toile entière — le bouton « Annuler
   *  le recadrage » quand l'outil est ouvert (App repose aussi le cadre committé
   *  à `null`). */
  const resetRectToFull = useCallback(() => {
    setRect(imageSize.width > 0 ? initialCropRect(null, imageSize) : null);
  }, [imageSize]);

  // État le plus récent pour l'écouteur ENTRÉE, synchronisé dans un EFFET :
  // écrire une ref dans un effet est permis, pendant le rendu non.
  const latest = useRef({ active, rect, onCommit });
  useEffect(() => {
    latest.current = { active, rect, onCommit };
  }, [active, rect, onCommit]);

  const validate = useCallback(() => {
    const state = latest.current;
    if (state.rect) state.onCommit(state.rect);
  }, []);

  // ENTRÉE valide. Écouteur global (le focus peut être n'importe où sur la
  // toile), mais jamais dans un champ de saisie — sinon valider un nom de preset
  // par Entrée recadrerait la toile.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!latest.current.active) return;
      if (event.key !== "Enter" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      }
      event.preventDefault();
      validate();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [validate]);

  return { rect, setRect, ratio, setRatio, resetRectToFull, validate };
}
