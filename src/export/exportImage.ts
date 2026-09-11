import type { LayerState } from "../layers/types";
import type { CanvasFrameState } from "../layers/canvasFrame";
import type { DevelopSettings } from "../layers/developSettings";

/**
 * Un frame relu, AVEC les dimensions auxquelles il a été rendu.
 *
 * SOURCE UNIQUE DE LA DIMENSION D'EXPORT (design §4.3, tranche T2). Avant, la
 * largeur et la hauteur étaient deux PARAMÈTRES de `exportImage`, que `App.tsx`
 * remplissait depuis son state React (`imageSize`) tandis que les octets, eux,
 * venaient d'une relecture dimensionnée par `ImageFrameResources`. Deux sources
 * que rien ne réconciliait : un pixel d'écart et le constructeur `ImageData`
 * levait sur une incohérence de longueur. L'invariant ne tenait que parce qu'un
 * seul site posait les deux au même instant — et une toile de format choisi crée
 * un second site.
 *
 * Le correctif n'est pas un test, c'est ce type : les dimensions voyagent AVEC
 * les octets, depuis le seul objet qui les connaisse toutes les deux. « Encoder
 * à d'autres dimensions que celles du frame relu » n'est plus exprimable.
 */
export interface ExportedFrame {
  pixels: Uint8Array;
  width: number;
  height: number;
}

/** Input boundary for the application export use case.
 *
 *  `cadre` (ticket 32, tranche B) : le sous-rectangle de la toile à exporter, ou
 *  `null` pour la toile entière. Le renderer compose TOUJOURS la toile entière
 *  puis relit ce seul sous-rectangle (`Renderer.exportFrame`) — c'est ce qui
 *  garantit que l'export cadré est le crop octet pour octet de l'export non
 *  cadré, sans rien évaluer dans l'espace du cadre. Optionnel : un appelant qui
 *  n'a pas de recadrage n'a rien à passer. */
export interface FrameRenderer {
  exportFrame(layers: LayerState[], cadre?: CanvasFrameState, develop?: DevelopSettings): Promise<ExportedFrame>;
}

/** Output boundary for the application export use case. */
export interface ImageWriter {
  write(path: string, bytes: Uint8Array): Promise<void>;
}

/** Yields `-edited`, `-edited-2`, `-edited-3`, ... candidate copy paths for
 *  `sourcePath`, indefinitely — the single naming rule shared by the
 *  synchronous (`buildCopyPath`, Set-backed, used by callers that already
 *  hold every occupied name in memory) and asynchronous (`resolveExportTargetAsync`,
 *  disk-backed) collision resolvers below, so the two can never drift apart
 *  on what the Nth candidate name actually is. */
function* candidateCopyPaths(sourcePath: string): Generator<string> {
  const lastDot = sourcePath.lastIndexOf(".");
  const base = lastDot === -1 ? sourcePath : sourcePath.slice(0, lastDot);
  const ext = lastDot === -1 ? "" : sourcePath.slice(lastDot);
  yield `${base}-edited${ext}`;
  let counter = 2;
  while (true) {
    yield `${base}-edited-${counter}${ext}`;
    counter += 1;
  }
}

export function buildCopyPath(sourcePath: string, existing: Set<string> = new Set()): string {
  for (const candidate of candidateCopyPaths(sourcePath)) {
    if (!existing.has(candidate)) return candidate;
  }
  /* istanbul ignore next -- candidateCopyPaths never terminates on its own;
   * TS control-flow analysis can't prove that, so this satisfies the
   * "string" return type without ever actually running. */
  throw new Error("unreachable");
}

/** Input boundary the export path resolver uses to ask whether a candidate
 *  path already exists on disk. Backed by the Tauri `path_exists` command in
 *  production (`launch.ts`'s `pathExists`); a Set-backed fake in tests. */
export interface PathAvailability {
  exists(path: string): Promise<boolean>;
}

/**
 * Refuse d'encoder un pixel non opaque — le second verrou de la séparation
 * « alpha à l'écran / opaque à l'export » (le premier étant `PresentPass`,
 * seul écrivain de la cible d'export, voir `render/presentPass.ts`).
 *
 * Un JPEG n'a PAS de canal alpha : la spécification HTML fait composer
 * `convertToBlob` sur du NOIR quand le format cible n'en a pas. Un composite à
 * alpha 0 qui arriverait jusqu'ici produirait donc un JPEG entièrement noir,
 * sans aucun message — le piège central de la tranche T0. Lever ici transforme
 * ce silence en erreur nommée, et rend impossible de retirer l'aplatissement en
 * amont sans que quelque chose casse bruyamment.
 *
 * Fail-fast plutôt qu'aplatir une seconde fois sur le CPU : un alpha qui
 * survit jusqu'ici est un défaut de pipeline, et le corriger en douce le
 * rendrait indétectable (« pas de fallback silencieux », CLAUDE.md § Méthode).
 *
 * Coût : un balayage de plus du tampon relu (un octet sur quatre). Négligeable
 * devant la relecture GPU et l'encodage JPEG qui l'encadrent.
 */
export function assertOpaqueForJpeg(pixels: Uint8Array): void {
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] !== 255) {
      throw new Error(
        `Export JPEG : pixel non opaque (alpha=${pixels[i]}) au pixel ${(i - 3) / 4}. ` +
          "Un JPEG n'a pas de canal alpha — l'encodage composerait ce pixel sur du noir en silence. " +
          "L'aplatissement sur fond opaque doit avoir lieu dans la passe de présentation (render/presentPass.ts) avant la relecture.",
      );
    }
  }
}

