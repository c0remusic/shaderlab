import { Group, Panel, Separator } from "react-resizable-panels";
import { DockedPanelCard } from "./DockedPanelCard";
import "./PanelColumn.css";

export interface PanelColumnProps {
  layersTitle: string;
  layersCollapsed: boolean;
  onLayersCollapsedChange: (collapsed: boolean) => void;
  layersContent: React.ReactNode;
  paramsTitle: string;
  paramsCollapsed: boolean;
  onParamsCollapsedChange: (collapsed: boolean) => void;
  paramsContent: React.ReactNode;
}

/**
 * Colonne dockée fixe à droite (Calques + Réglages), position posée UNE fois
 * en CSS (PanelColumn.css) — remplace le calcul de position JS de l'ancien
 * FloatingPanel/App.tsx. `react-resizable-panels` répartit la hauteur totale
 * disponible entre les deux cartes ; défaut 45/55, bornes 20%/80% pour
 * qu'aucune carte ne puisse être réduite à rien par le splitter (le repli
 * chevron reste le seul moyen de masquer le CONTENU d'une carte).
 *
 * Accessibilité clavier : vérifié sur pièce (bundle installé
 * node_modules/react-resizable-panels/dist/react-resizable-panels.js,
 * v4.12.2, pas juste la doc) que `Separator` (poignée de redimensionnement)
 * gère nativement ArrowUp/ArrowDown/ArrowLeft/ArrowRight/Home/End/Enter et
 * pose `tabIndex: 0` sur l'élément — aucun `onKeyDown`/`tabIndex` custom requis.
 *
 * Note API : le brief de départ nommait `PanelGroup`/`PanelResizeHandle`
 * (ancienne API v2/v3 du package) et `defaultSize`/`minSize`/`maxSize` en
 * nombres (pourcentage). La version réellement installée (4.12.2,
 * package.json) exporte `Group`/`Panel`/`Separator` (`orientation` au lieu
 * de `direction`), et interprète un `defaultSize`/`minSize`/`maxSize`
 * NUMÉRIQUE comme des PIXELS — un pourcentage doit être une string
 * (`"45"`, `"20"`, `"80"`) selon `react-resizable-panels.d.ts`. Adapté en
 * conséquence après vérification du `.d.ts` installé (pas deviné).
 */
export function PanelColumn({
  layersTitle,
  layersCollapsed,
  onLayersCollapsedChange,
  layersContent,
  paramsTitle,
  paramsCollapsed,
  onParamsCollapsedChange,
  paramsContent,
}: PanelColumnProps) {
  return (
    <div className="panel-column">
      <Group orientation="vertical" className="panel-column__group">
        <Panel defaultSize="45" minSize="20" maxSize="80" className="panel-column__pane">
          <DockedPanelCard
            title={layersTitle}
            collapsed={layersCollapsed}
            onCollapsedChange={onLayersCollapsedChange}
          >
            {layersContent}
          </DockedPanelCard>
        </Panel>
        <Separator className="panel-column__handle" aria-label="Redimensionner Calques et Réglages" />
        <Panel defaultSize="55" minSize="20" maxSize="80" className="panel-column__pane">
          <DockedPanelCard
            title={paramsTitle}
            collapsed={paramsCollapsed}
            onCollapsedChange={onParamsCollapsedChange}
          >
            {paramsContent}
          </DockedPanelCard>
        </Panel>
      </Group>
    </div>
  );
}
