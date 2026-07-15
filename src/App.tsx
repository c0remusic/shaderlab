import { useEffect, useRef, useState, useCallback } from "react";
import { initGpu, type GpuContext } from "./render/gpuContext";
import { Renderer } from "./render/renderer";
import { LayerStack } from "./layers/layerStack";
import { History } from "./layers/history";
import type { LayerState } from "./layers/types";
import { Inspector } from "./components/Inspector";
import { Canvas } from "./components/Canvas";
import { Toolbar } from "./components/Toolbar";
import { ErrorBanner } from "./components/ErrorBanner";
import { exportImage, resolveExportTarget } from "./export/exportImage";
import { getLaunchPath, readImageFile, pickImageFile } from "./launch";
import { MaskPainter } from "./mask/maskPainter";

export default function App() {
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
  const maskPaintersRef = useRef<Map<string, { painter: MaskPainter; syncedFrom: Uint8Array | null }>>(new Map());
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

  const commit = useCallback((stack: LayerStack) => {
    historyRef.current.push(stack);
    setLayers(stack.layers);
    rendererRef.current?.requestRender(stack.layers);
  }, []);

  const currentStack = useCallback((): LayerStack => {
    const stack = new LayerStack();
    stack.layers = layers;
    return stack.clone();
  }, [layers]);

  const openFile = useCallback(async (file: File, path: string | null, fromLaunch: boolean) => {
    if (!canvasRef.current) return;
    try {
      if (!gpuRef.current) {
        gpuRef.current = await initGpu(canvasRef.current);
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
      setLayers(stack.layers);
      rendererRef.current.render(stack.layers);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

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
    setLayers(stack.layers);
    rendererRef.current?.requestRender(stack.layers);
  }

  function handleParamCommit() {
    if (!paramDirtyRef.current) return;
    paramDirtyRef.current = false;
    commit(currentStack());
  }

  function handleMaskStroke(x: number, y: number) {
    if (!selectedId || imageSize.width === 0) return;
    const currentMaskData = selectedLayer?.maskData ?? null;
    let entry = maskPaintersRef.current.get(selectedId);
    if (!entry) {
      const painter = new MaskPainter(imageSize.width, imageSize.height);
      if (currentMaskData) painter.loadFrom(currentMaskData);
      entry = { painter, syncedFrom: currentMaskData };
      maskPaintersRef.current.set(selectedId, entry);
    } else if (entry.syncedFrom !== currentMaskData) {
      // The layer's maskData reference changed since we last synced this
      // painter (e.g. undo/redo restored a different mask snapshot for
      // this layer id). Re-seed the cached painter's buffer from the
      // current truth (layers/history) before painting on top of it,
      // otherwise the stale cached buffer would silently overwrite what
      // undo/redo just restored.
      if (currentMaskData) entry.painter.loadFrom(currentMaskData);
      else entry.painter.clear(0);
      entry.syncedFrom = currentMaskData;
    }
    const dirtyRect = entry.painter.paintStroke(x, y, brushSize, brushHardness, erase);
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
    rendererRef.current?.requestRender(layers, {
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
    const stack = currentStack();
    // The one and only immutable-copy update for this stroke — see the
    // comment in handleMaskStroke for why this is deferred to stroke-end.
    stack.updateMask(selectedId, entry.painter.getMaskData());
    commit(stack);
    entry.syncedFrom = stack.layers.find((l) => l.id === selectedId)?.maskData ?? null;
  }

  function handleUndo() {
    const previous = historyRef.current.undo();
    if (previous) {
      setLayers(previous.layers);
      rendererRef.current?.requestRender(previous.layers);
    }
  }

  function handleRedo() {
    const next = historyRef.current.redo();
    if (next) {
      setLayers(next.layers);
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
      await exportImage(rendererRef.current, layers, target, imageSize.width, imageSize.height);
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
      <main className="workspace">
        <Canvas
          ref={canvasRef}
          onFileDropped={(file) => openFile(file, null, false)}
          maskPaintMode={maskPaintMode}
          onMaskStroke={handleMaskStroke}
          onStrokeEnd={handleMaskStrokeEnd}
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
          maskPaintMode={maskPaintMode}
          onToggleMaskPaint={() => setMaskPaintMode((v) => !v)}
          brushSize={brushSize}
          onBrushSizeChange={setBrushSize}
          brushHardness={brushHardness}
          onBrushHardnessChange={setBrushHardness}
          erase={erase}
          onEraseChange={setErase}
        />
      </main>
    </div>
  );
}
