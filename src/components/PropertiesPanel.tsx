import type { ReactNode } from "react";
import type { LayerState } from "../layers/types";
import { getEffect } from "../render/effects/registry";
import type { PropertiesTarget } from "../ui/propertiesTarget";
import "./PropertiesPanel.css";

interface Props {
  target: PropertiesTarget | null;
  layer: LayerState | null;
  onTargetChange: (target: PropertiesTarget) => void;
  photoContent: ReactNode;
  effectContent: ReactNode;
  maskContent: ReactNode;
  controlsContent?: ReactNode;
}

export function propertiesPanelTitle(
  target: PropertiesTarget | null,
  layer: LayerState | null,
): string {
  if (!target || !layer || target.layerId !== layer.id) return "Propriétés";
  const name = layer.name ?? getEffect(layer.effectId).name;
  return `Propriétés · ${name}${target.kind === "mask" ? " · Masque" : ""}`;
}

/** Inspecteur unique : route les trois contenus existants sans absorber leur
 * logique. Les onglets choisissent une FACETTE du même calque ; ils ne changent
 * jamais `selectedId`, la pile ou le document. */
export function PropertiesPanel({
  target,
  layer,
  onTargetChange,
  photoContent,
  effectContent,
  maskContent,
  controlsContent,
}: Props) {
  if (!target || !layer || target.layerId !== layer.id) {
    return <p className="properties-panel__empty">Sélectionne un élément dans la pile.</p>;
  }

  const isPhoto = layer.imageSource !== undefined;
  const primaryKind = isPhoto ? "photo" : "effect";
  const primaryLabel = isPhoto ? "Photo" : "Effet";
  const maskCount = layer.mask.sources.length;
  const activeKind = target.kind === "mask" ? "mask" : primaryKind;

  return (
    <div className="properties-panel">
      <div className="properties-panel__tabs" role="tablist" aria-label="Cible des propriétés">
        <button
          type="button"
          role="tab"
          aria-selected={activeKind === primaryKind}
          className={`properties-panel__tab${activeKind === primaryKind ? " properties-panel__tab--active" : ""}`}
          onClick={() => onTargetChange({ kind: primaryKind, layerId: layer.id })}
        >
          {primaryLabel}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeKind === "mask"}
          className={`properties-panel__tab${activeKind === "mask" ? " properties-panel__tab--active" : ""}`}
          onClick={() => onTargetChange({ kind: "mask", layerId: layer.id })}
        >
          Masque{maskCount > 0 ? ` · ${maskCount}` : ""}
        </button>
      </div>
      <div className="properties-panel__content" role="tabpanel">
        {activeKind !== "mask" && controlsContent}
        {activeKind === "mask" ? maskContent : isPhoto ? photoContent : effectContent}
      </div>
    </div>
  );
}
