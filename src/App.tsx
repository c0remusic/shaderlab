import { useEffect, useRef, useState } from "react";
import { initGpu } from "./render/gpuContext";
import { Renderer } from "./render/renderer";
import { LayerStack } from "./layers/layerStack";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    (async () => {
      try {
        const ctx = await initGpu(canvasRef.current!);
        const renderer = new Renderer(ctx);

        const response = await fetch("/test-fixtures/sample.jpg");
        const blob = await response.blob();
        const bitmap = await createImageBitmap(blob);
        canvasRef.current!.width = bitmap.width;
        canvasRef.current!.height = bitmap.height;

        await renderer.loadImage(bitmap);
        const stack = new LayerStack();
        stack.addLayer("glow");
        renderer.render(stack.layers);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, []);

  return (
    <div>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <canvas ref={canvasRef} />
    </div>
  );
}
