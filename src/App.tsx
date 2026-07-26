import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { initGpu, type GpuContext } from "./render/gpuContext";
import { Renderer } from "./render/renderer";
import { LayerStack } from "./layers/layerStack";
import type { LayerState } from "./layers/types";
import { canAddPhotoLayer, hasPhotoLayer } from "./layers/photoLayer";
import { DocumentSession } from "./application/documentSession";
import { BrushToolbar } from "./components/BrushToolbar";
import { Canvas } from "./components/Canvas";
import { Toolbar } from "./components/Toolbar";
import { TransformHandles } from "./components/TransformHandles";
import { ErrorBanner } from "./components/ErrorBanner";
import { exportImage, resolveExportTargetAsync, resolveDefaultExportTarget } from "./export/exportImage";
import { messageFromUnknown } from "./lib/errors";
import {
  getLaunchPath,
  readImageFile,
  pickImageFile,
  logDiagnostic,
  writeImageFile,
  pathExists,
  defaultExportDir,
  pickExportFolder,
  joinExportTarget,
} from "./launch";
import { useGlobalControlWheel } from "./ui/activeControl";
import { getSyncedMaskPainter, type MaskPainterEntry } from "./mask/maskPainterSync";
import { getBrushRaster } from "./mask/brushSource";
import { PanelColumn } from "./components/dockedPanel/PanelColumn";
import { movePanelInDock, toFullDockTarget, visibleDockLayout, type DockDropTarget, type DockLayout } from "./ui/dockLayout";
import { clampDockWidth } from "./components/dockedPanel/dockWidth";
import { LayerPanel } from "./components/LayerPanel";
import { ParamPanel } from "./components/ParamPanel";
import { MaskPanel } from "./components/MaskPanel";
import { getEffect } from "./render/effects/registry";
import type { RefineEdgeParams } from "./mask/types";
import { MAX_COLOR_RANGE_SAMPLES } from "./mask/sources/colorRange";
import { planFold } from "./mask/foldPlan";
import { OverlayAnimationLoop } from "./render/overlayAnimationLoop";
import { hasValueChanged } from "./ui/valueChange";
import { Layers, SlidersHorizontal, Brush as BrushRailIcon, PackagePlus } from "lucide-react";
import { useContextualPanel } from "./ui/contextualPanel";
import { PanelRail, type PanelRailItem } from "./components/dockedPanel/PanelRail";
import { ColorPickerPanel } from "./components/ColorPickerPanel";
import type { EffectParam } from "./render/effects/types";
import { usePresets } from "./hooks/usePresets";
import { usePhotoLayer } from "./hooks/usePhotoLayer";
import { PresetPanel } from "./components/PresetPanel";
import { TauriPresetStore } from "./presets/presetStore";
import { capture } from "./presets/presetDocument";
import { Dialog } from "./ui/Dialog";
import { Button } from "./components/ui/button";

