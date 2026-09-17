// Ce que l'adapter ANNONCE sous WebView2 : les features (dont shader-f16) et
// l'identite du GPU. Question 1 du ticket d'optimisation — elle se repond par
// une lecture, pas par une supposition.
import { connecter } from "./cdp.mjs";

const c = await connecter();
const r = await c.evaluer(`(async () => {
  const a = await navigator.gpu.requestAdapter();
  if (!a) return { erreur: "aucun adapter" };
  const info = a.info ?? (a.requestAdapterInfo ? await a.requestAdapterInfo() : {});
  return {
    features: [...a.features].sort(),
    f16: a.features.has("shader-f16"),
    timestamp: a.features.has("timestamp-query"),
    info: { vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description },
    limites: {
      maxTextureDimension2D: a.limits.maxTextureDimension2D,
      maxBufferSize: a.limits.maxBufferSize,
      maxStorageBufferBindingSize: a.limits.maxStorageBufferBindingSize,
      maxBindGroups: a.limits.maxBindGroups,
    },
    formatCanvas: navigator.gpu.getPreferredCanvasFormat(),
  };
})()`);
console.log(JSON.stringify(r, null, 2));
c.fermer();
