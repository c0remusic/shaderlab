import { ChevronDown, ChevronRight, GripHorizontal } from "lucide-react";
import { IconButton } from "../ui/icon-button";
import "./DockedPanelCard.css";

/** Un onglet de la barre : ce qu'il faut pour le dessiner et le désigner. */
export interface DockedPanelTab {
  id: string;
  title: string;
}

export interface DockedPanelCardProps {
  /** Les onglets du GROUPE, dans leur ordre d'affichage. Un seul élément = une
   *  carte ordinaire, dont la barre porte simplement son titre.
   *
   *  MODÈLE PHOTOSHOP (2026-08-19) : un groupe montre ses panneaux en onglets,
   *  un seul visible, un clic pour passer à l'autre. Ce qui a fait choisir les
   *  onglets contre un repli — avec un onglet on VOIT que l'autre panneau
   *  existe et il est à un clic ; un repli le cache et en demande deux. Voir
   *  `ui/dockLayout.ts` pour le modèle et la mesure qui l'a motivé. */
  tabs: DockedPanelTab[];
  /** Onglet dont le contenu se rend. Doit être un `id` de `tabs`. */
  activeTab: string;
  onActiveTabChange: (id: string) => void;
  /** Le GROUPE est replié : seule la barre d'onglets se rend. */
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
  /** Appui sur un onglet — ouvre le glissement de CE panneau, pas du groupe.
   *  C'est ce qui permet de sortir un onglet de son groupe en le tirant, geste
   *  exact de Photoshop (« drag the panel by its tab outside the group »). */
  tabPointerDown?: (id: string, event: React.PointerEvent<HTMLElement>) => void;
}

/** Classes de la zone de contrôles pour un placement donné. Partagée avec le
 *  fantôme de glisser-déposer de `PanelColumn`, qui reconstruit la même carte à
 *  la main — deux listes de classes divergeraient. */
export function dockedPanelControlsClass(placement: "top" | "bottom" = "top"): string {
  return `docked-panel-card__controls docked-panel-card__controls--${placement}`;
}

export function DockedPanelCard({
  tabs,
  activeTab,
  onActiveTabChange,
  collapsed,
  onCollapsedChange,
  children,
  controls,
  controlsPlacement = "top",
  className = "",
  dragging = false,
  tabPointerDown,
}: DockedPanelCardProps) {
  const controlsNode = !collapsed && controls
    ? <div className={dockedPanelControlsClass(controlsPlacement)}>{controls}</div>
    : null;
  const groupe = tabs.length > 1;
  return (
    <div className={`docked-panel-card ${dragging ? "docked-panel-card--dragging" : ""} ${className}`.trim()}>
      {/* Toute la RANGÉE d'en-tête est une prise de glissement, poignée ⋮⋮
          comprise — pas seulement le mot du titre (23 px sur « Pile », et la
          poignée décorative promettait un geste qu'elle ne portait pas ;
          constat d'usage d'Antoine, 2026-09-12 : « les menus ne sont plus
          déplaçables »). Les contrôles interactifs (onglets, repli) posent
          leur propre onPointerDown et stopPropagation en dessous ; la rangée
          n'attrape que ce qui n'est pas déjà une commande, et vise l'onglet
          ACTIF — tirer le fond d'un groupe déplace le panneau visible. */}
      <div
        className="docked-panel-card__titlebar"
        data-collapsed={collapsed || undefined}
        data-grouped={groupe || undefined}
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button") && groupe) return;
          tabPointerDown?.(activeTab, event);
        }}
      >
        {/* `role="tablist"` seulement quand il Y A plusieurs onglets : un
            tablist d'un seul onglet annonce une navigation qui n'existe pas,
            et un lecteur d'écran l'énoncerait « onglet 1 sur 1 » à chaque
            carte du dock. À un seul, la barre reste un simple titre. */}
        <div
          className="docked-panel-card__tabs"
          role={groupe ? "tablist" : undefined}
          aria-label={groupe ? "Panneaux du groupe" : undefined}
        >
          {tabs.map((tab) => {
            const actif = tab.id === activeTab;
            return groupe ? (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={actif}
                className="docked-panel-card__tab"
                data-active={actif || undefined}
                onPointerDown={(event) => tabPointerDown?.(tab.id, event)}
                onClick={() => onActiveTabChange(tab.id)}
              >
                {tab.title}
              </button>
            ) : (
              <span
                key={tab.id}
                className="docked-panel-card__title"
                onPointerDown={(event) => tabPointerDown?.(tab.id, event)}
              >
                {tab.title}
              </span>
            );
          })}
        </div>
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