export default function App() {
  useGlobalControlWheel();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const gpuRef = useRef<GpuContext | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  // "Ouvrir une image" n'est jamais désactivé pendant une ouverture en
  // cours — un second clic (ex. après avoir choisi un fichier corrompu,
  // dont `createImageBitmap` peut mettre plusieurs secondes à rejeter) peut
  // lancer un second appel à `openFile` avant que le premier ne se soit
  // résolu. Sans ce garde, le premier (en retard, en échec) peut écraser
  // l'état posé par le second (plus rapide, réussi) une fois son rejet
  // enfin réglé — le bandeau d'erreur réapparaît seul quelques secondes
  // après une ouverture pourtant réussie (bug trouvé au checkpoint visuel
  // 2026-07-24). Seul l'appel dont la génération est encore la plus
  // récente au moment de committer est autorisé à toucher l'état visible.
  const openGenerationRef = useRef(0);
  const overlayAnimationLoopRef = useRef(new OverlayAnimationLoop());
  const sessionRef = useRef(new DocumentSession());
  const presetStoreRef = useRef(new TauriPresetStore());
  const presets = usePresets(presetStoreRef.current);
  const [layers, setLayers] = useState<LayerState[]>([]);
  const presetIsDirty = presets.isDirtyOf(layers);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  // Tracks whether `sourcePath` came from `getLaunchPath()` (Lightroom
  // round-trip) as opposed to a manual drag&drop open. This flag — not a
  // string comparison on the path — is what decides overwrite-vs-copy in
  // handleExport, per the project's copy-only safety rule.
  const [isLaunchFile, setIsLaunchFile] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const maskPaintersRef = useRef<Map<string, MaskPainterEntry>>(new Map());
  // True for the first sample of a stroke: forces a full live-preview
  // texture upload (the renderer's `liveMaskTexture` may hold a different
  // layer's content, or this same layer's content from BEFORE an undo/redo
  // that happened between strokes — a partial update on top of that stale
  // base would be silently wrong). Subsequent samples within the same
  // stroke use partial (dirtyRect-scoped) updates. Reset in
  // handleMaskStrokeEnd so the NEXT stroke also starts with a full upload.
  const maskStrokeIsFreshRef = useRef(true);
  const [brushSize, setBrushSize] = useState(30);
  const [brushHardness, setBrushHardness] = useState(0.5);
  const [erase, setErase] = useState(false);
  // Vrai pendant un drag de slider dont la valeur a bougé : le commit de fin
  // d'interaction ne pousse une entrée d'historique que si quelque chose a
  // réellement changé (un simple clic sans mouvement ne crée pas d'entrée).
  const paramDirtyRef = useRef(false);

  const [presetsFolded, setPresetsFolded] = useState(false);
  const [layersFolded, setLayersFolded] = useState(false);
  const [paramsFolded, setParamsFolded] = useState(false);
  const [maskFolded, setMaskFolded] = useState(false);
  const [overlayForceHidden, setOverlayForceHidden] = useState(false);
  const [colorPicker, setColorPicker] = useState<{
    layerId: string;
    key: string;
    label: string;
    hue: EffectParam;
    saturation: EffectParam;
    lightness: EffectParam;
    /** Déjà converti en coordonnée relative à `.workspace` (le conteneur
     *  positionné dans lequel le picker est rendu), pas en viewport. */
    anchorTop: number;
  } | null>(null);
  const [dockLayout, setDockLayout] = useState<DockLayout>([["presets", "layers", "params", "mask"]]);

  // Task 4 : id du preset en attente de confirmation de remplacement — non
  // nul seulement quand la pile courante n'est pas vide (voir
  // `requestApplyPreset`). Le PRD interdit d'écraser des masques déjà peints
  // sans confirmation explicite. `hasPhotoLayer` (Important 2, final-review
  // fix) : capturé au moment de la demande, pas recalculé au clic de
  // confirmation — la pile ne doit plus bouger entre les deux, mais figer la
  // valeur évite toute dépendance implicite à cet invariant.
  const [pendingPresetApply, setPendingPresetApply] = useState<{ id: string; hasPhotoLayer: boolean } | null>(null);

  // Task 5 : nom en attente de saisie pour "Créer une copie" depuis la
  // bannière de dérive — non nul tant que le dialogue de nommage est ouvert.
  const [pendingPresetCopyName, setPendingPresetCopyName] = useState<string | null>(null);

  // Deux confirmations peuvent s'enchaîner sur un même enregistrement (C1
  // overwrite-by-name, puis exclusion de calque photo) — voir
  // requestSavePreset/gateOnPhotoLayers plus bas. `pendingPhotoLayerSave`
  // porte un `onConfirm` CALLBACK plutôt qu'un flag figé "overwrite ou pas" :
  // le Task 5 réutilise cette même porte pour "Mettre à jour"/"Créer une
  // copie", qui ne rentrent pas dans une forme overwrite-id mais ont besoin
  // du même contrat "confirmer, puis lancer cette écriture précise".
  // `resolve`/`onCancel` portent la résolution de la promesse rendue par
  // `requestSavePreset` (Mineur 4, revue tâche 3) : PresetPanel n'efface son
  // champ de saisie qu'une fois l'écriture réellement aboutie, jamais sur la
  // seule demande — donc chaque porte de confirmation doit savoir dire "annulé"
  // (false) aussi bien que "confirmé puis écrit" (true/false selon l'issue).
  const [pendingOverwrite, setPendingOverwrite] = useState<{ id: string; name: string; resolve: (written: boolean) => void } | null>(
    null
  );
  const [pendingPhotoLayerSave, setPendingPhotoLayerSave] = useState<{
    excludedLayerIndexes: number[];
    onConfirm: () => void;
    onCancel: () => void;
  } | null>(null);

  // Largeur du dock — état session, partagée par toutes les colonnes,
  // pas d'entrée d'historique (disposition d'interface, pas donnée de
  // calque, même principe que dockLayout ci-dessus).
  const [dockWidth, setDockWidth] = useState(320);
  const handleDockWidthChange = useCallback((width: number) => setDockWidth(clampDockWidth(width)), []);

  // DocumentSession est la source de vérité COMPLÈTE des calques (avec les
  // rasters de masque), pour le rendu GPU, l'historique et l'export. Le state
  // React `layers` n'en est qu'une PROJECTION D'AFFICHAGE, rasters retirés.
  //
  // Pourquoi : un raster r8 pleine résolution (~26 Mo à 24MP) placé dans le
  // state React fait CRASHER (hang WebView2, CDP inerte) au re-render déclenché
  // par setLayers() en fin de stroke. Root cause épinglée par A/B live sur la
  // vraie fenêtre (2026-07-18, docs/superpowers/specs/2026-07-17-native-wgpu-
  // decision.md) : setLayers() SANS raster (ajout de calque) à 24MP ne crashe
  // pas ; setLayers() AVEC le raster 26MB crashe ; ne pas appeler setLayers
  // ne crashe pas. Ce n'est donc ni le GPU (requestRender avec le masque
  // complet est OK) ni le re-render en soi, mais le buffer 26 Mo transitant par
  // l'état React. Le fix garde setLayers() (UI correcte) mais retire le raster de
  // ce qui y entre ; les panneaux n'affichent jamais les pixels du masque.
  const syncSession = useCallback(() => {
    setLayers(sessionRef.current.displayLayers());
    setSelectedId(sessionRef.current.selectedId());
  }, []);

  const selectLayer = useCallback((id: string | null) => {
    sessionRef.current.select(id);
    setSelectedId(sessionRef.current.selectedId());
  }, []);

  const commit = useCallback(
    (stack: LayerStack) => {
      sessionRef.current.commit(stack);
      syncSession();
      rendererRef.current?.requestRender(sessionRef.current.layers());
    },
    [syncSession]
  );

  const currentStack = useCallback((): LayerStack => {
    // Depuis DocumentSession (COMPLET, avec les rasters de masque), jamais depuis le
    // state `layers` (projection d'affichage sans raster) — sinon toute
    // opération non-masque réécrirait des calques à raster null et effacerait
    // les masques.
    return sessionRef.current.currentStack();
  }, []);

  const openFile = useCallback(async (file: File, path: string | null, fromLaunch: boolean) => {
    if (!canvasRef.current) return;
    const generation = ++openGenerationRef.current;
    try {
      if (!gpuRef.current) {
        gpuRef.current = await initGpu(canvasRef.current, (message) => setError(message), logDiagnostic);
      }
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(file);
      } catch {
        throw new Error("Image non supportée ou corrompue.");
      }

      // Build and load the candidate renderer BEFORE touching anything the
      // PREVIOUS document depends on (rendererRef, canvas size, app state).
      // Renderer.createLoaded disposes the candidate's own partial
      // resources on failure and rethrows — this used to dispose the
      // outgoing renderer FIRST, so a failed load (unsupported image, GPU
      // size limit) left the canvas backed by an already-destroyed
      // renderer, with the previous document unusable despite `sourcePath`/
      // `imageSize` state still pointing at it. Only once loading succeeds
      // do we touch the canvas, dispose the outgoing renderer, and commit
      // the new document's state.
      const candidate = await Renderer.createLoaded(gpuRef.current, bitmap, logDiagnostic);

      if (generation !== openGenerationRef.current) {
        // A newer openFile() call already committed while we were still
        // decoding/loading — discard this stale result instead of
        // clobbering the newer document (canvas size, renderer, error
        // banner) with an outdated one.
        candidate.dispose();
        return;
      }

      canvasRef.current.width = bitmap.width;
      canvasRef.current.height = bitmap.height;
      rendererRef.current?.dispose();
      rendererRef.current = candidate;

      setImageSize({ width: bitmap.width, height: bitmap.height });
      setSourcePath(path);
      setIsLaunchFile(fromLaunch);

      const stack = new LayerStack();
      sessionRef.current.replaceDocument(stack);
      presets.clearActive();
      // Important 6 (final-review fix): a new document has no relationship
      // to the previous one's layer ids — any entry left in
      // maskPaintersRef from the outgoing document is an orphaned ~24Mo
      // buffer for a layer that no longer exists anywhere. This gap was
      // pre-existing (not introduced by presets), but presets is what turns
      // it from theoretical into "leaks on every applyPreset() in a loop" —
      // see applyPreset's own purge below for the other half of this fix.
      maskPaintersRef.current.clear();
      syncSession();
      rendererRef.current.render(sessionRef.current.layers());
      // Une ouverture réussie efface une éventuelle erreur laissée par une
      // tentative précédente (fichier corrompu, GPU indisponible...) — sinon
      // le bandeau d'erreur reste affiché au-dessus du document qui vient de
      // charger correctement.
      setError(null);
    } catch (e) {
      if (generation !== openGenerationRef.current) return;
      setError(messageFromUnknown(e));
    }
  }, [syncSession, presets.clearActive]);

  useEffect(() => {
    getLaunchPath().then(async (path) => {
      if (!path) return;
      try {
        const bytes = await readImageFile(path);
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "image/jpeg" });
        await openFile(new File([blob], path, { type: "image/jpeg" }), path, true);
      } catch (e) {
        setError(messageFromUnknown(e));
      }
    });
  }, [openFile]);

  useEffect(() => {
    // Important 1 (revue tâche 3) : c'était le SEUL appel preset non gardé —
    // un preset corrompu fait rejeter `TauriPresetStore.list()`, et sans
    // `.catch` ici le rejet restait non géré : aucun bandeau d'erreur, le
    // panneau affichait juste "Aucun preset enregistré" comme si la
    // bibliothèque était vide. Fail-fast comme les trois autres chemins preset.
    presets.refresh().catch((e) => setError(messageFromUnknown(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is stable (useCallback), run once on mount only.
  }, []);

  const handleOpenFile = useCallback(async () => {
    try {
      const path = await pickImageFile();
      if (!path) return;
      // Manual "Ouvrir" dialog path: a real absolute path is now known, but
      // this is still NOT the Lightroom launch path — isLaunchFile stays
      // false so handleExport keeps exporting via buildCopyPath (copy),
      // never overwriting the manually-opened source file in place.
      const bytes = await readImageFile(path);
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "image/jpeg" });
      await openFile(new File([blob], path, { type: "image/jpeg" }), path, false);
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }, [openFile]);

  // Tout ce qui est propre au calque photo (mode canvas, import, transform)
  // vit dans usePhotoLayer — App n'en garde que le câblage.
  const photoLayer = usePhotoLayer({
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
  });
  const { maskPaintMode, showTransformHandles, handleTransformChange, handleTransformCommit } = photoLayer;

  function handleAdd(effectId: string) {
    presets.clearActive();
    const stack = currentStack();
    const id = stack.addLayer(effectId);
    commit(stack);
    selectLayer(id);
  }

  // Callbacks passés à LayerPanel/ParamPanel enveloppés dans useCallback :
  // LayerPanel mémoïse chaque ligne (React.memo, voir LayerRow) pour qu'un
  // drag d'opacité ne re-render QUE la ligne concernée, pas la liste entière
  // des calques — sans références stables ici, cette mémoïsation ne servirait
  // à rien (nouvelle fonction à chaque render du composant App = memo inutile).
  const handleToggle = useCallback(
    (id: string) => {
      const stack = currentStack();
      // Mutation outcome (Task 3) : id absent -> pas d'entrée d'historique.
      if (!stack.toggleLayer(id)) return;
      commit(stack);
    },
    [currentStack, commit]
  );

  const handleRemove = useCallback(
    (id: string) => {
      presets.clearActive();
      const stack = currentStack();
      if (!stack.removeLayer(id)) return;
      maskPaintersRef.current.delete(id);
      commit(stack);
    },
    // presets.clearActive (not the whole `presets` object, which usePresets
    // returns as a fresh literal every render) — same narrowing already used
    // by openFile above. clearActive is `useCallback(..., [])` in
    // usePresets.ts, so it is referentially stable; the whole `presets`
    // object is not, and this callback is passed as onRemove to LayerRow
    // (memo()-ised in LayerPanel.tsx specifically so an opacity drag on one
    // layer doesn't re-render the others) — an unstable dependency here
    // defeated that memoization on every keystroke of any param drag.
    [currentStack, commit, presets.clearActive]
  );

  const handleReorder = useCallback(
    (id: string, newIndex: number) => {
      const stack = currentStack();
      // Mutation outcome : id absent, index hors-borne, ou index inchangé
      // (no-op) -> pas d'entrée d'historique.
      if (!stack.reorderLayer(id, newIndex)) return;
      commit(stack);
    },
    [currentStack, commit]
  );

  function handleParamChange(id: string, params: Record<string, number>) {
    // Mise à jour vivante pendant le drag : état + rendu coalescé, PAS
    // d'entrée d'historique — la spec v1 exige UNE entrée par interaction,
    // pas une par frame de drag.
    //
    // Volontairement PAS currentStack()/LayerStack.clone() ici : clone()
    // crée un objet FRAIS pour CHAQUE calque, pas seulement celui qui bouge
    // — avec LayerRow mémoïsé (LayerPanel.tsx, même pattern pour l'opacité),
    // ça re-render la liste entière à chaque frame de drag. Ce .map() garde
    // la référence des calques NON touchés, seul le calque `id` change.
    const previous = sessionRef.current.layers().find((l) => l.id === id);
    if (previous && Object.entries(params).some(([key, value]) => hasValueChanged(previous.params[key], value))) {
      paramDirtyRef.current = true;
    }
    const full = sessionRef.current.layers().map((l) => (l.id === id ? { ...l, params: { ...l.params, ...params } } : l));
    sessionRef.current.replaceLiveLayers(full);
    syncSession();
    rendererRef.current?.requestRender(full);
  }

  const handleParamCommit = useCallback(() => {
    if (!paramDirtyRef.current) return;
    paramDirtyRef.current = false;
    commit(currentStack());
  }, [commit, currentStack]);

  const handleOpacityChange = useCallback(
    (id: string, opacity: number) => {
      // Même raison que handleParamChange ci-dessus : pas de clone() complet
      // du stack pendant le drag, seul le calque `id` reçoit un objet frais
      // — condition nécessaire pour que LayerRow (React.memo) ne re-render
      // QUE la ligne dont l'opacité bouge, pas la liste entière des calques.
      const previous = sessionRef.current.layers().find((l) => l.id === id);
      if (previous && hasValueChanged(previous.opacity, opacity)) paramDirtyRef.current = true;
      const full = sessionRef.current.layers().map((l) => (l.id === id ? { ...l, opacity } : l));
      sessionRef.current.replaceLiveLayers(full);
      syncSession();
      rendererRef.current?.requestRender(full);
    },
    [syncSession]
  );

  const handleBlendModeChange = useCallback(
    (id: string, blendMode: string) => {
      const stack = currentStack();
      const layer = stack.layers.find((l) => l.id === id);
      if (layer) layer.blendMode = blendMode;
      commit(stack); // changement discret → une entrée d'historique directe
    },
    [currentStack, commit]
  );

  function handleAddMaskSource(layerId: string, type: "gradient" | "luminosity" | "colorRange") {
    const stack = currentStack();
    stack.addMaskSource(layerId, type);
    commit(stack); // ajout d'une source = action discrète, une entrée directe
  }

  function handleRemoveMaskSource(layerId: string, sourceId: string) {
    const stack = currentStack();
    if (!stack.removeMaskSource(layerId, sourceId)) return;
    commit(stack);
  }

  function handleMaskSourceParamsChange(layerId: string, sourceId: string, params: Record<string, number | number[]>) {
    const previousSource = sessionRef.current.layers().find((l) => l.id === layerId)?.mask.sources.find((s) => s.id === sourceId);
    if (previousSource && Object.entries(params).some(([key, value]) => hasValueChanged((previousSource.params?.[key] as number | number[] | undefined) ?? 0, value))) {
      paramDirtyRef.current = true;
    }
    const stack = currentStack();
    stack.updateMaskSourceParams(layerId, sourceId, params);
    sessionRef.current.replaceLiveLayers(stack.layers);
    syncSession();
    rendererRef.current?.requestRender(stack.layers);
  }

  function handleMaskSourceCombineModeChange(layerId: string, sourceId: string, mode: "add" | "subtract" | "intersect") {
    const stack = currentStack();
    if (!stack.setMaskSourceCombineMode(layerId, sourceId, mode)) return;
    commit(stack);
  }

  function handleMaskSourceEnabledChange(layerId: string, sourceId: string, enabled: boolean) {
    const stack = currentStack();
    // setMaskSourceEnabled ne commite (une entrée d'historique) que si la
    // valeur a réellement changé — pas d'entrée vide sur un no-op (même
    // discipline que le reste des toggles discrets de ce fichier).
    if (!stack.setMaskSourceEnabled(layerId, sourceId, enabled)) return;
    commit(stack);
  }

  function handleMaskInvertChange(layerId: string, invert: boolean) {
    const stack = currentStack();
    if (!stack.setMaskInvert(layerId, invert)) return;
    commit(stack);
  }

  function handleMaskEnabledChange(layerId: string, enabled: boolean) {
    const stack = currentStack();
    if (!stack.setMaskEnabled(layerId, enabled)) return;
    commit(stack);
  }

  function handleRefineEdgeChange(layerId: string, refineEdge: Partial<RefineEdgeParams>) {
    const previousLayer = sessionRef.current.layers().find((l) => l.id === layerId);
    if (
      previousLayer &&
      Object.entries(refineEdge).some(([key, value]) => {
        const previousValue = previousLayer.mask.refineEdge[key as keyof RefineEdgeParams];
        // edgeAware est un booléen (activation) — les autres champs de
        // RefineEdgeParams sont numériques, seuls comparables via
        // hasValueChanged (qui n'accepte que number|number[]).
        return typeof value === "boolean" ? previousValue !== value : hasValueChanged(previousValue as number, value as number);
      })
    ) {
      paramDirtyRef.current = true;
    }
    const stack = currentStack();
    stack.updateRefineEdge(layerId, refineEdge);
    sessionRef.current.replaceLiveLayers(stack.layers);
    syncSession();
    rendererRef.current?.requestRender(stack.layers);
  }

  // Limitation documentée Tranche 3 (brief Task 6 Step 10) : pas de picker
  // interactif au clic sur le canvas (hors scope, Tranche 4/panneau
  // flottant) — cette action prend la couleur du pixel au CENTRE du canvas
  // comme valeur de test minimale. Le <canvas> est configuré WebGPU (pas de
  // contexte 2D dessus) : on le redessine sur un canvas 2D hors-écran de
  // 1x1 via drawImage pour lire un seul pixel, plutôt qu'un readback GPU
  // dédié — suffisant pour un échantillon de test, pas pour un vrai picker.
  function handleAddColorSample(layerId: string, sourceId: string) {
    const source = sessionRef.current.layers().find((l) => l.id === layerId)?.mask.sources.find((s) => s.id === sourceId);
    if (!source || !canvasRef.current || canvasRef.current.width === 0) return;
    const existing = (source.params?.samples as number[] | undefined) ?? [];
    if (existing.length / 3 >= MAX_COLOR_RANGE_SAMPLES) return;
    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = 1;
    sampleCanvas.height = 1;
    const ctx2d = sampleCanvas.getContext("2d");
    if (!ctx2d) return;
    const cx = canvasRef.current.width / 2;
    const cy = canvasRef.current.height / 2;
    ctx2d.drawImage(canvasRef.current, cx, cy, 1, 1, 0, 0, 1, 1);
    const pixel = ctx2d.getImageData(0, 0, 1, 1).data;
    // sRGB -> linéaire (cohérent "linéaire strict", même conversion que le
    // reste du pipeline couleur du projet) — le canvas affiché est déjà en
    // sortie sRGB, la source colorRange compare en `colorLinear`.
    const toLinear = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const rgbLinear = [toLinear(pixel[0]), toLinear(pixel[1]), toLinear(pixel[2])];
    const params = { ...source.params, samples: [...existing, ...rgbLinear] };
    const stack = currentStack();
    // Toujours un ajout réel (echantillons.length croît strictement), mais
    // même discipline que les autres actions discrètes : ne commit que si
    // la mutation a effectivement changé quelque chose.
    if (!stack.updateMaskSourceParams(layerId, sourceId, params)) return;
    commit(stack); // ajout d'un échantillon = action discrète, une entrée directe
  }

  function handleMaskStroke(x: number, y: number) {
    if (!selectedId || imageSize.width === 0) return;
    // Raster depuis DocumentSession (complet) — le state `layers` est la projection
    // d'affichage sans raster.
    const layer = sessionRef.current.layers().find((l) => l.id === selectedId);
    const currentMaskData = layer ? getBrushRaster(layer) : null;
    const entry = getSyncedMaskPainter(
      maskPaintersRef.current,
      selectedId,
      currentMaskData,
      imageSize.width,
      imageSize.height
    );
    // Interpolate from the last painted point when one exists (a real drag
    // fires far fewer coalesced samples than the raw pointer path — without
    // this, fast strokes leave visible gaps between isolated brush dabs,
    // reported live 2026-07-18). The stroke's very first point has no
    // anchor yet, so it paints a single dab like before.
    const dirtyRect = entry.lastPoint
      ? entry.painter.paintLine(entry.lastPoint.x, entry.lastPoint.y, x, y, brushSize, brushHardness, erase)
      : entry.painter.paintStroke(x, y, brushSize, brushHardness, erase);
    entry.lastPoint = { x, y };
    // Live preview only: render straight from the painter's own buffer via
    // a GPU texture upload, WITHOUT going through LayerStack.updateBrushMask()'s
    // immutable-copy semantics on every sample. That copy (~26MB per call on
    // a 24MP photo) firing on every coalesced pointer sample during a real
    // drag was traced via WebView2 crash-dump analysis (2026-07-15, exception
    // 0xE0000008, reproduced 4 times) to a reproducible renderer OOM abort —
    // confirmed by clean before/after tests, not assumed. A second round of
    // testing showed the SAME crash from a full-buffer GPU reupload alone
    // (no JS copy), so the real fix scopes each upload to the brush's
    // touched region (`dirtyRect`) instead of the whole image — only the
    // first sample of a stroke uploads the full buffer (`maskStrokeIsFreshRef`),
    // seeding the renderer's live-preview texture correctly even if an
    // undo/redo happened since the last stroke. `layers` state and history
    // are intentionally untouched here; the real, history-visible mask
    // update happens exactly once, in handleMaskStrokeEnd, matching the
    // "one entry per interaction" pattern already established for sliders.
    rendererRef.current?.requestRender(sessionRef.current.layers(), {
      layerId: selectedId,
      raster: entry.painter.getMaskData(),
      scope: maskStrokeIsFreshRef.current ? { kind: "full" } : { kind: "partial", rect: dirtyRect },
    });
    maskStrokeIsFreshRef.current = false;
  }

  function handleMaskStrokeEnd() {
    maskStrokeIsFreshRef.current = true;
    if (!selectedId) return;
    const entry = maskPaintersRef.current.get(selectedId);
    if (!entry) return;
    entry.lastPoint = null; // next stroke's first point has no interpolation anchor
    const stack = currentStack();
    // The one and only immutable-copy update for this stroke — see the
    // comment in handleMaskStroke for why this is deferred to stroke-end.
    // updateBrushMask only returns false if selectedId's layer was removed
    // mid-stroke (race, not the common case) — same "no mutation, no
    // history entry" discipline as the rest of this file's discrete
    // commits.
    if (!stack.updateBrushMask(selectedId, entry.painter.getMaskData())) return;
    commit(stack);
    const committedLayer = stack.layers.find((l) => l.id === selectedId);
    entry.syncedFrom = committedLayer ? getBrushRaster(committedLayer) : null;
  }

  function handleUndo() {
    if (sessionRef.current.undo()) {
      syncSession();
      // Critique 1 (final-review fix): undo doesn't touch `activePresetId`
      // on its own — without this, undoing back through a preset
      // APPLICATION (e.g. to an empty stack) left the banner pointing at a
      // preset whose snapshot no longer matches, and "Mettre à jour" would
      // overwrite the preset file with the undone stack, unrecoverably (the
      // disk write itself isn't an undo-history entry). See
      // `usePresets.reconcileActiveAfterHistoryChange`'s doc comment for why
      // this is a STRUCTURAL check, not the full-value one that drives the
      // dirty banner.
      presets.reconcileActiveAfterHistoryChange(sessionRef.current.layers());
      rendererRef.current?.requestRender(sessionRef.current.layers());
    }
  }

  function handleRedo() {
    if (sessionRef.current.redo()) {
      syncSession();
      presets.reconcileActiveAfterHistoryChange(sessionRef.current.layers());
      rendererRef.current?.requestRender(sessionRef.current.layers());
    }
  }

  // Raccourcis globaux Ctrl+Z/Ctrl+Y (undo/redo) : fonctionnent depuis
  // n'importe où dans la fenêtre, PAS seulement quand un bouton Toolbar a le
  // focus — sauf par-dessus un contrôle éditable (input/textarea/
  // contentEditable, ex. le champ de valeur d'un LabeledSlider en cours de
  // frappe), où Ctrl+Z doit rester l'undo texte natif du champ, pas l'undo
  // de calque.
  useEffect(() => {
    function handleWindowKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      const isEditableTarget = tagName === "INPUT" || tagName === "TEXTAREA" || target?.isContentEditable;
      if (isEditableTarget) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        handleUndo();
      } else if (key === "y") {
        event.preventDefault();
        handleRedo();
      }
    }
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  });

  async function performExport(resolveDir: () => Promise<string | null>, bareFirst: boolean) {
    if (!rendererRef.current) return;
    if (!sourcePath) {
      setError(
        "Impossible d'exporter : ouvre le fichier via un vrai chemin (lancement depuis Lightroom, ou une future boîte de dialogue \"Ouvrir\") plutôt que par glisser-déposer."
      );
      return;
    }
    try {
      let target: string;
      if (roundTripActive) {
        // Contrat round-trip Lightroom : écrase toujours le launch path
        // exact, quel que soit le dossier demandé par l'appelant — voir
        // resolveExportTargetAsync's doc comment pour le contrat complet.
        target = await resolveExportTargetAsync(sourcePath, true, { exists: pathExists });
      } else {
        const dir = await resolveDir();
        if (dir === null) return; // "Exporter sous..." annulé par l'utilisateur
        const base = await joinExportTarget(sourcePath, dir);
        target = bareFirst
          ? await resolveDefaultExportTarget(base, { exists: pathExists })
          : await resolveExportTargetAsync(base, false, { exists: pathExists });
      }
      await exportImage(
        rendererRef.current,
        { write: writeImageFile },
        sessionRef.current.layers(),
        target,
        imageSize.width,
        imageSize.height
      );
      // Même discipline que openFile : un export réussi efface une erreur
      // laissée par une tentative précédente, plutôt que de laisser un
      // bandeau d'erreur périmé affiché au-dessus d'un export qui a marché.
      setError(null);
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }

  // Mineur 4 (revue tâche 3) : rend une Promise<boolean> résolue à `true`
  // SEULEMENT si l'écriture a réellement abouti (aucune confirmation
  // annulée, aucune exception) — PresetPanel n'efface son champ de saisie
  // que sur `true`, jamais sur la seule demande d'enregistrement.
  async function requestSavePreset(name: string): Promise<boolean> {
    const existing = presets.summaries.find((s) => s.name === name);
    if (existing) {
      return new Promise<boolean>((resolve) => {
        setPendingOverwrite({ id: existing.id, name, resolve });
      });
    }
    return gateOnPhotoLayers(name, () => commitSavePreset(name, null));
  }

  /** Runs `capture(sessionRef.current.layers(), name)` purely to inspect
   *  `skipped` — if it reports any excluded photo layer, blocks on the
   *  `pendingPhotoLayerSave` Dialog and defers `onConfirmed` to its
   *  "Enregistrer quand même" button; otherwise runs `onConfirmed`
   *  immediately. `name` is only used to compute `skipped` (a photo-layer
   *  exclusion doesn't depend on the target name) — callers that don't have
   *  a natural "new name" yet (Task 5's `updateActive`) pass the CURRENT
   *  preset's existing name, which is what would be recaptured anyway.
   *  Rend `false` si l'utilisateur annule la porte (Mineur 4), sinon le
   *  résultat de `onConfirmed` (issue réelle de l'écriture). */
  function gateOnPhotoLayers(name: string, onConfirmed: () => Promise<boolean>): Promise<boolean> {
    const { skipped } = capture(sessionRef.current.layers(), name);
    const excludedLayerIndexes = skipped.filter((s) => s.reason === "photo-layer").map((s) => s.layerIndex);
    if (excludedLayerIndexes.length > 0) {
      return new Promise<boolean>((resolve) => {
        setPendingPhotoLayerSave({
          excludedLayerIndexes,
          onConfirm: () => {
            onConfirmed().then(resolve);
          },
          onCancel: () => resolve(false),
        });
      });
    }
    return onConfirmed();
  }

  async function commitSavePreset(name: string, overwriteId: string | null): Promise<boolean> {
    try {
      if (overwriteId) {
        await presets.overwrite(overwriteId, sessionRef.current.layers(), name);
      } else {
        await presets.save(sessionRef.current.layers(), name);
      }
      return true;
    } catch (e) {
      setError(messageFromUnknown(e));
      return false;
    }
  }

  /** "Mettre à jour" (dirty banner). Reuses the active preset's own current
   *  name — `updateActive` keeps the name unchanged, `capture()` only needs
   *  SOME name to run its exclusion check. Routes through the SAME
   *  `gateOnPhotoLayers` gate as `requestSavePreset` (a photo layer must
   *  never be silently dropped from a written preset file). */
  function requestUpdateActive() {
    if (!presets.activePresetId) return;
    const layers = sessionRef.current.layers();
    // Critique 1 (final-review fix): never write an EMPTY stack over a
    // preset file. Reachable via undo (see handleUndo/reconcileActive...)
    // only through a race between the reconciliation and this click — kept
    // as a second, independent guard rather than relying solely on
    // `reconcileActiveAfterHistoryChange` clearing `activePresetId` in time.
    // The banner itself is also gated on `layers.length > 0` below (JSX), so
    // this button should already be unreachable when the stack is empty —
    // this is the belt to that suspenders.
    if (layers.length === 0) return;
    const activeSummary = presets.summaries.find((s) => s.id === presets.activePresetId);
    if (!activeSummary) {
      // Mineur (final-review fix): the old `?.name ?? ""` fallback let this
      // dialog open with an empty preset name on a lookup miss instead of
      // reporting the anomaly (activePresetId pointing at a preset removed
      // from the library, or summaries not yet refreshed) — fail loudly
      // rather than silently proceeding with a blank name.
      setError(`Preset actif introuvable dans la bibliothèque (id ${presets.activePresetId}) — impossible de le mettre à jour.`);
      return;
    }
    gateOnPhotoLayers(activeSummary.name, async () => {
      try {
        await presets.updateActive(layers);
        return true;
      } catch (e) {
        setError(messageFromUnknown(e));
        return false;
      }
    });
  }

  /** "Créer une copie" (dirty banner). Same photo-layer gate as
   *  `requestSavePreset`, AND now the same name-collision gate too
   *  (Important 3, final-review fix): before this fix, typing an
   *  already-taken name here created a silent duplicate — `requestSavePreset`
   *  asked to confirm an overwrite for the same event, `importFrom` instead
   *  auto-renamed to "(copie N)`, so the same feature had THREE different
   *  collision policies. Chosen here: reuse the SAME "Remplacer ?" dialog as
   *  `requestSavePreset` (not `resolveImportName`'s silent auto-rename) —
   *  unlike an import, the name here is something the user just TYPED
   *  themselves into a visible field, so a collision is very likely
   *  deliberate ("overwrite that one") and deserves the same explicit
   *  confirm/cancel as manual save, not a surprise "(copie 2)" they didn't
   *  ask for. */
  function requestCopyActiveAsNew(name: string): Promise<boolean> {
    const layers = sessionRef.current.layers();
    if (layers.length === 0) return Promise.resolve(false); // Critique 1 : jamais de preset vide
    const existing = presets.summaries.find((s) => s.name === name);
    if (existing) {
      return new Promise<boolean>((resolve) => {
        setPendingOverwrite({ id: existing.id, name, resolve });
      });
    }
    return gateOnPhotoLayers(name, async () => {
      try {
        await presets.copyActiveAsNew(layers, name);
        return true;
      } catch (e) {
        setError(messageFromUnknown(e));
        return false;
      }
    });
  }

  async function handleRenamePreset(id: string, name: string) {
    try {
      await presets.rename(id, name);
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }

  /** Applies preset `id` immediately — goes through the shared `commit`
   *  helper (`sessionRef.current.commit` + `syncSession` + `requestRender`),
   *  the SAME path as every other layer mutation: a hand-rolled
   *  `setLayers(sessionRef.current.layers())` would push full layer objects
   *  (with mask rasters) into React state, the 24MP OOM crash this file's
   *  `syncSession` comment documents as already fixed once, and would skip
   *  `requestRender` entirely (canvas wouldn't redraw). The confirmation gate
   *  lives in `requestApplyPreset` below, not here — this function always
   *  applies, it never asks. */
  async function applyPreset(id: string) {
    try {
      // (Mineur, final-review fix) The `if (presets.activePresetId !== id)
      // presets.clearActive();` line that used to be here was dead code:
      // `applyTo` reposes `active` unconditionally right after via
      // `setActive({ id, snapshot: ... })`, so this conditional clear could
      // never have any observable effect — removed rather than left as a
      // no-op suggesting an intention it didn't have.
      await presets.applyTo(
        id,
        sessionRef.current.layers(),
        (newLayers) => {
          const stack = new LayerStack();
          stack.layers = newLayers;
          commit(stack);
          // Important 6 (final-review fix): applyPreset replaces the WHOLE
          // stack with FRESH layer ids (LayerStack's freshId counter never
          // reuses an id) — every entry left in maskPaintersRef for the
          // OUTGOING layers is now an orphaned ~24Mo buffer for an id that
          // exists nowhere anymore. Purging by id (rather than relying on
          // ids never colliding) keeps this correct even if that invariant
          // ever changes.
          const newIds = new Set(newLayers.map((l) => l.id));
          for (const layerId of maskPaintersRef.current.keys()) {
            if (!newIds.has(layerId)) maskPaintersRef.current.delete(layerId);
          }
        },
        (message) => setError(message)
      );
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }

  /** Hard confirmation floor (PRD) : appliquer un preset sur une pile non
   *  vide écraserait des masques déjà peints — jamais sans confirmation
   *  explicite. Pile vide -> applique immédiatement, aucune confirmation.
   *  Important 2 (final-review fix) : la pile remplacée peut aussi contenir
   *  un calque photo (double exposure) importé et transformé à la main —
   *  destruction au moins aussi coûteuse qu'un masque peint, mais que
   *  l'ancien dialogue ne mentionnait jamais alors que la CAPTURE d'un
   *  preset, elle, énumère nommément les calques photo exclus. */
  function requestApplyPreset(id: string) {
    const currentLayers = sessionRef.current.layers();
    if (currentLayers.length > 0) {
      setPendingPresetApply({ id, hasPhotoLayer: hasPhotoLayer(currentLayers) });
      return;
    }
    applyPreset(id);
  }

  async function exportPresetFile(id: string) {
    try {
      const doc = await presetStoreRef.current.load(id);
      const sanitized = doc.name.replace(/[\\/:*?"<>|]/g, "_");
      await presetStoreRef.current.exportTo(`${sanitized}.json`, doc);
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }

  async function importPresetFile() {
    try {
      const doc = await presetStoreRef.current.importFrom();
      if (!doc) return; // annulé par l'utilisateur
      await presetStoreRef.current.save(doc.id, doc);
      await presets.refresh();
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }

  // Bouton "Exporter" : dossier fixe Images/shaderlab-export, nom nu tant
  // qu'il n'y a pas de collision réelle (resolveDefaultExportTarget) —
  // SAUF si le round-trip est bloqué par un calque photo malgré
  // isLaunchFile vrai : bascule alors explicitement vers le comportement
  // "Exporter sous..." (PRD : jamais un silence qui laisse croire que le
  // round-trip a eu lieu).
  async function handleExport() {
    if (isLaunchFile && !roundTripActive) {
      setError(
        "Round-trip Lightroom désactivé : ce document contient un calque de double exposure. Choisis un dossier d'export ci-dessous."
      );
      await handleExportAs();
      return;
    }
    await performExport(defaultExportDir, true);
  }

  // Bouton "Exporter sous..." : dossier choisi par l'utilisateur, toujours
  // -edited en premier (comportement conservateur) — Toolbar le désactive
  // quand isLaunchFile est vrai, donc jamais atteint dans ce cas.
  async function handleExportAs() {
    await performExport(pickExportFolder, false);
  }

  const selectedLayer = layers.find((l) => l.id === selectedId) ?? null;
  const paramsPanelTitle = selectedLayer ? `Réglages · ${getEffect(selectedLayer.effectId).name}` : "Réglages";

  const presetsPanel = useContextualPanel(true, "static");
  const layersPanel = useContextualPanel(true, "static");
  const paramsPanel = useContextualPanel(selectedId !== null, selectedId);
  const maskPanel = useContextualPanel(selectedId !== null, selectedId);

  // Table explicite plutôt qu'une chaîne de ternaires : sans branche par
  // défaut, un id inconnu héritait silencieusement de la visibilité du Masque.
  // Ce prédicat ne sert plus seulement à filtrer l'affichage, il alimente aussi
  // la traduction des index de glisser-déposer (`toFullDockTarget`) — un id
  // oublié y fausserait le déplacement sans jamais lever d'erreur. Le chantier
  // Presets ajoute un 4e panneau : il DOIT échouer bruyamment ici s'il oublie
  // sa ligne (fail-fast projet, pas de repli silencieux).
  const panelVisibility: Record<string, boolean> = useMemo(
    () => ({ presets: presetsPanel.visible, layers: layersPanel.visible, params: paramsPanel.visible, mask: maskPanel.visible }),
    [presetsPanel.visible, layersPanel.visible, paramsPanel.visible, maskPanel.visible]
  );
  const isPanelVisible = useCallback(
    (id: string) => {
      const visible = panelVisibility[id];
      if (visible === undefined) throw new Error(`Panneau inconnu dans le dock : "${id}" (ajouter sa visibilité à panelVisibility).`);
      return visible;
    },
    [panelVisibility]
  );

  // Le dock ne reçoit QUE les panneaux visibles : une colonne dont tous les
  // panneaux sont masqués garderait sinon sa largeur (`.panel-column__stack`
  // est en `flex: 0 0 --dock-reserved-width`) et laisserait un trou. Filtrer le
  // LAYOUT plutôt que le tableau `panels` est ce qui fait disparaître la
  // colonne : une colonne vide reste une colonne.
  const visibleLayout = useMemo(() => visibleDockLayout(dockLayout, isPanelVisible), [dockLayout, isPanelVisible]);

  // `dockLayout` (complet) reste la source de vérité : il mémorise la place
  // d'un panneau masqué, qui la retrouve en réapparaissant. La cible de drop
  // rapportée par PanelColumn est donc exprimée dans les index de la
  // projection VISIBLE et doit être retraduite avant mutation, sinon masquer
  // un panneau décale les colonnes et le glisser-déposer atterrit à côté.
  const handlePanelMove = useCallback(
    (id: string, target: DockDropTarget) => {
      setDockLayout((previous) =>
        movePanelInDock(previous, id, toFullDockTarget(previous, visibleDockLayout(previous, isPanelVisible), target))
      );
    },
    [isPanelVisible]
  );

  // Overlay du masque (rouge + contour animé) : affiché tant qu'on travaille
  // réellement sur le masque du calque sélectionné (panneau Masque ouvert OU
  // pinceau actif) ET qu'il y a un masque actif à montrer — pas en continu
  // dès qu'un masque existe (bruit visuel pendant qu'on règle un autre
  // aspect du calque). `overlayForceHidden` (Task 1) reste prioritaire :
  // un utilisateur qui veut juger le rendu final sans quitter le panneau
  // doit pouvoir l'éteindre explicitement. Voir
  // docs/superpowers/specs/2026-07-23-shaderlab-mask-overlay-visibility-design.md.
  const hasActiveMask = selectedLayer ? planFold(selectedLayer.mask).length > 0 : false;
  const wantsOverlay = ((maskPanel.visible && !maskFolded) || maskPaintMode) && hasActiveMask && !!selectedId;

  // Délai de grâce de 750ms avant extinction : quand on ferme le panneau
  // Masque, change de calque, ou que le calque perd son masque actif,
  // `wantsOverlay` passe à `false` immédiatement — mais `graceVisible` ne
  // suit qu'après ce délai, pour laisser voir le résultat se stabiliser
  // plutôt qu'une coupure brutale. Annulé (`clearTimeout`) si `wantsOverlay`
  // redevient `true` avant l'échéance (ex: on rouvre le panneau vite).
  const [graceVisible, setGraceVisible] = useState(wantsOverlay);
  useEffect(() => {
    if (wantsOverlay) {
      setGraceVisible(true);
      return;
    }
    const timer = setTimeout(() => setGraceVisible(false), 750);
    return () => clearTimeout(timer);
  }, [wantsOverlay]);

  const showOverlay = !overlayForceHidden && graceVisible;

  // Round-trip Lightroom désactivé dès qu'un calque photo (double exposure)
  // existe dans le document — même si isLaunchFile est vrai. `roundTripActive`
  // gouverne à la fois l'état du bouton "Exporter sous..." (Toolbar) et le
  // comportement RÉEL du bouton "Exporter" (performExport ci-dessous) — un
  // seul point de vérité, comme l'exige ARCHITECTURE.md §4.6 ("ET logique
  // au même endroit, pas une nouvelle branche disséminée").
  const roundTripActive = isLaunchFile && !hasPhotoLayer(layers);

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setMaskOverlay(showOverlay && selectedId ? selectedId : null);
    r.requestRender(sessionRef.current.layers());

    if (showOverlay && selectedId) {
      overlayAnimationLoopRef.current.start((timeMs) => {
        rendererRef.current?.tickOverlayAnimation(timeMs);
      });
    } else {
      overlayAnimationLoopRef.current.stop();
    }
    return () => overlayAnimationLoopRef.current.stop();
  }, [showOverlay, selectedId]);

  return (
    <div className="app-shell">
      <Toolbar
        canUndo={sessionRef.current.canUndo()}
        canRedo={sessionRef.current.canRedo()}
        hasImage={imageSize.width > 0 && imageSize.height > 0}
        fileName={sourcePath ? sourcePath.split(/[\\/]/).pop() ?? null : null}
        hasLaunchFile={roundTripActive}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onExport={handleExport}
        onExportAs={handleExportAs}
        onOpenFile={handleOpenFile}
        onImportPhotoLayer={photoLayer.handleImportPhotoLayer}
        canImportPhotoLayer={canAddPhotoLayer(layers)}
      />
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {maskPaintMode && (
        <BrushToolbar
          brushSize={brushSize}
          onBrushSizeChange={setBrushSize}
          brushHardness={brushHardness}
          onBrushHardnessChange={setBrushHardness}
          erase={erase}
          onEraseChange={setErase}
          onStop={photoLayer.stopMaskPaintMode}
        />
      )}
      {/* Deux mesures DISTINCTES, à ne pas confondre :
          --dock-reserved-width = largeur d'UNE colonne (lue par PanelColumn.css
          pour dimensionner chaque pile, et pilotée par la poignée de resize) ;
          --dock-total-width = place réellement occupée par le dock à l'écran,
          soit n colonnes et leurs n-1 gouttières. C'est cette seconde mesure que
          le canvas doit compenser : avec la première, masquer tous les panneaux
          depuis le rail laissait le canvas décalé de 320px pour un dock devenu
          invisible, et un dock à 2 colonnes n'était compensé que pour une. */}
      <main
        className="workspace"
        ref={workspaceRef}
        style={{
          "--dock-reserved-width": `${dockWidth}px`,
          "--dock-total-width":
            visibleLayout.length === 0
              ? "0px"
              : `calc(${visibleLayout.length} * ${dockWidth}px + ${visibleLayout.length - 1} * var(--space-4))`,
        } as React.CSSProperties}
      >
        <Canvas
          ref={canvasRef}
          onFileDropped={(file) => openFile(file, null, false)}
          hasImage={imageSize.width > 0 && imageSize.height > 0}
          onOpenFile={handleOpenFile}
          maskPaintMode={maskPaintMode}
          onMaskStroke={handleMaskStroke}
          onStrokeEnd={handleMaskStrokeEnd}
          brushSize={brushSize}
          brushHardness={brushHardness}
        />
        {/* `showTransformHandles` = mode canvas `idle` (usePhotoLayer/CanvasMode).
            Avant T1, les poignées se montaient sur la seule SÉLECTION : un calque
            photo sélectionné en mode peinture superposait sa boîte de déplacement
            (pointerEvents: "auto" sur toute la boîte) au geste de pinceau. Les
            deux modes sont maintenant mutuellement exclusifs. */}
        {showTransformHandles && selectedLayer?.imageSource && selectedLayer.transform && (
          <TransformHandles
            transform={selectedLayer.transform}
            photoSize={rendererRef.current?.photoSources?.dimensions(selectedLayer.imageSource.sourceId) ?? { width: 1, height: 1 }}
            bgSize={imageSize}
            canvasRef={canvasRef}
            onTransformChange={(t) => handleTransformChange(selectedLayer.id, t)}
            onTransformCommit={handleTransformCommit}
          />
        )}
        <PanelColumn
          panels={[
            {
              id: "presets", title: "Presets", collapsed: presetsFolded, onCollapsedChange: setPresetsFolded,
              content: (
                <>
                  <PresetPanel
                    summaries={presets.summaries}
                    hasLayers={layers.length > 0}
                    onSave={requestSavePreset}
                    onRename={handleRenamePreset}
                    onApply={requestApplyPreset}
                    onExport={exportPresetFile}
                    onImport={importPresetFile}
                  />
                  {/* Critique 1 (final-review fix) : `layers.length > 0` —
                      même garde que le bouton "Enregistrer" de PresetPanel
                      (`hasLayers`), qui l'avait déjà et que cette bannière
                      n'avait pas. Une pile vidée par undo ne doit jamais
                      offrir "Mettre à jour"/"Créer une copie" : les deux
                      écriraient un preset vide sur disque. */}
                  {presetIsDirty && presets.activePresetId && layers.length > 0 && (
                    <div className="preset-panel__dirty-banner">
                      <span>Preset modifié.</span>
                      <Button size="sm" variant="secondary" onClick={requestUpdateActive}>
                        Mettre à jour
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setPendingPresetCopyName("")}>
                        Créer une copie
                      </Button>
                    </div>
                  )}
                </>
              )
            },
            {
              id: "layers", title: "Calques", collapsed: layersFolded, onCollapsedChange: setLayersFolded,
              content: <LayerPanel
                  layers={layers}
                  selectedId={selectedId}
                  hasImage={imageSize.width > 0 && imageSize.height > 0}
                  onSelect={selectLayer}
                  onToggle={handleToggle}
                  onAdd={handleAdd}
                  onRemove={handleRemove}
                  onReorder={handleReorder}
                  onOpacityChange={handleOpacityChange}
                  onOpacityCommit={handleParamCommit}
                  onBlendModeChange={handleBlendModeChange}
                  thumbnailUrl={photoLayer.thumbnailUrl}
                />
            },
            {
              id: "params", title: paramsPanelTitle, collapsed: paramsFolded, onCollapsedChange: setParamsFolded,
              content: <ParamPanel
                  layer={selectedLayer}
                  onParamChange={handleParamChange}
                  onParamCommit={handleParamCommit}
                  onOpenColorPicker={(group) =>
                    // Re-cliquer la MÊME pastille referme le picker (bascule),
                    // au lieu de le laisser ouvert sans issue autre que le X.
                    setColorPicker((current) =>
                      current && current.layerId === group.layerId && current.key === group.key
                        ? null
                        : {
                            ...group,
                            // viewport -> repère de `.workspace`, dans lequel le
                            // picker est positionné en absolu.
                            anchorTop: group.anchorTop - (workspaceRef.current?.getBoundingClientRect().top ?? 0),
                          }
                    )
                  }
                />
            },
            {
              id: "mask", title: "Masque", collapsed: maskFolded, onCollapsedChange: setMaskFolded,
              content: <MaskPanel
                  layer={selectedLayer}
                  maskPaintMode={maskPaintMode}
                  onToggleMaskPaint={photoLayer.toggleMaskPaintMode}
                  overlayForceHidden={overlayForceHidden}
                  onToggleOverlayForceHidden={() => setOverlayForceHidden((v) => !v)}
                  onAddMaskSource={handleAddMaskSource}
                  onRemoveMaskSource={handleRemoveMaskSource}
                  onMaskSourceParamsChange={handleMaskSourceParamsChange}
                  onMaskSourceParamsCommit={handleParamCommit}
                  onMaskSourceCombineModeChange={handleMaskSourceCombineModeChange}
                  onMaskSourceEnabledChange={handleMaskSourceEnabledChange}
                  onMaskInvertChange={handleMaskInvertChange}
                  onMaskEnabledChange={handleMaskEnabledChange}
                  onRefineEdgeChange={handleRefineEdgeChange}
                  onRefineEdgeCommit={handleParamCommit}
                  onAddColorSample={handleAddColorSample}
                />
            },
          ]}
          layout={visibleLayout}
          onMove={handlePanelMove}
          width={dockWidth}
          onWidthChange={handleDockWidthChange}
        />
        <PanelRail
          items={[
            { id: "presets", icon: PackagePlus, label: "Presets", active: presetsPanel.visible, onClick: presetsPanel.toggleRail },
            { id: "layers", icon: Layers, label: "Calques", active: layersPanel.visible, onClick: layersPanel.toggleRail },
            { id: "params", icon: SlidersHorizontal, label: "Réglages", active: paramsPanel.visible, onClick: paramsPanel.toggleRail },
            { id: "mask", icon: BrushRailIcon, label: "Masque", active: maskPanel.visible, onClick: maskPanel.toggleRail },
          ] satisfies PanelRailItem[]}
        />
        {colorPicker && selectedLayer?.id === colorPicker.layerId && (
          <ColorPickerPanel
            key={colorPicker.key}
            label={colorPicker.label}
            hue={layers.find((l) => l.id === colorPicker.layerId)?.params[colorPicker.hue.name] ?? colorPicker.hue.default}
            saturation={layers.find((l) => l.id === colorPicker.layerId)?.params[colorPicker.saturation.name] ?? colorPicker.saturation.default}
            lightness={layers.find((l) => l.id === colorPicker.layerId)?.params[colorPicker.lightness.name] ?? colorPicker.lightness.default}
            onChange={(values) => {
              const params: Record<string, number> = {};
              if (values.hue !== undefined) params[colorPicker.hue.name] = values.hue;
              if (values.saturation !== undefined) params[colorPicker.saturation.name] = values.saturation;
              if (values.lightness !== undefined) params[colorPicker.lightness.name] = values.lightness;
              handleParamChange(colorPicker.layerId, params);
            }}
            onCommit={handleParamCommit}
            onClose={() => setColorPicker(null)}
            anchorTop={colorPicker.anchorTop}
            // Ancré à GAUCHE du dock ENTIER, pas d'une seule colonne : le dock
            // fait `visibleLayout.length` colonnes de `dockWidth`, séparées par
            // --space-4. Les `length` gouttières comptées ici = les length-1
            // séparations internes + celle entre le picker et le dock. Sans le
            // facteur colonnes, le picker se posait PAR-DESSUS le dock dès
            // qu'il avait 2 colonnes (constaté au checkpoint 2026-07-25).
            // Même mesure que le canvas (--dock-total-width) : les deux doivent
            // s'accorder sur la place occupée par le dock, sinon l'un se recale
            // et l'autre pas.
            style={{
              right: "calc(var(--space-6) + var(--rail-width) + var(--space-4) + var(--dock-total-width) + var(--space-4))",
            }}
          />
        )}
        <Dialog
          open={pendingOverwrite !== null}
          title="Remplacer le preset existant ?"
          description={pendingOverwrite ? `Un preset nommé "${pendingOverwrite.name}" existe déjà. L'enregistrement va écraser son contenu.` : undefined}
          onClose={() => {
            // Mineur 4 : annuler l'écrasement (X / Échap) doit résoudre
            // `requestSavePreset` à `false` — sinon la Promise reste en
            // suspens et PresetPanel ne sait jamais que l'écriture n'a pas eu lieu.
            pendingOverwrite?.resolve(false);
            setPendingOverwrite(null);
          }}
          actions={
            <>
              <Button
                variant="secondary"
                autoFocus
                onClick={() => {
                  pendingOverwrite?.resolve(false);
                  setPendingOverwrite(null);
                }}
              >
                Annuler
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (pendingOverwrite) {
                    const { name, id, resolve } = pendingOverwrite;
                    gateOnPhotoLayers(name, () => commitSavePreset(name, id)).then(resolve);
                  }
                  setPendingOverwrite(null);
                }}
              >
                Écraser
              </Button>
            </>
          }
        />
        <Dialog
          open={pendingPhotoLayerSave !== null}
          title="Calque(s) photo exclu(s) du preset"
          description={
            pendingPhotoLayerSave
              ? `${pendingPhotoLayerSave.excludedLayerIndexes.length} calque${pendingPhotoLayerSave.excludedLayerIndexes.length > 1 ? "s" : ""} de photo (double exposure) ne ${pendingPhotoLayerSave.excludedLayerIndexes.length > 1 ? "seront" : "sera"} pas inclus dans le preset — une source de photo n'a de sens que dans ce document.`
              : undefined
          }
          onClose={() => {
            pendingPhotoLayerSave?.onCancel();
            setPendingPhotoLayerSave(null);
          }}
          actions={
            <>
              <Button
                variant="secondary"
                autoFocus
                onClick={() => {
                  pendingPhotoLayerSave?.onCancel();
                  setPendingPhotoLayerSave(null);
                }}
              >
                Annuler
              </Button>
              <Button
                variant="default"
                onClick={() => {
                  pendingPhotoLayerSave?.onConfirm();
                  setPendingPhotoLayerSave(null);
                }}
              >
                Enregistrer quand même
              </Button>
            </>
          }
        >
          {pendingPhotoLayerSave && (
            <ul className="preset-panel__excluded-list">
              {pendingPhotoLayerSave.excludedLayerIndexes.map((layerIndex) => (
                <li key={layerIndex}>Calque {layerIndex + 1} — photo (double exposure)</li>
              ))}
            </ul>
          )}
        </Dialog>
        <Dialog
          open={pendingPresetCopyName !== null}
          title="Créer une copie du preset"
          onClose={() => setPendingPresetCopyName(null)}
          actions={
            <>
              <Button variant="secondary" autoFocus onClick={() => setPendingPresetCopyName(null)}>
                Annuler
              </Button>
              <Button
                variant="default"
                disabled={!pendingPresetCopyName || pendingPresetCopyName.trim() === ""}
                onClick={() => {
                  if (pendingPresetCopyName) requestCopyActiveAsNew(pendingPresetCopyName.trim());
                  setPendingPresetCopyName(null);
                }}
              >
                Créer
              </Button>
            </>
          }
        >
          <input
            type="text"
            className="preset-panel__name-input"
            placeholder="Nom du nouveau preset"
            value={pendingPresetCopyName ?? ""}
            onChange={(e) => setPendingPresetCopyName(e.target.value)}
          />
        </Dialog>
        <Dialog
          open={pendingPresetApply !== null}
          title="Remplacer la pile de calques ?"
          description={
            // Important 2 (final-review fix) : nomme explicitement le calque
            // photo (double exposure) détruit, pas seulement les masques —
            // c'était la porte la plus destructrice ET la moins explicite
            // (asymétrique avec la capture, qui énumère ces calques par nom).
            pendingPresetApply?.hasPhotoLayer
              ? "Les masques peints ET le calque photo (double exposure) importé sur les calques actuels seront perdus (annulable par Ctrl+Z après confirmation)."
              : "Les masques peints sur les calques actuels seront perdus (annulable par Ctrl+Z après confirmation)."
          }
          onClose={() => setPendingPresetApply(null)}
          actions={
            <>
              <Button variant="secondary" autoFocus onClick={() => setPendingPresetApply(null)}>
                Annuler
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (pendingPresetApply) applyPreset(pendingPresetApply.id);
                  setPendingPresetApply(null);
                }}
              >
                Remplacer
              </Button>
            </>
          }
        />
      </main>
    </div>
  );
}
