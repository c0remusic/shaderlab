export interface EffectParam {
  name: string;
  label: string;
  unit?: "percent" | "pixels" | "degrees" | "none";
  hint?: string;
  min: number;
  max: number;
  default: number;
  step: number;
  /** Groups this param with its hue/saturation/lightness siblings (same `key`)
   *  under a single swatch + disclosure control in ParamPanel, instead of a
   *  standalone slider. All three roles must be present for a given `key` —
   *  ParamPanel throws otherwise (see groupEffectParams). */
  colorGroup?: { key: string; role: "hue" | "saturation" | "lightness"; label: string };
  /** Renders this param as a named CHOICE list instead of a slider. The param
   *  value stays a number — the index into this array — because the uniform is
   *  `array<f32, N>` and nothing else may cross that boundary.
   *
   *  Why a list and not a slider with `step: 1`. A slider labels its value with
   *  the number itself: a mode param would read "0" or "1" and say nothing about
   *  what either is. Distinct from `colorGroup`, which groups three CONTINUOUS
   *  params under one control; here a single param has discrete named states.
   *
   *  Reserved for genuinely discrete states — two settings of the SAME operation
   *  belong on a slider (see `channelMixer`'s `monochrome`, deliberately
   *  continuous so partial desaturations stay reachable). Use this when the
   *  intermediate values would model nothing. Validated by `validateEffect`:
   *  `min` must be 0, `step` 1, and `max` exactly `choices.length - 1`. */
  choices?: string[];
}

export interface EffectPass {
  /** Resolution scale of this pass's output target relative to the image (1 = full, 0.5 = half...). */
  scale: number;
  /** WGSL body defining fs_main(uv, color) — `color` samples this pass's INPUT texture (bound as
   *  srcTexture, same as any single-pass effect). Internal passes never see the mask or `prevPass`. */
  wgsl: string;
}

export interface EffectModule {
  id: string;
  name: string;
  params: EffectParam[];
  /** WGSL fragment shader body. Must define fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32>
   *  and read params via the `params: array<f32, 8>` uniform (index order matches `params` above).
   *  Single-pass body (used directly when `passes` is absent). For multi-pass effects, this is the
   *  FINAL composite pass and additionally may sample `prevPass` (binding 4, the last internal
   *  pass's output) — this is also the only pass masking is applied to. */
  wgsl: string;
  /** Optional chain of internal passes run in order, each at its own resolution scale, before the
   *  final composite (`wgsl` above) runs. Each pass's input is the previous pass's output (the
   *  first pass's input is the layer's normal source texture). Masking is NOT applied to internal
   *  passes — only to the final composite. */
  passes?: EffectPass[];
}
