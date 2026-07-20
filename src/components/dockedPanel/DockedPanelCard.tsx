import { ChevronDown, ChevronRight } from "lucide-react";
import { IconButton } from "../../ui/IconButton";
import "./DockedPanelCard.css";

export interface DockedPanelCardProps {
  title: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  children: React.ReactNode;
  className?: string;
}

/**
 * Carte de panneau dockée, fixe (pas de drag, pas de magnétisme) — remplace
 * `FloatingPanel`. Position/taille sont pilotées par le parent (`PanelColumn`,
 * via `react-resizable-panels`) : ce composant ne connaît que son titre, son
 * état replié/déplié, et son contenu.
 */
export function DockedPanelCard({
  title,
  collapsed,
  onCollapsedChange,
  children,
  className = "",
}: DockedPanelCardProps) {
  return (
    <div className={`docked-panel-card ${className}`.trim()}>
      <div className="docked-panel-card__titlebar">
        <span className="docked-panel-card__title">{title}</span>
        <IconButton
          label={collapsed ? "Déplier le panneau" : "Replier le panneau"}
          size="compact"
          onClick={() => onCollapsedChange(!collapsed)}
        >
          {collapsed ? (
            <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" />
          ) : (
            <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />
          )}
        </IconButton>
      </div>
      {!collapsed && <div className="docked-panel-card__content">{children}</div>}
    </div>
  );
}
