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
  /**
   * Cette ligne appartient-elle au groupe qui CONTIENT la sélection ?
   *
   * Deux marques distinctes, et c'est la distinction qui compte (2026-08-16,
   * constat d'Antoine : « la barre blanche devrait devenir bleue, ça serait plus
   * cohérent ») :
   *  - le LAVIS dit quelle LIGNE est sélectionnée ;
   *  - le FILET dit quel GROUPE la contient.
   * Le filet est un trait CONTINU qui traverse tout un groupe. Le colorer sur la
   * seule ligne sélectionnée le faisait changer de couleur deux fois sur sa
   * longueur — gris, bleu, gris — pour un objet qui n'a qu'un seul sens.
   *
   * Vrai aussi sur la PHOTO du groupe et sur ses frères non sélectionnés : c'est
   * le groupe entier qui est actif, pas la ligne.
   */
  inActiveGroup: boolean;
}

/** Photo dont le groupe contient la cible : le parent de la ligne visée, ou la
 *  ligne visée elle-même quand c'est une photo qui ouvre un groupe. */
function activeGroupId(rows: LayerTreeRow[], target: PropertiesTarget | null): string | null {
  if (target === null) return null;
  const visee = rows.find((row) => row.layer.id === target.layerId);
  if (visee === undefined) return null;
  return visee.parentId ?? visee.layer.id;
}

/** Projection pure de la pile destinée à l'UI. Elle enrichit `layerTree` sans
 * changer son ordre, ses parents ni ses bornes de drag. */
export function toPileRows(
  layers: LayerState[],
  target: PropertiesTarget | null,
): PileRow[] {
  const arbre = toLayerTreeRows(layers);
  const groupeActif = activeGroupId(arbre, target);
  return arbre.map((row) => {
    const ownsTarget = target?.layerId === row.layer.id;
    const sources = row.layer.mask.sources;
    return {
      ...row,
      // Une ligne RACINE sans enfant n'est le groupe de personne : `parentId`
      // vaut null et son propre id ne coïncide avec `groupeActif` que si elle
      // ouvre bien un groupe — c'est ce que `activeGroupId` a déjà tranché.
      inActiveGroup: groupeActif !== null && row.parentId === groupeActif,
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

