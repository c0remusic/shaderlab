import { LayerStack } from "./layerStack";

const DEFAULT_BUDGET_BYTES = 512 * 1024 * 1024;

/**
 * Historique undo/redo borné en OCTETS RÉELLEMENT RETENUS (spec standalone
 * v1 : plafond 512 Mo par document, éviction des entrées les plus anciennes,
 * état courant toujours conservé).
 *
 * Le coût mémoire est dominé par les buffers de masque (≈ 1 octet/pixel,
 * ~26 Mo à 26MP). Depuis que clone() PARTAGE les références maskData
 * (immuables par convention), plusieurs entrées d'historique pointent vers
 * les mêmes buffers : compter octets-par-entrée surestimerait massivement.
 * On refcount donc chaque buffer unique — un buffer n'est compté qu'une
 * fois tant qu'au moins une entrée (past, current ou future) le retient,
 * et n'est décompté que quand plus aucune ne le retient.
 */
export class History {
  private past: LayerStack[] = [];
  private future: LayerStack[] = [];
  private current: LayerStack;
  private readonly budgetBytes: number;
  private refCounts = new Map<Uint8Array, number>();
  private totalBytes = 0;

  constructor(initial: LayerStack, budgetBytes: number = DEFAULT_BUDGET_BYTES) {
    this.current = initial;
    this.budgetBytes = budgetBytes;
    this.retain(initial);
  }

  private retain(stack: LayerStack): void {
    for (const layer of stack.layers) {
      if (!layer.maskData) continue;
      const count = this.refCounts.get(layer.maskData) ?? 0;
      if (count === 0) this.totalBytes += layer.maskData.byteLength;
      this.refCounts.set(layer.maskData, count + 1);
    }
  }

  private release(stack: LayerStack): void {
    for (const layer of stack.layers) {
      if (!layer.maskData) continue;
      const count = this.refCounts.get(layer.maskData);
      if (count === undefined) continue;
      if (count <= 1) {
        this.refCounts.delete(layer.maskData);
        this.totalBytes -= layer.maskData.byteLength;
      } else {
        this.refCounts.set(layer.maskData, count - 1);
      }
    }
  }

  push(state: LayerStack): void {
    this.past.push(this.current);
    // Clone défensif (partage les masques, copie les métadonnées) : une
    // mutation ultérieure de `state` par l'appelant ne corrompt pas
    // l'entrée stockée — même garantie qu'avant.
    const next = state.clone();
    this.current = next;
    this.retain(next);
    for (const dropped of this.future) this.release(dropped);
    this.future = [];
    // Éviction spec : les plus anciennes d'abord, jamais l'état courant.
    while (this.totalBytes > this.budgetBytes && this.past.length > 0) {
      this.release(this.past.shift()!);
    }
  }

  undo(): LayerStack | null {
    const previous = this.past.pop();
    if (!previous) return null;
    // Déplacements internes past<->current<->future : l'ensemble retenu ne
    // change pas, aucun retain/release nécessaire.
    this.future.push(this.current);
    this.current = previous;
    return this.current.clone();
  }

  redo(): LayerStack | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(this.current);
    this.current = next;
    return this.current.clone();
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Octets de masque uniques actuellement retenus (pour tests et futur
   *  indicateur UI). */
  bytesUsed(): number {
    return this.totalBytes;
  }
}
