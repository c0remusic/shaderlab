import { toDisplayLayers } from "../layers/displayProjection";
import { History } from "../layers/history";
import { LayerStack } from "../layers/layerStack";
import type { LayerState } from "../layers/types";
import { composerCadre, type CanvasFrame, type CanvasFrameState } from "../layers/canvasFrame";

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

  /** Cadre visible de la toile, ou `null` si elle n'est pas recadrée. */
  cadreToile(): CanvasFrameState {
    return this.current.cadre;
  }

  /**
   * Recadre la toile. NON DESTRUCTIF (ticket 28) : aucun calque, aucun raster,
   * aucune transform n'est touché — seul le cadre change.
   *
   * `rect` est exprimé dans le cadre COURANT, pas dans l'espace d'origine : un
   * recadrage d'un recadrage part de ce qu'on voit, ce qui est le seul point de
   * vue que l'utilisateur ait.
   */
  recadrerToile(rect: CanvasFrame): void {
    this.current.cadre = composerCadre(this.current.cadre, rect);
  }

  /**
   * Rend la toile entière. C'est la promesse du non-destructif, et elle tient en
   * une ligne PARCE QUE rien n'a été découpé : il n'y a rien à reconstruire, ni
   * raster à recoller, ni transform à défaire. Le nombre de recadrages empilés
   * ne change rien au coût.
   */
  annulerRecadrage(): void {
    this.current.cadre = null;
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
