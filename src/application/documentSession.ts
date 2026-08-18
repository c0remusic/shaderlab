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

  /**
   * Remplace les calques SANS entrée d'historique — le chemin de tout geste
   * vivant (glissement de poignée, de curseur, coup de pinceau).
   *
   * ⚠️ C'EST LA SEULE PORTE QUE LES GARDES DE `LayerStack` NE COUVRENT PAS, et
   * le verrou fuyait par là. `LayerStack` refuse quatorze opérations sur un
   * calque verrouillé, chacune derrière `isLocked`, et un test les couvre une
   * par une — mais **aucun geste à la souris ne passe par ces mutateurs**.
   * Pendant un glissement, `App.tsx` construit le tableau à la main et appelle
   * cette méthode, délibérément et pour une raison mesurée : `clone()` fabrique
   * un objet frais pour chaque calque, ce qui re-rend la liste entière à chaque
   * frame (34,2 ms de CPU par `pointermove`, 2026-07-30).
   *
   * Le commit ne rattrapait rien : `handleParamCommit` commite `currentStack()`,
   * c'est-à-dire l'état vivant DÉJÀ modifié.
   *
   * ── CE QUE LE FILTRE LAISSE PASSER, ET POURQUOI ─────────────────────────
   *
   * Il ne refuse pas l'envoi, il retient le CONTENU d'un calque verrouillé.
   * Refuser l'envoi entier figerait le document dès qu'un seul calque est
   * verrouillé, alors que le tableau vivant les porte tous à chaque frame.
   *
   * Trois choses restent autorisées, exactement comme dans `LayerStack` :
   * - le DÉVERROUILLAGE, sinon le verrou serait irréversible ;
   * - la VISIBILITÉ — masquer n'est pas modifier, c'est un confort de lecture
   *   de la pile, et le verrouiller rendrait le verrou hostile ;
   * - l'arrivée et le départ d'un calque : le verrou porte sur le CONTENU d'un
   *   calque, pas sur la composition de la pile.
   */
  replaceLiveLayers(layers: LayerState[]): void {
    const verrouilles = new Map(
      this.current.layers.filter((layer) => layer.locked).map((layer) => [layer.id, layer]),
    );
    this.current.layers = verrouilles.size === 0
      ? layers
      : layers.map((entrant) => {
          const verrouille = verrouilles.get(entrant.id);
          if (!verrouille) return entrant;
          // Le calque D'AVANT, plus les deux champs dont le verrou ne décide
          // pas. Reconstruire depuis l'entrant laisserait passer tout le reste.
          return { ...verrouille, locked: entrant.locked, enabled: entrant.enabled };
        });
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
