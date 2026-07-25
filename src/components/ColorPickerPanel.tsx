import { useCallback, useLayoutEffect, useRef, useState } from "react";
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
  /** Haut du déclencheur (la pastille), relatif au conteneur positionné —
   *  le panneau s'aligne dessus, en restant dans les bornes de ce conteneur. */
  anchorTop: number;
  /** Ancrage HORIZONTAL seulement (`right`) : le vertical vient de `anchorTop`. */
  style?: React.CSSProperties;
}

/** Doit rester égal au token `--color-picker-sv-size` (components.css) : un
 *  <canvas> exige ses dimensions en attributs numériques, pas en CSS. */
const SV_SIZE = 140;

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

export function ColorPickerPanel({ label, hue, saturation, lightness, onChange, onCommit, onClose, anchorTop, style }: ColorPickerPanelProps) {
  const svCanvasRef = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // `anchorTop` aligne le panneau sur sa pastille, mais une pastille en bas de
  // l'inspecteur ferait déborder le panneau hors de l'espace de travail (il
  // est en overflow: hidden — il serait rogné, pas scrollable). Le clamp se
  // fait ICI et pas chez l'appelant : seul le panneau connaît sa propre
  // hauteur, qui dépend de son contenu.
  const [top, setTop] = useState(anchorTop);
  useLayoutEffect(() => {
    const el = panelRef.current;
    const container = el?.offsetParent as HTMLElement | null;
    if (!el || !container) return;
    const gutter = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--space-6")) || 0;
    const maxTop = container.clientHeight - el.offsetHeight - gutter;
    setTop(Math.max(gutter, Math.min(anchorTop, maxTop)));
  }, [anchorTop]);
  // Only the user's in-progress typed draft lives in state — the field
  // otherwise mirrors the live hue/saturation/lightness props (so a SV/hue
  // drag keeps the hex text in sync instead of showing the color from when
  // the picker opened). Cleared on successful commit AND on blur/Enter even
  // when invalid, so a bad entry reverts to showing the live color again
  // rather than leaving a stuck bad string.
  const [draft, setDraft] = useState<string | null>(null);
  const lastDrawnHueRef = useRef<number | null>(null);

  // Redraw the SV square only when hue actually changed (not on every
  // saturation/lightness drag) — the grid's colors depend on hue alone.
  // useLayoutEffect (not the render body) because on the FIRST render
  // svCanvasRef.current is still null — refs attach during commit, which
  // happens after the render body runs — so a render-body guard would draw
  // nothing on initial mount and leave the canvas blank until some unrelated
  // re-render happened to fire. useLayoutEffect runs after the ref is
  // attached (including on mount) and, like the render-body version, only
  // reruns when `hue` itself changes — so a saturation/lightness drag still
  // doesn't trigger a redraw. Layout (not passive) effect avoids a visible
  // blank-canvas flash before the first paint.
  useLayoutEffect(() => {
    const canvas = svCanvasRef.current;
    if (!canvas || lastDrawnHueRef.current === hue) return;
    drawSvSquare(canvas, hue);
    lastDrawnHueRef.current = hue;
  }, [hue]);

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
    if (draft === null) return;
    const match = /^#?[0-9a-fA-F]{6}$/.test(draft);
    if (!match) {
      setDraft(null); // revert invalid input — falls back to showing the live color again
      return;
    }
    const parsed = hexToHsl(draft);
    onChange(parsed);
    onCommit();
    setDraft(null);
  }, [draft, onChange, onCommit]);

  const currentHex = hslToHex(hue, saturation, lightness);

  return (
    <div ref={panelRef} className="color-picker-panel" style={{ ...style, top }} role="dialog" aria-label={`Sélecteur de couleur — ${label}`}>
      <div className="color-picker-panel__header">
        <span className="color-picker-panel__title">{label}</span>
        <IconButton label="Fermer le sélecteur de couleur" size="compact" onClick={onClose}>
          <X className="icon-sm icon-stroke" aria-hidden />
        </IconButton>
      </div>
      <div className="color-picker-panel__body">
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
            value={draft ?? currentHex}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitHexInput}
            onKeyDown={(e) => e.key === "Enter" && commitHexInput()}
            placeholder={currentHex}
          />
        </label>
      </div>
    </div>
  );
}
