import type { ReactNode, MouseEvent } from "react";
import { Image as PhotoLayerIcon, Plus, Sparkles as EffectLayerIcon } from "lucide-react";
import type { LayerLocks, LayerState } from "../layers/types";
import { mergeDownVerdict, stampVerdict } from "../layers/flatten";
import { isFullyLocked } from "../layers/layerLocks";
import {
  ContextMenu,
  ContextMenuCheckboxItem,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "./ui/context-menu";
import { LayerActionsMenuItems } from "./layerActionsMenu";

/** Un calque à présenter dans le menu de la toile : son id, le NOM affiché (déjà
 *  résolu — `layer.name` ou le nom de l'effet) et son GENRE (pour l'icône).
 *  `App` construit ces items au clic droit, à partir de `hitTestAll` et du
 *  registre d'effets ; ce composant ne les recalcule pas. */
export interface CanvasMenuLayer {
  id: string;
  name: string;
  kind: "photo" | "effect";
}

interface Props {
  /** La toile et ses overlays. Le déclencheur de menu les ENVELOPPE (un
   *  `display: contents`, aucune boîte, donc la mise en page de la toile est
   *  intacte) : un clic droit n'importe où dedans remonte jusqu'à lui. */
  children: ReactNode;
  /** Mesure le point cliqué (`App` : hit-test + registre) et remplit
   *  `placed`/`fullFrame`. Ne fait qu'écrire un état ; n'annule ni n'arrête
   *  l'événement, pour que Base UI ouvre son menu à la position du pointeur et
   *  que le garde global de `main.tsx` retire le menu natif de WebView2. */
  onContextMenu: (event: MouseEvent) => void;
  /** Calques placés/photo sous le curseur, du HAUT vers le BAS. */
  placed: CanvasMenuLayer[];
  /** Effets PLEIN CADRE (sans ancrage) sous le curseur, du HAUT vers le BAS.
   *  Ils couvrent toute la toile, donc les mettre avec les calques placés
   *  ferait de la liste la pile entière à chaque clic — d'où le second groupe,
   *  séparé (ticket 29). */
  fullFrame: CanvasMenuLayer[];
  /** Pile COMPLÈTE, pour résoudre le calque SÉLECTIONNÉ et ses verdicts
   *  d'aplatissement — mêmes fonctions PURES que la zone de contrôles
   *  (`stampVerdict`/`mergeDownVerdict`), jamais une copie. */
  layers: LayerState[];
  selectedId: string | null;
  /** Un clic sur un item de la liste SÉLECTIONNE ce calque. Les items sont des
   *  cases (Base UI ne ferme pas le menu à leur bascule) : le menu reste ouvert
   *  et sa section d'actions se recale sur le calque fraîchement sélectionné —
   *  c'est ce qui permet « choisir un calque puis Aplatir » dans un seul menu. */
  onSelectLayer: (id: string) => void;
  /** Aucun calque sous le curseur : « Ajouter un effet… » seul, comme le vide de
   *  la pile — `App` ouvre le sélecteur existant. Grisé sans image. */
  hasImage: boolean;
  onAddEffect: () => void;
  /** ACTIONS du calque SÉLECTIONNÉ, réutilisées du ticket 28 via
   *  `LayerActionsMenuItems` — exactement les handlers d'`App`, aucun neuf. */
  onToggle: (id: string, altKey: boolean) => void;
  onDuplicate: (id: string) => void;
  onStamp: (id: string) => void;
  onMergeDown: (id: string) => void;
  onToggleLock: (id: string, which: keyof LayerLocks, value: boolean) => void;
  onRemove: (id: string) => void;
  /** OUVRE le renommage en place (ticket 31) de la ligne du calque sélectionné,
   *  dans la pile — le champ d'édition vit sur la ligne, pas ici. */
  onStartRename: (id: string) => void;
}

/**
 * MENU CONTEXTUEL DE LA TOILE (ticket 29, tranche 2 du clic droit).
 *
 * Sous l'outil Déplacement de Photoshop, un clic droit sur la toile liste les
 * calques qui ont un pixel sous le curseur ; ce menu fait pareil, puis y ajoute
 * les actions du ticket 28 sur le calque SÉLECTIONNÉ. Il n'a AUCUNE logique : la
 * liste et le partage placé/plein-cadre sont calculés par `App` (qui a le
 * hit-test et le registre), les verdicts sortent de fonctions PURES, et chaque
 * action appelle un handler reçu. Le clic droit NE DÉPEND PAS de la case
 * « Sélection auto » : il liste toujours tous les genres.
 */
export function CanvasContextMenu({
  children,
  onContextMenu,
  placed,
  fullFrame,
  layers,
  selectedId,
  onSelectLayer,
  hasImage,
  onAddEffect,
  onToggle,
  onDuplicate,
  onStamp,
  onMergeDown,
  onToggleLock,
  onRemove,
  onStartRename,
}: Props) {
  const hasLayers = placed.length > 0 || fullFrame.length > 0;
  const selectedLayer = selectedId !== null ? layers.find((l) => l.id === selectedId) ?? null : null;
  const stamp = selectedLayer ? stampVerdict(layers, selectedLayer.id) : null;
  const merge = selectedLayer ? mergeDownVerdict(layers, selectedLayer.id) : null;

  const renderGroup = (items: CanvasMenuLayer[]) =>
    items.map((item) => (
      <ContextMenuCheckboxItem
        key={item.id}
        checked={item.id === selectedId}
        onCheckedChange={() => onSelectLayer(item.id)}
      >
        {item.kind === "photo" ? (
          <PhotoLayerIcon className="icon-sm icon-stroke" aria-hidden="true" />
        ) : (
          <EffectLayerIcon className="icon-sm icon-stroke" aria-hidden="true" />
        )}
        {item.name}
      </ContextMenuCheckboxItem>
    ));

  return (
    <ContextMenu>
      <ContextMenuTrigger
        render={
          // `display: contents` : le déclencheur n'a AUCUNE boîte, donc le
          // `.pasteboard` reste enfant effectif de `.workspace` et sa chaîne de
          // hauteurs `100%` est intacte (un vrai bloc l'aurait cassée). Il reste
          // dans l'arbre du DOM, donc reçoit bien le `contextmenu` par
          // bouillonnement depuis la toile et ses overlays.
          <div className="workspace__canvas-context" style={{ display: "contents" }} onContextMenu={onContextMenu} />
        }
      >
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent aria-label="Actions de la toile">
        {!hasLayers ? (
          // AUCUN calque sous le curseur : « Ajouter un effet… » seul, comme le
          // vide de la pile.
          <ContextMenuItem disabled={!hasImage} onClick={onAddEffect}>
            <Plus className="icon-sm icon-stroke" aria-hidden="true" />
            Ajouter un effet…
          </ContextMenuItem>
        ) : (
          <>
            {renderGroup(placed)}
            {placed.length > 0 && fullFrame.length > 0 && <ContextMenuSeparator />}
            {renderGroup(fullFrame)}
            {selectedLayer && stamp && merge && (
              <>
                <ContextMenuSeparator />
                <LayerActionsMenuItems
                  layer={selectedLayer}
                  stampOk={stamp.ok}
                  stampReason={stamp.ok ? "" : stamp.reason}
                  mergeOk={merge.ok}
                  mergeReason={merge.ok ? "" : merge.reason}
                  removable={!isFullyLocked(selectedLayer)}
                  onToggle={onToggle}
                  onDuplicate={onDuplicate}
                  onStamp={onStamp}
                  onMergeDown={onMergeDown}
                  onToggleLock={onToggleLock}
                  onRemove={onRemove}
                  onStartRename={onStartRename}
                />
              </>
            )}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
