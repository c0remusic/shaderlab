import { ChevronDown, ChevronRight } from "lucide-react";
import { IconButton } from "../../ui/IconButton";
import "./FloatingPanel.css";

export interface FloatingPanelProps {
  title: string;
  position: { x: number; y: number };
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  children: React.ReactNode;
}

/**
 * Conteneur générique flottant — Calques/Réglages aujourd'hui, Masques
 * (Tranche 4 du chantier calques/masquage) demain. Position et repli sont
 * TOUJOURS remontés à l'appelant (App.tsx) : ce composant ne possède aucun
 * state de position persistant, même philosophie que LayerPanel/ParamPanel
 * (state remonté, composants de présentation purs).
 *
 * Repli/dépli INSTANTANÉ, sans transition (design.md §6, observé sur
 * Photoshop réel) : le contenu est démonté/remonté (`collapsed && null`),
 * jamais une hauteur animée.
 */
export function FloatingPanel({ title, position, collapsed, onCollapsedChange, children }: FloatingPanelProps) {
  return (
    <div
      className="floating-panel"
      style={{ transform: `translate(${position.x}px, ${position.y}px)` }}
    >
      <div className="floating-panel__titlebar">
        <span className="floating-panel__title">{title}</span>
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
      {!collapsed && <div className="floating-panel__content">{children}</div>}
    </div>
  );
}
