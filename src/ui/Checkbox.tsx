import { useId } from "react";
import { Check } from "lucide-react";

export interface CheckboxProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

/**
 * Native checkbox input visually restyled. The input stays in the DOM
 * (opacity 0, full hit area) so Space toggle, focus-visible and the full
 * label-as-target behavior are native, not reimplemented.
 */
export function Checkbox({ label, checked, disabled = false, onChange }: CheckboxProps) {
  const id = useId();

  return (
    <label htmlFor={id} className={`ui-checkbox ${disabled ? "ui-checkbox--disabled" : ""}`.trim()}>
      <span className="ui-checkbox__box-wrap">
        <input
          id={id}
          type="checkbox"
          className="ui-checkbox__input"
          checked={checked}
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span
          className={`ui-checkbox__box ${checked ? "ui-checkbox__box--checked" : ""}`.trim()}
          aria-hidden="true"
        >
          {checked && <Check className="ui-checkbox__check" size={12} strokeWidth={2.5} />}
        </span>
      </span>
      <span className="ui-checkbox__label">{label}</span>
    </label>
  );
}
