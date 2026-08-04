import { useEffect, useRef, useState } from "react";
import { Pipette } from "lucide-react";
import { hslToHex } from "../ui/hsl";
import { moveColorRampHandle, nudgeColorRampHandle, type ColorRampHandleRole, type ColorRampPositions } from "../ui/colorRamp";
import { NumberField } from "./ui/number-field";
import "./ColorRampControl.css";

export interface ColorRampStopValue {
  id: string;
  label: string;
  hue: number;
  saturation: number;
  lightness: number;
  position: number;
  movable: boolean;
}

interface Props {
  label: string;
  stops: [ColorRampStopValue, ColorRampStopValue, ColorRampStopValue];
  positions: ColorRampPositions;
  disabled?: boolean;
  onChange: (positions: ColorRampPositions) => void;
  onCommit: () => void;
  onOpenStop: (stopId: string, anchorTop: number) => void;
}

const HANDLE_LABELS: Record<ColorRampHandleRole, string> = {
  midPosition: "Position de l'arrêt moyen",
  blackPoint: "Point noir",
  whitePoint: "Point blanc",
};

export function ColorRampControl({ label, stops, positions, disabled = false, onChange, onCommit, onOpenStop }: Props) {
  const [activeStopId, setActiveStopId] = useState(stops[1].id);
  const [preview, setPreview] = useState(positions);
  const previewRef = useRef(preview);
  const startRef = useRef<ColorRampPositions | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingRef = useRef<ColorRampPositions | null>(null);
  const suppressStopClickRef = useRef(false);

  useEffect(() => {
    if (startRef.current === null) { setPreview(positions); previewRef.current = positions; }
  }, [positions]);

  useEffect(() => () => { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); }, []);

  const publish = (next: ColorRampPositions) => {
    setPreview(next); previewRef.current = next; pendingRef.current = next;
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      if (pendingRef.current) onChange(pendingRef.current);
      pendingRef.current = null;
    });
  };

  const flush = () => {
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    if (pendingRef.current) onChange(pendingRef.current);
    pendingRef.current = null;
  };

  const handlePointerDown = (role: ColorRampHandleRole, event: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const track = event.currentTarget.parentElement;
    if (!track) return;
    startRef.current = previewRef.current;
    event.currentTarget.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    let moved = false;
    const move = (clientX: number) => {
      const rect = track.getBoundingClientRect();
      const handleSize = parseFloat(getComputedStyle(track).getPropertyValue("--control-height-sm")) || 0;
      const usableWidth = Math.max(1, rect.width - handleSize);
      publish(moveColorRampHandle(previewRef.current, role, (clientX - rect.left - handleSize / 2) / usableWidth));
    };
    const onMove = (moveEvent: PointerEvent) => {
      if (!moved && Math.abs(moveEvent.clientX - startX) < 2) return;
      moved = true;
      move(moveEvent.clientX);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      startRef.current = null;
    };
    const onUp = () => { if (moved) { if (role === "midPosition") suppressStopClickRef.current = true; flush(); onCommit(); } cleanup(); };
    const onCancel = () => {
      const start = startRef.current;
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null; pendingRef.current = null;
      if (start && moved) { setPreview(start); previewRef.current = start; onChange(start); }
      cleanup();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onCancel, { once: true });
  };

  const handleKeyDown = (role: ColorRampHandleRole, event: React.KeyboardEvent<HTMLButtonElement>) => {
    const direction = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1
      : event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : null;
    if (disabled || direction === null) return;
    event.preventDefault();
    const next = nudgeColorRampHandle(previewRef.current, role, direction, event.shiftKey);
    publish(next); flush(); onCommit();
  };

  const visualStops = [
    { ...stops[0], position: 0 },
    { ...stops[1], position: preview.midPosition },
    { ...stops[2], position: 1 },
  ] as const;
  const activeStop = visualStops.find((stop) => stop.id === activeStopId) ?? visualStops[1];
  const gradient = `linear-gradient(90deg, ${visualStops.map((stop) => `${hslToHex(stop.hue, stop.saturation, stop.lightness)} ${stop.position * 100}%`).join(", ")})`;

  const openActiveStop = (element: HTMLElement) => {
    onOpenStop(activeStop.id, element.getBoundingClientRect().top);
  };

  return (
    <section className="color-ramp" aria-label={label} data-disabled={disabled || undefined}>
      <div className="color-ramp__editor">
        <div className="color-ramp__track" style={{ backgroundImage: gradient }}>
          {(["blackPoint", "whitePoint"] as const).map((role) => (
            <button key={role} type="button" className="color-ramp__range-handle"
              style={{ left: `calc(${preview[role]} * (100% - var(--control-height-sm)) + var(--control-height-sm) / 2)` }} aria-label={`${HANDLE_LABELS[role]} — ${Math.round(preview[role] * 100)} %`}
              disabled={disabled} onPointerDown={(event) => handlePointerDown(role, event)} onKeyDown={(event) => handleKeyDown(role, event)} />
          ))}
        {visualStops.map((stop) => (
          <button key={stop.id} type="button" className="color-ramp__stop"
            style={{ left: `calc(${stop.position} * (100% - var(--control-height-sm)) + var(--control-height-sm) / 2)`, "--ramp-stop-color": hslToHex(stop.hue, stop.saturation, stop.lightness) } as React.CSSProperties}
            aria-label={`${stop.label} — position ${Math.round(stop.position * 100)} %`} aria-pressed={stop.id === activeStop.id} disabled={disabled}
            onClick={() => {
              if (suppressStopClickRef.current) { suppressStopClickRef.current = false; return; }
              setActiveStopId(stop.id);
            }}
            onPointerDown={stop.movable ? (event) => handlePointerDown("midPosition", event) : undefined}
            onKeyDown={stop.movable ? (event) => handleKeyDown("midPosition", event) : undefined} />
        ))}
        </div>
        <output className="color-ramp__range-values" aria-live="polite">
          <span>{Math.round(preview.blackPoint * 100)}</span>
          <span>{Math.round(preview.whitePoint * 100)}</span>
        </output>
      </div>
      <div className="color-ramp__active-stop">
        <button type="button" className="color-ramp__active-swatch"
          style={{ "--ramp-stop-color": hslToHex(activeStop.hue, activeStop.saturation, activeStop.lightness) } as React.CSSProperties}
          aria-label={`Choisir la couleur — ${activeStop.label}`} disabled={disabled} onClick={(event) => openActiveStop(event.currentTarget)} />
        <strong className="color-ramp__active-label">{activeStop.label}</strong>
        <NumberField label="Position" value={Math.round(activeStop.position * 100)} unit="%" min={5} max={95} step={1}
          disabled={disabled || !activeStop.movable} labelPlacement="inline"
          classNames={{ root: "color-ramp__position", label: "color-ramp__position-label", field: "color-ramp__position-field", input: "color-ramp__position-input", unit: "color-ramp__position-unit" }}
          onCommit={(value) => {
            publish({ ...previewRef.current, midPosition: value / 100 });
            flush();
            onCommit();
          }} />
        <button type="button" className="color-ramp__picker-button" aria-label={`Ouvrir le sélecteur — ${activeStop.label}`}
          disabled={disabled} onClick={(event) => openActiveStop(event.currentTarget)}>
          <Pipette className="icon-sm icon-stroke" aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
