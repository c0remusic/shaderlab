import type { Meta, StoryObj } from "@storybook/react-vite";
import { AlertTriangle, Info, X, XCircle } from "lucide-react";
import { Alert, AlertTitle, AlertDescription, AlertAction } from "./alert";
import { IconButton } from "./icon-button";

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
  argTypes: {
    variant: {
      control: "select",
      options: ["default", "destructive"],
    },
  },
};

export default meta;
type Story = StoryObj<typeof Alert>;

// --- Variants (one named export per cva `variant` value) ---

export const Default: Story = {};

export const Destructive: Story = {
  args: {
    variant: "destructive",
    children: (
      <>
        <XCircle aria-hidden="true" />
        <AlertTitle>Échec de l'export</AlertTitle>
        <AlertDescription>Le rendu n'a pas pu être écrit sur le disque.</AlertDescription>
      </>
    ),
  },
};

// --- Content states ---

export const NoIcon: Story = {
  args: {
    children: (
      <>
        <AlertTitle>Rendu terminé</AlertTitle>
        <AlertDescription>Le fichier a été exporté avec succès.</AlertDescription>
      </>
    ),
  },
};

export const TitleOnly: Story = {
  args: {
    children: (
      <>
        <Info aria-hidden="true" />
        <AlertTitle>Aucun calque sélectionné</AlertTitle>
      </>
    ),
  },
};

export const DescriptionOnly: Story = {
  args: {
    children: (
      <>
        <Info aria-hidden="true" />
        <AlertDescription>Ajustez le curseur pour prévisualiser le masque.</AlertDescription>
      </>
    ),
  },
};

export const WithLink: Story = {
  args: {
    children: (
      <>
        <Info aria-hidden="true" />
        <AlertTitle>Mise à jour disponible</AlertTitle>
        <AlertDescription>
          Une nouvelle version est prête. <a href="#">Voir les notes de version</a>.
        </AlertDescription>
      </>
    ),
  },
};

export const WithAction: Story = {
  args: {
    children: (
      <>
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>Modifications non enregistrées</AlertTitle>
        <AlertDescription>Votre session expire dans 2 minutes.</AlertDescription>
        <AlertAction>
          <IconButton label="Fermer l'alerte">
            <X className="icon-sm icon-stroke" aria-hidden="true" />
          </IconButton>
        </AlertAction>
      </>
    ),
  },
};

export const LongContent: Story = {
  args: {
    className: "max-w-[360px]",
    children: (
      <>
        <AlertTriangle aria-hidden="true" />
        <AlertTitle>Résolution élevée détectée</AlertTitle>
        <AlertDescription>
          L'image chargée mesure 8192 × 8192 pixels. Le rendu de masques complexes à cette
          résolution peut ralentir considérablement l'aperçu en temps réel et augmenter la
          consommation mémoire du GPU. Envisagez de travailler sur une version réduite puis
          d'exporter à pleine résolution.
        </AlertDescription>
      </>
    ),
  },
};
