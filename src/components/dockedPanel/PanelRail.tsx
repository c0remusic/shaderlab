import { memo } from "react";
import { IconButton } from "../ui/icon-button";
import "./PanelRail.css";

export interface PanelRailItem {
  id: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
  label: string;
  active: boolean;
  onClick: () => void;
}

export interface PanelRailProps {
  items: PanelRailItem[];
}

/** Fixed column of toggle icons next to the dock (Photoshop-style rail) —
 *  every item stays clickable regardless of `active`/condition state; a
 *  disabled-looking rail item would contradict the "force the empty state
 *  open" behavior `useContextualPanel.toggleRail` provides.
 *
 *  MÉMOÏSÉ (2026-07-30, profil CPU) : le rail ne dépend que de la visibilité
 *  des panneaux, qui ne change jamais pendant un geste — il se rendait pourtant
 *  à chaque `pointermove`, avec ses cinq `IconButton` et leurs infobulles (5 ×
 *  31 rendus pour 30 échantillons de souris). Ne tient que si `App` passe un
 *  tableau `items` d'identité stable (`useMemo`) : un littéral recréé à chaque
 *  rendu annulerait la mémoïsation en silence. */
export const PanelRail = memo(function PanelRail({ items }: PanelRailProps) {
  return (
    <div className="panel-rail" role="toolbar" aria-orientation="vertical" aria-label="Panneaux">
      {items.map(({ id, icon: Icon, label, active, onClick }) => (
        <IconButton
          key={id}
          label={label}
          size="default"
          onClick={onClick}
          className={active ? "panel-rail__item panel-rail__item--active" : "panel-rail__item"}
          aria-pressed={active}
        >
          <Icon className="icon-lg icon-stroke" aria-hidden />
        </IconButton>
      ))}
    </div>
  );
});