async function encodeJpeg(pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  assertOpaqueForJpeg(pixels);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  const imageData = new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), width, height);
  ctx.putImageData(imageData, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.95 });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Decides the write target for an export, enforcing the project's copy-only
 * safety rule : ALWAYS returns a fresh non-colliding path derived from
 * `sourcePath`. Le fichier d'origine n'est JAMAIS écrasé.
 *
 * Il exista une exception — le round-trip Lightroom, où l'app écrasait en
 * place le fichier reçu en argument de lancement, parce que Lightroom en avait
 * déjà fait une copie temporaire en amont. Elle est déposée
 * ([ADR-0002](../../.claude/decisions/ADR-0002-abandon-round-trip-lightroom.md))
 * et avec elle le paramètre `isLaunchFile` qui la portait : la règle
 * copie-seulement n'a plus de cas particulier, donc plus rien à passer pour
 * l'obtenir.
 *
 * Checks real disk state via `availability`, not an in-memory set the caller
 * has to keep synced — a candidate that looked free a moment ago (or that no
 * caller ever recorded) is exactly the "manual export overwrites an existing
 * file" bug this replaces.
 */
export async function resolveExportTargetAsync(
  sourcePath: string,
  availability: PathAvailability
): Promise<string> {
  for (const candidate of candidateCopyPaths(sourcePath)) {
    if (!(await availability.exists(candidate))) return candidate;
  }
  /* istanbul ignore next -- see the matching comment in buildCopyPath. */
  throw new Error("unreachable");
}

/** Yields the bare `basePath` first, then falls back to the same
 *  `-edited`/`-edited-2`/... sequence as `candidateCopyPaths` — reused
 *  as-is, not duplicated, so the two naming rules can never drift on what
 *  the Nth fallback candidate actually is. */
function* candidateDefaultExportPaths(basePath: string): Generator<string> {
  yield basePath;
  yield* candidateCopyPaths(basePath);
}

/**
 * Résolveur du bouton "Exporter" par défaut : `basePath` est déjà le chemin
 * complet dans le dossier d'export dédié (dossier + nom de fichier source,
 * voir `joinExportTarget` côté launch.ts). Contrairement à
 * `resolveExportTargetAsync`, essaie le nom nu en premier — sûr ici car le
 * dossier dédié est distinct du dossier de la photo source : une collision
 * ne peut survenir qu'avec un export précédent, jamais avec l'original.
 * `resolveExportTargetAsync` reste le résolveur du bouton "Exporter sous..."
 * (comportement conservateur pour un dossier arbitraire, y compris
 * potentiellement le dossier source lui-même). Il servait AUSSI le round-trip
 * Lightroom, déposé — voir son commentaire.
 */
export async function resolveDefaultExportTarget(
  basePath: string,
  availability: PathAvailability
): Promise<string> {
  for (const candidate of candidateDefaultExportPaths(basePath)) {
    if (!(await availability.exists(candidate))) return candidate;
  }
  /* istanbul ignore next -- candidateDefaultExportPaths never terminates on
   * its own; see the matching comment in buildCopyPath. */
  throw new Error("unreachable");
}

/**
 * Renders the current layer stack and writes the result to `targetPath`.
 * Caller decides `targetPath`, and since the Lightroom round-trip was dropped
 * (ADR-0002) there is only one kind left: a fresh, non-colliding path derived
 * from the source (`resolveExportTargetAsync` / `resolveDefaultExportTarget`).
 * No caller can ask for an in-place overwrite any more.
 *
 * Uses `renderer.exportFrame()`, NOT `render()` + a raw ping-pong readback.
 * `render()` writes its final pass straight to the canvas, never into the
 * ping-pong buffers — reading `pingPong[0]` back after `render()` would
 * return stale data from an intermediate pass, not the actual final
 * composited frame (a real bug flagged in Task 5's review). `exportFrame()`
 * reruns the same multi-pass pipeline targeting a dedicated off-screen
 * texture for every pass, including the last one, so its readback is always
 * correct.
 */
export async function exportImage(
  frameRenderer: FrameRenderer,
  imageWriter: ImageWriter,
  layers: LayerState[],
  targetPath: string,
  cadre: CanvasFrameState = null,
  /** Étage de développement du document (ticket 03) : appliqué au composite en
   *  fin de chaîne, donc l'export DOIT le porter — un seul pipeline, un fichier
   *  exporté est l'image développée. Défaut `{}` = aucun réglage. */
  develop: DevelopSettings = {}
): Promise<void> {
  // Aucun paramètre de dimension : elles arrivent avec les octets — voir
  // `ExportedFrame`. C'est ce qui interdit d'encoder aux dimensions d'une
  // autre source (le state React, avant la tranche T2). Le `cadre` ne dit PAS
  // les dimensions : il dit quel sous-rectangle relire, et les dimensions
  // reviennent quand même AVEC les octets (celles du cadre écrêté).
  const frame = await frameRenderer.exportFrame(layers, cadre, develop);
  const jpegBytes = await encodeJpeg(frame.pixels, frame.width, frame.height);
  await imageWriter.write(targetPath, jpegBytes);
}
