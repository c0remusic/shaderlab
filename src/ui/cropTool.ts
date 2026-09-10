import { STRETCH_HANDLES, type StretchHandle } from "./effectStretch";

/**
 * OUTIL DE RECADRAGE DE LA TOILE — la géométrie PURE du cadre qu'on trace, tire
 * et contraint sur la toile (ticket 32, tranche B). Aucune dépendance DOM/React,
 * testable en env Node comme `tools.ts`, `canvasMode.ts`, `effectStretch.ts`.
 *
 * ── L'ESPACE EST CELUI DE LA TOILE D'ORIGINE, EN PIXELS ─────────────────────
 *
 * Pendant l'outil, l'image ENTIÈRE est montrée (le renderer reçoit `setCadre(null)`)
 * : le cadre courant ne découpe plus l'affichage, on le voit posé sur toute la
 * toile pour l'agrandir ou le déplacer — c'est le non-destructif rendu VISIBLE,
 * et c'est ce que fait Lightroom. Le rectangle de travail est donc exprimé dans
 * l'espace d'ORIGINE (pixels de la toile), et la validation le pose en cadre
 * ABSOLU (voir `App`/`useCropTool` : `annulerRecadrage` puis `recadrerToile`, la
 * composition contre `null` étant l'identité — c'est ce qui permet d'AGRANDIR un
 * cadre existant, ce que `composerCadre` seul interdit).
 *
 * ── LES RATIOS ─────────────────────────────────────────────────────────────
 *
 * `CROP_RATIOS` porte la liste — Libre · D'origine · Carré · 4:5 · 3:2. Elle
 * n'est PAS dérivable d'ADR-0007 : cet ADR dérive des dimensions de CRÉATION par
 * contenance (dont « A3 » est un format ABSOLU, pas un ratio) ; un recadrage
 * choisit une PROPORTION du cadre existant. « 3:2 » n'existe pas côté création.
 * « Carré »/« 4:5 » partagent les proportions d'ADR-0007 mais restent définis
 * ici, où le concept vit. Les ratios relatifs sont ORIENTÉS comme la toile
 * (paysage → 5:4 / 3:2, portrait → 4:5 / 2:3), même règle qu'ADR-0007 §2 :
 * imposer le portrait à une toile paysage réduirait le cadre pour rien.
 */

/** Rectangle de recadrage, en pixels de la toile d'ORIGINE. */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type CropRatioId = "free" | "original" | "square" | "4:5" | "3:2";

export interface CropRatioOption {
  id: CropRatioId;
  label: string;
}

/** Ordre d'affichage du sélecteur. « Libre » d'abord (le défaut), puis les
 *  proportions du plus général au plus spécifique. */
export const CROP_RATIOS: readonly CropRatioOption[] = [
  { id: "free", label: "Libre" },
  { id: "original", label: "D'origine" },
  { id: "square", label: "Carré" },
  { id: "4:5", label: "4:5" },
  { id: "3:2", label: "3:2" },
];

export const DEFAULT_CROP_RATIO: CropRatioId = "free";

/** Côté minimal d'un cadre, en pixels de la toile. Un cadre plus petit ne
 *  laisserait plus de prise à la souris et produirait un export dégénéré. */
export const MIN_CROP_PX = 16;

/** Les huit poignées, réutilisées telles quelles de `effectStretch` — un cadre
 *  de recadrage a exactement la même topologie (4 coins, 4 côtés), et refaire
 *  une table divergerait en silence. */
export const CROP_HANDLES: readonly StretchHandle[] = STRETCH_HANDLES;

interface Size {
  width: number;
  height: number;
}

/**
 * Ratio largeur/hauteur d'un id, ou `null` pour « Libre ». Les ratios relatifs
 * sont orientés comme la toile.
 */
export function cropRatioValue(id: CropRatioId, docSize: Size): number | null {
  const landscape = docSize.width >= docSize.height;
  switch (id) {
    case "free":
      return null;
    case "original":
      return docSize.height > 0 ? docSize.width / docSize.height : 1;
    case "square":
      return 1;
    case "4:5":
      return landscape ? 5 / 4 : 4 / 5;
    case "3:2":
      return landscape ? 3 / 2 : 2 / 3;
  }
}

/**
 * Ratio EFFECTIF pendant un geste. `Maj` contraint « au ratio choisi » : si un
 * ratio fixe est sélectionné, il s'applique toujours ; en « Libre », `Maj`
 * rabat sur le carré, faute d'autre ratio à honorer (convention Photoshop /
 * Figma).
 */
export function effectiveCropRatio(id: CropRatioId, docSize: Size, shift: boolean): number | null {
  if (id !== "free") return cropRatioValue(id, docSize);
  return shift ? 1 : null;
}

