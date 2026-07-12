export interface EffectParam {
  name: string;
  min: number;
  max: number;
  default: number;
  step: number;
}

export interface EffectModule {
  id: string;
  name: string;
  params: EffectParam[];
  /** WGSL fragment shader body. Must define fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32>
   *  and read params via the `params: array<f32, 8>` uniform (index order matches `params` above). */
  wgsl: string;
}
