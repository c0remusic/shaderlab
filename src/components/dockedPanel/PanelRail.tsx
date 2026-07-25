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
 *  open" behavior `useContextualPanel.toggleRail` provides. */
export function PanelRail({ items }: PanelRailProps) {
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
}
