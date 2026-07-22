import type { Meta, StoryObj } from "@storybook/react-vite";
import { AlertTriangle } from "lucide-react";
import { Alert, AlertTitle, AlertDescription } from "./alert";

const meta: Meta<typeof Alert> = {
  title: "Components/ui/Alert",
  component: Alert,
  args: {
    variant: "default",
    children: (
      <>
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>Attention</AlertTitle>
        <AlertDescription>Le fichier sélectionné n'est pas un JPEG valide.</AlertDescription>
      </>
    ),
  },
};

export default meta;
type Story = StoryObj<typeof Alert>;

export const Default: Story = {};

export const Destructive: Story = {
  args: { variant: "destructive" },
};
