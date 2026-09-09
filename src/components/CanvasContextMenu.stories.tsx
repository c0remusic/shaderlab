import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fireEvent, fn, userEvent, within } from "storybook/test";
import { CanvasContextMenu, type CanvasMenuLayer } from "./CanvasContextMenu";
import { defaultLayerMask } from "../mask/types";
import type { LayerState } from "../layers/types";

function makeLayer(overrides: Partial<LayerState>): LayerState {
  return {
    id: "layer-1",
    effectId: "glow",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
    ...overrides,
  };
}

// Photo de fond, un effet PLACÉ (light leak, porte un ancrage sur la toile) et un
// effet PLEIN CADRE (grain, sans ancrage) : la scène de la vérification CDP du
// ticket 29. L'ordre du MODÈLE est index 0 = bas.
const photo = makeLayer({
  id: "photo",
  effectId: "passthrough",
  name: "IMG_1234.jpg",
  imageSource: { sourceId: "s-photo" },
  transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
});
const leak = makeLayer({ id: "leak", effectId: "lightLeak" });
const grain = makeLayer({ id: "grain", effectId: "grain" });
const layers: LayerState[] = [photo, leak, grain];

// Les groupes sont ordonnés du HAUT vers le BAS — c'est ce que rend `hitTestAll`,
// et `App` les partage (placé/photo puis plein cadre).
const placedTrois: CanvasMenuLayer[] = [
  { id: "leak", name: "Light leak", kind: "effect" },
  { id: "photo", name: "IMG_1234.jpg", kind: "photo" },
];
const pleinCadreTrois: CanvasMenuLayer[] = [{ id: "grain", name: "Grain", kind: "effect" }];

// La toile est un simple carré : le déclencheur (`display: contents`) l'enveloppe,
// et un clic droit dessus remonte jusqu'à lui.
const surface = <div data-testid="toile" style={{ width: 320, height: 200, background: "var(--surface-workspace)" }} />;

function menuHandlers() {
  return {
    onContextMenu: fn(),
    onSelectLayer: fn(),
    onAddEffect: fn(),
    onToggle: fn(),
    onDuplicate: fn(),
    onStamp: fn(),
    onMergeDown: fn(),
    onToggleLock: fn(),
    onRemove: fn(),
  };
}

const meta: Meta<typeof CanvasContextMenu> = {
  title: "Components/CanvasContextMenu",
  component: CanvasContextMenu,
  args: {
    children: surface,
    layers,
    hasImage: true,
    ...menuHandlers(),
  },
};

export default meta;
type Story = StoryObj<typeof CanvasContextMenu>;

// TROIS calques sous le curseur : la photo À TRAVERS un light leak placé, plus un
// grain plein cadre. Le menu liste [Light leak, IMG] puis, après un séparateur,
// [Grain] ; le calque sélectionné (Light leak) est coché ; puis viennent les
// actions du ticket 28 sur ce calque sélectionné.
export const TroisCalques: Story = {
  args: { placed: placedTrois, fullFrame: pleinCadreTrois, selectedId: "leak" },
  play: async ({ canvasElement, args }) => {
    fireEvent.contextMenu(within(canvasElement).getByTestId("toile"));
    const body = within(document.body);
    const menu = await body.findByRole("menu");
    const m = within(menu);

    // La LISTE des calques : cases, du haut vers le bas, deux groupes.
    const cases = m.getAllByRole("menuitemcheckbox");
    await expect(cases.map((el) => el.textContent)).toEqual(["Light leak", "IMG_1234.jpg", "Grain"]);
    // Le sélectionné est coché, les autres non.
    await expect(cases[0]).toHaveAttribute("aria-checked", "true");
    await expect(cases[1]).toHaveAttribute("aria-checked", "false");
    await expect(cases[2]).toHaveAttribute("aria-checked", "false");

    // Un clic sur un item SÉLECTIONNE (sans logique — appelle le handler).
    await userEvent.click(cases[1]);
    await expect(args.onSelectLayer).toHaveBeenCalledWith("photo");

    // Les ACTIONS du calque sélectionné (les mêmes entrées que le ticket 28).
    const actions = m.getAllByRole("menuitem").map((el) => el.textContent);
    await expect(actions).toEqual([
      "Masquer le calque",
      "Dupliquer",
      "Aplatir en nouveau calque",
      "Fusionner avec le dessous",
      "Verrous",
      "Supprimer le calque",
    ]);
  },
};

// UN seul calque (une photo) : la liste n'a qu'une case, aucun séparateur de
// groupe, et les actions suivent.
export const UnCalque: Story = {
  args: {
    placed: [{ id: "photo", name: "IMG_1234.jpg", kind: "photo" }],
    fullFrame: [],
    selectedId: "photo",
  },
  play: async ({ canvasElement }) => {
    fireEvent.contextMenu(within(canvasElement).getByTestId("toile"));
    const menu = await within(document.body).findByRole("menu");
    const m = within(menu);
    const cases = m.getAllByRole("menuitemcheckbox");
    await expect(cases.map((el) => el.textContent)).toEqual(["IMG_1234.jpg"]);
    // Actions présentes : Aplatir n'est pas grisé sur une photo (ticket 27).
    await expect(m.getByRole("menuitem", { name: "Aplatir en nouveau calque" })).not.toHaveAttribute("aria-disabled", "true");
  },
};

// AUCUN calque sous le curseur : « Ajouter un effet… » seul (comme le vide de la
// pile). Actif car une image est chargée.
export const Vide: Story = {
  args: { placed: [], fullFrame: [], selectedId: null },
  play: async ({ canvasElement, args }) => {
    fireEvent.contextMenu(within(canvasElement).getByTestId("toile"));
    const menu = await within(document.body).findByRole("menu");
    const items = within(menu).getAllByRole("menuitem");
    await expect(items.map((el) => el.textContent)).toEqual(["Ajouter un effet…"]);
    await expect(items[0]).not.toHaveAttribute("aria-disabled", "true");
    await userEvent.click(items[0]);
    await expect(args.onAddEffect).toHaveBeenCalled();
  },
};
