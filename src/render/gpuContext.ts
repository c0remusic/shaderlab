export interface GpuContext {
  device: GPUDevice;
  context: GPUCanvasContext;
  format: GPUTextureFormat;
}

export async function initGpu(canvas: HTMLCanvasElement): Promise<GpuContext> {
  if (!navigator.gpu) {
    throw new Error("WebGPU non disponible sur ce navigateur/GPU.");
  }
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error("Aucun adaptateur WebGPU trouvé.");
  }
  const device = await adapter.requestDevice();
  const context = canvas.getContext("webgpu") as GPUCanvasContext;
  if (!context) {
    throw new Error("Impossible d'obtenir un contexte WebGPU sur le canvas.");
  }
  const format: GPUTextureFormat = "rgba8unorm-srgb";
  context.configure({ device, format, alphaMode: "opaque" });
  return { device, context, format };
}
