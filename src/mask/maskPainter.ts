/** Bounding box (in image pixels, inclusive-exclusive like a DOMRect) of the
 *  region a single `paintStroke()` call actually touched. A brush stroke
 *  only ever affects a small area — moving/uploading the FULL mask buffer
 *  per sample (26MB on a 24MP photo) at real-drag sampling rates was traced
 *  to a reproducible renderer OOM crash (2026-07-15); callers should use
 *  this to update only the touched region instead. */
export interface DirtyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Réglages d'UN trait de pinceau (gate v1 §Masquage : « taille, dureté,
 *  opacité et débit »).
 *
 *  Regroupés en objet plutôt qu'ajoutés en paramètres positionnels : avec
 *  opacité et débit, `paintLine` passerait à NEUF arguments dont sept nombres
 *  interchangeables à la lecture — une inversion silencieuse entre `hardness`,
 *  `opacity` et `flow` ne se verrait ni au type-check ni au rendu, seulement
 *  au toucher du pinceau.
 *
 *  **`opacity` et `flow` ne sont pas deux noms du même réglage** — c'est leur
 *  couple qui rend un masque constructible progressivement au lieu de binaire :
 *  - `opacity` est le PLAFOND du trait. Repasser cent fois au cours du MÊME
 *    trait ne dépasse jamais ce plafond.
 *  - `flow` est le DÉPÔT par tampon. À débit faible chaque tampon ajoute peu,
 *    et repasser dans le même trait fait monter la valeur — jusqu'au plafond.
 *
 *  Un trait suivant repart d'un plafond RÉANCRÉ sur la valeur courante (voir
 *  `beginStroke`), donc deux traits séparés à 50 % dépassent bien 50 %.
 */
export interface BrushSettings {
  /** Rayon en pixels IMAGE (pas en pixels écran). */
  radius: number;
  /** Dureté 0..1 : fraction du rayon restant à pleine force avant le fondu.
   *  1 = pas de fondu du tout. */
  hardness: number;
  /** `true` = le trait RETIRE du masque au lieu d'y ajouter. */
  erase: boolean;
  /** Plafond du trait, 0..1. 1 = comportement d'avant cette fonctionnalité. */
  opacity: number;
  /** Dépôt par tampon, 0..1. 1 = comportement d'avant cette fonctionnalité. */
  flow: number;
}

/** Adapte la forme POSITIONNELLE héritée (`radius, hardness, erase`) sur
 *  `BrushSettings`. Elle survit uniquement pour qu'`App.tsx` continue de
 *  compiler pendant que l'interface est câblée séparément ; `opacity`/`flow`
 *  à 1 y rendent le peintre byte-identique à sa version d'avant (témoin
 *  « équivalence historique » dans `test/mask/maskPainter.test.ts`). À retirer
 *  quand `App.tsx` sera passé à la forme objet. */
function resolveBrush(
  brushOrRadius: BrushSettings | number,
  hardness: number | undefined,
  erase: boolean | undefined
): BrushSettings {
  if (typeof brushOrRadius !== "number") return brushOrRadius;
  return { radius: brushOrRadius, hardness: hardness ?? 1, erase: erase ?? false, opacity: 1, flow: 1 };
}

/** Bounding-box union of two dirty rects — used by `paintLine` to combine
 *  the touched region of every interpolated dab along a segment. */
function unionRect(a: DirtyRect, b: DirtyRect): DirtyRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
}

export class MaskPainter {
  private width: number;
  private height: number;
  private data: Uint8Array;

