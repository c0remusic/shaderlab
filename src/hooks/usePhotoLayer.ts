import { useCallback, useEffect, useState, type MutableRefObject, type RefObject } from "react";
import type { DocumentSession } from "../application/documentSession";
import type { LayerStack } from "../layers/layerStack";
import type { LayerState, LayerTransform } from "../layers/types";
import { MAX_PHOTO_LAYERS, canAddPhotoLayer } from "../layers/photoLayer";
import type { Renderer } from "../render/renderer";
import { pickImageFile, readImageFile } from "../launch";
import { messageFromUnknown } from "../lib/errors";
import { centerTransform, fitToCanvas, resetTransform } from "../ui/transform";
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
  /** Synchronisation React COALESCÉE sur rAF (voir `App.syncScheduler`) : le
   *  chemin vivant d'un drag l'appelle par échantillon de pointeur, elle ne
   *  coûte qu'un `setLayers` par frame. */
  scheduleSync: () => void;
  /** Force l'exécution immédiate d'une synchronisation coalescée en attente.
   *  Appelée en FIN DE GESTE — sans elle, la dernière position d'un drag
   *  n'atteindrait l'état React qu'à la frame suivante, après le commit. */
  flushSync: () => void;
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
  scheduleSync,
  flushSync,
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reconciliation d'un etat local sur une pile/selection qui a change SOUS lui : `reconcileCanvasMode` rend le mode inchange par IDENTITE quand rien ne bouge, donc aucun rendu en cascade dans le cas courant.
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
      const transform: LayerTransform = { x: imageSize.width / 2, y: imageSize.height / 2, scaleX: 1, scaleY: 1, rotation: 0 };
      const stack = currentStack();
      // La photo s'insère JUSTE AU-DESSUS du calque sélectionné (parité
      // Photoshop, `LayerStack.insertIndexAfter`) ; sans sélection, en haut de
      // pile. La sélection passe ensuite sur la photo importée — inchangé.
      const id = stack.addPhotoLayer(sourceId, transform, basename(path) ?? undefined, selectedId);
      commit(stack);
      selectLayer(id);
      setError(null);
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }, [rendererRef, sessionRef, setError, commit, currentStack, imageSize.width, imageSize.height, selectLayer, selectedId]);

  /** Remplace l'IMAGE du calque photo `id` par celle du fichier `path`
   *  (tranche T2). Séparé du dialogue natif pour la même raison
   *  qu'`importPhotoFromPath` : c'est le seul point d'entrée pilotable depuis
   *  CDP sur la vraie fenêtre.
   *
   *  Le VERROU est consulté AVANT toute lecture de fichier et tout
   *  enregistrement de source. `LayerStack.setLayerImageSource` le refuserait
   *  de toute façon, mais après coup : une source aurait déjà été enregistrée,
   *  et comme rien n'est jamais libéré (`PhotoSourceStore`, pas de refcount),
   *  un clic sur un calque verrouillé consommerait un jeton
   *  `MAX_REGISTERED_PHOTO_SOURCES` pour rien.
   *
   *  N'INCRÉMENTE PAS le nombre de calques photo : `canAddPhotoLayer` n'a donc
   *  rien à dire ici, contrairement à l'import. Le plafond qui s'applique est
   *  celui des SOURCES enregistrées, et il est tenu par `register` lui-même —
   *  qui lève, message et sortie compris ; la levée atterrit dans le `catch`
   *  ci-dessous et donc dans la bannière d'erreur, jamais dans le silence. */
  const replacePhotoImageFromPath = useCallback(async (id: string, path: string) => {
    if (!rendererRef.current?.photoSources) return;
    const layer = sessionRef.current.layers().find((l) => l.id === id);
    if (!layer?.imageSource) return;
    if (layer.locked === true) {
      setError("Calque verrouillé : déverrouille-le pour remplacer son image.");
      return;
    }
    try {
      const bytes = await readImageFile(path);
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "image/jpeg" });
      const bitmap = await createImageBitmap(blob);
      const sourceId = await rendererRef.current.photoSources.register(bitmap);
      const stack = currentStack();
      // Le nom du calque suit l'image, dans le MÊME appel donc la MÊME entrée
      // d'historique (voir `setLayerImageSource`). `basename` peut rendre
      // `null` sur un chemin dégénéré : le nom reste alors inchangé plutôt que
      // de devenir vide.
      if (!stack.setLayerImageSource(id, sourceId, basename(path) ?? undefined)) {
        // `sourceId` est frais à chaque appel : un refus ici ne peut venir que
        // d'une cible devenue invalide pendant les `await` (calque supprimé,
        // undo, verrouillage). On le DIT — sans quoi le clic resterait sans
        // effet ni explication.
        setError("Remplacement impossible : le calque photo visé n'est plus disponible.");
        return;
      }
      commit(stack);
      setError(null);
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }, [rendererRef, sessionRef, setError, commit, currentStack]);

  const handleReplacePhotoImage = useCallback(async (id: string) => {
    try {
      const path = await pickImageFile();
      if (!path) return;
      await replacePhotoImageFromPath(id, path);
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }, [replacePhotoImageFromPath, setError]);

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
      if (previous?.transform && (previous.transform.x !== transform.x || previous.transform.y !== transform.y || previous.transform.scaleX !== transform.scaleX || previous.transform.scaleY !== transform.scaleY || previous.transform.rotation !== transform.rotation)) {
        paramDirtyRef.current = true;
      }
      const full = sessionRef.current.layers().map((l) => (l.id === id ? { ...l, transform } : l));
      sessionRef.current.replaceLiveLayers(full);
      // COALESCÉ (mesure CPU 2026-07-30 : 21,9 ms de CPU par `pointermove`
      // brut, un rendu de l'arbre React entier par échantillon). La session et
      // le rendu GPU restent, eux, sur le chemin brut : `requestRender` a son
      // propre `FrameScheduler` depuis toujours — c'est l'asymétrie que ce
      // coalescing supprime. Même motif que `Canvas.schedulePaint`.
      scheduleSync();
      rendererRef.current?.requestRender(full);
    },
    [sessionRef, rendererRef, paramDirtyRef, scheduleSync],
  );

  const handleTransformCommit = useCallback(() => {
    // AVANT la garde `paramDirtyRef` : la dernière position du geste peut
    // encore être en attente dans le scheduler, et elle doit atteindre l'état
    // React quoi qu'il arrive — y compris quand le geste n'a rien sali (clic
    // sans mouvement) et qu'on sort sans committer.
    flushSync();
    if (!paramDirtyRef.current) return;
    paramDirtyRef.current = false;
    commit(currentStack());
  }, [flushSync, paramDirtyRef, commit, currentStack]);

  /** Applique une transformation PURE (`src/ui/transform.ts`) au calque photo
   *  `id` et committe en UNE seule entrée d'historique. Les trois actions du
   *  panneau Photo (Réinitialiser · Ajuster à la toile · Centrer) passent
   *  toutes par ici : elles ne diffèrent que par la fonction pure appliquée.
   *  No-op si le calque n'existe plus ou n'est pas un calque photo — cas
   *  inatteignable depuis le panneau, qui n'affiche ses boutons que pour un
   *  calque photo sélectionné (`PhotoPanel.tsx`, garde d'état vide).
   *
   *  Ne demande PAS les dimensions de la source : `resetTransform` et
   *  `centerTransform` ne s'en servent pas (`transform.ts`, elles ne lisent
   *  que la taille du FOND). Seul « Ajuster à la toile » en a besoin, et il
   *  les résout lui-même — les exiger ici transformait deux actions
   *  parfaitement calculables en no-op silencieux. */
  const applyTransformAction = useCallback(
    (id: string, produce: (transform: LayerTransform) => LayerTransform) => {
      const layer = sessionRef.current.layers().find((l) => l.id === id);
      if (!layer?.imageSource || !layer.transform) return;
      handleTransformChange(id, produce(layer.transform));
      handleTransformCommit();
    },
    [sessionRef, handleTransformChange, handleTransformCommit],
  );

  const handlePhotoReset = useCallback(
    (id: string) => applyTransformAction(id, () => resetTransform(imageSize)),
    [applyTransformAction, imageSize],
  );
  const handlePhotoCenter = useCallback(
    (id: string) => applyTransformAction(id, (transform) => centerTransform(transform, imageSize)),
    [applyTransformAction, imageSize],
  );

  /** « Ajuster à la toile » est la SEULE des trois actions qui a besoin des
   *  dimensions de la photo source (le rapport photo/fond donne l'échelle
   *  *contain*). Si le store ne les connaît pas, l'action ne peut pas être
   *  calculée : elle le DIT, elle ne se tait pas (fail-fast projet). */
  const handlePhotoFitToCanvas = useCallback(
    (id: string) => {
      const layer = sessionRef.current.layers().find((l) => l.id === id);
      if (!layer?.imageSource || !layer.transform) return;
      const photoSize = rendererRef.current?.photoSources?.dimensions(layer.imageSource.sourceId);
      if (!photoSize) {
        setError("« Ajuster à la toile » indisponible : les dimensions de la photo source sont inconnues (source non enregistrée). Réimporte la photo.");
        return;
      }
      applyTransformAction(id, (transform) => fitToCanvas(transform, imageSize, photoSize));
    },
    [sessionRef, rendererRef, setError, applyTransformAction, imageSize],
  );

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
    /** Pose un mode ARBITRAIRE. Exposé pour la palette d'outils
     *  (`src/ui/tools.ts`), qui calcule l'état complet — mode, effacement,
     *  main — en une fois : la bascule et l'arrêt ci-dessus ne savent
     *  exprimer que deux des transitions dont elle a besoin. */
    setCanvasMode,
    handleImportPhotoLayer,
    importPhotoFromPath,
    handleReplacePhotoImage,
    replacePhotoImageFromPath,
    handleTransformChange,
    handleTransformCommit,
    handlePhotoReset,
    handlePhotoFitToCanvas,
    handlePhotoCenter,
    thumbnailUrl,
  };
}
