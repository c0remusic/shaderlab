import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { DockedPanelCard } from "./DockedPanelCard";
import { getDockDropTarget, isNoOpDockDrop, resolveDockDragCommit, type DockDropTarget, type DockLayout } from "../../ui/dockLayout";
import { clampDockWidth, DOCK_WIDTH_MIN, DOCK_WIDTH_MAX } from "./dockWidth";
import "../../ui/dragReorder.css";
import "./PanelColumn.css";

export interface DockedPanelSpec {
  id: string;
  title: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  content: React.ReactNode;
  /** Optionnel : zone fixe (non défilante) de la carte, voir
   *  `DockedPanelCardProps.header`. */
  header?: React.ReactNode;
  /** Le contenu de ce panneau est une LISTE de longueur variable (calques,
   *  sources de masque, presets) — donc la seule carte de la colonne qui
   *  absorbe la compression quand la place manque. Drapeau EXPLICITE et non
   *  heuristique : c'est le panneau lui-même qui sait si son contenu peut
   *  s'allonger sans fin, aucune mesure ne le devine de façon fiable (une
   *  carte à contenu fixe peut être temporairement plus haute qu'une liste
   *  courte).
   *  Défaut `false` = hauteur naturelle conservée, jamais comprimée : c'est le
   *  modèle observé sur Photoshop web (docs/design-system/
   *  photoshop-web-observations-2026-07-27.md §5bis) — les panneaux du dessous
   *  restent à leur place, c'est la liste longue qui défile chez elle. */
  variableLength?: boolean;
}

export interface PanelColumnProps {
  panels: DockedPanelSpec[];
  layout: DockLayout;
  onMove: (id: string, target: DockDropTarget) => void;
  width: number;
  onWidthChange: (width: number) => void;
}

interface DockDragState {
  draggedId: string;
  pointerId: number;
  grabOffset: { x: number; y: number };
  pointerPosition: { x: number; y: number };
  target: DockDropTarget | null;
  targetBounds: { top: number; right: number; bottom: number; left: number } | null;
  /** Origine (coin haut-gauche, coords viewport) du conteneur `.panel-column`,
   *  lue DANS le handler pointermove en même temps que `targetBounds` — le
   *  guide d'alignement est positionné en absolu dans ce conteneur, donc il
   *  faut soustraire cette origine. Lire le DOM pendant le render (React peut
   *  rejouer cette phase) est interdit ; capturer les deux rects au même
   *  instant est en prime plus cohérent que de les lire à deux moments. */
  dockOrigin: { left: number; top: number } | null;
}

