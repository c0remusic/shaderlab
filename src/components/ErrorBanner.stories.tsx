import type { Meta, StoryObj } from "@storybook/react-vite";
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
