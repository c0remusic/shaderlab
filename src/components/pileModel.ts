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
   * Le filet de cette ligne est-il sur le CHEMIN qui va de la photo du groupe
   * jusqu'à la sélection ?
   *
   * Deux marques, deux portées, et c'est la distinction qui compte (2026-08-16,
   * deux constats d'Antoine à un tour d'écart) :
   *  - le LAVIS dit quelle LIGNE est sélectionnée ;
   *  - le FILET TRACE le chemin depuis la tête du groupe jusqu'à elle, puis
   *    s'arrête. Au-dessous, il reprend sa couleur de repos.
   *
   * ⚠️ DEUX ERREURS SUCCESSIVES avant cette forme, et elles se corrigent l'une
   * l'autre. Colorer le seul segment de la ligne sélectionnée faisait un trait
   * BICOLORE (gris, bleu, gris) sur un objet qui n'a qu'un sens — « la barre
   * blanche devrait devenir bleue, ça serait plus cohérent ». Colorer le groupe
   * ENTIER a corrigé ça mais dépassait la cible — « toute la barre est bleue,
   * ça ne s'arrête pas à l'élément sélectionné ». Ce qui est juste est entre les
   * deux : un trait CONTINU, qui commence à la photo et FINIT à la sélection.
   *
   * Conséquence assumée : sélectionner la PHOTO du groupe n'allume aucun filet.
   * Le chemin est alors de longueur nulle — on est déjà à la tête, il n'y a rien
   * à parcourir.
   */
  railToSelection: boolean;
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
  // Position de la sélection dans l'ORDRE D'AFFICHAGE — c'est là que le chemin
  // s'arrête. `toLayerTreeRows` rend déjà cet ordre (la photo ouvre son groupe
  // par le haut depuis l'ADR-0004), donc comparer des index suffit : pas besoin
  // de reconstruire une notion de « avant » propre à ce module.
  const indexSelection = arbre.findIndex((row) => row.layer.id === target?.layerId);
  return arbre.map((row, index) => {
    const ownsTarget = target?.layerId === row.layer.id;
    const sources = row.layer.mask.sources;
    return {
      ...row,
      // Trois conditions, et la troisième est celle qui ARRÊTE le trait :
      // le bon groupe, une ligne qui porte un filet (donc imbriquée, ce que
      // `parentId` non nul garantit), et une position AU-DESSUS OU SUR la
      // sélection. Sans elle, le filet éclairait tout le groupe et dépassait la
      // ligne visée.
      railToSelection:
        groupeActif !== null && row.parentId === groupeActif && index <= indexSelection,
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

