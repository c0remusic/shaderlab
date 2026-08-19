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
  /**
   * Valeur PAR DÉFAUT du réglage. Deux mécanismes adoptés au ticket 11
   * (2026-08-18) en dépendent, et aucun des deux n'est décoratif :
   *
   * - **retour au défaut au DOUBLE-CLIC** sur la piste ou sur le libellé. C'est
   *   le geste de Photoshop, de Lightroom et de Blender ; sans lui, revenir en
   *   arrière demande de se souvenir du chiffre.
   * - **marque du défaut sur la piste**, et **uniquement quand la valeur en
   *   diffère**. Enrichissement demandé par Antoine devant la planche : la
   *   montrer en permanence ferait un point de plus à lire sur chaque ligne d'un
   *   panneau qui en compte déjà trop.
   *
   * ⚠️ Omis = les deux mécanismes n'existent pas pour ce curseur, en silence et
   * volontairement : la taille du pinceau ou le zoom n'ont pas de « défaut » au
   * sens d'un paramètre d'effet, et inventer une valeur de repli fabriquerait un
   * geste qui ramène ailleurs qu'on ne croit.
   */
  defaultValue?: number;
  /**
   * Lecture INVERSE d'une saisie texte, quand `displayValue` montre une autre
   * unité que celle du curseur. Rend une valeur DANS LES UNITÉS DU CURSEUR
   * (min..max), déjà bornée, ou `null` si la frappe n'est pas un nombre.
   *
   * D'OÙ ÇA VIENT (voie B, symétrie panneau/toile). Un paramètre spatial montre
   * des pixels (`displayValue = "1234 px"`) mais son curseur reste en FRACTION —
   * c'est ce qui garde le double-clic de retour au défaut, la marque du défaut
   * et le round-trip EXACTS, et laisse `test:render` inchangé. Le champ texte
   * doit alors ACCEPTER des pixels : sans cette closure il passerait par
   * `parseControlValue` avec les bornes de fraction, et « 1500 » serait écrêté à
   * 1. Absente = comportement d'origine (parse sur les bornes du curseur).
   */
  parseDisplayValue?: (raw: string) => number | null;
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
  defaultValue,
  parseDisplayValue,
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
    // Quand le champ montre une autre unité que le curseur (pixels d'un
    // paramètre spatial), sa lecture inverse rend déjà une valeur en unités du
    // curseur, bornée. Sinon, parse standard sur les bornes du curseur.
    const nextValue = parseDisplayValue
      ? parseDisplayValue(draftValue)
      : parseControlValue(draftValue, min, max, step);
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

  /** Retour au défaut, si ce curseur en a un et n'y est pas déjà.
   *  `onCommit` derrière `onChange` : c'est UN geste, donc UNE entrée
   *  d'historique — comme un relâchement de glissement. */
  function revenirAuDefaut() {
    if (disabled || defaultValue === undefined || defaultValue === value) return;
    onChange(defaultValue);
    onCommit?.();
  }

  /** Position du défaut sur la piste, en pourcentage — `undefined` quand il n'y
   *  a rien à montrer : pas de défaut déclaré, valeur déjà au défaut, ou course
   *  dégénérée (min == max, où le pourcentage n'existe pas). */
  const positionDefaut =
    defaultValue !== undefined && defaultValue !== value && max > min
      ? ((Math.min(Math.max(defaultValue, min), max) - min) / (max - min)) * 100
      : undefined;

  return (
    <div ref={rowRef} className={cn("flex flex-col gap-1", disabled && "opacity-50", className)}>
      {/* DOUBLE-CLIC SUR LE LIBELLÉ, et pas seulement sur la piste : c'est la
          cible la plus large et la plus stable de la ligne, et viser un curseur
          de 12 px pour le remettre au défaut serait un geste de précision au
          service d'une remise à zéro. Photoshop accepte les deux. */}
      <label
        id={labelId}
        htmlFor={id}
        className={cn("text-sm text-muted-foreground", positionDefaut !== undefined && "cursor-pointer")}
        onDoubleClick={revenirAuDefaut}
        title={positionDefaut !== undefined ? "Double-cliquer pour revenir au défaut" : undefined}
      >
        {label}
      </label>
      <div className="flex items-center gap-2">
        {/* MARQUE DU DÉFAUT — un filet vertical sur la piste, posé DERRIÈRE le
            curseur et sans capter le pointeur. Elle n'apparaît que lorsque la
            valeur a quitté le défaut : c'est la demande d'Antoine devant la
            planche, et c'est ce qui l'empêche de devenir un point de plus à lire
            sur chaque ligne d'un panneau qui en compte déjà trop. */}
        <span className="relative flex min-w-0 flex-1 items-center">
          {positionDefaut !== undefined && (
            <span
              aria-hidden="true"
              data-marque-defaut=""
              className="pointer-events-none absolute z-0 h-[var(--space-4)] w-px bg-[var(--border-strong)]"
              style={{ left: `${positionDefaut}%` }}
            />
          )}
        <SliderPrimitive
          id={id}
          aria-labelledby={labelId}
          className="relative z-10 min-w-0 flex-1"
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
          onDoubleClick={revenirAuDefaut}
        />
        </span>
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
