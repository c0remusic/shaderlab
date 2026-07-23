import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { ErrorBanner } from "./ErrorBanner";

const meta: Meta<typeof ErrorBanner> = {
  title: "Components/ErrorBanner",
  component: ErrorBanner,
  args: {
    message: "Impossible de charger le shader.",
    onDismiss: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof ErrorBanner>;

export const Default: Story = {};

export const LongMessage: Story = {
  args: {
    message:
      "Le fichier sélectionné n'a pas pu être analysé — vérifiez qu'il s'agit bien d'un shader WGSL valide et réessayez.",
  },
};

// --- Message variants ---

export const ShortMessage: Story = {
  args: { message: "Échec." },
};

export const FileError: Story = {
  args: { message: "Le fichier dépasse la taille maximale de 32 Mo." },
};

export const UnbrokenLongToken: Story = {
  args: {
    message:
      "Chemin invalide : C:/Users/antoine/Pictures/exports/rendu-final-tres-long-sans-espaces-pour-tester-overflow.jpeg",
  },
};

// --- Interaction test (play) ---

export const DismissCallsHandler: Story = {
  args: {
    onDismiss: fn(),
  },
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const dismiss = canvas.getByRole("button", { name: "Fermer" });

    await userEvent.click(dismiss);

    await expect(args.onDismiss).toHaveBeenCalledTimes(1);
  },
};
