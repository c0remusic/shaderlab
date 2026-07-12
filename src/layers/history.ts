import { LayerStack } from "./layerStack";

export class History {
  private past: LayerStack[] = [];
  private future: LayerStack[] = [];
  private current: LayerStack;

  constructor(initial: LayerStack) {
    this.current = initial;
  }

  push(state: LayerStack): void {
    this.past.push(this.current);
    this.current = state.clone();
    this.future = [];
  }

  undo(): LayerStack | null {
    const previous = this.past.pop();
    if (!previous) return null;
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
}
