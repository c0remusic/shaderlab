import type { Meta, StoryObj } from "@storybook/react-vite";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

function DropdownMenuDemo() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="secondary">Ajouter une source</Button>} />
      <DropdownMenuContent align="start">
        <DropdownMenuLabel>Sources de masque</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem>Dégradé</DropdownMenuItem>
        <DropdownMenuItem>Luminosité</DropdownMenuItem>
        <DropdownMenuItem>Plage de couleur</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const meta: Meta<typeof DropdownMenuDemo> = {
  title: "Components/ui/DropdownMenu",
  component: DropdownMenuDemo,
};

export default meta;
type Story = StoryObj<typeof DropdownMenuDemo>;

export const Default: Story = {};
