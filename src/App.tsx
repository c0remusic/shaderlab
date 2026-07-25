import { useEffect, useRef, useState, useCallback } from "react";
import { initGpu, type GpuContext } from "./render/gpuContext";
import { Renderer } from "./render/renderer";
import { LayerStack } from "./layers/layerStack";
import type { LayerState, LayerTransform } from "./layers/types";
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
import { movePanelInDock, type DockDropTarget, type DockLayout } from "./ui/dockLayout";
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
  const [layers, setLayers] = useState<LayerState[]>([]);
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
  const [maskPaintMode, setMaskPaintMode] = useState(false);
  const [brushSize, setBrushSize] = useState(30);
  const [brushHardness, setBrushHardness] = useState(0.5);
  const [erase, setErase] = useState(false);
  // Vrai pendant un drag de slider dont la valeur a bougé : le commit de fin
  // d'interaction ne pousse une entrée d'historique que si quelque chose a
  // réellement changé (un simple clic sans mouvement ne crée pas d'entrée).
  const paramDirtyRef = useRef(false);

  const [layersCollapsed, setLayersCollapsed] = useState(false);
  const [paramsCollapsed, setParamsCollapsed] = useState(false);
  const [maskCollapsed, setMaskCollapsed] = useState(false);
  const [overlayForceHidden, setOverlayForceHidden] = useState(false);
  const [dockLayout, setDockLayout] = useState<DockLayout>([["layers", "params", "mask"]]);
  const handlePanelMove = useCallback((id: string, target: DockDropTarget) => {
    setDockLayout((previous) => movePanelInDock(previous, id, target));
  }, []);

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
  }, [syncSession]);

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

  const handleImportPhotoLayer = useCallback(async () => {
    if (!rendererRef.current?.photoSources) return;
    if (!canAddPhotoLayer(sessionRef.current.layers())) {
      setError("Limite atteinte : au plus une photo importée (double exposure) par document.");
      return;
    }
    try {
      const path = await pickImageFile();
      if (!path) return;
      const bytes = await readImageFile(path);
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "image/jpeg" });
      const bitmap = await createImageBitmap(blob);
      const sourceId = rendererRef.current.photoSources.register(bitmap);
      const transform: LayerTransform = { x: imageSize.width / 2, y: imageSize.height / 2, scale: 1, rotation: 0 };
      const stack = currentStack();
      const id = stack.addPhotoLayer(sourceId, transform);
      commit(stack);
      selectLayer(id);
      setError(null);
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }, [commit, currentStack, imageSize.width, imageSize.height, selectLayer]);

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
    [syncSession],
  );

  const handleTransformCommit = useCallback(() => {
    if (!paramDirtyRef.current) return;
    paramDirtyRef.current = false;
    commit(currentStack());
  }, [commit, currentStack]);

  function handleAdd(effectId: string) {
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
      const stack = currentStack();
      if (!stack.removeLayer(id)) return;
      maskPaintersRef.current.delete(id);
      commit(stack);
    },
    [currentStack, commit]
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
      rendererRef.current?.requestRender(sessionRef.current.layers());
    }
  }

  function handleRedo() {
    if (sessionRef.current.redo()) {
      syncSession();
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

  // Overlay du masque (rouge + contour animé) : affiché tant qu'on travaille
  // réellement sur le masque du calque sélectionné (panneau Masque ouvert OU
  // pinceau actif) ET qu'il y a un masque actif à montrer — pas en continu
  // dès qu'un masque existe (bruit visuel pendant qu'on règle un autre
  // aspect du calque). `overlayForceHidden` (Task 1) reste prioritaire :
  // un utilisateur qui veut juger le rendu final sans quitter le panneau
  // doit pouvoir l'éteindre explicitement. Voir
  // docs/superpowers/specs/2026-07-23-shaderlab-mask-overlay-visibility-design.md.
  const hasActiveMask = selectedLayer ? planFold(selectedLayer.mask).length > 0 : false;
  const wantsOverlay = (!maskCollapsed || maskPaintMode) && hasActiveMask && !!selectedId;

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
        onImportPhotoLayer={handleImportPhotoLayer}
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
          onStop={() => setMaskPaintMode(false)}
        />
      )}
      <main className="workspace" ref={workspaceRef} style={{ "--dock-reserved-width": `${dockWidth}px` } as React.CSSProperties}>
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
        {selectedLayer?.imageSource && selectedLayer.transform && (
          <TransformHandles
            transform={selectedLayer.transform}
            photoSize={rendererRef.current?.photoSources?.dimensions(selectedLayer.imageSource.sourceId) ?? { width: 1, height: 1 }}
            bgSize={imageSize}
            canvasRef={canvasRef}
            onTransformChange={(t) => handleTransformChange(selectedLayer.id, t)}
            onTransformCommit={handleTransformCommit}
          />
        )}
        <PanelColumn panels={[{
          id: "layers", title: "Calques", collapsed: layersCollapsed, onCollapsedChange: setLayersCollapsed,
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
            />
        }, {
          id: "params", title: paramsPanelTitle, collapsed: paramsCollapsed, onCollapsedChange: setParamsCollapsed,
          content: <ParamPanel
              layer={selectedLayer}
              onParamChange={handleParamChange}
              onParamCommit={handleParamCommit}
            />
        }, {
          id: "mask", title: "Masque", collapsed: maskCollapsed, onCollapsedChange: setMaskCollapsed,
          content: <MaskPanel
              layer={selectedLayer}
              maskPaintMode={maskPaintMode}
              onToggleMaskPaint={() => setMaskPaintMode((v) => !v)}
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
        }]} layout={dockLayout} onMove={handlePanelMove} width={dockWidth} onWidthChange={handleDockWidthChange} />
      </main>
    </div>
  );
}
