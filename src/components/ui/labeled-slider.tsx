import { useEffect, useId, useRef, type WheelEvent as ReactWheelEvent } from "react";

import { Slider as SliderPrimitive } from "./slider";
import { cn } from "../../lib/utils";
import { formatControlValue } from "../../ui/formatValue";
import { registerControl, unregisterControl, markControlActive, wheelTickValue } from "../../ui/activeControl";

export interface LabeledSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  displayValue?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
  /**
   * Fin d'interaction discrète : relâchement de drag, clic sur la piste, ou
   * commit clavier (flèches/Home/End/PageUp/PageDown) — couvert nativement
   * par `onValueCommitted` de Base UI. Optionnel — un slider sans
   * conséquence sur l'historique (ex. taille de pinceau) peut l'omettre.
   */
  onCommit?: () => void;
  className?: string;
}

/**
 * Labeled, calibrated single-value slider on top of the shared Base UI
 * primitive (`./slider`). Preserves the pre-migration legacy slider's
 * contract (single numeric value, `onChange`/`onCommit`, wheel-to-adjust,
 * global Ctrl+wheel via `activeControl`) so every existing caller keeps its
 * callback names and commit timing unchanged.
 */
export function LabeledSlider({
  label,
  value,
  min,
  max,
  step = 1,
  displayValue,
  disabled = false,
  onChange,
  onCommit,
  className,
}: LabeledSliderProps) {
  const id = useId();
  const shownValue = displayValue ?? formatControlValue(value, step);

  // Registre du "dernier contrôle modifié" (Ctrl+molette global, voir
  // activeControl.ts) — réécrit à chaque rendu, toujours frais.
  registerControl(id, { value, min, max, step, onChange, onCommit });
  useEffect(() => () => {
    unregisterControl(id);
    window.clearTimeout(wheelCommitTimer.current);
  }, [id]);

  // Molette survolée = ajuste directement (1% de la plage par cran). Le
  // commit (historique) est différé : une seule entrée après la dernière
  // molette, pas une par cran (même logique "une entrée par interaction"
  // que le drag/clavier, couverts nativement par onValueCommitted).
  const wheelCommitTimer = useRef<number | undefined>(undefined);
  function handleWheel(event: ReactWheelEvent<HTMLDivElement>) {
    if (disabled) return;
    event.preventDefault();
    onChange(wheelTickValue({ value, min, max }, event.deltaY));
    markControlActive(id);
    if (onCommit) {
      window.clearTimeout(wheelCommitTimer.current);
      wheelCommitTimer.current = window.setTimeout(onCommit, 400);
    }
  }

  return (
    <div className={cn("flex flex-col gap-1", disabled && "opacity-50", className)} onWheel={handleWheel}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm text-muted-foreground">
          {label}
        </label>
        <span className="font-mono text-sm text-foreground tabular-nums">{shownValue}</span>
      </div>
      <SliderPrimitive
        id={id}
        value={[value]}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(next) => {
          onChange(Array.isArray(next) ? next[0] : next);
          markControlActive(id);
        }}
        onValueCommitted={() => onCommit?.()}
      />
    </div>
  );
}
