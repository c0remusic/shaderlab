import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { MaskPanel } from "./MaskPanel";
import { assertAccessibleNames } from "./ui/accessible-name.test-support";
import { defaultLayerMask, createParametricSource } from "../mask/types";
import type { LayerState } from "../layers/types";

const gradientSource = createParametricSource("source-1", "gradient", {
  angle: 0,
  startX: 0.3,
  startY: 0.5,
  endX: 0.7,
  endY: 0.5,
  feather: 0.1,
  invert: 0,
});

const luminositySource = createParametricSource("source-2", "luminosity", {
  shadowsMin: 0,
  shadowsMax: 0.3,
  highlightsMin: 0.7,
  highlightsMax: 1,
  feather: 0.05,
});

const colorRangeSource = createParametricSource("source-3", "colorRange", {
  tolerance: 0.2,
  hardness: 0.5,
  samples: [],
});

const layerWithMask: LayerState = {
  id: "layer-1",
  effectId: "glow",
  params: {},
  enabled: true,
  opacity: 1,
  blendMode: "normal",
  mask: { ...defaultLayerMask(), sources: [gradientSource] },
};

/** Un contrôle INERTE, quelle que soit la primitive qui le rend.
 *
 *  `toBeDisabled()` ne connaît que les éléments de formulaire NATIFS. La case
 *  Base UI est un `<span role="checkbox">` : elle porte `aria-disabled` et
 *  `tabindex="-1"` mais aucun attribut `disabled`, et `toBeDisabled()` la
 *  déclarerait active à tort. On vérifie donc les deux formes — et
 *  `tabindex="-1"` est la preuve directe que la NAVIGATION CLAVIER saute le
 *  contrôle, ce qu'un simple `disabled` sur un natif garantit par ailleurs.
 *  (Copie locale de l'helper de `ParamPanel.stories.tsx` : un export nommé
 *  depuis un fichier CSF serait interprété par Storybook comme une story.) */
async function expectInert(el: HTMLElement) {
  if (el.hasAttribute("aria-disabled")) {
    await expect(el).toHaveAttribute("aria-disabled", "true");
    await expect(el).toHaveAttribute("tabindex", "-1");
    return;
  }
  await expect(el).toBeDisabled();
}

/** Miroir de `expectInert` : le contrôle est réellement actionnable. */
async function expectLive(el: HTMLElement) {
  if (el.hasAttribute("aria-disabled")) {
    await expect(el).toHaveAttribute("aria-disabled", "false");
    return;
  }
  await expect(el).toBeEnabled();
}

