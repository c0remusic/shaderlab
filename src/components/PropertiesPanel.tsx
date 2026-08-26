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
  /** SÉLECTEUR D'EFFET, rendu en TÊTE du contenu (2026-08-21). Ce slot portait
   *  la zone de contrôles entière — fusion, opacité, verrous compris — jusqu'à
   *  ce qu'Antoine relève que ces trois-là décrivent le CALQUE et n'ont rien à
   *  faire ici : ils sont redescendus dans la carte Pile. Ne reste que ce qui
   *  décrit l'EFFET, au-dessus de ses réglages. */
  effectSelector?: ReactNode;
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
  effectSelector,
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
        {activeKind !== "mask" && effectSelector}
        {activeKind === "mask" ? maskContent : isPhoto ? photoContent : effectContent}
      </div>
    </div>
  );
}
