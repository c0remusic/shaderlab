import { toDisplayLayers } from "../layers/displayProjection";
import { History } from "../layers/history";
import { LayerStack } from "../layers/layerStack";
import type { LayerState } from "../layers/types";

/** Framework-free application state for one non-destructive image document. */
export class DocumentSession {
  private history: History;
  private current: LayerStack;
  private selectedLayerId: string | null = null;

  constructor(initial: LayerStack = new LayerStack()) {
    this.current = initial.clone();
    this.history = new History(this.current);
  }

  layers(): LayerState[] {
    return this.current.layers;
  }

  displayLayers(): LayerState[] {
    return toDisplayLayers(this.current.layers);
  }

  selectedId(): string | null {
    return this.selectedLayerId;
  }

  select(id: string | null): void {
    this.selectedLayerId = id && this.current.layers.some((layer) => layer.id === id) ? id : null;
  }

  replaceDocument(stack: LayerStack): void {
    this.current = stack.clone();
    this.history = new History(this.current);
    this.selectedLayerId = null;
  }

  currentStack(): LayerStack {
    return this.current.clone();
  }

  replaceLiveLayers(layers: LayerState[]): void {
    this.current.layers = layers;
    this.normalizeSelection();
  }

  commit(stack: LayerStack): void {
    this.history.push(stack);
    this.current = stack.clone();
    this.normalizeSelection();
  }

  undo(): boolean {
    const previous = this.history.undo();
    if (!previous) return false;
    this.current = previous;
    this.normalizeSelection();
    return true;
  }

  redo(): boolean {
    const next = this.history.redo();
    if (!next) return false;
    this.current = next;
    this.normalizeSelection();
    return true;
  }

  canUndo(): boolean {
    return this.history.canUndo();
  }

  canRedo(): boolean {
    return this.history.canRedo();
  }

  private normalizeSelection(): void {
    if (this.selectedLayerId && !this.current.layers.some((layer) => layer.id === this.selectedLayerId)) {
      this.selectedLayerId = null;
    }
  }
}
