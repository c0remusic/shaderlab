import { useEffect, useRef, useState, useCallback } from "react";
import { initGpu, type GpuContext } from "./render/gpuContext";
import { Renderer } from "./render/renderer";
import { LayerStack } from "./layers/layerStack";
import { History } from "./layers/history";
import type { LayerState } from "./layers/types";
import { LayerPanel } from "./components/LayerPanel";
import { ParamPanel } from "./components/ParamPanel";
import { Canvas } from "./components/Canvas";
import { Toolbar } from "./components/Toolbar";
import { ErrorBanner } from "./components/ErrorBanner";
import { exportImage, resolveExportTarget } from "./export/exportImage";
import { getLaunchPath, readImageFile } from "./launch";
import { MaskPainter } from "./mask/maskPainter";
import { open } from "@tauri-apps/plugin-dialog";

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
  const [maskPaintMode, setMaskPaintMode] = useState(false);
  const [brushSize, setBrushSize] = useState(30);
  const [brushHardness, setBrushHardness] = useState(0.5);
  const [erase, setErase] = useState(false);

  const commit = useCallback((stack: LayerStack) => {
    historyRef.current.push(stack);
    setLayers(stack.layers);
    rendererRef.current?.render(stack.layers);
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
        const blob = new Blob([bytes.buffer as ArrayBuffer]);
        await openFile(new File([blob], path), path, true);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }, [openFile]);

  const handleOpenFile = useCallback(async () => {
    try {
      const path = await open({
        multiple: false,
        filters: [{ name: "Images", extensions: ["jpg", "jpeg"] }],
      });
      if (!path || Array.isArray(path)) return;
      // Manual "Ouvrir" dialog path: a real absolute path is now known, but
      // this is still NOT the Lightroom launch path — isLaunchFile stays
      // false so handleExport keeps exporting via buildCopyPath (copy),
      // never overwriting the manually-opened source file in place.
      const bytes = await readImageFile(path);
      const blob = new Blob([bytes.buffer as ArrayBuffer]);
      await openFile(new File([blob], path), path, false);
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
    const stack = currentStack();
    stack.updateParams(id, params);
    commit(stack);
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
    entry.painter.paintStroke(x, y, brushSize, brushHardness, erase);
    const stack = currentStack();
    stack.updateMask(selectedId, entry.painter.getMaskData());
    entry.syncedFrom = stack.layers.find((l) => l.id === selectedId)?.maskData ?? null;
    setLayers(stack.layers);
    rendererRef.current?.render(stack.layers);
    // Intentionally NOT calling `commit()`/history.push() per pointer-move sample —
    // that would flood undo history with every mouse-move frame. Mask strokes are
    // committed to history once, on pointer-up (see handleMaskStrokeEnd below).
  }

  function handleMaskStrokeEnd() {
    if (!selectedId) return;
    const stack = currentStack();
    commit(stack);
    // `commit` -> `currentStack` clones the stack, producing a brand-new
    // `maskData` reference for every layer even though the bytes are
    // unchanged. Re-sync the tracked reference to that new clone so the
    // next stroke's divergence check in `handleMaskStroke` doesn't mistake
    // this stroke-end's own clone for an external change (undo/redo). A
    // genuine undo/redo does NOT go through this function, so its clone's
    // reference legitimately won't match any tracked `syncedFrom` and will
    // still correctly trigger a re-seed.
    const entry = maskPaintersRef.current.get(selectedId);
    if (entry) {
      entry.syncedFrom = stack.layers.find((l) => l.id === selectedId)?.maskData ?? null;
    }
  }

  function handleUndo() {
    const previous = historyRef.current.undo();
    if (previous) {
      setLayers(previous.layers);
      rendererRef.current?.render(previous.layers);
    }
  }

  function handleRedo() {
    const next = historyRef.current.redo();
    if (next) {
      setLayers(next.layers);
      rendererRef.current?.render(next.layers);
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
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <Toolbar
        canUndo={historyRef.current.canUndo()}
        canRedo={historyRef.current.canRedo()}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onExport={handleExport}
        onOpenFile={handleOpenFile}
      />
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <LayerPanel
          layers={layers}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onToggle={handleToggle}
          onAdd={handleAdd}
          onRemove={handleRemove}
          onReorder={handleReorder}
        />
        <Canvas
          ref={canvasRef}
          onFileDropped={(file) => openFile(file, null, false)}
          maskPaintMode={maskPaintMode}
          onMaskStroke={handleMaskStroke}
          onStrokeEnd={handleMaskStrokeEnd}
        />
        <ParamPanel
          layer={selectedLayer}
          onParamChange={handleParamChange}
          maskPaintMode={maskPaintMode}
          onToggleMaskPaint={() => setMaskPaintMode((v) => !v)}
          brushSize={brushSize}
          onBrushSizeChange={setBrushSize}
          brushHardness={brushHardness}
          onBrushHardnessChange={setBrushHardness}
          erase={erase}
          onEraseChange={setErase}
        />
      </div>
    </div>
  );
}
