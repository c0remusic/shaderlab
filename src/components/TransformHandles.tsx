import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { LayerTransform } from "../layers/types";
import {
  CORNER_INDICES,
  EDGE_INDICES,
  computeHandleGeometry,
  overlayRectFromClientRects,
  sameOverlayRect,
  transformFromCornerDrag,
  transformFromEdgeDrag,
  rotationFromPointer,
  snapAngle,
  type CornerIndex,
  type EdgeIndex,
  type OverlayRect,
} from "../ui/transform";
import { buildSnapTargets, snapBox, snapScales, type SnapGuide } from "../ui/snap";
import "./TransformHandles.css";

interface Props {
  transform: LayerTransform;
  photoSize: { width: number; height: number };
  bgSize: { width: number; height: number };
  /** Les AUTRES calques photo, cibles d'accroche du magnétisme. Vide = seuls
   *  les bords et médianes de la toile servent de cibles. */
  otherPhotoLayers?: readonly { transform: LayerTransform; photoSize: { width: number; height: number } }[];
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  onTransformChange: (transform: LayerTransform) => void;
  onTransformCommit: () => void;
  /**
   * Consulté AVANT de démarrer un déplacement (toile de montage T1) : rend
   * `true` si le clic appartenait à une AUTRE image, auquel cas la sélection
   * lui a été cédée et AUCUN drag ne démarre.
   *
   * Existe parce que le corps de la box est cliquable et se superpose au
   * canvas sur toute la surface du calque sélectionné : sans ce relais, un clic
   * sur une image posée PAR-DESSUS la sélection n'atteindrait jamais le canvas
   * et déplacerait la sélection courante — soit exactement le cas du collage à
   * images qui se recouvrent que T1 vise.
   *
   * Ne concerne QUE le corps de la box : les poignées de coin et de rotation
   * sont des cibles explicites et petites, elles gardent la priorité absolue.
   */
  onPickThrough?: (x: number, y: number) => boolean;
  /** Nom du calque, pour que le nom accessible du cadre dise DE QUELLE photo
   *  il s'agit. Deux photos superposées produisent sinon deux cadres portant
   *  le même nom, ce qui ne distingue rien au lecteur d'écran. */
  layerName?: string | null;
}

/** Pas de déplacement au clavier, en pixels du FOND — la même unité que les
 *  champs X/Y du panneau Photo, et la même convention que Photoshop, dont le
 *  décalage aux flèches vaut 1 pixel du DOCUMENT quel que soit le zoom (et non
 *  1 pixel d'écran, qui changerait de sens à chaque changement de zoom). */
const NUDGE_STEP_PX = 1;
const NUDGE_STEP_LARGE_PX = 10;

/** Y en BAS positif : c'est le repère de `LayerTransform`, celui du fond. */
const NUDGE_BY_KEY: Readonly<Record<string, { dx: number; dy: number }>> = {
  ArrowLeft: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 },
  ArrowUp: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 },
};

/** Écart entre le point SAISI et le centre de la poignée, en pixels du fond.
 *
 *  Sans lui, le premier `pointermove` traitait la position du pointeur comme si
 *  elle ÉTAIT le coin : saisir la poignée à trois pixels de son centre — ce qui
 *  est le cas normal, elle fait une quinzaine de pixels — téléportait le coin
 *  sous le curseur avant même que la main ait bougé. La photo sautait donc au
 *  démarrage de chaque redimensionnement (signalé à l'usage le 2026-07-31).
 *
 *  Mesuré une fois au `pointerdown` et retranché à chaque déplacement : le
 *  premier mouvement devient un no-op exact, quel que soit l'endroit de la
 *  poignée qu'on a attrapé. */
type GrabOffset = { grabDx: number; grabDy: number };

type DragKind =
  // L'index du coin tiré est indispensable : c'est lui qui désigne le coin
  // OPPOSÉ, qui doit rester immobile pendant l'échelle (`transformFromCornerDrag`).
  | ({ kind: "corner"; index: CornerIndex } & GrabOffset)
  // Même forme que `corner` et pas un booléen sur celui-ci : un côté et un coin
  // n'ont ni la même table de normales ni le même nombre d'axes touchés, les
  // confondre rendrait l'index ambigu.
  | ({ kind: "edge"; index: EdgeIndex } & GrabOffset)
  | { kind: "rotate" }
  | { kind: "move"; startX: number; startY: number; originTransform: LayerTransform };

