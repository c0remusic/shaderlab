import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { PanelColumn, type DockedPanelSpec } from "./PanelColumn";
import type { DockLayout } from "../../ui/dockLayout";
// La garde de densité ci-dessous mesure la carte Effets REELLE (liste de
// calques + zone de contrôles en pied) : un contenu factice n'aurait ni la même
// hauteur de chrome ni la même géométrie de ligne, donc ne prouverait rien.
import { LayerControls, LayerPanel } from "../LayerPanel";
import { defaultLayerMask } from "../../mask/types";
import type { LayerState } from "../../layers/types";

function makeStoryLayer(overrides: Partial<LayerState>): LayerState {
  return {
    id: "layer",
    effectId: "glow",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
    ...overrides,
  };
}

const layout: DockLayout = [["layers", "properties"]];

const panels: DockedPanelSpec[] = [
  { id: "layers", title: "Pile", collapsed: false, onCollapsedChange: () => {}, content: <p style={{ margin: 0 }}>Structure du document.</p> },
  { id: "properties", title: "Propriétés · Glow", collapsed: false, onCollapsedChange: () => {}, content: <p style={{ margin: 0 }}>Effet ou masque de la cible.</p> },
];

const meta: Meta<typeof PanelColumn> = {
  title: "Components/DockedPanel/PanelColumn",
  component: PanelColumn,
  args: {
    panels,
    layout,
    onMove: () => {},
    width: 320,
    onWidthChange: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof PanelColumn>;

export const Default: Story = {};

export const SingleColumn: Story = {
  args: { layout: [["layers", "properties"]] },
};

// --- State variants ---

export const AllCollapsed: Story = {
  args: {
    panels: panels.map((p) => ({ ...p, collapsed: true })),
  },
};

export const AllExpanded: Story = {
  args: {
    panels: panels.map((p) => ({ ...p, collapsed: false })),
  },
};

export const SinglePanel: Story = {
  args: {
    panels: [panels[0]],
    layout: [["layers"]],
  },
};

export const Narrow: Story = {
  args: { width: 220 },
};

// --- Plancher de compression ---

// GARDE ANTI-RÉCIDIVE (2026-07-28). Le plancher de compression existait depuis
// `5a77077` mais n'a JAMAIS atteint le DOM pendant trois commits : `gridRef`
// n'était attaché à aucun élément, donc le `useLayoutEffect` sortait à son
// premier `if (!grid) return`, aucune des trois variables CSS n'était publiée,
// et `min-height` retombait sur des valeurs de repli à 0px. Rien dans la suite
// de tests ne pouvait le voir — la convention du projet interdit de rendre un
// composant React en Vitest, et le défaut n'est observable qu'au niveau du
// style CALCULÉ, après montage. C'est donc ici, et nulle part ailleurs, que ça
// se vérifie.
export const ListCardHasCompressionFloor: Story = {
  args: {
    layout: [["layers"]],
    panels: [
      {
        id: "layers",
        title: "Pile",
        collapsed: false,
        onCollapsedChange: () => {},
        variableLength: true,
        content: (
          <ul data-dock-list="" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {["Glow", "Grain", "Warp"].map((name) => (
              <li key={name} style={{ height: 44 }}>
                {name}
              </li>
            ))}
          </ul>
        ),
      },
    ],
  },
  play: async ({ canvasElement }) => {
    const item = canvasElement.querySelector<HTMLElement>(".panel-column__item");
    await expect(item).not.toBeNull();
    // La valeur exacte dépend des tokens et de la hauteur de ligne mesurée ;
    // ce qui se verrouille ici est qu'un plancher EXISTE. `0px` = les variables
    // n'ont pas atteint le DOM, la carte peut être écrasée jusqu'à disparaître.
    await expect(getComputedStyle(item!).minHeight).not.toBe("0px");
  },
};

// GARDE ANTI-RÉCIDIVE (2026-07-28) — le DOCUMENT MINIMAL À DEUX PHOTOS tient
// sans qu'aucune ligne ne se cache.
//
// Cinq lignes : arrière-plan · Glow · Grain · une photo importée · un effet
// écrêté sur elle. C'est le plus petit
// document réel comportant deux photos. Mesuré sur la vraie fenêtre puis
// reproduit ici au byte près : carte Effets gelée à 456px — exactement son
// plancher à 4 lignes — et `.docked-panel-card__content` débordant de 60px,
// soit une ligne (52) plus sa gouttière (8). La 5e ligne était hors champ.
//
// Ce qui est verrouillé ici, et que rien d'autre ne peut voir (les lignes sont
// conformes une par une, c'est leur SOMME face à la hauteur allouée qui
// fautait) :
//   1. les 5 lignes sont entièrement dans la zone défilante de la carte ;
//   2. cette zone ne déborde pas ;
//   3. c'est bien la CARTE qui borne, pas la colonne — la grille ne défile pas
//      (corollaire indissociable de l'ADR-0001) ;
//   4. une ligne fait au plus 56px hors sélection (checklist ADR-0001, point 3) ;
//   5. un nom de fichier long s'ELLIPSE au lieu d'élargir la colonne, ET il lui
//      reste assez de largeur pour être lu (ajouté le 2026-07-29 : c'est la
//      mesure qui manquait quand le nom est tombé à 52 px).
//
// La hauteur de fenêtre est SIMULÉE (surcharge de `max-height` sur la grille) :
// le runner de stories a son propre viewport, et cette garde doit mesurer la
// répartition de hauteur, pas la taille de la fenêtre du runner.
const DOCK_VIEWPORT_HEIGHT = 1377;
const DOCK_VIEWPORT_MARGIN = 32;
/** Hauteurs de contenu des quatre autres cartes, relevées sur la vraie fenêtre
 *  (mesure CDP du 2026-07-27 reprise dans l'ADR-0001). Elles ne sont pas du
 *  décor : sans elles la colonne n'est pas en déficit, aucune carte n'est
 *  comprimée, et la garde ne garderait rien. */
const OTHER_PANEL_CONTENT_HEIGHTS = { presets: 88, properties: 334 };

const fillerPanel = (id: string, title: string, height: number, variableLength = false): DockedPanelSpec => ({
  id,
  title,
  collapsed: false,
  onCollapsedChange: () => {},
  variableLength,
  content: <div style={{ height }} />,
});

const twoPhotoDocument: LayerState[] = [
  // La photo de FOND est un calque depuis la tranche T1 (design 2026-07-28) :
  // elle occupe une VRAIE ligne de la liste, là où elle était une ligne dérivée
  // rendue à part. Le document reste donc à cinq lignes, ce que garde le nom de
  // cette story.
  makeStoryLayer({
    id: "background",
    effectId: "passthrough",
    name: "DSCF5160.JPG",
    imageSource: { sourceId: "s0" },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  }),
  makeStoryLayer({ id: "glow", effectId: "glow" }),
  makeStoryLayer({ id: "grain", effectId: "grain" }),
  makeStoryLayer({
    id: "photo",
    effectId: "passthrough",
    // Nom LONG à dessein : c'est le cas rapporté (« DSCF5160-edited.JPG »
    // collait le pourcentage), reproduit à la largeur de dock par défaut. Un
    // nom court laisserait de la marge et la garde ne garderait rien.
    name: "DSCF5160-edited-panorama-final.JPG",
    imageSource: { sourceId: "s1" },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  }),
  makeStoryLayer({ id: "bleed", effectId: "lensDistortion", clipToBelow: true }),
];

export const FiveRowDocumentHidesNoRow: Story = {
  render: () => (
    <div className="sb-dock-viewport" style={{ position: "relative", height: DOCK_VIEWPORT_HEIGHT }}>
      <style>{`.sb-dock-viewport .panel-column__grid { max-height: ${DOCK_VIEWPORT_HEIGHT - DOCK_VIEWPORT_MARGIN}px; }`}</style>
      <PanelColumn
        layout={[["presets", "layers", "properties"]]}
        onMove={() => {}}
        width={320}
        onWidthChange={() => {}}
        panels={[
          fillerPanel("presets", "Presets", OTHER_PANEL_CONTENT_HEIGHTS.presets, true),
          {
            id: "layers",
            title: "Pile",
            collapsed: false,
            onCollapsedChange: () => {},
            variableLength: true,
            controlsPlacement: "bottom",
            controls: (
              <LayerControls
                layers={twoPhotoDocument}
                selectedId="bleed"
                onOpacityChange={() => {}}
                onOpacityCommit={() => {}}
                onBlendModeChange={() => {}}
                onEffectChange={() => {}}
                onToggleLock={() => {}}
                onDuplicate={() => {}}
                onRemove={() => {}}
              />
            ),
            content: (
              <LayerPanel
                layers={twoPhotoDocument}
                selectedId="bleed"
                hasImage
                onSelect={() => {}}
                onToggle={() => {}}
                onAdd={() => {}}
                onReorder={() => {}}
              />
            ),
          },
          fillerPanel("properties", "Propriétés · Lens distortion", OTHER_PANEL_CONTENT_HEIGHTS.properties),
        ]}
      />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const grid = canvasElement.querySelector<HTMLElement>(".panel-column__grid")!;
    const card = canvasElement.querySelectorAll<HTMLElement>(".panel-column__item")[1]
      .querySelector<HTMLElement>(".docked-panel-card")!;
    const content = card.querySelector<HTMLElement>(".docked-panel-card__content")!;
    const rows = Array.from(content.querySelectorAll<HTMLElement>(".layer-panel__row"));

    // Le document mesuré : 5 lignes. Sous la règle de PROXIMITÉ (2026-07-29),
    // TROIS sont imbriquées — Glow et Grain sous le FOND du document (aucun
    // calque photo n'est appliqué avant eux), l'écrêté sous la photo importée.
    // Seuls l'arrière-plan et la photo importée sont racine. C'est exactement
    // le document sur lequel Antoine a constaté qu'une seule ligne sur quatre
    // était indentée : cette assertion est ce qui l'empêche de revenir.
    await expect(rows).toHaveLength(5);
    await expect(rows.map((row) => row.classList.contains("layer-panel__row--nested"))).toEqual([
      false, true, true, false, true,
    ]);

    // 1+2. Aucune ligne hors champ, et la zone défilante ne déborde pas.
    const contentBottom = content.getBoundingClientRect().bottom;
    await expect(rows.map((row) => row.getBoundingClientRect().bottom <= contentBottom + 0.5)).toEqual([
      true, true, true, true, true,
    ]);
    await expect(content.scrollHeight).toBeLessThanOrEqual(content.clientHeight);

    // 3. La colonne ne défile pas : c'est la carte qui borne (ADR-0001).
    await expect(grid.scrollHeight).toBeLessThanOrEqual(grid.clientHeight);

    // 4. Densité de ligne (checklist ADR-0001, point 3). Le budget est SERRÉ :
    // 2 px de trop par ligne suffisent à renvoyer la cinquième hors champ — la
    // ligne d'arrière-plan les a réellement pris le 2026-07-29 en repliant sa
    // grille sur deux rangées (voir `.layer-panel__row-main > *`,
    // LayerPanel.css). Cette assertion-ci ne l'aurait PAS vu (54 <= 56) ; c'est
    // le point 2 ci-dessus qui l'a attrapé.
    for (const row of rows) await expect(row.offsetHeight).toBeLessThanOrEqual(56);

    // 5. Le nom cède plutôt que d'élargir la colonne — et il lui reste de quoi
    // se lire. Le « % » en lecture seule contre lequel il venait buter a quitté
    // la ligne le 2026-07-29 avec les autres contrôles répétés (ADR-0001) :
    // c'est la LARGEUR RENDUE au nom qui se mesure désormais, parce que c'est
    // elle qui manquait — à 52 px, « DSCF5160-edited.JPG » s'affichait « DSC… ».
    const photoRow = rows[3];
    const name = photoRow.querySelector<HTMLElement>(".layer-panel__row-name")!;
    await expect(name.scrollWidth).toBeGreaterThan(name.clientWidth); // ellipse active
    // 152 px mesurés ici, contre 176 px dans `LayerPanel.stories.tsx` : la
    // différence est le CHROME de la carte (padding de `.docked-panel-card` et
    // de sa zone défilante), absent d'une story qui monte le panneau nu à 320 px.
    // C'est CE chiffre-ci qui est celui de la vraie fenêtre.
    await expect(Math.round(name.getBoundingClientRect().width)).toBeGreaterThanOrEqual(145);
    // La colonne garde sa largeur réservée : le nom n'a pas le droit de
    // l'élargir (c'est ce que `min-width: 0` sur .panel-column__stack empêche).
    await expect(photoRow.offsetWidth).toBeLessThanOrEqual(320);
  },
};

// --- Interaction test (play) ---

// PanelColumn délègue le repli de chaque carte à la DockedPanelCard sous-jacente ;
// cliquer le bouton "Replier le panneau" de la première carte dépliée (Calques)
// doit remonter à SON callback onCollapsedChange avec true.
export const CollapsePanelCallsSpec: Story = {
  args: {
    panels: [
      { ...panels[0], onCollapsedChange: fn() },
      { ...panels[1], collapsed: true },
    ],
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    // Seule "Calques" est dépliée -> un unique bouton "Replier le panneau".
    const collapse = canvas.getByRole("button", { name: "Replier le panneau" });
    await userEvent.click(collapse);

    const layersSpec = args.panels.find((p) => p.id === "layers");
    await expect(layersSpec?.onCollapsedChange).toHaveBeenCalledTimes(1);
    await expect(layersSpec?.onCollapsedChange).toHaveBeenCalledWith(true);
  },
};
