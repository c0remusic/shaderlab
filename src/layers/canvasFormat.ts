/**
 * FORMAT DE LA TOILE, CHOISI À LA CRÉATION DU DOCUMENT (tranche T2 du design
 * `docs/superpowers/specs/2026-07-29-shaderlab-toile-de-montage-design.md`).
 *
 * Module PUR : aucune connaissance du GPU, de React, ni de l'ouverture de
 * fichier. Il répond à une seule question — « quelles dimensions de toile pour
 * ce format et cette photo ? » — et refuse bruyamment les réponses qui ne
 * tiennent pas dans le budget (voir `MAX_CANVAS_PIXELS`).
 *
 * Il ne sait RIEN du redimensionnement d'une toile déjà ouverte : ce chemin est
 * différé (§9 du design) parce que c'est lui qui invalide les masques déjà
 * peints. Ici la dimension est posée une fois, avant qu'aucun raster de masque
 * n'existe.
 */

import { assertCanvasWithinBudget } from "../render/limits";

export interface CanvasPixelSize {
  width: number;
  height: number;
}

/** Formats nommés proposés à l'ouverture, en plus de « comme la photo ». */
export type NamedCanvasFormat = "carre" | "quatre-cinq" | "a3";

/**
 * Ce que l'interface demande. `photo` est le DÉFAUT et le cas dégénéré du
 * chemin : ouvrir sans rien choisir passe par lui, et il rend les dimensions de
 * la photo sans le moindre calcul — c'est ce qui rend « le comportement
 * d'aujourd'hui » atteignable sans y penser, par construction et pas par
 * discipline.
 */
export type CanvasFormatRequest =
  | { kind: "photo" }
  | { kind: "nomme"; format: NamedCanvasFormat }
  | { kind: "libre"; width: number; height: number };

/** Le défaut, nommé une fois pour que tous les sites d'ouverture le partagent. */
export const PHOTO_CANVAS_FORMAT: CanvasFormatRequest = { kind: "photo" };

/** Résolution d'impression supposée par le format « A3 ». Un format papier n'a
 *  pas de pixels : il faut nommer le dpi, sinon « A3 » ne veut rien dire. 300
 *  dpi est le standard d'impression photo — 150 serait de la bureautique, 600
 *  quadruplerait la surface pour un gain invisible à l'œil nu. */
export const A3_PRINT_DPI = 300;

/** Dimensions physiques d'un A3, en millimètres (ISO 216). */
export const A3_MM = { short: 297, long: 420 };

const MM_PER_INCH = 25.4;

function assertUsableDimension(value: number, nom: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
    throw new Error(
      `Dimension de toile invalide (${nom} = ${value}) : un entier strictement positif est attendu, en pixels.`,
    );
  }
}

/**
 * Plus PETIT rectangle du ratio `ratioW:ratioH` qui CONTIENT la photo à sa
 * résolution native. C'est la règle unique des formats nommés relatifs
 * (« carré », « 4:5 ») : elle ne rétrécit jamais la photo et n'ajoute jamais un
 * pixel de plus que nécessaire pour atteindre la proportion demandée.
 *
 * Le ratio est ORIENTÉ comme la photo (un paysage en 4:5 rend un 5:4) : imposer
 * le portrait à une photo paysage ajouterait ~50 % de surface — donc de VRAM —
 * uniquement pour tourner le cadre. Une photo exactement carrée retombe sur
 * l'orientation canonique du format (portrait).
 */
function smallestContaining(photo: CanvasPixelSize, ratioShort: number, ratioLong: number): CanvasPixelSize {
  const landscape = photo.width > photo.height;
  const ratioW = landscape ? ratioLong : ratioShort;
  const ratioH = landscape ? ratioShort : ratioLong;
  const k = Math.max(photo.width / ratioW, photo.height / ratioH);
  return { width: Math.ceil(ratioW * k), height: Math.ceil(ratioH * k) };
}

function a3Pixels(photo: CanvasPixelSize): CanvasPixelSize {
  const px = (mm: number) => Math.round((mm / MM_PER_INCH) * A3_PRINT_DPI);
  const short = px(A3_MM.short);
  const long = px(A3_MM.long);
  return photo.width > photo.height ? { width: long, height: short } : { width: short, height: long };
}

/**
 * UNIQUE dérivation « format demandé + photo → dimensions de toile ». Tout site
 * d'ouverture passe par ici, donc aucun ne peut inventer sa propre arithmétique
 * de format, et la borne de budget est appliquée une seule fois, ici.
 */
export function canvasSizeFor(request: CanvasFormatRequest, photo: CanvasPixelSize): CanvasPixelSize {
  const size = resolve(request, photo);
  assertUsableDimension(size.width, "largeur");
  assertUsableDimension(size.height, "hauteur");
  assertCanvasWithinBudget(size.width, size.height);
  return size;
}

function resolve(request: CanvasFormatRequest, photo: CanvasPixelSize): CanvasPixelSize {
  switch (request.kind) {
    case "photo":
      return { width: photo.width, height: photo.height };
    case "libre":
      return { width: request.width, height: request.height };
    case "nomme":
      switch (request.format) {
        case "carre":
          return smallestContaining(photo, 1, 1);
        case "quatre-cinq":
          return smallestContaining(photo, 4, 5);
        case "a3":
          return a3Pixels(photo);
      }
  }
}

/**
 * Valide DEUX CHAMPS DE SAISIE et rend soit la demande de format, soit le
 * message à afficher sous le formulaire. Pure : c'est la validation de la saisie
 * libre, pas son affichage.
 *
 * Rend un message plutôt que de lever, parce qu'ici l'entrée invalide est
 * l'état NORMAL d'un formulaire en cours de frappe (« 12 » avant « 1200 ») — pas
 * un défaut de pipeline. La règle reste la même que partout ailleurs : le champ
 * refusé ne peut pas être confirmé, jamais silencieusement arrondi. Les
 * dimensions qui passent d'ici repassent par `canvasSizeFor`, donc par la borne
 * de budget, à l'ouverture — cette fonction ne dispense de rien.
 */
export function parseFreeCanvasRequest(
  widthText: string,
  heightText: string,
): { kind: "ok"; request: CanvasFormatRequest } | { kind: "erreur"; message: string } {
  const width = Number(widthText.trim());
  const height = Number(heightText.trim());
  if (widthText.trim() === "" || heightText.trim() === "") {
    return { kind: "erreur", message: "Largeur et hauteur en pixels, toutes les deux." };
  }
  const request: CanvasFormatRequest = { kind: "libre", width, height };
  try {
    canvasSizeFor(request, { width: 1, height: 1 });
  } catch (e) {
    return { kind: "erreur", message: e instanceof Error ? e.message : String(e) };
  }
  return { kind: "ok", request };
}

/** Libellé d'un format nommé, pour le menu d'ouverture. Vit ici et non dans le
 *  composant : le libellé de « A3 » DOIT porter le dpi, sinon le format ne veut
 *  rien dire — et cette obligation est une propriété du format, pas de l'UI. */
export const NAMED_CANVAS_FORMAT_LABELS: Record<NamedCanvasFormat, string> = {
  carre: "Carré",
  "quatre-cinq": "4:5",
  a3: `A3 (${A3_PRINT_DPI} dpi)`,
};