function clampRange(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Rectangle initial de l'outil : le cadre courant s'il existe (pour l'agrandir
 *  ou le déplacer), sinon la toile entière. Toujours borné à la toile et à la
 *  taille minimale. */
export function initialCropRect(cadre: CropRect | null, docSize: Size): CropRect {
  const base = cadre ?? { x: 0, y: 0, width: docSize.width, height: docSize.height };
  return clampCropToDoc(base, docSize);
}

/** Ramène un rectangle dans la toile et au-dessus de la taille minimale, sans
 *  changer sa position tant que c'est possible. */
export function clampCropToDoc(rect: CropRect, docSize: Size): CropRect {
  const width = clampRange(rect.width, MIN_CROP_PX, docSize.width);
  const height = clampRange(rect.height, MIN_CROP_PX, docSize.height);
  const x = clampRange(rect.x, 0, docSize.width - width);
  const y = clampRange(rect.y, 0, docSize.height - height);
  return { x, y, width, height };
}

/**
 * Déplace le cadre d'un delta en pixels de toile, borné à la toile (il ne peut
 * pas en sortir). Cumulé depuis le rectangle de DÉPART du geste, jamais
 * incrémental — même discipline que les autres manipulateurs.
 */
export function moveCropRect(start: CropRect, dx: number, dy: number, docSize: Size): CropRect {
  return {
    x: clampRange(start.x + dx, 0, docSize.width - start.width),
    y: clampRange(start.y + dy, 0, docSize.height - start.height),
    width: start.width,
    height: start.height,
  };
}

/**
 * Redimensionne le cadre en tirant `handle`, cumulé depuis `start`. `(dx, dy)`
 * est le déplacement TOTAL du pointeur depuis l'appui, en pixels de toile.
 * `ratio` non nul contraint la proportion ; `null` laisse les deux axes libres.
 * Le résultat est toujours borné à la toile et à la taille minimale.
 */
export function resizeCropRect(
  start: CropRect,
  handle: StretchHandle,
  dx: number,
  dy: number,
  ratio: number | null,
  docSize: Size,
): CropRect {
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;

  if (handle.h === "left") left = clampRange(start.x + dx, 0, right - MIN_CROP_PX);
  else if (handle.h === "right") right = clampRange(start.x + start.width + dx, left + MIN_CROP_PX, docSize.width);
  if (handle.v === "top") top = clampRange(start.y + dy, 0, bottom - MIN_CROP_PX);
  else if (handle.v === "bottom") bottom = clampRange(start.y + start.height + dy, top + MIN_CROP_PX, docSize.height);

  const free: CropRect = { x: left, y: top, width: right - left, height: bottom - top };
  if (ratio === null) return free;

  // POINT FIXE : le bord (ou coin) opposé à celui qu'on tire. Un côté absent est
  // ancré à son MILIEU, ce qui fait grandir la proportion symétriquement sur
  // l'axe libre.
  const anchorX = handle.h === "left" ? right : handle.h === "right" ? left : (left + right) / 2;
  const anchorY = handle.v === "top" ? bottom : handle.v === "bottom" ? top : (top + bottom) / 2;
  return applyRatioAnchored(free, ratio, anchorX, anchorY, handle, docSize);
}

/**
 * Force la proportion `ratio` sur `rect`, ancré à `(anchorX, anchorY)`, puis
 * ramène le tout dans la toile en conservant proportion ET ancre.
 *
 * L'axe MENEUR dépend de la poignée : un côté horizontal mène par la largeur,
 * un côté vertical par la hauteur, un coin par la largeur (choix stable, le
 * geste reste prévisible). L'axe libre est alors dérivé et re-centré sur l'ancre
 * du côté qu'on n'a pas touché.
 */
function applyRatioAnchored(
  rect: CropRect,
  ratio: number,
  anchorX: number,
  anchorY: number,
  handle: StretchHandle,
  docSize: Size,
): CropRect {
  const menePWidth = handle.h !== null; // coin ou côté horizontal → largeur mène
  let width = rect.width;
  let height = rect.height;
  if (menePWidth) height = width / ratio;
  else width = height * ratio;

  // Réduit à la toile en gardant proportion + ancre : le facteur le plus
  // contraignant des deux axes s'applique aux deux.
  const maxWidth = anchorX >= docSize.width / 2 ? anchorX : docSize.width - anchorX;
  const maxHeight = anchorY >= docSize.height / 2 ? anchorY : docSize.height - anchorY;
  // Sur un axe non touché (ancré au milieu), la demi-course de chaque côté borne.
  const boundW = handle.h === null ? Math.min(anchorX, docSize.width - anchorX) * 2 : maxWidth;
  const boundH = handle.v === null ? Math.min(anchorY, docSize.height - anchorY) * 2 : maxHeight;
  const scale = Math.min(1, boundW / width, boundH / height);
  width = Math.max(MIN_CROP_PX, width * scale);
  height = Math.max(MIN_CROP_PX, height * scale);

  const x = handle.h === "left" ? anchorX - width : handle.h === "right" ? anchorX : anchorX - width / 2;
  const y = handle.v === "top" ? anchorY - height : handle.v === "bottom" ? anchorY : anchorY - height / 2;
  return clampCropToDoc({ x, y, width, height }, docSize);
}

/**
 * Applique un ratio au rectangle courant (changement de sélecteur) : garde le
 * CENTRE, prend la plus grande boîte de ce ratio qui tient dans la toile sans
 * dépasser la taille courante démesurément, puis clampe. « Libre » ne touche à
 * rien.
 */
export function applyRatioToRect(rect: CropRect, ratio: number | null, docSize: Size): CropRect {
  if (ratio === null) return clampCropToDoc(rect, docSize);
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  // Part de la largeur courante, dérive la hauteur, puis rétrécit pour tenir
  // dans la toile (jamais agrandir au-delà de la toile).
  let width = rect.width;
  let height = width / ratio;
  const scale = Math.min(1, docSize.width / width, docSize.height / height);
  width = Math.max(MIN_CROP_PX, width * scale);
  height = Math.max(MIN_CROP_PX, height * scale);
  return clampCropToDoc({ x: cx - width / 2, y: cy - height / 2, width, height }, docSize);
}
