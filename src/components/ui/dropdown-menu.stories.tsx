import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { expect, fn, screen, userEvent, within } from "storybook/test";
import { Button } from "./button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu";

function DropdownMenuDemo() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="secondary">Ajouter une source</Button>} />
      <DropdownMenuContent align="start">
        {/* base-ui Menu.GroupLabel must live inside a Menu.Group. */}
        <DropdownMenuGroup>
          <DropdownMenuLabel>Sources de masque</DropdownMenuLabel>
          <DropdownMenuItem>Dégradé</DropdownMenuItem>
          <DropdownMenuItem>Luminosité</DropdownMenuItem>
          <DropdownMenuItem>Plage de couleur</DropdownMenuItem>
        </DropdownMenuGroup>
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

// --- Variants ---

export const WithShortcutsAndDestructive: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="secondary">Calque</Button>} />
      <DropdownMenuContent align="start">
        <DropdownMenuItem>
          Dupliquer
          <DropdownMenuShortcut>⌘D</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem>
          Renommer
          <DropdownMenuShortcut>⏎</DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive">
          Supprimer
          <DropdownMenuShortcut>⌫</DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

export const WithDisabledItem: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="secondary">Exporter</Button>} />
      <DropdownMenuContent align="start">
        <DropdownMenuItem>PNG</DropdownMenuItem>
        <DropdownMenuItem>JPEG</DropdownMenuItem>
        <DropdownMenuItem disabled>WebP (indisponible)</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

function CheckboxItemsDemo() {
  const [showGrid, setShowGrid] = useState(true);
  const [showRulers, setShowRulers] = useState(false);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="secondary">Affichage</Button>} />
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Repères</DropdownMenuLabel>
          <DropdownMenuCheckboxItem checked={showGrid} onCheckedChange={setShowGrid}>
            Grille
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem checked={showRulers} onCheckedChange={setShowRulers}>
            Règles
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const WithCheckboxItems: Story = {
  render: () => <CheckboxItemsDemo />,
};

function RadioGroupDemo() {
  const [blend, setBlend] = useState("normal");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="secondary">Fusion</Button>} />
      <DropdownMenuContent align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Mode de fusion</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={blend} onValueChange={setBlend}>
            <DropdownMenuRadioItem value="normal">Normal</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="multiply">Produit</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="screen">Écran</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const WithRadioGroup: Story = {
  render: () => <RadioGroupDemo />,
};

export const WithSubmenu: Story = {
  render: () => (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="secondary">Ajouter une source</Button>} />
      <DropdownMenuContent align="start">
        <DropdownMenuItem>Dégradé</DropdownMenuItem>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>Bruit</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            <DropdownMenuItem>Perlin</DropdownMenuItem>
            <DropdownMenuItem>Voronoï</DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};

// --- Interaction tests (play) ---
// GOTCHA: base-ui renders the opened menu in a PORTAL outside canvasElement.
// The trigger lives in canvasElement; the menu + items must be queried via `screen`.

export const OpensOnClick: Story = {
  render: () => <DropdownMenuDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = await canvas.findByRole("button", { name: "Ajouter une source" });

    await userEvent.click(trigger);

    // Menu content is portalled — query the document, not the canvas.
    const item = await screen.findByRole("menuitem", { name: "Dégradé" }, { timeout: 3000 });
    await expect(item).toBeInTheDocument();
    await expect(screen.getByRole("menuitem", { name: "Plage de couleur" })).toBeInTheDocument();
  },
};

function SelectableDemo({ onSelect }: { onSelect: (value: string) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="secondary">Ajouter une source</Button>} />
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => onSelect("Dégradé")}>Dégradé</DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSelect("Luminosité")}>Luminosité</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export const SelectsItem: Story = {
  args: {
    // Spy passed through args, consumed by the render below.
    onSelect: fn(),
  } as { onSelect: ReturnType<typeof fn> },
  render: (args) => <SelectableDemo onSelect={(args as { onSelect: (v: string) => void }).onSelect} />,
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    const trigger = canvas.getByRole("button", { name: "Ajouter une source" });

    await userEvent.click(trigger);

    // Portalled item — find via screen.
    const item = await screen.findByRole("menuitem", { name: "Luminosité" });
    await userEvent.click(item);

    await expect((args as { onSelect: ReturnType<typeof fn> }).onSelect).toHaveBeenCalledWith(
      "Luminosité",
    );
  },
};
