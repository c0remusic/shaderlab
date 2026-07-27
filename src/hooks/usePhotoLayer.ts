import { useCallback, useEffect, useState, type MutableRefObject, type RefObject } from "react";
import type { DocumentSession } from "../application/documentSession";
import type { LayerStack } from "../layers/layerStack";
import type { LayerState, LayerTransform } from "../layers/types";
import { MAX_PHOTO_LAYERS, canAddPhotoLayer } from "../layers/photoLayer";
import type { Renderer } from "../render/renderer";
import { pickImageFile, readImageFile } from "../launch";
import { messageFromUnknown } from "../lib/errors";
import {
  IDLE_CANVAS_MODE,
  isMaskPaint,
  reconcileCanvasMode,
  showsTransformHandles,
  toggleMaskPaint,
  type CanvasMode,
} from "../ui/canvasMode";

/** Basename d'un chemin Windows ou POSIX — même extraction que celle déjà
 *  utilisée pour le titre de la Toolbar (`App.tsx`, `sourcePath.split(...)`).
 *  Rend `null` plutôt qu'une chaîne vide pour qu'un chemin dégénéré ne pose
 *  pas un `name` vide sur le calque (l'affichage retomberait alors sur un nom
 *  invisible au lieu du nom de l'effet). */
export function basename(path: string): string | null {
  const last = path.split(/[\\/]/).pop();
  return last && last.length > 0 ? last : null;
}

interface Deps {
  sessionRef: RefObject<DocumentSession>;
  rendererRef: RefObject<Renderer | null>;
  /** Dimensions de la photo de FOND : la transform initiale centre la photo
   *  importée dessus. */
  imageSize: { width: number; height: number };
  /** Partagé avec les sliders de paramètres d'`App` : un commit ne pousse une
   *  entrée d'historique que si une valeur a réellement bougé. Reste possédé
   *  par `App` — plusieurs features l'arment. */
  paramDirtyRef: MutableRefObject<boolean>;
  commit: (stack: LayerStack) => void;
  currentStack: () => LayerStack;
  selectLayer: (id: string | null) => void;
  syncSession: () => void;
  setError: (message: string | null) => void;
  /** Lus pour la réconciliation du mode canvas (retour forcé en `idle`). */
  selectedId: string | null;
  layers: LayerState[];
}

/**
 * Tout ce qui est propre au CALQUE PHOTO (double exposure / parité
 * Photoshop) : mode d'interaction du canvas, import, et édition de transform.
 *
 * Extrait d'`App.tsx` en T1 sur le modèle exact de `usePresets`
 * (`ARCHITECTURE.md` §7 R6 : « chaque feature apporte son propre hook module
 * [...] pour qu'`App.tsx` gagne quelques lignes de câblage et non ~150 »).
 * RESTENT dans `App.tsx` : la sélection, l'historique, l'export, les presets
 * — ce hook ne prend que ce qui est propre au calque photo. Les tranches
 * suivantes (barre contextuelle, flip, crop, changement d'effet) déposent
 * leurs handlers ICI, pas dans `App.tsx`.
 */
