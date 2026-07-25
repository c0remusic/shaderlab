import { Collapsible as CollapsiblePrimitive } from "@base-ui/react/collapsible";
import { ChevronRight } from "lucide-react";

import type { EffectParam } from "../../render/effects/types";
import { hslToHex } from "../../ui/hsl";
import { LabeledSlider } from "./labeled-slider";

export interface ColorGroupControlProps {
  label: string;
  hueParam: EffectParam;
  saturationParam: EffectParam;
  lightnessParam: EffectParam;
  hue: number;
  saturation: number;
  lightness: number;
  defaultOpen?: boolean;
  onChange: (paramName: string, value: number) => void;
  onCommit: () => void;
  onOpenPicker?: () => void;
}

/**
 * Swatch + disclosure control for a hue/saturation/lightness param trio
 * (see EffectParam.colorGroup) — same Collapsible primitive and header
 * treatment as ./collapsible, but with a color preview in the trigger
 * instead of a plain title, since a bare title can't show the resulting
 * color. The panel keeps the ordinary LabeledSlider controls so fine
 * adjustment (wheel, keyboard, typed value) works exactly like every other
 * effect param.
 */
export function ColorGroupControl({
  label,
  hueParam,
  saturationParam,
  lightnessParam,
  hue,
  saturation,
  lightness,
  defaultOpen = false,
  onChange,
  onCommit,
  onOpenPicker,
}: ColorGroupControlProps) {
  const hex = hslToHex(hue, saturation, lightness);

  return (
    <CollapsiblePrimitive.Root defaultOpen={defaultOpen}>
      <CollapsiblePrimitive.Trigger
        render={<div role="button" tabIndex={0} />}
        nativeButton={false}
        className="flex h-[var(--section-header-height)] w-full items-center gap-2 rounded-[var(--radius-control)] px-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-[var(--focus-width)] focus-visible:outline-[var(--focus-color)] focus-visible:outline-offset-[var(--focus-offset)]"
      >
        <button
          type="button"
          className="h-5 w-5 shrink-0 rounded-[var(--radius-control)] border border-border focus-visible:outline-[var(--focus-width)] focus-visible:outline-[var(--focus-color)] focus-visible:outline-offset-[var(--focus-offset)]"
          style={{ background: hex }}
          aria-label={`Ouvrir le sélecteur de couleur pour ${label}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpenPicker?.();
          }}
        />
        <span className="flex-1 truncate text-sm text-foreground">{label}</span>
        <span className="shrink-0 font-mono text-xs text-muted-foreground">{hex}</span>
        <ChevronRight className="icon-sm icon-stroke shrink-0 text-muted-foreground transition-transform data-panel-open:rotate-90" aria-hidden="true" />
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Panel className="flex flex-col gap-3 px-1.5 py-2">
        <LabeledSlider
          label="Teinte"
          value={hue}
          min={hueParam.min}
          max={hueParam.max}
          step={hueParam.step}
          displayValue={`${Math.round(hue)}°`}
          onChange={(v) => onChange(hueParam.name, v)}
          onCommit={onCommit}
        />
        <LabeledSlider
          label="Saturation"
          value={saturation}
          min={saturationParam.min}
          max={saturationParam.max}
          step={saturationParam.step}
          displayValue={`${Math.round(saturation * 100)} %`}
          onChange={(v) => onChange(saturationParam.name, v)}
          onCommit={onCommit}
        />
        <LabeledSlider
          label="Luminosité"
          value={lightness}
          min={lightnessParam.min}
          max={lightnessParam.max}
          step={lightnessParam.step}
          displayValue={`${Math.round(lightness * 100)} %`}
          onChange={(v) => onChange(lightnessParam.name, v)}
          onCommit={onCommit}
        />
      </CollapsiblePrimitive.Panel>
    </CollapsiblePrimitive.Root>
  );
}