/**
 * Overlay de poignées type Photoshop pour un calque de photo (double
 * exposure) : 4 coins pour l'échelle uniforme, 1 poignée dédiée pour la
 * rotation, corps de la box pour déplacer. Même famille de gestion pointer
 * que `MaskPainter`/le pan-zoom existants (`pointerdown`/`pointermove`/
 * `pointerup` + `setPointerCapture`) — toute la géométrie vit dans
 * `ui/transform.ts`, ce composant ne fait que traduire écran<->pixels du
 * fond et déléguer.
 */
export function TransformHandles({ transform, photoSize, bgSize, otherPhotoLayers, canvasRef, onTransformChange, onTransformCommit, onPickThrough, layerName }: Props) {
  const dragRef = useRef<DragKind | null>(null);
  /** Vrai entre le premier `keydown` de flèche et le `keyup` qui le relâche.
   *  L'appui MAINTENU répète le `keydown` mais n'émet qu'un seul `keyup` :
   *  committer sur le relâchement fait donc UNE entrée d'historique par appui,
   *  là où committer sur chaque `keydown` en aurait fait une par répétition —
   *  soit une dizaine par seconde, et un `Ctrl+Z` devenu inutilisable. */
  const nudgingRef = useRef(false);
  /** Guides ACTIFS, montrés pendant le geste seulement. Un magnétisme sans
   *  guide se lit comme une saccade : on voit la photo sauter sans savoir sur
   *  quoi, donc sans pouvoir décider si c'est ce qu'on voulait. */
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [overlayRect, setOverlayRect] = useState<OverlayRect | null>(null);

  // Cale l'overlay sur le rectangle AFFICHÉ du canvas plutôt que sur son
  // conteneur (voir `overlayRectFromClientRects` pour le défaut que ça corrige).
  // Deux rects mesurés, jamais une hypothèse de mise en page : un zoom posé sur
  // le canvas par transform CSS est déjà dans `getBoundingClientRect()`.
  const measureOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    const canvas = canvasRef.current;
    const parent = overlay?.offsetParent;
    if (!overlay || !canvas || !parent) return;
    const next = overlayRectFromClientRects(canvas.getBoundingClientRect(), parent.getBoundingClientRect());
    setOverlayRect((previous) => (previous && sameOverlayRect(previous, next) ? previous : next));
  }, [canvasRef]);

  // Sans tableau de dépendances, DÉLIBÉRÉMENT : un zoom/déplacement du canvas
  // par transform CSS ne change aucune taille de boîte, donc n'émet AUCUN
  // `ResizeObserver` — seule une mesure à chaque rendu le rattrape. La garde
  // d'égalité dans `measureOverlay` est ce qui empêche la boucle de rendu.
  // `useLayoutEffect` et non `useEffect` : la mesure doit être posée avant la
  // peinture, sinon les poignées apparaissent une frame à la mauvaise place.
  useLayoutEffect(() => {
    measureOverlay();
  });

  // Filet pour ce qui bouge SANS rendu React : redimensionnement de fenêtre,
  // ouverture/fermeture d'une colonne du dock (qui change le padding du stage,
  // donc la taille affichée du canvas).
  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = overlayRef.current?.offsetParent;
    if (!canvas || !parent) return;
    const observer = new ResizeObserver(measureOverlay);
    observer.observe(canvas);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [canvasRef, measureOverlay]);

  const screenToImagePixels = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    },
    [canvasRef],
  );

  /** Pixels ÉCRAN par pixel du FOND — ce qui convertit le seuil d'accroche.
   *  Lu sur le rect mesuré du canvas, donc le zoom (transform CSS) y est déjà. */
  const displayScale = useCallback((): number => {
    const canvas = canvasRef.current;
    if (!canvas || canvas.width === 0) return 0;
    return canvas.getBoundingClientRect().width / canvas.width;
  }, [canvasRef]);

  const { corners, edges, rotationHandle } = computeHandleGeometry(transform, photoSize);

  function toScreenStyle(point: { x: number; y: number }): React.CSSProperties {
    // Positionnement en % de l'overlay — qui coïncide maintenant exactement
    // avec le rectangle affiché du canvas (`measureOverlay`). Le % évite de
    // recalculer un pixel-ratio par poignée : une seule mesure sert aux cinq.
    return {
      left: `${(point.x / bgSize.width) * 100}%`,
      top: `${(point.y / bgSize.height) * 100}%`,
    };
  }

  function handlePointerDown(e: React.PointerEvent, kind: DragKind) {
    // BOUTON PRINCIPAL SEULEMENT. Le bouton du milieu est un geste de
    // déplacement de la VUE (`Canvas.isPanGesture`) : sans cette garde, un
    // clic du milieu sur la photo sélectionnée la déplaçait, elle, puisque le
    // cadre est au-dessus du canvas et intercepte avant lui. Il ne déplace
    // toujours pas la vue au-dessus du cadre — le geste appartient au canvas,
    // qui ne reçoit pas l'évènement — mais il ne fait plus le contraire de ce
    // qu'il annonce.
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = kind;
  }

  /** `pointerdown` sur une poignée d'échelle : mesure l'écart de saisie avant
   *  d'ouvrir le drag. Le centre de la poignée vient de la MÊME géométrie que
   *  celle qui la dessine, donc l'écart est exact et pas une approximation. */
  function handleScaleHandleDown(
    e: React.PointerEvent,
    kind: { kind: "corner"; index: CornerIndex } | { kind: "edge"; index: EdgeIndex },
  ) {
    const center = kind.kind === "corner" ? corners[kind.index] : edges[kind.index];
    const pointer = screenToImagePixels(e.clientX, e.clientY);
    handlePointerDown(e, {
      ...kind,
      grabDx: pointer ? pointer.x - center.x : 0,
      grabDy: pointer ? pointer.y - center.y : 0,
    });
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const pointer = screenToImagePixels(e.clientX, e.clientY);
    if (!pointer) return;
    // L'ÉCART DE SAISIE est retranché ici, une seule fois, pour les deux
    // gestes d'échelle : la suite du calcul reçoit le point où serait le
    // pointeur s'il avait attrapé la poignée pile en son centre.
    const aimed =
      drag.kind === "corner" || drag.kind === "edge"
        ? { x: pointer.x - drag.grabDx, y: pointer.y - drag.grabDy }
        : pointer;
    if (drag.kind === "corner") {
      // `Alt` maintenu = ancrage sur le CENTRE (l'ancien comportement, qui
      // faisait grossir la photo dans les 4 directions) ; sans `Alt`, le coin
      // opposé reste fixe, comme Photoshop. Même famille de modificateur que le
      // `Shift` de la rotation : lu sur l'événement, aucun listener clavier.
      // `Maj` CONTRAINT les proportions (convention Figma, choix utilisateur
      // 2026-07-31) : le coin est LIBRE par défaut, ce qui est le geste qui
      // manquait — jusqu'ici aucun geste ne pouvait étirer une photo.
      onTransformChange(
        withScaleSnap(
          transformFromCornerDrag(
            transform,
            photoSize,
            aimed,
            drag.index,
            e.altKey ? "center" : "oppositeCorner",
            e.shiftKey,
          ),
          e.ctrlKey,
        ),
      );
    } else if (drag.kind === "edge") {
      onTransformChange(
        withScaleSnap(
          transformFromEdgeDrag(transform, photoSize, aimed, drag.index, e.altKey ? "center" : "oppositeCorner"),
          e.ctrlKey,
        ),
      );
    } else if (drag.kind === "rotate") {
      // Snap d'angle à 15° (design 2026-07-26 §3.4) : déclencheur = `Shift`
      // maintenu pendant le drag, disponible sans aucun listener clavier.
      // La saisie au clavier dans le panneau Photo reste littérale.
      const raw = rotationFromPointer(transform, pointer);
      const rotation = e.shiftKey ? snapAngle(raw) : raw;
      onTransformChange({ ...transform, rotation });
    } else {
      const dx = pointer.x - drag.startX;
      const dy = pointer.y - drag.startY;
      const moved = { ...drag.originTransform, x: drag.originTransform.x + dx, y: drag.originTransform.y + dy };
      // `Ctrl` DÉSACTIVE l'accroche. Un magnétisme sans échappatoire empêche le
      // placement délibérément proche d'une ligne, qui est un besoin réel.
      if (e.ctrlKey) {
        setGuides([]);
        onTransformChange(moved);
        return;
      }
      const targets = buildSnapTargets(bgSize, otherPhotoLayers);
      const snap = snapBox(moved, photoSize, targets, displayScale());
      setGuides(snap.guides);
      onTransformChange({ ...moved, x: moved.x + snap.dx, y: moved.y + snap.dy });
    }
  }

  /** ACCROCHE D'ÉCHELLE seulement — pas d'accroche de position pendant un
   *  redimensionnement. Déplacer la boîte pour coller un bord sur un guide
   *  bougerait aussi l'ancre, et l'ancre immobile est l'invariant que tout
   *  `transformFromCornerDrag`/`EdgeDrag` tient. La faire céder au magnétisme
   *  échangerait un défaut visible (la photo ne colle pas au bord) contre un
   *  défaut sournois (le coin opposé glisse pendant qu'on redimensionne). */
  function withScaleSnap(next: LayerTransform, bypass: boolean): LayerTransform {
    if (bypass) {
      setGuides([]);
      return next;
    }
    setGuides([]);
    return { ...next, ...snapScales(next.scaleX, next.scaleY) };
  }

  function handlePointerUp(e: React.PointerEvent) {
    setGuides([]);
    if (!dragRef.current) return;
    if ((e.currentTarget as Element).hasPointerCapture(e.pointerId)) {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
    onTransformCommit();
  }

  /**
   * DÉPLACEMENT AU CLAVIER — le seul geste du cadre qui n'avait aucun
   * équivalent hors souris. L'échelle et la rotation, elles, sont déjà
   * atteignables au clavier par les champs Largeur/Hauteur et Angle du panneau
   * Photo : c'est ce qui satisfait WCAG 2.1.1 sans avoir à rendre les dix
   * pastilles focusables une à une (voir le commentaire du polygone).
   *
   * AUCUNE accroche ici, délibérément, et c'est aussi le choix de Photoshop :
   * le magnétisme sert à poser vite à la souris. Au clavier on demande
   * exactement un pixel — un pas qui se ferait avaler par une accroche serait
   * un pas qui ne fait rien, sans que rien ne le dise.
   */
  function handleKeyDown(e: React.KeyboardEvent) {
    // Un geste souris en cours a la priorité : deux sources de mouvement
    // simultanées écriraient chacune par-dessus l'autre.
    if (dragRef.current) return;
    if (e.key === "Escape") {
      // Rendre le focus, rien de plus. « Annuler la transformation » au sens
      // de Photoshop demanderait une session modale avec un instantané
      // d'avant, que cet overlay n'a pas : il est affiché en permanence et
      // chaque geste committe déjà dans l'historique. L'annulation, c'est
      // Ctrl+Z (App.tsx). Quitter l'OUTIL, c'est le Échap global du même
      // fichier, qui reçoit cet évènement par bouillonnement.
      (e.currentTarget as SVGElement).blur();
      return;
    }
    const nudge = NUDGE_BY_KEY[e.key];
    if (!nudge) return;
    // Sans ça, les flèches font défiler la zone de travail sous le cadre.
    e.preventDefault();
    const step = e.shiftKey ? NUDGE_STEP_LARGE_PX : NUDGE_STEP_PX;
    nudgingRef.current = true;
    onTransformChange({ ...transform, x: transform.x + nudge.dx * step, y: transform.y + nudge.dy * step });
  }

  function handleKeyUp(e: React.KeyboardEvent) {
    if (!(e.key in NUDGE_BY_KEY) || !nudgingRef.current) return;
    nudgingRef.current = false;
    onTransformCommit();
  }

  function handlePointerCancel(e: React.PointerEvent) {
    setGuides([]);
    // Perte de capture (alt-tab, interruption OS/tactile) : annule le drag
    // SANS committer, contrairement à pointerup — même sémantique que
    // dragReorder.ts (pointercancel n'est pas un dépôt valide). Évite un
    // état de drag stale et une modif de transform jamais commitée.
    if (!dragRef.current) return;
    if ((e.currentTarget as Element).hasPointerCapture(e.pointerId)) {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
  }

  return (
    <div
      ref={overlayRef}
      className="transform-handles"
      // Rendu invisible tant que la mesure n'a pas eu lieu : un overlay
      // dimensionné par défaut afficherait des poignées hors de la photo.
      style={overlayRect ?? { width: 0, height: 0 }}
    >
      {overlayRect && (
        <>
          {/* Le contour est le QUADRILATÈRE réel de la photo transformée, pas
              son englobante alignée aux axes : cette dernière est strictement
              plus grande dès qu'il y a une rotation, et laissait un cadre droit
              trop grand avec les pastilles flottant à l'intérieur. Un SVG à
              `viewBox` en pixels du fond mappe exactement comme le % des
              pastilles (`toScreenStyle`), donc contour et pastilles ne peuvent
              pas diverger ; `non-scaling-stroke` garde un trait de 1px quel que
              soit le facteur d'affichage. Le corps cliquable est le `fill` de ce
              même polygone — un clic dans un coin de l'ancienne englobante,
              hors de la photo tournée, n'attrape donc plus rien. */}
          <svg
            className="transform-handles__outline"
            viewBox={`0 0 ${bgSize.width} ${bgSize.height}`}
            preserveAspectRatio="none"
            // `presentation` et NON `aria-hidden="true"`, qui était posé ici :
            // `aria-hidden` retire tout le SOUS-ARBRE de l'arbre
            // d'accessibilité, donc le polygone de déplacement ci-dessous
            // aurait été focusable au clavier tout en restant invisible pour un
            // lecteur d'écran — le pire des deux états. `presentation` ne retire
            // que la sémantique propre du `<svg>` ; ses enfants gardent la leur.
            role="presentation"
          >
            {/* GUIDES D'ACCROCHE. Tracés dans le MÊME svg que le cadre, donc
                dans le même viewBox en pixels du fond : une ligne à `value`
                tombe exactement là où l'accroche l'a calculée, sans seconde
                conversion qui pourrait diverger. Ils traversent tout le cadre
                parce qu'un guide qui s'arrêterait à la boîte ne montrerait pas
                sur QUOI elle s'aligne. */}
            {guides.map((guide) => (
              <line
                key={`${guide.axis}-${guide.value}`}
                className="transform-handles__guide"
                x1={guide.axis === "x" ? guide.value : 0}
                x2={guide.axis === "x" ? guide.value : bgSize.width}
                y1={guide.axis === "y" ? guide.value : 0}
                y2={guide.axis === "y" ? guide.value : bgSize.height}
                vectorEffect="non-scaling-stroke"
                aria-hidden="true"
              />
            ))}
            {/* HALO. Le même quadrilatère, tracé d'abord en encre sombre et
                plus large. Sans lui le cadre était un seul trait sombre
                semi-transparent (`--outline-contrast`) : invisible sur une
                photo sombre, c'est-à-dire précisément là où on recadre un ciel
                de nuit ou une silhouette à contre-jour — signalé à l'usage le
                2026-07-31. Un cadre doit se lire sur N'IMPORTE quel contenu, et
                aucune couleur unique ne le peut : il faut le contraste d'une
                paire. `pointer-events: none` — la prise reste sur le polygone
                du dessus, un seul et même chemin, donc la zone cliquable ne
                bouge pas d'un pixel. */}
            <polygon
              className="transform-handles__box-halo"
              points={corners.map((corner) => `${corner.x},${corner.y}`).join(" ")}
              vectorEffect="non-scaling-stroke"
              aria-hidden="true"
            />
            {/* SEULE CIBLE CLAVIER de l'overlay, et le nom accessible de tout
                le cadre. Le choix de n'en avoir qu'une est celui de Photoshop,
                dont les poignées sont souris-seulement : ce que WCAG 2.1.1
                exige est que chaque FONCTION soit atteignable au clavier, pas
                chaque pastille. Déplacer l'est ici (flèches) ; redimensionner
                et tourner le sont par les champs Largeur/Hauteur et Angle du
                panneau Photo. Un anneau à dix poignées aurait construit un
                second chemin, à deux modes, pour des fonctions déjà couvertes.

                `role="application"` et non `group` : en mode navigation, un
                lecteur d'écran s'approprie les flèches pour parcourir la page.
                C'est le rôle qui les laisse arriver jusqu'ici — sans lui, le
                déplacement au clavier ne marcherait que pour les utilisateurs
                sans lecteur d'écran, c'est-à-dire pas pour ceux qu'il vise. */}
            <polygon
              className="transform-handles__box"
              points={corners.map((corner) => `${corner.x},${corner.y}`).join(" ")}
              vectorEffect="non-scaling-stroke"
              tabIndex={0}
              role="application"
              aria-label={`Cadre de transformation${layerName ? ` de ${layerName}` : ""} — flèches pour déplacer, Maj+flèches par pas de ${NUDGE_STEP_LARGE_PX} px`}
              onKeyDown={handleKeyDown}
              onKeyUp={handleKeyUp}
              onPointerDown={(e) => {
                // Même garde que `handlePointerDown`, mais AVANT la désignation :
                // un clic du milieu ne doit pas non plus céder la sélection à
                // l'image du dessous, c'est un geste de vue, pas de document.
                if (e.button !== 0) return;
                const origin = screenToImagePixels(e.clientX, e.clientY);
                // Une image posée par-dessus reprend la sélection au lieu de laisser
                // la box déplacer le calque courant (voir `onPickThrough`).
                if (origin && onPickThrough?.(origin.x, origin.y)) {
                  e.stopPropagation();
                  return;
                }
                handlePointerDown(e, { kind: "move", startX: origin?.x ?? 0, startY: origin?.y ?? 0, originTransform: transform });
              }}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
            />
          </svg>
          {/* LES NEUF PASTILLES qui suivent (4 coins, 4 côtés, rotation) sont
              `aria-hidden` : ce sont des affordances de SOURIS, et leurs
              fonctions ont chacune un équivalent clavier ailleurs (champs
              Largeur/Hauteur et Angle du panneau Photo). Les exposer sans les
              rendre actionnables au clavier annoncerait à un lecteur d'écran
              neuf contrôles dont aucun ne répondrait — une promesse en creux,
              pire que le silence. La divergence est assumée et documentée,
              pas subie. */}
          {CORNER_INDICES.map((index) => (
            <div
              key={index}
              aria-hidden="true"
              // Les quatre coins ne partagent PAS la même diagonale. 0 (haut-gauche)
              // et 2 (bas-droit) sont sur l'axe ↖↘ ; 1 (haut-droit) et 3
              // (bas-gauche) sur l'axe ↗↙. Une seule règle CSS pour les quatre
              // affichait donc une flèche à l'envers sur deux d'entre eux —
              // elle annonçait un geste et le contrôle en faisait un autre.
              className={`transform-handles__corner transform-handles__corner--${index % 2 === 0 ? "nwse" : "nesw"}`}
              style={toScreenStyle(corners[index])}
              onPointerDown={(e) => handleScaleHandleDown(e, { kind: "corner", index })}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
            />
          ))}
          {/* POIGNÉES DE CÔTÉ. Elles n'existaient pas tant que l'échelle était
              unique : sans second axe, une poignée de côté aurait fait
              exactement ce que fait un coin. Chacune ne touche QUE l'axe de sa
              normale, en repère local — tirer la poignée droite d'une photo
              tournée à 30° étire toujours sa largeur À ELLE. */}
          {EDGE_INDICES.map((index) => (
            <div
              key={`edge-${index}`}
              aria-hidden="true"
              className={`transform-handles__edge transform-handles__edge--${index % 2 === 0 ? "vertical" : "horizontal"}`}
              style={toScreenStyle(edges[index])}
              onPointerDown={(e) => handleScaleHandleDown(e, { kind: "edge", index })}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
            />
          ))}
          <div
            className="transform-handles__rotation"
            aria-hidden="true"
            style={toScreenStyle(rotationHandle)}
            onPointerDown={(e) => handlePointerDown(e, { kind: "rotate" })}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
          />
        </>
      )}
    </div>
  );
}
