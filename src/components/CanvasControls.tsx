import type { RefObject } from "react";
import type { CanvasControl, EffectParam } from "../render/effects/types";
import { RegionHandles } from "./RegionHandles";
import { AxisHandles } from "./AxisHandles";
import { PointHandles } from "./PointHandles";

interface Props {
  controls: readonly CanvasControl[];
  params: readonly EffectParam[];
  values: Readonly<Record<string, number>>;
  imageSize: { width: number; height: number };
  canvasRef: RefObject<HTMLCanvasElement | null>;
  effectName: string;
  disabled?: boolean;
  onChange: (patch: Record<string, number>) => void;
  onCommit: () => void;
}

/** Hôte déclaratif unique. La première migration porte les disques historiques ;
 * point et axe rejoignent ce dispatch sans branchement par identifiant d'effet. */
export function CanvasControls({ controls, params, values, imageSize, canvasRef, effectName, disabled = false, onChange, onCommit }: Props) {
  const value = (name: string) => values[name] ?? params.find((param) => param.name === name)?.default ?? 0;
  return controls.map((control) => {
    if (control.visibleWhen) {
      const expected = control.visibleWhen.equals;
      const current = value(control.visibleWhen.param);
      if (Array.isArray(expected) ? !expected.includes(current) : current !== expected) return null;
    }
    if (control.kind === "point") {
      const xParam = params.find((param) => param.name === control.x);
      const yParam = params.find((param) => param.name === control.y);
      if (!xParam || !yParam) return null;
      return <PointHandles key={control.id} point={{ x: value(control.x), y: value(control.y) }}
        xRange={{ min: xParam.min, max: xParam.max }} yRange={{ min: yParam.min, max: yParam.max }}
        canvasRef={canvasRef} label={`${effectName} — ${control.label}`}
        disabled={disabled}
        onChange={(point) => onChange({ [control.x]: point.x, [control.y]: point.y })} onCommit={onCommit} />;
    }
    if (control.kind === "axis") {
      const lengthParam = params.find((param) => param.name === control.length);
      if (!lengthParam) return null;
      return <AxisHandles key={control.id} angle={value(control.angle)} length={value(control.length)}
        lengthRange={{ min: lengthParam.min, max: lengthParam.max }} imageSize={imageSize} canvasRef={canvasRef}
        label={`${effectName} — ${control.label}`}
        disabled={disabled}
        onChange={(angle, length) => onChange({ [control.angle]: angle, [control.length]: length })} onCommit={onCommit} />;
    }
    if (control.kind !== "disk") return null;
    const radiusParam = params.find((param) => param.name === control.radius);
    if (!radiusParam) return null; // validateEffect rend ce cas impossible.
    return (
      <RegionHandles
        key={control.id}
        center={{ x: value(control.x), y: value(control.y) }}
        radius={value(control.radius)}
        radiusRange={{ min: radiusParam.min, max: radiusParam.max }}
        bgSize={imageSize}
        canvasRef={canvasRef}
        effectName={`${effectName} — ${control.label}`}
        disabled={disabled}
        onRegionChange={(center, radius) => onChange({ [control.x]: center.x, [control.y]: center.y, [control.radius]: radius })}
        onRegionCommit={onCommit}
      />
    );
  });
}
