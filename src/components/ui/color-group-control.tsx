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
  /** Rend les trois curseurs ET la pastille INERTES, sans rien masquer : le
   *  repli continue de s'ouvrir et l'hexadécimal reste lu. La pastille en fait
   *  partie parce qu'elle n'est pas décorative — c'est le point d'entrée du
   *  sélecteur de couleur, qui écrit les mêmes paramètres que les curseurs. */
  disabled?: boolean;
  onChange: (paramName: string, value: number) => void;
  onCommit: () => void;
  /** Reçoit la position verticale (viewport) de la pastille : le picker
   *  s'aligne dessus plutôt que sur le haut de l'espace de travail. */
  onOpenPicker?: (anchorTop: number) => void;
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
  disabled = false,
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
        className="flex h-[var(--section-header-height)] w-full items-center gap-1.5 rounded-[var(--radius-control)] px-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-[var(--focus-width)] focus-visible:outline-[var(--focus-color)] focus-visible:outline-offset-[var(--focus-offset)]"
      >
        <button
          type="button"
          // La pastille est le SEUL point d'entrée du sélecteur de couleur :
          // sans curseur ni réaction au survol, rien n'indiquait qu'elle
          // ouvrait un panneau (retour checkpoint 2026-07-25).
          className="h-5 w-5 shrink-0 cursor-pointer rounded-[var(--radius-control)] border border-border transition-shadow hover:ring-2 hover:ring-[var(--border-selection)] focus-visible:outline-[var(--focus-width)] focus-visible:outline-[var(--focus-color)] focus-visible:outline-offset-[var(--focus-offset)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:ring-0"
          style={{ background: hex }}
          disabled={disabled}
          aria-label={`Ouvrir le sélecteur de couleur pour ${label}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onOpenPicker?.(e.currentTarget.getBoundingClientRect().top);
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
          disabled={disabled}
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
          disabled={disabled}
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
          disabled={disabled}
          onChange={(v) => onChange(lightnessParam.name, v)}
          onCommit={onCommit}
        />
      </CollapsiblePrimitive.Panel>
    </CollapsiblePrimitive.Root>
  );
}
