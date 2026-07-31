import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

import { Slider as SliderPrimitive } from "./slider";
import { cn } from "../../lib/utils";
import { formatControlValue, parseControlValue } from "../../ui/formatValue";
import {
  registerControl,
  unregisterControl,
  markControlActive,
  wheelTickValue,
  shouldWheelAdjust,
} from "../../ui/activeControl";

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
  const labelId = `${id}-label`;
  const shownValue = displayValue ?? formatControlValue(value, step);
  const [draftValue, setDraftValue] = useState(shownValue);
  const [isEditing, setIsEditing] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronisation d'un BROUILLON local sur la valeur externe, uniquement hors edition : la retirer ferait ecraser la frappe en cours, et un `key` de reset perdrait le focus du champ.
    if (!isEditing) setDraftValue(shownValue);
  }, [isEditing, shownValue]);

  // Registre du "dernier contrôle modifié" (Ctrl+molette global, voir
  // activeControl.ts) — réécrit après CHAQUE rendu (effet de bord hors
  // render), donc toujours frais.
  useEffect(() => {
    registerControl(id, { value, min, max, step, onChange, onCommit });
  }, [id, value, min, max, step, onChange, onCommit]);
  useEffect(() => () => {
    unregisterControl(id);
    window.clearTimeout(wheelCommitTimer.current);
  }, [id]);

  // Molette SUR UN CONTRÔLE FOCALISÉ (clic ou tabulation) = ajuste directement
  // (1% de la plage par cran) ; sans focus, l'évènement est laissé au
  // défilement du panneau. Le commit (historique) est différé : une seule
  // entrée après la dernière molette, pas une par cran (même logique "une
  // entrée par interaction" que le drag/clavier, couverts nativement par
  // onValueCommitted).
  //
  // Écouteur DOM natif (pas `onWheel` React) : React 19 enregistre `wheel` en
  // PASSIF sur la racine, donc un `preventDefault()` depuis un handler React
  // est un no-op et le panneau défilerait EN PLUS de l'ajustement de valeur.
  // `{ passive: false }` est la seule façon d'annuler réellement le
  // défilement.
  const rowRef = useRef<HTMLDivElement | null>(null);
  const wheelCommitTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const row = rowRef.current;
    if (!row) return;
    const handleWheel = (event: WheelEvent) => {
      // Focus sur le THUMB, pas n'importe où dans la ligne : le champ de
      // saisie de la valeur est lui aussi dans la ligne, et pendant une
      // édition il gèle son brouillon. Une molette acceptée là ferait
      // avancer `value`, puis le blur reparserait le brouillon gelé et
      // restaurerait l'ancienne valeur — en posant une entrée d'historique.
      // La saisie texte reste donc maîtresse de son propre champ.
      const thumb = row.querySelector('[data-slot="slider-thumb"]');
      const active = document.activeElement;
      const hasFocusWithin = thumb !== null && active !== null && thumb.contains(active);
      if (!shouldWheelAdjust({ disabled, hasFocusWithin, ctrlKey: event.ctrlKey })) return;
      event.preventDefault();
      onChange(wheelTickValue({ value, min, max }, event.deltaY));
      markControlActive(id);
      if (onCommit) {
        window.clearTimeout(wheelCommitTimer.current);
        wheelCommitTimer.current = window.setTimeout(onCommit, 400);
      }
    };
    row.addEventListener("wheel", handleWheel, { passive: false });
    return () => row.removeEventListener("wheel", handleWheel);
  }, [id, disabled, value, min, max, onChange, onCommit]);

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
    // Commit via the input's `onBlur` handler only. Calling
    // commitTypedValue() here as well would double-fire onChange/onCommit:
    // the controlled `value` prop is not updated synchronously between the
    // explicit commit and the blur-triggered re-commit, so the
    // `nextValue !== value` guard cannot dedupe them.
    event.currentTarget.blur();
  }

  return (
    <div ref={rowRef} className={cn("flex flex-col gap-1", disabled && "opacity-50", className)}>
      <label id={labelId} htmlFor={id} className="text-sm text-muted-foreground">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <SliderPrimitive
          id={id}
          aria-labelledby={labelId}
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
          className="h-[var(--control-height-md)] w-[var(--slider-value-width)] rounded-[var(--radius-control)] border border-border bg-[var(--surface-inset)] px-2 text-center font-mono text-sm tabular-nums text-foreground outline-none transition-colors hover:border-[var(--border-emphasis)] focus-visible:border-[var(--focus-color)] focus-visible:ring-[var(--focus-width)] focus-visible:ring-[var(--focus-color)]/50 disabled:cursor-not-allowed"
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
