import { useId } from "react";
import { formatControlValue } from "./formatValue";

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  displayValue?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}

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
  disabled = false,
  onChange,
}: SliderProps) {
  const id = useId();
  const shownValue = displayValue ?? formatControlValue(value, step);

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
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.valueAsNumber)}
      />
    </div>
  );
}
