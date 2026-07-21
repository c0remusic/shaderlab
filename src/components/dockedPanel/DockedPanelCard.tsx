import { ChevronDown, ChevronRight } from "lucide-react";
import { IconButton } from "../../ui/IconButton";
import "./DockedPanelCard.css";

export interface DockedPanelCardProps {
  title: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  children: React.ReactNode;
  className?: string;
  reorderIndex: number;
  dragging?: boolean;
  titlebarProps?: React.HTMLAttributes<HTMLDivElement>;
}

export function DockedPanelCard({ title, collapsed, onCollapsedChange, children, className = "", reorderIndex, dragging = false, titlebarProps }: DockedPanelCardProps) {
  return (
    <div className={`docked-panel-card ${dragging ? "docked-panel-card--dragging" : ""} ${className}`.trim()} data-reorder-index={reorderIndex}>
      <div className="docked-panel-card__titlebar" data-collapsed={collapsed || undefined} {...titlebarProps}>
        <span className="docked-panel-card__title">{title}</span>
        <span className="docked-panel-card__drag-grip" aria-hidden="true" />
        <IconButton
          label={collapsed ? "Déplier le panneau" : "Replier le panneau"}
          size="compact"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onCollapsedChange(!collapsed);
          }}
        >
          {collapsed ? <ChevronRight size={14} strokeWidth={1.5} aria-hidden="true" /> : <ChevronDown size={14} strokeWidth={1.5} aria-hidden="true" />}
        </IconButton>
      </div>
      {!collapsed && <div className="docked-panel-card__content">{children}</div>}
    </div>
  );
}
