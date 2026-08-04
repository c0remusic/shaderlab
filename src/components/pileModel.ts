import type { LayerState } from "../layers/types";
import {
  layerTarget,
  type PropertiesTarget,
} from "../ui/propertiesTarget";
import { toLayerTreeRows, type LayerTreeRow } from "./layerTree";

export interface PileMaskSummary {
  /** Un masque existe visuellement dès qu'il porte une source, même désactivée.
   * Lire le raster pour décider ici ferait parcourir jusqu'à 24 Mpx pendant un
   * rendu React — strictement interdit. */
  present: boolean;
  sourceCount: number;
  enabledSourceCount: number;
  enabled: boolean;
  invert: boolean;
}

export interface PileRow extends LayerTreeRow {
  primaryTarget: PropertiesTarget;
  mask: PileMaskSummary;
  selectedFacet: "primary" | "mask" | null;
}

/** Projection pure de la pile destinée à l'UI. Elle enrichit `layerTree` sans
 * changer son ordre, ses parents ni ses bornes de drag. */
export function toPileRows(
  layers: LayerState[],
  target: PropertiesTarget | null,
): PileRow[] {
  return toLayerTreeRows(layers).map((row) => {
    const ownsTarget = target?.layerId === row.layer.id;
    const sources = row.layer.mask.sources;
    return {
      ...row,
      primaryTarget: layerTarget(row.layer),
      mask: {
        present: sources.length > 0,
        sourceCount: sources.length,
        enabledSourceCount: sources.filter((source) => source.enabled).length,
        enabled: row.layer.mask.enabled,
        invert: row.layer.mask.invert,
      },
      selectedFacet: ownsTarget
        ? target.kind === "mask"
          ? "mask"
          : "primary"
        : null,
    };
  });
}

