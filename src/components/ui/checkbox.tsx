import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Check } from "lucide-react";
import { useId } from "react";

import { cn } from "../../lib/utils";

export interface CheckboxProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  className?: string;
}

export function Checkbox({ label, checked, disabled = false, onChange, className }: CheckboxProps) {
  const id = useId();

  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-1.5 text-sm text-foreground", disabled && "cursor-not-allowed text-[var(--text-disabled)]", className)} htmlFor={id}>
      <CheckboxPrimitive.Root
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
        className="flex size-[var(--checkbox-size)] shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-[var(--border-strong)] bg-transparent text-[var(--text-on-light)] transition-colors hover:bg-muted hover:border-[var(--border-emphasis)] focus-visible:outline-[var(--focus-width)] focus-visible:outline-[var(--focus-color)] focus-visible:outline-offset-[var(--focus-offset)] data-checked:bg-primary data-checked:border-primary data-disabled:border-[var(--border-subtle)] data-disabled:bg-transparent data-disabled:text-[var(--text-disabled)]"
      >
        <CheckboxPrimitive.Indicator className="flex items-center justify-center">
          <Check className="icon-sm icon-stroke" aria-hidden="true" />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
      <span>{label}</span>
    </label>
  );
}