  /** Le masque tel qu'il était AU DÉBUT du trait courant.
   *
   *  C'est la pièce sans laquelle l'opacité est inapplicable : le plafond d'un
   *  trait est relatif à ce qui était là AVANT lui, pas absolu. Sans cette
   *  copie, un trait à 50 % sur une zone déjà à 200 la ferait REDESCENDRE à
   *  127 — une opération de peinture qui efface, ce que personne n'attend —
   *  et deux traits successifs à 50 % ne pourraient jamais dépasser 50 %.
   *
   *  Alloué à la PREMIÈRE ouverture de trait puis RÉUTILISÉ (`set`, pas
   *  `new Uint8Array`) : sur une photo 24MP c'est 24 Mo, et en réallouer un par
   *  trait rejouerait exactement le motif d'allocations répétées qui a causé
   *  le crash OOM de 2026-07-15. La recopie, elle, coûte un memcpy UNE fois par
   *  trait (geste utilisateur), jamais par échantillon de pointeur. */
  private strokeBase: Uint8Array | null = null;

  /** Un trait est-il ouvert ? Distingue « tampon de suite » (le plafond reste
   *  ancré) de « premier tampon d'un nouveau trait » (le plafond se réancre). */
  private strokeActive = false;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height);
  }

  private ensureStrokeBase(): Uint8Array {
    let base = this.strokeBase;
    if (base === null || base.length !== this.data.length) {
      base = new Uint8Array(this.data.length);
      this.strokeBase = base;
    }
    return base;
  }

  /** Ouvre un trait : ancre le plafond d'opacité sur l'état COURANT du masque.
   *
   *  Appelée par `getSyncedMaskPainter` au premier échantillon de chaque trait
   *  (il sait déjà où commence un trait : c'est son `lastPoint === null`), et
   *  automatiquement par le premier tampon si personne ne l'a fait — un tampon
   *  hors trait EST un début de trait, et laisser le peintre dans un état
   *  indéfini serait pire que de le supposer. Ne PAS l'appeler au milieu d'un
   *  trait : cela réancrerait le plafond, et l'opacité cesserait de plafonner. */
  beginStroke(): void {
    this.ensureStrokeBase().set(this.data);
    this.strokeActive = true;
  }

  /** Ferme le trait courant : le prochain tampon réancrera le plafond.
   *  L'oublier ne corrompt rien, mais fait vivre tous les traits suivants sous
   *  le plafond du premier — le symptôme est « l'opacité ne remonte plus ». */
  endStroke(): void {
    this.strokeActive = false;
  }

  paintStroke(x: number, y: number, brush: BrushSettings): DirtyRect;
  /** Forme héritée — voir `resolveBrush`. */
  paintStroke(x: number, y: number, radius: number, hardness: number, erase: boolean): DirtyRect;
  paintStroke(
    x: number,
    y: number,
    brushOrRadius: BrushSettings | number,
    hardness?: number,
    erase?: boolean
  ): DirtyRect {
    const brush = resolveBrush(brushOrRadius, hardness, erase);
    if (!this.strokeActive) this.beginStroke();
    const base = this.ensureStrokeBase();
    const radius = brush.radius;

    const minX = Math.max(0, Math.floor(x - radius));
    const maxX = Math.min(this.width - 1, Math.ceil(x + radius));
    const minY = Math.max(0, Math.floor(y - radius));
    const maxY = Math.min(this.height - 1, Math.ceil(y + radius));

    const falloffStart = radius * brush.hardness;
    const falloffSpan = Math.max(radius - falloffStart, 0.0001);

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const dist = Math.hypot(px - x, py - y);
        if (dist > radius) continue;
        let strength = 1.0;
        if (dist > falloffStart) {
          strength = 1.0 - (dist - falloffStart) / falloffSpan;
        }
        const idx = py * this.width + px;
        const current = this.data[idx];
        // Ce que CE tampon dépose, indépendamment de ce que le trait a déjà
        // posé : c'est le débit. À 1 on retrouve exactement le `strength * 255`
        // additif de la version d'avant.
        const deposit = brush.flow * strength * 255;
        if (brush.erase) {
          // Plancher du trait, quantifié vers le HAUT : 0.5 sur un masque plein
          // vaut 127.5, non représentable en octet — arrondir vers le bas
          // ferait descendre SOUS la limite demandée.
          const floorValue = Math.ceil(base[idx] * (1 - brush.opacity));
          if (current > floorValue) this.data[idx] = Math.max(floorValue, current - deposit);
        } else {
          // Plafond du trait, quantifié vers le BAS pour la raison symétrique.
          const ceilValue = Math.floor(base[idx] + brush.opacity * (255 - base[idx]));
          if (current < ceilValue) this.data[idx] = Math.min(ceilValue, current + deposit);
        }
      }
    }

    // When the brush's footprint doesn't overlap the image at all (its
    // center is far enough outside on one axis — reachable since painting
    // can now continue past the canvas edge, pointer-capture fix), maxX/maxY
    // end up SMALLER than minX/minY. Clamp to an EMPTY (zero-area) rect
    // instead of returning a NEGATIVE width/height: that malformed rect used
    // to flow straight into a GPU partial-texture-upload copy size
    // (computeR8UploadRegion → device.queue.writeTexture), which WebGPU
    // rejects — a validation error on every such frame, causing a visible
    // flicker (reported live, 2026-07-18). A [0,0] copy is a valid GPU no-op.
    return {
      x: minX,
      y: minY,
      width: Math.max(0, maxX - minX + 1),
      height: Math.max(0, maxY - minY + 1),
    };
  }

  /**
   * Stamps a run of interpolated dabs from (fromX,fromY) to (toX,toY), so a
   * fast drag reads as a continuous stroke instead of isolated dots. A single
   * `paintStroke` per raw pointer sample leaves visible gaps whenever the
   * cursor travels farther between two samples than the brush diameter —
   * reported live (dotted/gapped trail on a real drag, 2026-07-18).
   *
   * Dabs are spaced at 25% of the brush radius (dense enough that
   * consecutive circles overlap and blend into a solid line — standard
   * "brush spacing" in painting tools). The FROM point itself is NOT
   * re-stamped: it was already painted by the previous call in the stroke
   * (or is the stroke's very first dab, painted separately) — a duplicate
   * dab there would be redundant, not incorrect, but wasted work.
   *
   * Chaque tampon interpolé dépose son `flow` comme un tampon ordinaire : à
   * débit faible, un trait lent (donc beaucoup de tampons superposés) monte
   * plus vite qu'un trait rapide, exactement comme un aérographe. C'est voulu.
   */
  paintLine(fromX: number, fromY: number, toX: number, toY: number, brush: BrushSettings): DirtyRect;
  /** Forme héritée — voir `resolveBrush`. */
  paintLine(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    radius: number,
    hardness: number,
    erase: boolean
  ): DirtyRect;
  paintLine(
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    brushOrRadius: BrushSettings | number,
    hardness?: number,
    erase?: boolean
  ): DirtyRect {
    const brush = resolveBrush(brushOrRadius, hardness, erase);
    const dx = toX - fromX;
    const dy = toY - fromY;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return this.paintStroke(toX, toY, brush);

    const spacing = Math.max(1, brush.radius * 0.25);
    const steps = Math.max(1, Math.ceil(distance / spacing));

    let touched: DirtyRect = this.paintStroke(toX, toY, brush);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const rect = this.paintStroke(fromX + dx * t, fromY + dy * t, brush);
      touched = unionRect(touched, rect);
    }
    return touched;
  }

  getMaskData(): Uint8Array {
    return this.data;
  }

  /** Termine le trait courant : le contenu sous le pinceau vient d'être
   *  remplacé, l'ancre de plafond du trait en cours décrirait un masque qui
   *  n'existe plus (cas réel : un undo/redo entre deux échantillons). */
  clear(fill: 0 | 255): void {
    this.data.fill(fill);
    this.endStroke();
  }

  /** Même raison que `clear` de terminer le trait courant. */
  loadFrom(data: Uint8Array): void {
    this.data.set(data);
    this.endStroke();
  }
}
