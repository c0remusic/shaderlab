import type { RefObject } from "react";
import type { CanvasControl, EffectParam } from "../render/effects/types";
import { RegionHandles } from "./RegionHandles";
import { AxisHandles } from "./AxisHandles";
import { PointHandles } from "./PointHandles";
import { TransformHandles } from "./TransformHandles";
import { boiteVersTransform, transformVersBoite } from "../ui/boxControl";
import type { FrameRectLike } from "../ui/transform";

interface Props {
  controls: readonly CanvasControl[];
  params: readonly EffectParam[];
  values: Readonly<Record<string, number>>;
  imageSize: { width: number; height: number };
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Cadre de recadrage courant, ou `null` — descendu à chaque manipulateur
   *  pour caler les poignées sur le rectangle document virtuel (ticket 32). */
  frame?: FrameRectLike | null;
  effectName: string;
  disabled?: boolean;
  /** Le CORPS d'une boîte capte-t-il le pointeur ? Faux dans l'outil Forme :
   *  les poignées restent attrapables, mais un glissement DANS la forme
   *  commence une nouvelle forme au lieu de déplacer celle qui est là. */
  corpsInteractif?: boolean;
  onChange: (patch: Record<string, number>) => void;
  onCommit: () => void;
}

/** Hôte déclaratif unique. La première migration porte les disques historiques ;
 * point et axe rejoignent ce dispatch sans branchement par identifiant d'effet. */
export function CanvasControls({ controls, params, values, imageSize, canvasRef, frame = null, effectName, disabled = false, corpsInteractif = true, onChange, onCommit }: Props) {
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
        canvasRef={canvasRef} imageSize={imageSize} frame={frame} label={`${effectName} — ${control.label}`}
        disabled={disabled}
        onChange={(point) => onChange({ [control.x]: point.x, [control.y]: point.y })} onCommit={onCommit} />;
    }
    if (control.kind === "axis") {
      const lengthParam = params.find((param) => param.name === control.length);
      if (!lengthParam) return null;
      return <AxisHandles key={control.id} angle={value(control.angle)} length={value(control.length)}
        lengthRange={{ min: lengthParam.min, max: lengthParam.max }} imageSize={imageSize} canvasRef={canvasRef} frame={frame}
        label={`${effectName} — ${control.label}`}
        disabled={disabled}
        onChange={(angle, length) => onChange({ [control.angle]: angle, [control.length]: length })} onCommit={onCommit} />;
    }
    if (control.kind === "box") {
      // LE QUATRIÈME GENRE NE REND AUCUN MANIPULATEUR NEUF (ticket 25) :
      // `TransformHandles` fait déjà huit poignées, une rotation, le magnétisme
      // et l'accès clavier pour le calque photo. Une boîte d'effet est le même
      // objet dans d'autres unités, et `ui/boxControl.ts` est ce changement
      // d'unités — voir son en-tête pour le piège des degrés et des radians.
      //
      // `otherPhotoLayers` reste vide : les cibles d'accroche d'une boîte
      // d'effet sont les bords et médianes de la toile, pas les autres photos —
      // un aplat ne s'aligne pas sur une image qu'il recouvre.
      const boite = {
        centreX: value(control.x),
        centreY: value(control.y),
        largeur: value(control.width),
        hauteur: value(control.height),
        rotation: value(control.rotation),
      };
      const { transform, photoSize } = boiteVersTransform(boite, imageSize);
      return (
        <TransformHandles
          key={control.id}
          transform={transform}
          photoSize={photoSize}
          bgSize={imageSize}
          canvasRef={canvasRef}
          frame={frame}
          layerName={`${effectName} — ${control.label}`}
          corpsInteractif={corpsInteractif}
          onTransformChange={(suivant) => {
            const rendue = transformVersBoite(suivant, photoSize, imageSize);
            onChange({
              [control.x]: rendue.centreX,
              [control.y]: rendue.centreY,
              [control.width]: rendue.largeur,
              [control.height]: rendue.hauteur,
              [control.rotation]: rendue.rotation,
            });
          }}
          onTransformCommit={onCommit}
        />
      );
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
        frame={frame}
        effectName={`${effectName} — ${control.label}`}
        disabled={disabled}
        onRegionChange={(center, radius) => onChange({ [control.x]: center.x, [control.y]: center.y, [control.radius]: radius })}
        onRegionCommit={onCommit}
      />
    );
  });
}
