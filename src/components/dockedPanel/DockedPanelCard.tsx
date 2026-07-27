import { ChevronDown, ChevronRight, GripHorizontal } from "lucide-react";
import { IconButton } from "../ui/icon-button";
import "./DockedPanelCard.css";

export interface DockedPanelCardProps {
  title: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  children: React.ReactNode;
  /** Zone FIXE entre la barre de titre et le contenu : elle ne défile pas avec
   *  `children` (c'est le contenu qui porte le défilement). C'est ce qui permet
   *  aux contrôles du calque sélectionné de rester visibles quelle que soit la
   *  position dans une longue pile — modèle observé sur Photoshop web
   *  (`docs/design-system/photoshop-web-observations-2026-07-27.md` §5bis). */
  header?: React.ReactNode;
  className?: string;
  dragging?: boolean;
  titlebarProps?: React.HTMLAttributes<HTMLDivElement>;
}

export function DockedPanelCard({ title, collapsed, onCollapsedChange, children, header, className = "", dragging = false, titlebarProps }: DockedPanelCardProps) {
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
      {!collapsed && header && <div className="docked-panel-card__header">{header}</div>}
      {!collapsed && <div className="docked-panel-card__content">{children}</div>}
    </div>
  );
}