export function PanelColumn({ panels, layout, onMove, width, onWidthChange }: PanelColumnProps) {
  const [dragState, setDragStateRaw] = useState<DockDragState | null>(null);
  // Miroir de `dragState` tenu à jour de façon SYNCHRONE par le setter
  // fonctionnel ci-dessous, lu par `finishDrag` au relâchement/annulation —
  // évite de commiter une cible de drop périmée si un pointerup arrive avant
  // que le render déclenché par le dernier pointermove n'ait mis à jour la
  // fermeture de `finishDrag` (voir resolveDockDragCommit, ui/dockLayout.ts).
  const dragStateRef = useRef<DockDragState | null>(null);
  const dockRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const setDragState = useCallback((updater: DockDragState | null | ((current: DockDragState | null) => DockDragState | null)) => {
    setDragStateRaw((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      dragStateRef.current = next;
      return next;
    });
  }, []);
  const draggedPanel = dragState ? panels.find((panel) => panel.id === dragState.draggedId) : null;

  // PLANCHER DE COMPRESSION (2026-07-27) — publie sur chaque .panel-column__item
  // les deux hauteurs que CSS ne sait pas calculer seul (voir le commentaire
  // de PanelColumn.css § PLANCHER) :
  //   --dock-card-chrome-height  = barre de titre + en-tête (incompressibles)
  //   --dock-card-content-height = hauteur NATURELLE du contenu (scrollHeight,
  //                                donc indépendante de la compression en cours)
  // La règle CSS en fait `chrome + min(contenu naturel, plancher)` : une carte
  // ne peut jamais être écrasée sous son chrome, ni gonflée par le plancher si
  // son contenu est plus court que lui.
  const cardShape = `${layout.map((column) => column.join(">")).join("|")}#${panels
    .map((panel) => `${panel.id}:${panel.collapsed ? "c" : "o"}`)
    .join(",")}`;
  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const items = Array.from(grid.querySelectorAll<HTMLElement>(".panel-column__item"));
    const setVar = (element: HTMLElement, name: string, px: number) => {
      const next = `${Math.ceil(px)}px`;
      // Écriture conditionnelle : une écriture inconditionnelle relance le
      // ResizeObserver à chaque passe et boucle.
      if (element.style.getPropertyValue(name) !== next) element.style.setProperty(name, next);
    };
    const measure = () => {
      for (const item of items) {
        const titlebar = item.querySelector<HTMLElement>(".docked-panel-card__titlebar");
        const header = item.querySelector<HTMLElement>(".docked-panel-card__header");
        const content = item.querySelector<HTMLElement>(".docked-panel-card__content");
        // Carte repliée : pas de contenu, donc rien à comprimer — pas de
        // plancher, sinon la carte repliée serait gonflée à la hauteur d'une
        // ligne fantôme.
        if (!titlebar || !content) {
          item.style.removeProperty("--dock-card-chrome-height");
          item.style.removeProperty("--dock-card-content-height");
          continue;
        }
        setVar(item, "--dock-card-chrome-height", titlebar.offsetHeight + (header?.offsetHeight ?? 0));
        setVar(item, "--dock-card-content-height", content.scrollHeight);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const item of items) {
      for (const part of item.querySelectorAll(".docked-panel-card__titlebar, .docked-panel-card__header, .docked-panel-card__content")) {
        observer.observe(part);
        // Le contenu COMPRIMÉ garde une boîte de taille constante quand sa
        // liste s'allonge : seul son enfant grandit. Sans l'observer, la
        // hauteur naturelle publiée resterait celle d'avant l'ajout.
        if (part.firstElementChild) observer.observe(part.firstElementChild);
      }
    }
    return () => observer.disconnect();
  }, [cardShape]);

  // Redimensionnement en largeur — poignée sur le bord GAUCHE de TOUT le
  // conteneur .panel-column (toutes colonnes confondues, décision Antoine
  // 2026-07-21 : largeur globale partagée, pas de redimensionnement par
  // colonne indépendant). La colonne est ancrée à droite (right: var(--space-6)),
  // donc glisser vers la GAUCHE agrandit la largeur, vers la DROITE la réduit —
  // pas de magnétisme, juste un clamp aux bornes. État de drag en ref (pas
  // besoin de re-render pendant le geste : la largeur elle-même vit dans
  // App.tsx via onWidthChange, appelé à chaque pointermove).
  const widthDragRef = useRef<{ pointerId: number; startClientX: number; startWidth: number } | null>(null);

  const handleWidthPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      widthDragRef.current = { pointerId: e.pointerId, startClientX: e.clientX, startWidth: width };
    },
    [width]
  );

  const handleWidthPointerMove = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const drag = widthDragRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      const delta = e.clientX - drag.startClientX;
      onWidthChange(clampDockWidth(drag.startWidth - delta));
    },
    [onWidthChange]
  );

  const handleWidthPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = widthDragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    widthDragRef.current = null;
  }, []);

  const handleWidthPointerCancel = handleWidthPointerUp;

  const handlePointerDown = useCallback((id: string, event: React.PointerEvent<HTMLDivElement>) => {
    const card = event.currentTarget.closest<HTMLElement>(".panel-column__item");
    if (!card) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = card.getBoundingClientRect();
    setDragState((current) => current ?? {
      draggedId: id,
      pointerId: event.pointerId,
      grabOffset: { x: event.clientX - rect.left, y: event.clientY - rect.top },
      pointerPosition: { x: event.clientX, y: event.clientY },
      target: null,
      targetBounds: null,
      dockOrigin: null,
    });
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    setDragState((current) => {
      if (!current || event.pointerId !== current.pointerId) return current;
      const card = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-dock-column]");
      const pointerPosition = { x: event.clientX, y: event.clientY };
      if (!card) return { ...current, pointerPosition, target: null, targetBounds: null, dockOrigin: null };

      const columnIndex = Number(card.dataset.dockColumn);
      const rowIndex = Number(card.dataset.dockRow);
      const rect = card.getBoundingClientRect();
      const relativeX = (event.clientX - rect.left) / rect.width;
      const target = getDockDropTarget(
        columnIndex,
        rowIndex,
        relativeX,
        (event.clientY - rect.top) / rect.height,
        columnIndex === layout.length - 1,
      );
      if (isNoOpDockDrop(layout, current.draggedId, target)) return { ...current, pointerPosition, target: null, targetBounds: null, dockOrigin: null };
      const dockRect = dockRef.current?.getBoundingClientRect();
      const dockOrigin = dockRect ? { left: dockRect.left, top: dockRect.top } : null;
      return { ...current, pointerPosition, target, targetBounds: rect, dockOrigin };
    });
  }, [layout]);

  const finishDrag = useCallback((event: React.PointerEvent<HTMLDivElement>, commit: boolean) => {
    const resolved = resolveDockDragCommit(dragStateRef.current, event.pointerId, commit);
    if (resolved) onMove(resolved.draggedId, resolved.target);
    setDragState(null);
  }, [onMove, setDragState]);

  let guideStyle: React.CSSProperties | null = null;
  let guideClassName = "drag-reorder__alignment-guide";
  // Calcul PUR (aucune lecture du DOM ici) : les deux rects nécessaires
  // — `targetBounds` et `dockOrigin` — ont été capturés dans handlePointerMove.
  if (dragState?.target && dragState.targetBounds && dragState.dockOrigin) {
    const dockOrigin = dragState.dockOrigin;
    if (dragState.target.kind === "vertical") {
      guideStyle = {
        left: (dragState.targetBounds.left + dragState.targetBounds.right) / 2 - dockOrigin.left,
        top: (dragState.target.position === "before" ? dragState.targetBounds.top : dragState.targetBounds.bottom) - dockOrigin.top,
        width: dragState.targetBounds.right - dragState.targetBounds.left,
      };
    } else {
      guideClassName += " panel-column__alignment-guide--vertical";
      guideStyle = {
        left: (dragState.target.position === "left" ? dragState.targetBounds.left : dragState.targetBounds.right) - dockOrigin.left,
        top: (dragState.targetBounds.top + dragState.targetBounds.bottom) / 2 - dockOrigin.top,
        height: dragState.targetBounds.bottom - dragState.targetBounds.top,
      };
    }
  }

  return (
    <div
      ref={dockRef}
      className="panel-column"
      onPointerMove={dragState ? handlePointerMove : undefined}
      onPointerUp={dragState ? (event) => finishDrag(event, true) : undefined}
      onPointerCancel={dragState ? (event) => finishDrag(event, false) : undefined}
    >
      <div className="panel-column__grid scroll-thin">
        {layout.map((column, columnIndex) => (
          <div className="panel-column__stack" key={column.join("-")}>
            {columnIndex === 0 && (
              <div
                className="panel-column__width-handle"
                onPointerDown={handleWidthPointerDown}
                onPointerMove={handleWidthPointerMove}
                onPointerUp={handleWidthPointerUp}
                onPointerCancel={handleWidthPointerCancel}
                role="separator"
                aria-orientation="vertical"
                aria-label="Redimensionner la largeur du dock"
                aria-valuenow={Math.round(clampDockWidth(width))}
                aria-valuemin={DOCK_WIDTH_MIN}
                aria-valuemax={DOCK_WIDTH_MAX}
                tabIndex={0}
              />
            )}
            {column.map((id, rowIndex) => {
              const panel = panels.find((candidate) => candidate.id === id);
              if (!panel) return null;
              return (
                <div
                  className="panel-column__item"
                  data-dock-column={columnIndex}
                  data-dock-row={rowIndex}
                  data-variable-length={panel.variableLength || undefined}
                  key={panel.id}
                >
                  <DockedPanelCard
                    title={panel.title}
                    collapsed={panel.collapsed}
                    onCollapsedChange={panel.onCollapsedChange}
                    header={panel.header}
                    dragging={dragState?.draggedId === panel.id}
                    titlebarProps={{ onPointerDown: (event) => handlePointerDown(panel.id, event) }}
                  >
                    {panel.content}
                  </DockedPanelCard>
                </div>
              );
            })}
          </div>
        ))}
      </div>
      {guideStyle && <div className={guideClassName} style={guideStyle} aria-hidden="true" />}
      {dragState && draggedPanel && (
        <div
          className="panel-column__ghost"
          style={{ transform: `translate(${dragState.pointerPosition.x - dragState.grabOffset.x}px, ${dragState.pointerPosition.y - dragState.grabOffset.y}px)` }}
          aria-hidden="true"
        >
          <div className="docked-panel-card">
            <div className="docked-panel-card__titlebar"><span className="docked-panel-card__title">{draggedPanel.title}</span></div>
            {!draggedPanel.collapsed && draggedPanel.header && <div className="docked-panel-card__header">{draggedPanel.header}</div>}
            {!draggedPanel.collapsed && <div className="docked-panel-card__content">{draggedPanel.content}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
