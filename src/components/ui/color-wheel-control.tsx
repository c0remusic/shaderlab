import { useEffect, useRef, useState } from "react";
import { hslToHex } from "../../ui/hsl";
import { pointToHueSat, hueSatToPoint, nudgeHueSat, type HueSat } from "../../ui/colorWheel";
import { formatSignedValue, parseSignedValue } from "../../ui/formatValue";
import { LabeledSlider } from "./labeled-slider";
import "./color-wheel-control.css";

/**
 * Une VRAIE ROUE chromatique (ticket 06) : teinte au pourtour, saturation au
 * rayon, un point qu'on tire, la luminance en curseur SIGNÉ dessous. Contrôle du
 * Color Grading de Lightroom — pas un sélecteur de couleur.
 *
 * Il COMPOSE `LabeledSlider` pour la luminance (primitive `ui/`, curseur inline
 * signé, double-clic-défaut) et n'a de maison que le disque teinte/saturation. La
 * géométrie point ↔ (teinte, saturation) est le module pur `ui/colorWheel.ts`
 * (testé). Les couleurs de la roue sont des DONNÉES du domaine, calculées par
 * `hslToHex` (aucun littéral, donc `lint:tokens` ne les touche pas).
 */
export interface ColorWheelChange {
  hue?: number;
  saturation?: number;
  luminance?: number;
}

interface Props {
  label: string;
  hue: number;
  saturation: number;
  luminance: number;
  hueDefault: number;
  saturationDefault: number;
  luminanceDefault: number;
  luminanceMin: number;
  luminanceMax: number;
  luminanceStep: number;
  disabled?: boolean;
  onChange: (patch: ColorWheelChange) => void;
  onCommit: () => void;
}

/** Anneau de teinte : conic-gradient calé sur la convention de `colorWheel.ts`
 *  (0° à droite, sens trigonométrique). L'angle conique se mesure horaire depuis
 *  le haut, d'où `90 - φ`. */
const HUE_RING = `conic-gradient(${Array.from({ length: 13 }, (_, i) => {
  const phi = i * 30;
  return `${hslToHex(((90 - phi) % 360 + 360) % 360, 1, 0.5)} ${phi}deg`;
}).join(", ")})`;

// Blanchiment du centre (saturation 0 au coeur) : blanc calcule -> transparent.
const SAT_OVERLAY = `radial-gradient(circle at center, ${hslToHex(0, 0, 1)} 0%, transparent 72%)`;

export function ColorWheelControl({
  label, hue, saturation, luminance,
  hueDefault, saturationDefault, luminanceDefault,
  luminanceMin, luminanceMax, luminanceStep,
  disabled = false, onChange, onCommit,
}: Props) {
  const [preview, setPreview] = useState<HueSat>({ hue, saturation });
  const previewRef = useRef(preview);
  const draggingRef = useRef(false);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<HueSat | null>(null);
  const diskRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!draggingRef.current) {
      const next = { hue, saturation };
      setPreview(next);
      previewRef.current = next;
    }
  }, [hue, saturation]);

  useEffect(() => () => { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); }, []);

  const publish = (next: HueSat) => {
    setPreview(next); previewRef.current = next; pendingRef.current = next;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (pendingRef.current) onChange({ hue: pendingRef.current.hue, saturation: pendingRef.current.saturation });
      pendingRef.current = null;
    });
  };

  const flush = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    if (pendingRef.current) onChange({ hue: pendingRef.current.hue, saturation: pendingRef.current.saturation });
    pendingRef.current = null;
  };

  const fromClient = (clientX: number, clientY: number): HueSat => {
    const disk = diskRef.current!;
    const rect = disk.getBoundingClientRect();
    const radius = rect.width / 2;
    return pointToHueSat(clientX - (rect.left + radius), clientY - (rect.top + radius), radius);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    event.preventDefault();
    draggingRef.current = true;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    publish(fromClient(event.clientX, event.clientY));
    const onMove = (moveEvent: PointerEvent) => publish(fromClient(moveEvent.clientX, moveEvent.clientY));
    const cleanup = () => {
      draggingRef.current = false;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    const onUp = () => { flush(); onCommit(); cleanup(); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onUp, { once: true });
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const coarse = event.shiftKey;
    let next: HueSat | null = null;
    if (event.key === "ArrowLeft") next = nudgeHueSat(previewRef.current, coarse ? -10 : -2, 0);
    else if (event.key === "ArrowRight") next = nudgeHueSat(previewRef.current, coarse ? 10 : 2, 0);
    else if (event.key === "ArrowUp") next = nudgeHueSat(previewRef.current, 0, coarse ? 10 : 2);
    else if (event.key === "ArrowDown") next = nudgeHueSat(previewRef.current, 0, coarse ? -10 : -2);
    if (!next) return;
    event.preventDefault();
    publish(next); flush(); onCommit();
  };

  const resetHueSat = () => {
    if (disabled) return;
    const next = { hue: hueDefault, saturation: saturationDefault };
    setPreview(next); previewRef.current = next;
    onChange({ hue: hueDefault, saturation: saturationDefault });
    onCommit();
  };

  const point = hueSatToPoint(preview.hue, preview.saturation, 50); // rayon 50 % -> fractions
  const left = 50 + point.x;
  const top = 50 + point.y;
  const pointColor = hslToHex(preview.hue, Math.max(preview.saturation / 100, 0), 0.5);

  return (
    <section className="color-wheel" aria-label={label} data-disabled={disabled || undefined}>
      <div className="color-wheel__head">{label}</div>
      <div
        ref={diskRef}
        className="color-wheel__disk"
        role="slider"
        aria-label={`${label} — teinte ${Math.round(preview.hue)}°, saturation ${Math.round(preview.saturation)}`}
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(preview.hue)}
        aria-valuetext={`teinte ${Math.round(preview.hue)}°, saturation ${Math.round(preview.saturation)}`}
        tabIndex={disabled ? -1 : 0}
        style={{ backgroundImage: `${SAT_OVERLAY}, ${HUE_RING}` }}
        onPointerDown={handlePointerDown}
        onKeyDown={handleKeyDown}
        onDoubleClick={resetHueSat}
      >
        <span
          className="color-wheel__point"
          style={{ left: `${left}%`, top: `${top}%`, "--wheel-point-color": pointColor } as React.CSSProperties}
          aria-hidden="true"
        />
      </div>
      <LabeledSlider
        label="Luminance"
        value={luminance}
        min={luminanceMin}
        max={luminanceMax}
        step={luminanceStep}
        displayValue={formatSignedValue(luminance, luminanceStep)}
        parse={(raw) => parseSignedValue(raw, luminanceMin, luminanceMax, luminanceStep)}
        layout="inline"
        valueAlign="right"
        disabled={disabled}
        defaultValue={luminanceDefault}
        onChange={(v) => onChange({ luminance: v })}
        onCommit={onCommit}
      />
    </section>
  );
}
