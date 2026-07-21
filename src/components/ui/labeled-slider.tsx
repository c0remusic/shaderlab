import { useEffect, useId, useRef, useState, type KeyboardEvent, type WheelEvent as ReactWheelEvent } from "react";

import { Slider as SliderPrimitive } from "./slider";
import { cn } from "../../lib/utils";
import { formatControlValue, parseControlValue } from "../../ui/formatValue";
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
  const [draftValue, setDraftValue] = useState(shownValue);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    if (!isEditing) setDraftValue(shownValue);
  }, [isEditing, shownValue]);

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

  function commitTypedValue() {
    const nextValue = parseControlValue(draftValue, min, max, step);
    setIsEditing(false);

    if (nextValue === null) {
      setDraftValue(shownValue);
      return;
    }

    if (nextValue !== value) onChange(nextValue);
    onCommit?.();
  }

  function handleValueKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    commitTypedValue();
    event.currentTarget.blur();
  }

  return (
    <div className={cn("flex flex-col gap-1", disabled && "opacity-50", className)} onWheel={handleWheel}>
      <label htmlFor={id} className="text-sm text-muted-foreground">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <SliderPrimitive
          id={id}
          className="min-w-0 flex-1"
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
        <input
          aria-label={`${label} (valeur)`}
          className="h-[var(--control-height-md)] w-[var(--slider-value-width)] rounded-[var(--radius-control)] border border-border bg-[var(--surface-inset)] px-2 text-right font-mono text-sm tabular-nums text-foreground outline-none transition-colors hover:border-[var(--border-emphasis)] focus-visible:border-[var(--focus-color)] focus-visible:ring-[var(--focus-width)] focus-visible:ring-[var(--focus-color)]/50 disabled:cursor-not-allowed"
          disabled={disabled}
          inputMode="decimal"
          type="text"
          value={draftValue}
          onChange={(event) => setDraftValue(event.target.value)}
          onFocus={(event) => {
            setIsEditing(true);
            event.currentTarget.select();
          }}
          onBlur={commitTypedValue}
          onKeyDown={handleValueKeyDown}
        />
      </div>
    </div>
  );
}
