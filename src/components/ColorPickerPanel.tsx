import { useCallback, useRef, useState } from "react";
import { X } from "lucide-react";
import { IconButton } from "./ui/icon-button";
import { hexToHsl, hslToHex } from "../ui/hsl";
import "./ColorPickerPanel.css";

export interface ColorPickerPanelProps {
  label: string;
  hue: number;
  saturation: number;
  lightness: number;
  onChange: (values: { hue?: number; saturation?: number; lightness?: number }) => void;
  onCommit: () => void;
  onClose: () => void;
  style?: React.CSSProperties;
}

const SV_SIZE = 160;
const HUE_BAND_HEIGHT = 12;

/** Saturation/lightness square for a FIXED hue — HSL's "S" axis maps to
 *  the square's X, and "L" to Y inverted (top = light, bottom = dark),
 *  matching the common SV-picker convention users already expect. */
function drawSvSquare(canvas: HTMLCanvasElement, hue: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  const imageData = ctx.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    const lightness = 1 - y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      const saturation = x / (width - 1);
      const hex = hslToHex(hue, saturation, lightness);
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      const i = (y * width + x) * 4;
      imageData.data[i] = r;
      imageData.data[i + 1] = g;
      imageData.data[i + 2] = b;
      imageData.data[i + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

export function ColorPickerPanel({ label, hue, saturation, lightness, onChange, onCommit, onClose, style }: ColorPickerPanelProps) {
  const svCanvasRef = useRef<HTMLCanvasElement>(null);
  const [hexInput, setHexInput] = useState(() => hslToHex(hue, saturation, lightness));
  const lastDrawnHueRef = useRef<number | null>(null);

  // Redraw the SV square only when hue actually changed (not on every
  // saturation/lightness drag) — the grid's colors depend on hue alone.
  // Runs in the render body (not an effect) so the very first paint — where
  // the canvas ref attaches during this same commit — already has pixels
  // instead of waiting a whole extra effect-cycle for a blank canvas.
  if (svCanvasRef.current && lastDrawnHueRef.current !== hue) {
    drawSvSquare(svCanvasRef.current, hue);
    lastDrawnHueRef.current = hue;
  }

  const handleSvPointer = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = svCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
      onChange({ saturation: x, lightness: 1 - y });
    },
    [onChange]
  );

  const handleHuePointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      onChange({ hue: x * 360 });
    },
    [onChange]
  );

  const commitHexInput = useCallback(() => {
    const match = /^#?[0-9a-fA-F]{6}$/.test(hexInput);
    if (!match) {
      setHexInput(hslToHex(hue, saturation, lightness)); // revert invalid input
      return;
    }
    const parsed = hexToHsl(hexInput);
    onChange(parsed);
    onCommit();
  }, [hexInput, hue, saturation, lightness, onChange, onCommit]);

  const currentHex = hslToHex(hue, saturation, lightness);

  return (
    <div className="color-picker-panel" style={style} role="dialog" aria-label={`Sélecteur de couleur — ${label}`}>
      <div className="color-picker-panel__header">
        <span className="color-picker-panel__title">{label}</span>
        <IconButton label="Fermer le sélecteur de couleur" size="compact" onClick={onClose}>
          <X className="icon-sm icon-stroke" aria-hidden />
        </IconButton>
      </div>
      <canvas
        ref={svCanvasRef}
        width={SV_SIZE}
        height={SV_SIZE}
        className="color-picker-panel__sv"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          handleSvPointer(e);
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && handleSvPointer(e)}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          onCommit();
        }}
      />
      <div
        className="color-picker-panel__hue-band"
        style={{ height: HUE_BAND_HEIGHT }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          handleHuePointer(e);
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && handleHuePointer(e)}
        onPointerUp={(e) => {
          e.currentTarget.releasePointerCapture(e.pointerId);
          onCommit();
        }}
      >
        <div className="color-picker-panel__hue-thumb" style={{ left: `${(hue / 360) * 100}%` }} />
      </div>
      <label className="color-picker-panel__hex">
        <span>Hex</span>
        <input
          type="text"
          value={hexInput}
          onChange={(e) => setHexInput(e.target.value)}
          onBlur={commitHexInput}
          onKeyDown={(e) => e.key === "Enter" && commitHexInput()}
          placeholder={currentHex}
        />
      </label>
    </div>
  );
}
