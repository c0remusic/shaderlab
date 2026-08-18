import type { LayerTransform } from "../layers/types";

/**
 * ADAPTATEUR DE BOÎTE — le quatrième genre de `CanvasControl`, et il n'a demandé
 * aucun manipulateur neuf (ticket 25, débloqué par le ticket 17).
 *
 * `TransformHandles` fait déjà quatre coins, quatre côtés, une rotation, le
 * magnétisme et l'accès clavier, pour le calque photo. Une boîte d'effet et une
 * photo transformée sont le MÊME objet dans deux systèmes d'unités : un centre,
 * deux demi-étendues, un angle. Ce module est ce changement d'unités.
 *
 * ── LES DEUX SYSTÈMES ───────────────────────────────────────────────────────
 *
 * Côté EFFET, tout est en fractions du cadre — c'est ce que le shader lit, et
 * c'est ce qui rend un preset indépendant de la définition de la photo :
 * `centreX`/`centreY` en UV (0..1), `largeur`/`hauteur` en fraction de la
 * largeur et de la hauteur du cadre, `rotation` en DEGRÉS.
 *
 * Côté MANIPULATEUR, `LayerTransform` est en PIXELS du fond, avec une `rotation`
 * en RADIANS et deux échelles relatives à une `photoSize`. La boîte n'a pas de
 * photo derrière elle : on lui en fabrique une, dont la taille EST la boîte à
 * l'échelle 1. C'est ce qui laisse `scaleX`/`scaleY` à 1 au repos et fait que
 * toute la mécanique d'échelle existante s'applique sans la comprendre.
 *
 * ⚠️ DEUX UNITÉS D'ANGLE, ET C'EST LE PIÈGE DE CE FICHIER. Le degré vient du
 * paramètre d'effet (un curseur se lit en degrés), le radian de la géométrie.
 * Les confondre ne casse rien de visible tout de suite : une boîte tourne, mais
 * d'un facteur 57.
 */

/** Une boîte telle qu'un effet la déclare : fractions du cadre, angle en degrés. */
export interface BoiteUv {
  centreX: number;
  centreY: number;
  largeur: number;
  hauteur: number;
  rotation: number;
}

export interface TaillePixels {
  width: number;
  height: number;
}

const DEG_VERS_RAD = Math.PI / 180;

/**
 * Boîte → ce que `TransformHandles` attend.
 *
 * La `photoSize` rendue n'est pas une photo : c'est la boîte mesurée en pixels,
 * donnée au manipulateur comme si elle était le contenu à transformer. Elle est
 * bornée à un pixel — une boîte de taille nulle rendrait des poignées
 * superposées et une échelle infinie au premier glissement.
 */
export function boiteVersTransform(
  boite: BoiteUv,
  cadre: TaillePixels,
): { transform: LayerTransform; photoSize: TaillePixels } {
  return {
    transform: {
      x: boite.centreX * cadre.width,
      y: boite.centreY * cadre.height,
      scaleX: 1,
      scaleY: 1,
      rotation: boite.rotation * DEG_VERS_RAD,
    },
    photoSize: {
      width: Math.max(boite.largeur * cadre.width, 1),
      height: Math.max(boite.hauteur * cadre.height, 1),
    },
  };
}

/**
 * Le retour, après un glissement.
 *
 * `photoSize` est celle qu'on a FABRIQUÉE à l'aller : le manipulateur ne la
 * change jamais, il change `scaleX`/`scaleY`. La largeur réelle est donc le
 * produit des deux, et c'est la seule façon de récupérer un redimensionnement.
 */
export function transformVersBoite(
  transform: LayerTransform,
  photoSize: TaillePixels,
  cadre: TaillePixels,
): BoiteUv {
  return {
    centreX: transform.x / cadre.width,
    centreY: transform.y / cadre.height,
    largeur: (photoSize.width * transform.scaleX) / cadre.width,
    hauteur: (photoSize.height * transform.scaleY) / cadre.height,
    rotation: transform.rotation / DEG_VERS_RAD,
  };
}
