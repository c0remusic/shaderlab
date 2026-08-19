import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { LayerControls } from "./LayerPanel";
import { assertAccessibleNames } from "./ui/accessible-name.test-support";
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

const layers: LayerState[] = [
  makeLayer({ id: "layer-1", effectId: "glow", opacity: 1 }),
  makeLayer({ id: "layer-2", effectId: "grain", opacity: 0.35, blendMode: "screen" }),
  // Calque PHOTO : le sélecteur d'effet ne doit PAS être proposé dessus
  // (décision produit du 2026-07-31 — un effet est un calque à part, écrêté).
  makeLayer({
    id: "photo-layer",
    effectId: "passthrough",
    name: "IMG_1234.jpg",
    imageSource: { sourceId: "photo-1" },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
  }),
];

const meta: Meta<typeof LayerControls> = {
  title: "Components/LayerControls",
  component: LayerControls,
  args: {
    layers,
    selectedId: "layer-1",
    onOpacityChange: () => {},
    onOpacityCommit: () => {},
    onBlendModeChange: () => {},
    onEffectChange: () => {},
    onToggleLock: () => {},
    onDuplicate: () => {},
    onRemove: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof LayerControls>;

export const Default: Story = {};

// Aucune sélection : l'en-tête reste MONTÉ (sinon la liste sauterait de toute
// sa hauteur à chaque désélection), mais tous ses contrôles sont désactivés.
export const NoSelection: Story = {
  args: { selectedId: null },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("combobox", { name: "Effet" })).toBeDisabled();
    await expect(canvas.getByRole("combobox", { name: "Fusion" })).toBeDisabled();
    await expect(canvas.getByRole("textbox", { name: "Opacité" })).toBeDisabled();
    // Les actions migrées depuis les lignes (2026-07-29) suivent la même
    // règle : montées mais inertes. Les faire disparaître ferait sauter la
    // liste au-dessus à chaque désélection (ADR-0001, § Conséquences).
    await expect(canvas.getByRole("button", { name: "Verrouiller — Tout" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Dupliquer le calque" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Supprimer le calque" })).toBeDisabled();
  },
};

// --- Actions migrées depuis les lignes (2026-07-29, ADR-0001) ---
//
// Elles se répétaient sur CHAQUE ligne de la liste et mangeaient la largeur du
// nom (mesurée à 52 px au dock par défaut). Elles agissent désormais sur le
// calque SÉLECTIONNÉ. Leur contrepartie côté liste — la preuve qu'elles n'y
// sont plus — vit dans `LayerPanel.stories.tsx` (`NoPerRowActions`).

export const ToggleLock: Story = {
  args: { selectedId: "layer-2", onToggleLock: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Verrouiller — Tout" }));
    await expect(args.onToggleLock).toHaveBeenCalledWith("layer-2", "all", true);

    // LES QUATRE VERROUS (2026-08-19) : la rangee en porte quatre, et chacun
    // rapporte SA cle. Sans ce second cas, trois boutons sur quatre
    // pourraient rapporter "all" sans que rien ne rougisse.
    await userEvent.click(canvas.getByRole("button", { name: "Verrouiller — Position — la géométrie" }));
    await expect(args.onToggleLock).toHaveBeenCalledWith("layer-2", "position", true);
  },
};

export const DuplicateSelectedLayer: Story = {
  args: { selectedId: "layer-2", onDuplicate: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Dupliquer le calque" }));
    await expect(args.onDuplicate).toHaveBeenCalledWith("layer-2");
  },
};

export const RemoveSelectedLayer: Story = {
  args: { selectedId: "layer-2", onRemove: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Supprimer le calque" }));
    await expect(args.onRemove).toHaveBeenCalledWith("layer-2");
  },
};

