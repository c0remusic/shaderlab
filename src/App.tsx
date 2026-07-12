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
import { exportImage, resolveExportTarget } from "./export/exportImage";
import { getLaunchPath } from "./launch";
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
  const maskPaintersRef = useRef<Map<string, MaskPainter>>(new Map());
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
      const bitmap = await createImageBitmap(file);
      canvasRef.current.width = bitmap.width;
      canvasRef.current.height = bitmap.height;

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
      const response = await fetch(`file://${path}`);
      const blob = await response.blob();
      await openFile(new File([blob], path), path, true);
    });
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
    commit(stack);
  }

  function handleParamChange(id: string, params: Record<string, number>) {
    const stack = currentStack();
    stack.updateParams(id, params);
    commit(stack);
  }

  function handleMaskStroke(x: number, y: number) {
    if (!selectedId || imageSize.width === 0) return;
    let painter = maskPaintersRef.current.get(selectedId);
    if (!painter) {
      painter = new MaskPainter(imageSize.width, imageSize.height);
      maskPaintersRef.current.set(selectedId, painter);
    }
    painter.paintStroke(x, y, brushSize, brushHardness, erase);
    const stack = currentStack();
    stack.updateMask(selectedId, painter.getMaskData());
    setLayers(stack.layers);
    rendererRef.current?.render(stack.layers);
    // Intentionally NOT calling `commit()`/history.push() per pointer-move sample —
    // that would flood undo history with every mouse-move frame. Mask strokes are
    // committed to history once, on pointer-up (see handleMaskStrokeEnd below).
  }

  function handleMaskStrokeEnd() {
    if (!selectedId) return;
    commit(currentStack());
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
    if (!rendererRef.current || !sourcePath) return;
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
      />
      {error && <p style={{ color: "red" }}>{error}</p>}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <LayerPanel
          layers={layers}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onToggle={handleToggle}
          onAdd={handleAdd}
          onRemove={handleRemove}
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
