import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { PhotoPanel } from "./PhotoPanel";
import { assertAccessibleNames } from "./ui/accessible-name.test-support";
import { defaultLayerMask } from "../mask/types";
import type { LayerState } from "../layers/types";

function makePhotoLayer(overrides: Partial<LayerState> = {}): LayerState {
  return {
    id: "layer-photo",
    effectId: "passthrough",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
    imageSource: { sourceId: "src-1" },
    transform: { x: 500, y: 400, scaleX: 1, scaleY: 1, rotation: 0 },
    name: "IMG_1234.jpg",
    ...overrides,
  };
}

const meta: Meta<typeof PhotoPanel> = {
  title: "Components/PhotoPanel",
  component: PhotoPanel,
  args: {
    layer: makePhotoLayer(),
    // Pas d'URL de vignette en Storybook (le store GPU n'existe pas) :
    // l'emplacement réservé doit rendre proprement.
    thumbnailUrl: () => null,
    onTransformChange: () => {},
    onTransformCommit: () => {},
    onReset: () => {},
    onFitToCanvas: () => {},
    onCenter: () => {},
    onReplaceImage: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof PhotoPanel>;

export const Default: Story = {};

/** Le rail peut ouvrir le panneau sans calque photo sélectionné (override
 *  "open" de `useContextualPanel`) — l'état vide est obligatoire. */
export const NoPhotoLayerSelected: Story = {
  args: { layer: null },
};

export const EffectLayerSelected: Story = {
  args: { layer: makePhotoLayer({ effectId: "glow", imageSource: undefined, transform: undefined, name: undefined }) },
};

export const RotatedAndScaled: Story = {
  args: { layer: makePhotoLayer({ transform: { x: 120, y: 60, scaleX: 0.45, scaleY: 0.45, rotation: Math.PI / 4 } }) },
};

// --- Interaction tests (play) ---

export const TypingAngleCommitsOnce: Story = {
  args: { onTransformChange: fn(), onTransformCommit: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("Angle");
    await userEvent.clear(input);
    await userEvent.type(input, "45");
    await userEvent.keyboard("{Enter}");
    // Exactement une entrée d'historique : `Entrée` ne fait que blurrer, le
    // commit vient du seul `onBlur` (même piège que LabeledSlider).
    await expect(args.onTransformChange).toHaveBeenCalledTimes(1);
    await expect(args.onTransformCommit).toHaveBeenCalledTimes(1);
    const [, transform] = (args.onTransformChange as ReturnType<typeof fn>).mock.calls[0];
    await expect(transform.rotation).toBeCloseTo(Math.PI / 4, 6);
  },
};

export const EscapeAbandonsFieldEdit: Story = {
  args: { onTransformChange: fn(), onTransformCommit: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const input = canvas.getByLabelText("X");
    await userEvent.clear(input);
    await userEvent.type(input, "999");
    await userEvent.keyboard("{Escape}");
    // Aucune valeur committée, et le champ est revenu à la valeur du calque.
    await expect(args.onTransformChange).not.toHaveBeenCalled();
    await expect(input).toHaveValue("500");
  },
};

export const TabOrderFollowsVisualOrder: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // Ordre visuel complet : le bouton de repli de chaque section (pattern
    // `Disclosure` des panneaux du dock) précède son contenu.
    await userEvent.tab();
    await expect(document.activeElement).toBe(canvas.getByRole("button", { name: "Source" }));
    await userEvent.tab();
    await expect(document.activeElement).toBe(canvas.getByRole("button", { name: "Remplacer l'image…" }));
    await userEvent.tab();
    await expect(document.activeElement).toBe(canvas.getByRole("button", { name: "Placement" }));
    for (const label of ["X", "Y", "Échelle X", "Échelle Y", "Angle"]) {
      await userEvent.tab();
      await expect(document.activeElement).toBe(canvas.getByLabelText(label));
    }
    await userEvent.tab();
    await expect(document.activeElement).toBe(canvas.getByRole("button", { name: "Actions" }));
    await userEvent.tab();
    await expect(document.activeElement).toBe(canvas.getByRole("button", { name: "Réinitialiser" }));
  },
};

/**
 * GARDE D'ACCESSIBILITÉ — chaque champ du panneau porte un nom accessible
 * CALCULÉ (accname), non vide et non réduit à un identifiant généré. Voir
 * `ui/accessible-name.test-support.ts` pour pourquoi la seconde condition est
 * celle qui donne sa valeur au test.
 */
export const EveryFieldHasAnAccessibleName: Story = {
  play: async ({ canvasElement }) => {
    const report = assertAccessibleNames(canvasElement);
    // Le balayage doit avoir vu les CINQ champs de placement, pas un seul.
    // Cinq depuis que l'échelle a deux axes : un champ unique ne pouvait pas
    // exprimer une photo étirée et aurait dû choisir en silence lequel des deux
    // il affichait.
    await expect(report.map((entry) => entry.name).sort()).toEqual(["Angle", "X", "Y", "Échelle X", "Échelle Y"]);
  },
};

export const ActionsFireTheirHandler: Story = {
  args: { onReset: fn(), onFitToCanvas: fn(), onCenter: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Ajuster à la toile" }));
    await expect(args.onFitToCanvas).toHaveBeenCalledWith("layer-photo");
    await userEvent.click(canvas.getByRole("button", { name: "Centrer" }));
    await expect(args.onCenter).toHaveBeenCalledWith("layer-photo");
    await userEvent.click(canvas.getByRole("button", { name: "Réinitialiser" }));
    await expect(args.onReset).toHaveBeenCalledWith("layer-photo");
  },
};

/** T2 — remplacer l'image du calque sélectionné. Le bouton vit dans la
 *  section « Source » : c'est la source qu'il change, rien d'autre. */
export const ReplaceImageFiresItsHandler: Story = {
  args: { onReplaceImage: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Remplacer l'image…" }));
    await expect(args.onReplaceImage).toHaveBeenCalledWith("layer-photo");
  },
};

/** Un calque VERROUILLÉ ne peut pas changer d'image (`LayerStack.isLocked`) :
 *  l'UI le montre au lieu de laisser cliquer puis refuser en silence. */
export const ReplaceImageDisabledWhenLocked: Story = {
  args: { layer: makePhotoLayer({ locked: true }), onReplaceImage: fn() },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const button = canvas.getByRole("button", { name: "Remplacer l'image…" });
    await expect(button).toBeDisabled();
    // `pointerEventsCheck: 0` : le bouton désactivé porte `pointer-events:
    // none`, donc un clic réel ne l'atteint même pas. On force quand même
    // l'événement pour vérifier le second garde — que le handler ne parte pas
    // si le clic passait.
    await userEvent.click(button, { pointerEventsCheck: 0 });
    await expect(args.onReplaceImage).not.toHaveBeenCalled();
  },
};
