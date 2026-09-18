import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ColorMixer } from "./ColorMixer";
import { defaultLayerMask } from "../mask/types";
import type { LayerState } from "../layers/types";

/**
 * LE MÉLANGEUR DE COULEURS EN DEUX VUES (ticket 07, item 5).
 *
 * Ce que ces stories doivent MONTRER, et qu'aucun test unitaire ne montre : que
 * les deux vues sont bien deux LECTURES du même jeu de curseurs, et qu'on passe
 * de l'une à l'autre par un clic. Le regroupement lui-même est éprouvé en
 * `test/ui/colorMixer.test.ts`, à travers `groupEffectParams` — donc sur ce qui
 * est RENDU, pas sur ce qui est demandé.
 */
function calque(params: Record<string, number> = {}): LayerState {
  return {
    id: "develop:hsl",
    effectId: "hsl",
    params,
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
  };
}

const meta: Meta<typeof ColorMixer> = {
  title: "Components/ColorMixer",
  component: ColorMixer,
  args: {
    layer: calque(),
    onParamChange: fn(),
    onParamCommit: fn(),
  },
};
export default meta;
type Story = StoryObj<typeof ColorMixer>;

/** Vue COULEUR au premier affichage : les huit pastilles, et les TROIS curseurs
 *  de la bande sélectionnée — pas les vingt-quatre. */
export const VueCouleur: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Couleur" })).toHaveAttribute("aria-pressed", "true");
    // Huit pastilles, nommées par leur bande (la couleur EST l'étiquette, le nom
    // part en aria-label — huit noms ne tiennent pas sur 320 px).
    const pastilles = within(canvas.getByRole("group", { name: "Couleur à régler" })).getAllByRole("button");
    await expect(pastilles).toHaveLength(8);
    await expect(canvas.getByRole("button", { name: "Rouge" })).toHaveAttribute("aria-pressed", "true");
    // Les trois curseurs de la bande, sous son nom, et RIEN d'autre : c'est le
    // point qui avait manqué à la première écriture — les vingt et un curseurs
    // non cités revenaient par le bloc libre et le panneau semblait normal.
    await expect(canvas.getByText("Teinte")).toBeInTheDocument();
    await expect(canvas.getByText("Saturation")).toBeInTheDocument();
    await expect(canvas.getByText("Luminance")).toBeInTheDocument();
    await expect(canvas.queryByText("Turquoise")).not.toBeInTheDocument();

    // ⚠️ « Traitement » EST AU-DESSUS des pastilles, et cet ordre est le fond
    // du correctif : rendu par `ParamPanel` il tombait en tête de `params[]`,
    // donc ENTRE les pastilles et les trois curseurs qu'elles commandent —
    // le sélecteur coupé de ce qu'il sélectionne. Un test de position, parce
    // qu'aucun autre ne verrait la régression.
    const traitement = canvas.getByText("Traitement");
    const reglages = canvas.getByText("Réglages :");
    await expect(traitement.compareDocumentPosition(reglages) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  },
};

/**
 * Changer de pastille change la bande RÉGLÉE — et ça se prouve par les VALEURS.
 *
 * ⚠️ Les trois libellés sont « Teinte / Saturation / Luminance » quelle que soit
 * la bande : un panneau qui ne changerait PAS de bande au clic aurait exactement
 * la même allure. La story donne donc une valeur distincte à chaque bande et lit
 * ce qui est affiché, seule chose qui distingue les vingt-quatre curseurs.
 */
export const AutreBande: Story = {
  args: { layer: calque({ redHue: 20, blueHue: -40 }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByDisplayValue("+ 20")).toBeInTheDocument();

    await userEvent.click(canvas.getByRole("button", { name: "Bleu" }));
    await expect(canvas.getByRole("button", { name: "Bleu" })).toHaveAttribute("aria-pressed", "true");
    await expect(canvas.getByRole("button", { name: "Rouge" })).toHaveAttribute("aria-pressed", "false");
    // Les curseurs sont ceux du BLEU, et le « + 20 » du rouge a disparu.
    await expect(canvas.getByDisplayValue("− 40")).toBeInTheDocument();
    await expect(canvas.queryByDisplayValue("+ 20")).not.toBeInTheDocument();
  },
};

/** Vue MÉLANGE : un canal à la fois, les huit bandes en colonne. « Tout » les
 *  rend tous les trois — c'est ce que le panneau rendait avant ce ticket. */
export const VueMelange: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Mélange" }));
    // Les pastilles cèdent la place aux quatre canaux.
    await expect(canvas.queryByRole("group", { name: "Couleur à régler" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Tous les canaux" })).toHaveAttribute("aria-pressed", "true");
    // « Tout » : les trois blocs, chacun de huit bandes nommées, et les trois
    // titres qui les séparent (seule vue où un bloc est titré).
    await expect(canvas.getAllByText("Rouge")).toHaveLength(3);
    await expect(canvas.getAllByText("Turquoise")).toHaveLength(3);

    // Un seul canal : huit lignes, un seul bloc, plus de titre — l'onglet actif
    // le nomme déjà.
    await userEvent.click(canvas.getByRole("button", { name: "Canal Saturation" }));
    await expect(canvas.getAllByText("Rouge")).toHaveLength(1);
  },
};

/** En NOIR ET BLANC, il n'y a plus deux vues à choisir : Lightroom remplace le
 *  mélangeur par le seul « Mélange noir et blanc ». Le sélecteur disparaît. */
export const NoirEtBlanc: Story = {
  args: { layer: calque({ mode: 1, redGray: 60, blueGray: -40 }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByText("Réglages :")).not.toBeInTheDocument();
    await expect(canvas.queryByRole("group", { name: "Couleur à régler" })).not.toBeInTheDocument();
    // « Traitement » RESTE, lui : c'est par là qu'on revient à la couleur, et
    // le bouton N&B du bandeau vit dans un AUTRE module, qui peut être replié.
    await expect(canvas.getByText("Traitement")).toBeInTheDocument();
    await expect(canvas.getByText("Mélange noir et blanc")).toBeInTheDocument();
    // Les huit bandes de mélange, nommées court, valeurs SIGNÉES (ticket 07).
    await expect(canvas.getByText("Rouge")).toBeInTheDocument();
    await expect(canvas.getByText("Magenta")).toBeInTheDocument();
  },
};
