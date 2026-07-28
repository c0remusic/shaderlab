import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { DockedPanelCard } from "./DockedPanelCard";

const meta: Meta<typeof DockedPanelCard> = {
  title: "Components/DockedPanel/DockedPanelCard",
  component: DockedPanelCard,
  args: {
    title: "Calques",
    collapsed: false,
    onCollapsedChange: () => {},
    children: <p style={{ margin: 0 }}>Contenu du panneau.</p>,
  },
};

export default meta;
type Story = StoryObj<typeof DockedPanelCard>;

export const Default: Story = {};

export const Collapsed: Story = {
  args: { collapsed: true },
};

export const Dragging: Story = {
  args: { dragging: true },
};

// --- Content / title variants ---

export const LongTitle: Story = {
  args: { title: "Paramètres avancés du calque de correction colorimétrique" },
};

export const RichContent: Story = {
  args: {
    title: "Paramètres",
    children: (
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <label style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          Intensité <input type="range" defaultValue={60} />
        </label>
        <label style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
          Rayon <input type="range" defaultValue={30} />
        </label>
        <button type="button">Réinitialiser</button>
      </div>
    ),
  },
};

export const OverflowContent: Story = {
  args: {
    title: "Journal",
    children: (
      <p style={{ margin: 0 }}>
        {Array.from({ length: 20 }, (_, i) => `Ligne ${i + 1} du contenu long qui teste le débordement vertical.`).join(" ")}
      </p>
    ),
  },
};

// --- Zone de contrôles fixe (ADR-0001) ---
//
// Ce qui est verrouillé ici n'est pas l'esthétique de la carte mais
// l'INVARIANT de l'ADR-0001 : la zone de contrôles est UNIQUE, elle ne défile
// pas avec la liste, et elle vit HORS du conteneur défilant
// (`.docked-panel-card__content`) — quel que soit son placement. Le placement,
// lui, a changé le 2026-07-28 : la carte Effets la pose en PIED, pour qu'on
// lise d'abord CE QUI est modifié puis les réglages.

const controlsArgs = {
  controls: <button type="button">Réglage de l'élément sélectionné</button>,
} satisfies Partial<React.ComponentProps<typeof DockedPanelCard>>;

/** Ordre du DOM = ordre de lecture : les contrôles précèdent la liste. */
export const ControlsOnTop: Story = {
  args: { ...controlsArgs, controlsPlacement: "top" },
  play: async ({ canvasElement }) => {
    const card = canvasElement.querySelector(".docked-panel-card")!;
    await expect(Array.from(card.children).map((el) => el.className.split(" ")[0])).toEqual([
      "docked-panel-card__titlebar",
      "docked-panel-card__controls",
      "docked-panel-card__content",
    ]);
    await expect(card.querySelector(".docked-panel-card__controls")!.className).toContain(
      "docked-panel-card__controls--top",
    );
  },
};

/** PIED (2026-07-28) : la zone passe APRÈS le contenu, en restant un FRÈRE du
 *  conteneur défilant — jamais un enfant, sinon elle défilerait avec la liste
 *  et l'ADR-0001 tomberait. */
export const ControlsAtBottom: Story = {
  args: { ...controlsArgs, controlsPlacement: "bottom" },
  play: async ({ canvasElement }) => {
    const card = canvasElement.querySelector(".docked-panel-card")!;
    await expect(Array.from(card.children).map((el) => el.className.split(" ")[0])).toEqual([
      "docked-panel-card__titlebar",
      "docked-panel-card__content",
      "docked-panel-card__controls",
    ]);
    const controls = card.querySelector(".docked-panel-card__controls")!;
    await expect(controls.className).toContain("docked-panel-card__controls--bottom");
    // Hors du scroller : c'est CE point que l'ADR-0001 exige, pas la position.
    await expect(card.querySelector(".docked-panel-card__content")!.contains(controls)).toBe(false);
    // Une seule zone : le principe est un contrôle UNIQUE, pas un par ligne.
    await expect(card.querySelectorAll(".docked-panel-card__controls")).toHaveLength(1);
  },
};

/** Repliée : ni contenu ni contrôles, seule la barre de titre subsiste. */
export const CollapsedHidesControls: Story = {
  args: { ...controlsArgs, controlsPlacement: "bottom", collapsed: true },
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelectorAll(".docked-panel-card__controls")).toHaveLength(0);
    await expect(canvasElement.querySelectorAll(".docked-panel-card__content")).toHaveLength(0);
  },
};

// --- Interaction tests (play) ---

// Repli : l'entête montre "Replier le panneau" quand il est déplié ; cliquer
// doit demander le passage à collapsed=true.
export const CollapseTogglesFromExpanded: Story = {
  args: {
    collapsed: false,
    onCollapsedChange: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const toggle = canvas.getByRole("button", { name: "Replier le panneau" });

    await userEvent.click(toggle);

    await expect(args.onCollapsedChange).toHaveBeenCalledTimes(1);
    await expect(args.onCollapsedChange).toHaveBeenCalledWith(true);
  },
};

// Dépli : quand collapsed=true, le contenu est démonté et l'entête montre
// "Déplier le panneau" ; cliquer doit demander collapsed=false.
export const ExpandTogglesFromCollapsed: Story = {
  args: {
    collapsed: true,
    onCollapsedChange: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    // Contenu démonté tant que replié.
    await expect(canvas.queryByText("Contenu du panneau.")).toBeNull();

    const toggle = canvas.getByRole("button", { name: "Déplier le panneau" });
    await userEvent.click(toggle);

    await expect(args.onCollapsedChange).toHaveBeenCalledTimes(1);
    await expect(args.onCollapsedChange).toHaveBeenCalledWith(false);
  },
};