// CALQUE VERROUILLÉ : la zone entière est inerte SAUF le verrou lui-même — sans
// quoi le verrou serait une trappe sans sortie, l'affordance de déverrouillage
// ayant quitté la ligne. DUPLIQUER reste actif, SUPPRIMER non : c'est
// exactement ce que le modèle fait (`LayerStack.duplicateLayer` lit la source
// sans la muter, `removeLayer` consulte `isLocked` et refuse). Un bouton actif
// dont la mutation est refusée en silence serait un échec silencieux.
export const LockedLayerKeepsOnlyItsWayOut: Story = {
  args: {
    layers: [makeLayer({ id: "layer-1", effectId: "glow", locks: { all: true } })],
    selectedId: "layer-1",
    onToggleLock: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("combobox", { name: "Effet" })).toBeDisabled();
    await expect(canvas.getByRole("combobox", { name: "Fusion" })).toBeDisabled();
    await expect(canvas.getByRole("textbox", { name: "Opacité" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Supprimer le calque" })).toBeDisabled();
    await expect(canvas.getByRole("button", { name: "Dupliquer le calque" })).not.toBeDisabled();
    const unlock = canvas.getByRole("button", { name: "Déverrouiller — Tout" });
    await expect(unlock).not.toBeDisabled();
    await userEvent.click(unlock);
    await expect(args.onToggleLock).toHaveBeenCalledWith("layer-1", "all", false);
  },
};

// L'opacité est le SEUL contrôle de l'en-tête dont l'étiquette a quitté l'écran
// (`labelPlacement="hidden"`, donc `sr-only`). Sans cette story, une régression
// qui le rendrait anonyme — étiquette non liée, `htmlFor` cassé — passerait au
// vert : plus rien d'autre ne vérifie son nom accessible. Elle verrouille aussi
// l'UNITÉ affichée : un pourcentage entier, jamais un 0..1.
export const OpacityFieldIsNamedAndShowsPercent: Story = {
  args: { selectedId: "layer-2" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole("textbox", { name: "Opacité" });
    await expect(field).toHaveValue("35");
    await expect(canvas.getByText("%")).toBeVisible();
  },
};

/** GARDE D'ACCESSIBILITÉ — balayage MESURÉ de la zone de contrôles de calque.
 *  Le champ d'opacité y porte `labelPlacement="hidden"` : son étiquette est
 *  hors écran, donc c'est exactement le cas où un nom accessible se perd sans
 *  que rien ne se voie. Voir `ui/accessible-name.test-support.ts`. */
export const EveryFieldHasAnAccessibleName: Story = {
  args: { selectedId: "layer-2" },
  play: async ({ canvasElement }) => {
    const report = assertAccessibleNames(canvasElement);
    // Les trois contrôles de la zone : les deux listes déroulantes Base UI
    // (`role="combobox"`) et le champ d'opacité à l'étiquette hors écran.
    await expect(report.map((entry) => entry.name).sort()).toEqual(["Effet", "Fusion", "Opacité"]);
  },
};

// Contrat de commit du champ (précédent du repo : `ui/labeled-slider.tsx`,
// `PhotoPanel`) — brouillon local, commit au blur, EXACTEMENT une entrée
// d'historique. La saisie porte l'unité (« 60 % ») : le champ doit l'accepter
// telle qu'il l'affiche.
export const OpacityFieldCommitsTypedPercent: Story = {
  args: { selectedId: "layer-2", onOpacityChange: fn(), onOpacityCommit: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole("textbox", { name: "Opacité" });
    await userEvent.click(field);
    await userEvent.keyboard("{Control>}a{/Control}60 %");
    await userEvent.tab();
    await expect(args.onOpacityChange).toHaveBeenCalledTimes(1);
    await expect(args.onOpacityChange).toHaveBeenCalledWith("layer-2", 0.6);
    await expect(args.onOpacityCommit).toHaveBeenCalledTimes(1);
  },
};

// Saisie invalide : retour à la valeur précédente, jamais un NaN poussé dans le
// modèle ni une entrée d'historique.
export const OpacityFieldRejectsInvalidInput: Story = {
  args: { selectedId: "layer-2", onOpacityChange: fn(), onOpacityCommit: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole("textbox", { name: "Opacité" });
    await userEvent.click(field);
    await userEvent.keyboard("{Control>}a{/Control}bloup");
    await userEvent.tab();
    await expect(field).toHaveValue("35");
    await expect(args.onOpacityChange).not.toHaveBeenCalled();
    await expect(args.onOpacityCommit).not.toHaveBeenCalled();
  },
};

// Échap abandonne l'édition en cours sans rien committer.
export const OpacityFieldEscapeAbandons: Story = {
  args: { selectedId: "layer-2", onOpacityChange: fn(), onOpacityCommit: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const field = canvas.getByRole("textbox", { name: "Opacité" });
    await userEvent.click(field);
    await userEvent.keyboard("{Control>}a{/Control}99{Escape}");
    await expect(field).toHaveValue("35");
    await expect(args.onOpacityChange).not.toHaveBeenCalled();
  },
};

// Décision produit du 2026-07-31 : un effet ne se pose jamais sur un calque
// photo. Le sélecteur n'est pas DÉSACTIVÉ (ce serait l'état d'un calque
// verrouillé), il est ABSENT, remplacé par la phrase qui dit la règle.
export const PhotoLayerHasNoEffectSelector: Story = {
  args: { selectedId: "photo-layer" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByRole("combobox", { name: "Effet" })).toBeNull();
    await expect(canvas.getByText("Aucun effet sur un calque photo")).toBeVisible();
    // Les actions du calque restent, elles : le verrou, la duplication et la
    // suppression n'ont rien à voir avec l'effet.
    await expect(canvas.getByRole("button", { name: "Dupliquer le calque" })).toBeVisible();
  },
};

// Le sélecteur d'effet est la seule UI qui change l'effectId d'un calque DÉJÀ
// créé (le Select « Ajouter un effet » du panneau ne fait qu'ajouter). Il
// expose "Aucun effet" (= passthrough), absent du sélecteur d'ajout.
export const ChangeLayerEffect: Story = {
  args: { selectedId: "layer-1", onEffectChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("combobox", { name: "Effet" }));
    // La popup du Select est portalisée hors de canvasElement.
    const option = await within(document.body).findByRole("option", { name: "Aucun effet" });
    await userEvent.click(option);
    await expect(args.onEffectChange).toHaveBeenCalledWith("layer-1", "passthrough");
  },
};
