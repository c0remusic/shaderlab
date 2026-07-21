import { useId, useEffect, useRef } from "react";
import { formatControlValue } from "./formatValue";
import { registerControl, unregisterControl, markControlActive, wheelTickValue } from "./activeControl";

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  displayValue?: string;
  title?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
  /**
   * Fin d'interaction discrète : pointer-up (fin de drag) ou relâchement
   * d'une touche de navigation clavier (flèches/Home/End/PageUp/PageDown).
   * Optionnel — un slider sans conséquence sur l'historique (ex. taille de
   * pinceau) peut l'omettre.
   */
  onCommit?: () => void;
}

const COMMIT_KEYS = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/**
 * Calibrated single-value slider. Uses a native <input type="range"> so
 * keyboard steps, Home/End and screen-reader value announcements are free —
 * only the visual track/thumb are restyled via tokens.
 */
export function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  displayValue,
  title,
  disabled = false,
  onChange,
  onCommit,
}: SliderProps) {
  const id = useId();
  const shownValue = displayValue ?? formatControlValue(value, step);

  // Registre du "dernier contrôle modifié" (Ctrl+molette global, voir
  // activeControl.ts) — réécrit à chaque rendu, toujours frais.
  registerControl(id, { value, min, max, step, onChange, onCommit });
  useEffect(() => () => unregisterControl(id), [id]);

  // Molette survolée = ajuste directement (1% de la plage par cran). Le
  // commit (historique) est différé : une seule entrée après la dernière
  // molette, pas une par cran (même logique "une entrée par interaction"
  // que le drag).
  const wheelCommitTimer = useRef<number | undefined>(undefined);
  function handleWheel(event: React.WheelEvent<HTMLInputElement>) {
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
    <div className={`ui-slider ${disabled ? "ui-slider--disabled" : ""}`.trim()}>
      <div className="ui-slider__row">
        <label htmlFor={id} className="ui-slider__label">
          {label}
        </label>
        <span className="ui-slider__value">{shownValue}</span>
      </div>
      <input
        id={id}
        type="range"
        className="ui-slider__input"
        title={title}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        // draggable={false} : confirmé par sonde CDP (geste réel, pas
        // synthétique) que ce <input type="range"> déclenche un dragstart/
        // dragend HTML5 natif au click-drag, indépendamment de tout ancêtre
        // draggable — comportement par défaut du moteur sur un input stylé,
        // présent sur TOUS les sliders de l'app (opacité ET params d'effet),
        // pas seulement celui qui semblait saccadé. Le désactive pour tous.
        draggable={false}
        onChange={(event) => {
          onChange(event.target.valueAsNumber);
          markControlActive(id);
        }}
        onPointerUp={onCommit}
        onKeyUp={(event) => {
          if (onCommit && COMMIT_KEYS.has(event.key)) onCommit();
        }}
        onWheel={handleWheel}
      />
    </div>
  );
}
