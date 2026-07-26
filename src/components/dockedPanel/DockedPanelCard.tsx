import { ChevronDown, ChevronRight, GripHorizontal } from "lucide-react";
import { IconButton } from "../ui/icon-button";
import "./DockedPanelCard.css";

export interface DockedPanelCardProps {
  title: string;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  children: React.ReactNode;
  className?: string;
  dragging?: boolean;
  titlebarProps?: React.HTMLAttributes<HTMLDivElement>;
}

export function DockedPanelCard({ title, collapsed, onCollapsedChange, children, className = "", dragging = false, titlebarProps }: DockedPanelCardProps) {
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
      {!collapsed && <div className="docked-panel-card__content">{children}</div>}
    </div>
  );
}
