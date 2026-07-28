import { ChevronDown, ChevronRight, GripHorizontal } from "lucide-react";
import { IconButton } from "../ui/icon-button";
import "./DockedPanelCard.css";

export interface DockedPanelCardProps {
  title: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  children: React.ReactNode;
  /** Zone de CONTRÔLES FIXE : elle ne défile pas avec `children` (c'est le
   *  contenu qui porte le défilement). C'est ce qui permet aux contrôles de
   *  l'élément sélectionné de rester visibles quelle que soit la position dans
   *  une longue liste — modèle observé sur Photoshop web
   *  (`docs/design-system/photoshop-web-observations-2026-07-27.md` §5bis),
   *  formalisé par l'ADR-0001.
   *
   *  Ex-`header` : renommé le 2026-07-28 quand la zone a gagné le droit de
   *  vivre en PIED (voir `controlsPlacement`) — « en-tête » y devenait faux. */
  controls?: React.ReactNode;
  /** Où la zone de contrôles se pose. `"top"` (défaut) = entre la barre de
   *  titre et le contenu ; `"bottom"` = sous le contenu, en pied de carte.
   *  Seule la POSITION change : la zone reste fixe et hors du conteneur
   *  défilant dans les deux cas, ce que l'ADR-0001 exige. */
  controlsPlacement?: "top" | "bottom";
  className?: string;
  dragging?: boolean;
  titlebarProps?: React.HTMLAttributes<HTMLDivElement>;
}

/** Classes de la zone de contrôles pour un placement donné. Partagée avec le
 *  fantôme de glisser-déposer de `PanelColumn`, qui reconstruit la même carte à
 *  la main — deux listes de classes divergeraient. */
export function dockedPanelControlsClass(placement: "top" | "bottom" = "top"): string {
  return `docked-panel-card__controls docked-panel-card__controls--${placement}`;
}

export function DockedPanelCard({ title, collapsed, onCollapsedChange, children, controls, controlsPlacement = "top", className = "", dragging = false, titlebarProps }: DockedPanelCardProps) {
  const controlsNode = !collapsed && controls
    ? <div className={dockedPanelControlsClass(controlsPlacement)}>{controls}</div>
    : null;
  return (
    <div className={`docked-panel-card ${dragging ? "docked-panel-card--dragging" : ""} ${className}`.trim()}>
      <div className="docked-panel-card__titlebar" data-collapsed={collapsed || undefined} {...titlebarProps}>
        <span className="docked-panel-card__title">{title}</span>
        <GripHorizontal className="docked-panel-card__drag-grip icon-sm icon-stroke" aria-hidden="true" />
        <IconButton
          label={collapsed ? "Déplier le panneau" : "Replier le panneau"}
          size="compact"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onCollapsedChange(!collapsed);
          }}
        >
          {collapsed ? (
            <ChevronRight className="icon-sm icon-stroke" aria-hidden="true" />
          ) : (
            <ChevronDown className="icon-sm icon-stroke" aria-hidden="true" />
          )}
        </IconButton>
      </div>
      {controlsPlacement === "top" && controlsNode}
      {!collapsed && <div className="docked-panel-card__content scroll-thin">{children}</div>}
      {controlsPlacement === "bottom" && controlsNode}
    </div>
  );
}
