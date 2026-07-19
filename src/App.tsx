import { useEffect, useRef, useState, useCallback } from "react";
import { initGpu, type GpuContext } from "./render/gpuContext";
import { Renderer } from "./render/renderer";
import { LayerStack } from "./layers/layerStack";
import { History } from "./layers/history";
import type { LayerState } from "./layers/types";
import { toDisplayLayers } from "./layers/displayProjection";
import { Inspector } from "./components/Inspector";
import { BrushToolbar } from "./components/BrushToolbar";
import { Canvas } from "./components/Canvas";
import { Toolbar } from "./components/Toolbar";
import { ErrorBanner } from "./components/ErrorBanner";
import { exportImage, resolveExportTarget } from "./export/exportImage";
import { getLaunchPath, readImageFile, pickImageFile } from "./launch";
import { useGlobalControlWheel } from "./ui/activeControl";
import { getSyncedMaskPainter, type MaskPainterEntry } from "./mask/maskPainterSync";
import { getBrushRaster } from "./mask/brushSource";

export default function App() {
  useGlobalControlWheel();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gpuRef = useRef<GpuContext | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const historyRef = useRef<History>(new History(new LayerStack()));
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

  // `layersRef` = source de vérité COMPLÈTE des calques (avec maskData), pour le
  // rendu GPU, l'historique et l'export. Le state React `layers` n'en est qu'une
  // PROJECTION D'AFFICHAGE, maskData retiré.
  //
  // Pourquoi : un maskData r8 pleine résolution (~26 Mo à 24MP) placé dans le
  // state React fait CRASHER (hang WebView2, CDP inerte) au re-render déclenché
  // par setLayers() en fin de stroke. Root cause épinglée par A/B live sur la
  // vraie fenêtre (2026-07-18, docs/superpowers/specs/2026-07-17-native-wgpu-
  // decision.md) : setLayers() SANS maskData (ajout de calque) à 24MP ne crashe
  // pas ; setLayers() AVEC le maskData 26MB crashe ; ne pas appeler setLayers
  // ne crashe pas. Ce n'est donc ni le GPU (requestRender avec le masque
  // complet est OK) ni le re-render en soi, mais le buffer 26 Mo transitant par
  // l'état React. Le fix garde setLayers() (UI correcte) mais retire maskData de
  // ce qui y entre ; les panneaux n'affichent jamais les pixels du masque.
  const layersRef = useRef<LayerState[]>([]);
  const syncLayers = useCallback((full: LayerState[]) => {
    layersRef.current = full;
    setLayers(toDisplayLayers(full));
  }, []);

  const commit = useCallback(
    (stack: LayerStack) => {
      historyRef.current.push(stack);
      syncLayers(stack.layers);
      rendererRef.current?.requestRender(stack.layers);
    },
    [syncLayers]
  );

  const currentStack = useCallback((): LayerStack => {
    // Depuis layersRef (COMPLET, avec maskData), jamais depuis le state `layers`
    // (projection d'affichage sans maskData) — sinon toute opération non-masque
    // réécrirait des calques à maskData null et effacerait les masques.
    const stack = new LayerStack();
    stack.layers = layersRef.current;
    return stack.clone();
  }, []);

  const openFile = useCallback(async (file: File, path: string | null, fromLaunch: boolean) => {
    if (!canvasRef.current) return;
    try {
      if (!gpuRef.current) {
        gpuRef.current = await initGpu(canvasRef.current, (message) => setError(message));
      }
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(file);
      } catch {
        throw new Error("Image non supportée ou corrompue.");
      }
      canvasRef.current.width = bitmap.width;
      canvasRef.current.height = bitmap.height;

      rendererRef.current?.dispose();
      rendererRef.current = new Renderer(gpuRef.current);
      await rendererRef.current.loadImage(bitmap);

      // Only commit sourcePath/isLaunchFile/imageSize state AFTER loadImage succeeds.
      // If loadImage throws, these state updates never happen, leaving the previous
      // values intact and preventing handleExport from attempting to export with an
      // unloaded renderer.
      setImageSize({ width: bitmap.width, height: bitmap.height });
      setSourcePath(path);
      setIsLaunchFile(fromLaunch);

      const stack = new LayerStack();
      historyRef.current = new History(stack);
      syncLayers(stack.layers);
      rendererRef.current.render(stack.layers);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [syncLayers]);

  useEffect(() => {
    getLaunchPath().then(async (path) => {
      if (!path) return;
      try {
        const bytes = await readImageFile(path);
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "image/jpeg" });
        await openFile(new File([blob], path, { type: "image/jpeg" }), path, true);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }, [openFile]);

  // Overlay du masque : montrer le masque du calque sélectionné en rouge
  // safelight dès qu'on entre en mode peinture (pour VOIR ce qu'on masque),
  // l'éteindre sinon. Piloté comme un état du renderer + un re-rendu.
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setMaskOverlay(maskPaintMode && selectedId ? selectedId : null);
    r.requestRender(layersRef.current);
  }, [maskPaintMode, selectedId]);

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
      setError((e as Error).message);
    }
  }, [openFile]);

  function handleAdd(effectId: string) {
    const stack = currentStack();
    const id = stack.addLayer(effectId);
    setSelectedId(id);
    commit(stack);
  }

  function handleToggle(id: string) {
    const stack = currentStack();
    stack.toggleLayer(id);
    commit(stack);
  }

  function handleRemove(id: string) {
    const stack = currentStack();
    stack.removeLayer(id);
    if (selectedId === id) setSelectedId(null);
    maskPaintersRef.current.delete(id);
    commit(stack);
  }

  function handleReorder(id: string, newIndex: number) {
    const stack = currentStack();
    stack.reorderLayer(id, newIndex);
    commit(stack);
  }

  function handleParamChange(id: string, params: Record<string, number>) {
    // Mise à jour vivante pendant le drag : état + rendu coalescé, PAS
    // d'entrée d'historique — la spec v1 exige UNE entrée par interaction,
    // pas une par frame de drag.
    paramDirtyRef.current = true;
    const stack = currentStack();
    stack.updateParams(id, params);
    syncLayers(stack.layers);
    rendererRef.current?.requestRender(stack.layers);
  }

  function handleParamCommit() {
    if (!paramDirtyRef.current) return;
    paramDirtyRef.current = false;
    commit(currentStack());
  }

  function handleOpacityChange(id: string, opacity: number) {
    paramDirtyRef.current = true;
    const stack = currentStack();
    const layer = stack.layers.find((l) => l.id === id);
    if (layer) layer.opacity = opacity;
    syncLayers(stack.layers);
    rendererRef.current?.requestRender(stack.layers);
  }

  function handleBlendModeChange(id: string, blendMode: string) {
    const stack = currentStack();
    const layer = stack.layers.find((l) => l.id === id);
    if (layer) layer.blendMode = blendMode;
    commit(stack); // changement discret → une entrée d'historique directe
  }

  function handleMaskStroke(x: number, y: number) {
    if (!selectedId || imageSize.width === 0) return;
    // maskData depuis layersRef (complet) — le state `layers` est la projection
    // d'affichage sans maskData.
    const layer = layersRef.current.find((l) => l.id === selectedId);
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
    // a GPU texture upload, WITHOUT going through LayerStack.updateMask()'s
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
    rendererRef.current?.requestRender(layersRef.current, {
      layerId: selectedId,
      maskData: entry.painter.getMaskData(),
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
    stack.updateBrushMask(selectedId, entry.painter.getMaskData());
    commit(stack);
    const committedLayer = stack.layers.find((l) => l.id === selectedId);
    entry.syncedFrom = committedLayer ? getBrushRaster(committedLayer) : null;
  }

  function handleUndo() {
    const previous = historyRef.current.undo();
    if (previous) {
      syncLayers(previous.layers);
      rendererRef.current?.requestRender(previous.layers);
    }
  }

  function handleRedo() {
    const next = historyRef.current.redo();
    if (next) {
      syncLayers(next.layers);
      rendererRef.current?.requestRender(next.layers);
    }
  }

  async function handleExport() {
    if (!rendererRef.current) return;
    if (!sourcePath) {
      setError(
        "Impossible d'exporter : ouvre le fichier via un vrai chemin (lancement depuis Lightroom, ou une future boîte de dialogue \"Ouvrir\") plutôt que par glisser-déposer."
      );
      return;
    }
    // Manual export ALWAYS copies (buildCopyPath) unless this file was
    // opened via the Lightroom launch-path CLI arg, in which case we
    // overwrite that exact path (Lightroom's own temp copy) — see
    // resolveExportTarget's doc comment for the full rationale.
    const target = resolveExportTarget(sourcePath, isLaunchFile);
    try {
      await exportImage(rendererRef.current, layersRef.current, target, imageSize.width, imageSize.height);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const selectedLayer = layers.find((l) => l.id === selectedId) ?? null;

  return (
    <div className="app-shell">
      <Toolbar
        canUndo={historyRef.current.canUndo()}
        canRedo={historyRef.current.canRedo()}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onExport={handleExport}
        onOpenFile={handleOpenFile}
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
      <main className="workspace">
        <Canvas
          ref={canvasRef}
          onFileDropped={(file) => openFile(file, null, false)}
          maskPaintMode={maskPaintMode}
          onMaskStroke={handleMaskStroke}
          onStrokeEnd={handleMaskStrokeEnd}
          brushSize={brushSize}
          brushHardness={brushHardness}
        />
        <Inspector
          layers={layers}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onToggle={handleToggle}
          onAdd={handleAdd}
          onRemove={handleRemove}
          onReorder={handleReorder}
          layer={selectedLayer}
          onParamChange={handleParamChange}
          onParamCommit={handleParamCommit}
          onOpacityChange={handleOpacityChange}
          onOpacityCommit={handleParamCommit}
          onBlendModeChange={handleBlendModeChange}
          maskPaintMode={maskPaintMode}
          onToggleMaskPaint={() => setMaskPaintMode((v) => !v)}
        />
      </main>
    </div>
  );
}