const meta: Meta<typeof MaskPanel> = {
  title: "Components/MaskPanel",
  component: MaskPanel,
  args: {
    layer: layerWithMask,
    maskPaintMode: false,
    onToggleMaskPaint: () => {},
    onAddMaskSource: () => {},
    onRemoveMaskSource: () => {},
    onMaskSourceParamsChange: () => {},
    onMaskSourceParamsCommit: () => {},
    onMaskSourceCombineModeChange: () => {},
    onMaskSourceEnabledChange: () => {},
    onMaskInvertChange: () => {},
    onMaskEnabledChange: () => {},
    onRefineEdgeChange: () => {},
    onRefineEdgeCommit: () => {},
    onAddColorSample: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof MaskPanel>;

export const Default: Story = {};

/** GARDE D'ACCESSIBILITÉ — balayage MESURÉ du panneau Masque, le plus dense en
 *  contrôles (pistes de source paramétrique, seuil, contour, affinage). Voir
 *  `ui/accessible-name.test-support.ts`. */
export const EveryFieldHasAnAccessibleName: Story = {
  play: async ({ canvasElement }) => {
    const report = assertAccessibleNames(canvasElement);
    // Quatorze contrôles : la case d'activation du masque, la source
    // paramétrique (angle, deux points, adoucissement — piste + champ chacun) et
    // la case d'inversion de la source.
    await expect(report.map((entry) => entry.name)).toEqual([
      "Inverser",
      "Angle",
      "Angle (valeur)",
      "Départ X",
      "Départ X (valeur)",
      "Départ Y",
      "Départ Y (valeur)",
      "Arrivée X",
      "Arrivée X (valeur)",
      "Arrivée Y",
      "Arrivée Y (valeur)",
      "Adoucissement",
      "Adoucissement (valeur)",
      "Inverser",
    ]);
  },
};

export const NoSources: Story = {
  args: {
    layer: { ...layerWithMask, mask: defaultLayerMask() },
  },
};

export const MultipleSources: Story = {
  args: {
    layer: {
      ...layerWithMask,
      mask: { ...defaultLayerMask(), sources: [gradientSource, luminositySource, colorRangeSource] },
    },
  },
};

export const MaskDisabled: Story = {
  args: {
    layer: {
      ...layerWithMask,
      mask: { ...defaultLayerMask(), sources: [gradientSource], enabled: false },
    },
  },
};

export const Inverted: Story = {
  args: {
    layer: {
      ...layerWithMask,
      mask: { ...defaultLayerMask(), sources: [gradientSource], invert: true },
    },
  },
};

export const PaintModeActive: Story = {
  args: { maskPaintMode: true },
};

export const NoLayerSelected: Story = {
  args: { layer: null },
};

/** Calque VERROUILLÉ : chaque contrôle dont la mutation est refusée par
 *  `LayerStack.isLocked` est rendu INERTE ; ceux que la garde n'atteint pas
 *  restent actionnables, et toutes les valeurs restent LISIBLES.
 *
 *  Cette story est la liste exécutable du partage : si un contrôle change de
 *  camp dans `layerStack.ts`, elle échoue ici plutôt que de mentir à l'écran.
 *  Le « pourquoi » passe par `title` sur la racine du panneau, jamais par une
 *  ligne de texte — la hauteur des cartes est sous budget (ADR-0001). */
export const LockedLayer: Story = {
  args: {
    layer: { ...layerWithMask, id: "layer-locked", locked: true },
    onMaskEnabledChange: fn(),
    onMaskInvertChange: fn(),
    onMaskSourceParamsChange: fn(),
    onRefineEdgeChange: fn(),
    onToggleMaskPaint: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.getByTitle("Calque verrouillé")).toBeInTheDocument();

    // --- INERTES : la garde du modèle refuse ces mutations ---
    // setMaskEnabled
    await expectInert(canvas.getByRole("button", { name: "Désactiver le masque" }));
    // setMaskInvert + le param `invert` de la source (updateMaskSourceParams) :
    // même libellé « Inverser », d'où la requête plurielle.
    const inverts = canvas.getAllByRole("checkbox", { name: "Inverser" });
    await expect(inverts).toHaveLength(2);
    for (const box of inverts) await expectInert(box);
    // updateBrushMask — le mode peinture est la SEULE porte d'entrée du pinceau.
    await expectInert(canvas.getByRole("button", { name: "Peindre le masque" }));
    // addMaskSource (refuse en LEVANT, d'où ce disabled antérieur)
    await expectInert(canvas.getByRole("button", { name: "Ajouter une source" }));
    // setMaskSourceEnabled / removeMaskSource
    await expectInert(canvas.getByRole("button", { name: "Désactiver la source" }));
    await expectInert(canvas.getByRole("button", { name: "Supprimer la source" }));
    // setMaskSourceCombineMode (3 bascules)
    for (const name of ["+ Ajouter", "− Soustraire", "∩ Intersecter"]) {
      await expectInert(canvas.getByRole("button", { name }));
    }
    // updateMaskSourceParams — tous les curseurs de la source active.
    const sourceSliders = canvas.getAllByRole("slider");
    await expect(sourceSliders.length).toBeGreaterThan(0);
    for (const slider of sourceSliders) await expectInert(slider);

    // --- ACTIONNABLES : la garde ne les atteint pas ---
    // Préférence de VUE, aucun calque muté.
    await expectLive(canvas.getByRole("button", { name: "Masquer l'overlay" }));
    // Choix de la source à CONSULTER : état local du panneau, pas une mutation.
    await expectLive(canvas.getByRole("button", { name: "Dégradé" }));

    // --- LISIBILITÉ : consulter reste possible, y compris replié ---
    const angle = canvas.getByLabelText("Angle (valeur)");
    await expectInert(angle);
    await expect(angle).toHaveValue("0");
    // Le repli « Affiner le bord » s'ouvre encore : sinon ces valeurs seraient
    // non pas désactivées mais INACCESSIBLES.
    await userEvent.click(canvas.getByRole("button", { name: "Affiner le bord" }));
    const feather = await canvas.findByLabelText("Adoucir le bord (valeur)");
    await expectInert(feather);
    await expect(feather).toHaveValue("0");
    await expectInert(canvas.getByRole("checkbox", { name: "Accroché aux contours (edge-aware)" }));

    // Aucun de ces gestes n'a pu écrire.
    await expect(args.onMaskEnabledChange).not.toHaveBeenCalled();
    await expect(args.onRefineEdgeChange).not.toHaveBeenCalled();
  },
};

/** Contre-épreuve de `LockedLayer` : le MÊME calque non verrouillé garde tous
 *  ses contrôles actifs. Sans elle, `LockedLayer` passerait aussi si le panneau
 *  désactivait tout en permanence. */
export const UnlockedLayerKeepsControlsActive: Story = {
  args: { layer: { ...layerWithMask, id: "layer-unlocked" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTitle("Calque verrouillé")).toBeNull();
    for (const name of ["Désactiver le masque", "Peindre le masque", "Ajouter une source", "Supprimer la source", "+ Ajouter"]) {
      await expectLive(canvas.getByRole("button", { name }));
    }
    for (const box of canvas.getAllByRole("checkbox", { name: "Inverser" })) await expectLive(box);
    for (const slider of canvas.getAllByRole("slider")) await expectLive(slider);
  },
};

// --- Interaction tests (play) ---

export const TogglePaintMode: Story = {
  args: { maskPaintMode: false, onToggleMaskPaint: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Peindre le masque" }));
    await expect(args.onToggleMaskPaint).toHaveBeenCalled();
  },
};

export const ToggleMaskActive: Story = {
  args: { onMaskEnabledChange: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    // "Masque actif" is an aria-pressed IconButton (not a checkbox since
    // c0d18b5) — its accessible name is the aria-label, which reflects the
    // action, not the state. Mask starts enabled → clicking fires (id, false).
    await userEvent.click(canvas.getByRole("button", { name: "Désactiver le masque" }));
    await expect(args.onMaskEnabledChange).toHaveBeenCalledWith("layer-1", false);
  },
};

export const AddSourceFromMenu: Story = {
  args: { onAddMaskSource: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Ajouter une source" }));
    // Menu items portal out of canvasElement → query via `screen`.
    const gradientItem = await screen.findByRole("menuitem", { name: "Dégradé" });
    await userEvent.click(gradientItem);
    await expect(args.onAddMaskSource).toHaveBeenCalledWith("layer-1", "gradient");
  },
};

export const RemoveSource: Story = {
  args: { onRemoveMaskSource: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Supprimer la source" }));
    await expect(args.onRemoveMaskSource).toHaveBeenCalledWith("layer-1", "source-1");
  },
};
