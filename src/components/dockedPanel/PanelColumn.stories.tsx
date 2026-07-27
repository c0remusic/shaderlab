import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { PanelColumn, type DockedPanelSpec } from "./PanelColumn";
import type { DockLayout } from "../../ui/dockLayout";

const layout: DockLayout = [["layers", "params"], ["mask"]];

const panels: DockedPanelSpec[] = [
  { id: "layers", title: "Calques", collapsed: false, onCollapsedChange: () => {}, content: <p style={{ margin: 0 }}>Liste des calques.</p> },
  { id: "params", title: "Paramètres", collapsed: false, onCollapsedChange: () => {}, content: <p style={{ margin: 0 }}>Réglages de l'effet.</p> },
  { id: "mask", title: "Masque", collapsed: true, onCollapsedChange: () => {}, content: <p style={{ margin: 0 }}>Sources de masque.</p> },
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
  args: { layout: [["layers", "params", "mask"]] },
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
        title: "Effets",
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

// --- Interaction test (play) ---

// PanelColumn délègue le repli de chaque carte à la DockedPanelCard sous-jacente ;
// cliquer le bouton "Replier le panneau" de la première carte dépliée (Calques)
// doit remonter à SON callback onCollapsedChange avec true.
export const CollapsePanelCallsSpec: Story = {
  args: {
    panels: [
      { ...panels[0], onCollapsedChange: fn() },
      { ...panels[1], collapsed: true },
      { ...panels[2] },
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