export function usePhotoLayer({
  sessionRef,
  rendererRef,
  imageSize,
  paramDirtyRef,
  commit,
  currentStack,
  selectLayer,
  syncSession,
  setError,
  selectedId,
  layers,
}: Deps) {
  const [canvasMode, setCanvasMode] = useState<CanvasMode>(IDLE_CANVAS_MODE);

  // Garde structurel du mode `crop` (design §3.4) : un mode attaché à un
  // calque qui n'est plus sélectionné — ou qui a disparu (suppression, undo,
  // changement de document) — dessinerait ses poignées sur un AUTRE calque et
  // `Échap` y restaurerait le crop du premier. Abandon forcé, jamais de
  // restauration silencieuse. `reconcileCanvasMode` rend le mode inchangé par
  // identité quand rien ne doit bouger, donc ce `setState` est un no-op React
  // dans le cas courant.
  useEffect(() => {
    setCanvasMode((mode) => reconcileCanvasMode(mode, selectedId, layers.map((l) => l.id)));
  }, [selectedId, layers]);

  /** Importe une photo depuis un chemin ABSOLU déjà connu — extrait de
   *  `handleImportPhotoLayer` pour que le chemin soit fournissable autrement
   *  que par le dialogue natif. Consommé par le pont de debug dev-only
   *  (`App.tsx`), qui permet de piloter un import depuis CDP : le dialogue
   *  natif n'est pilotable ni par CDP ni par computer-use sur ce projet
   *  (limite documentée dans CLAUDE.md), donc sans ce point d'entrée aucune
   *  mesure ni aucun test de bout en bout impliquant un calque photo n'est
   *  possible sur la vraie fenêtre. */
  const importPhotoFromPath = useCallback(async (path: string) => {
    if (!rendererRef.current?.photoSources) return;
    if (!canAddPhotoLayer(sessionRef.current.layers())) {
      setError(
        `Limite atteinte : au plus ${MAX_PHOTO_LAYERS} photo${MAX_PHOTO_LAYERS > 1 ? "s" : ""} importée${MAX_PHOTO_LAYERS > 1 ? "s" : ""} (double exposure) par document.`,
      );
      return;
    }
    try {
      const bytes = await readImageFile(path);
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "image/jpeg" });
      const bitmap = await createImageBitmap(blob);
      // `register` est ATTENDU (il produit la vignette) avant `addPhotoLayer`,
      // pour que le re-render qui crée la ligne ait déjà sa vignette — sinon
      // elle n'apparaîtrait qu'au prochain re-render fortuit.
      const sourceId = await rendererRef.current.photoSources.register(bitmap);
      const transform: LayerTransform = { x: imageSize.width / 2, y: imageSize.height / 2, scale: 1, rotation: 0 };
      const stack = currentStack();
      const id = stack.addPhotoLayer(sourceId, transform, basename(path) ?? undefined);
      commit(stack);
      selectLayer(id);
      setError(null);
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }, [rendererRef, sessionRef, setError, commit, currentStack, imageSize.width, imageSize.height, selectLayer]);

  const handleImportPhotoLayer = useCallback(async () => {
    try {
      const path = await pickImageFile();
      if (!path) return;
      await importPhotoFromPath(path);
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }, [importPhotoFromPath, setError]);

  const handleTransformChange = useCallback(
    (id: string, transform: LayerTransform) => {
      const previous = sessionRef.current.layers().find((l) => l.id === id);
      if (previous?.transform && (previous.transform.x !== transform.x || previous.transform.y !== transform.y || previous.transform.scale !== transform.scale || previous.transform.rotation !== transform.rotation)) {
        paramDirtyRef.current = true;
      }
      const full = sessionRef.current.layers().map((l) => (l.id === id ? { ...l, transform } : l));
      sessionRef.current.replaceLiveLayers(full);
      syncSession();
      rendererRef.current?.requestRender(full);
    },
    [sessionRef, rendererRef, paramDirtyRef, syncSession],
  );

  const handleTransformCommit = useCallback(() => {
    if (!paramDirtyRef.current) return;
    paramDirtyRef.current = false;
    commit(currentStack());
  }, [paramDirtyRef, commit, currentStack]);

  const toggleMaskPaintMode = useCallback(() => setCanvasMode(toggleMaskPaint), []);
  const stopMaskPaintMode = useCallback(() => setCanvasMode(IDLE_CANVAS_MODE), []);

  /** Lecture de la vignette d'un calque photo, injectée dans `LayerPanel`.
   *  Référence STABLE (la ref, pas le store, est la dépendance) : elle
   *  traverse la mémoïsation de `LayerRow`. */
  const thumbnailUrl = useCallback(
    (sourceId: string) => rendererRef.current?.photoSources?.thumbnailUrl(sourceId) ?? null,
    [rendererRef],
  );

  return {
    canvasMode,
    maskPaintMode: isMaskPaint(canvasMode),
    showTransformHandles: showsTransformHandles(canvasMode),
    toggleMaskPaintMode,
    stopMaskPaintMode,
    handleImportPhotoLayer,
    importPhotoFromPath,
    handleTransformChange,
    handleTransformCommit,
    thumbnailUrl,
  };
}
