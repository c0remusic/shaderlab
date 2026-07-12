import { useEffect, useRef, useState } from "react";
import { initGpu, getSrgbCanvasView } from "./render/gpuContext";

const SHADER_SRC = `
@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> @builtin(position) vec4<f32> {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0)
  );
  return vec4<f32>(pos[i], 0.0, 1.0);
}

@fragment
fn fs_main() -> @location(0) vec4<f32> {
  return vec4<f32>(0.8, 0.2, 0.4, 1.0);
}
`;

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    initGpu(canvasRef.current)
      .then((ctx) => {
        const { device } = ctx;
        const module = device.createShaderModule({ code: SHADER_SRC });
        const pipeline = device.createRenderPipeline({
          layout: "auto",
          vertex: { module, entryPoint: "vs_main" },
          // Write into the sRGB view format: the shader outputs the linear
          // color (0.8, 0.2, 0.4) and the GPU encodes it to sRGB on store —
          // this is the same auto-encode every effect's final pass relies on.
          fragment: { module, entryPoint: "fs_main", targets: [{ format: ctx.srgbFormat }] },
        });
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginRenderPass({
          colorAttachments: [
            {
              view: getSrgbCanvasView(ctx),
              clearValue: { r: 0, g: 0, b: 0, a: 1 },
              loadOp: "clear",
              storeOp: "store",
            },
          ],
        });
        pass.setPipeline(pipeline);
        pass.draw(3);
        pass.end();
        device.queue.submit([encoder.finish()]);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div>
      {error && <p style={{ color: "red" }}>{error}</p>}
      <canvas ref={canvasRef} width={800} height={600} />
    </div>
  );
}
