import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { IconButton } from "./ui/icon-button";
import { hexToHsl, hslToHex, hslToRgb } from "../ui/hsl";
import { draftKeyAction } from "../ui/draftField";
import "./ColorPickerPanel.css";

export interface ColorPickerPanelProps {
  label: string;
  hue: number;
  saturation: number;
  lightness: number;
  onChange: (values: { hue?: number; saturation?: number; lightness?: number }) => void;
  onCommit: () => void;
  onClose: () => void;
  /** Haut du déclencheur (la pastille), relatif au conteneur positionné —
   *  le panneau s'aligne dessus, en restant dans les bornes de ce conteneur. */
  anchorTop: number;
  /** Ancrage HORIZONTAL seulement (`right`) : le vertical vient de `anchorTop`. */
  style?: React.CSSProperties;
}

/** Doit rester égal au token `--color-picker-sv-size` (components.css) : un
 *  <canvas> exige ses dimensions en attributs numériques, pas en CSS. */
const SV_SIZE = 140;

/** Pas large de la teinte (Maj+flèche, Page↑/Page↓), en degrés. */
const COARSE_HUE_STEP = 10;

/** Touches qui font BOUGER la valeur d'un curseur — donc celles dont le
 *  relâchement clôt une interaction et mérite une entrée d'historique. C'est
 *  le jeu que `<input type="range">` traite nativement, et que la bande de
 *  teinte doit reproduire à la main faute d'élément natif dessous. */
const VALUE_KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);

/** Saturation/lightness square for a FIXED hue — HSL's "S" axis maps to
 *  the square's X, and "L" to Y inverted (top = light, bottom = dark),
 *  matching the common SV-picker convention users already expect. */
function drawSvSquare(canvas: HTMLCanvasElement, hue: number) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { width, height } = canvas;
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;
  for (let y = 0; y < height; y += 1) {
    const lightness = 1 - y / (height - 1);
    for (let x = 0; x < width; x += 1) {
      // hslToRgb (numérique) et NON hslToHex : la version par chaîne coûtait
      // 4,65 ms par redessin contre 0,76 ms ici — un glissement sur la bande
      // de teinte redessine les 19 600 pixels à chaque image.
      const { r, g, b } = hslToRgb(hue, x / (width - 1), lightness);
      const i = (y * width + x) * 4;
      data[i] = r * 255;
      data[i + 1] = g * 255;
      data[i + 2] = b * 255;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
}

export function ColorPickerPanel({ label, hue, saturation, lightness, onChange, onCommit, onClose, anchorTop, style }: ColorPickerPanelProps) {
  const svCanvasRef = useRef<HTMLCanvasElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // `anchorTop` aligne le panneau sur sa pastille, mais une pastille en bas de
  // l'inspecteur ferait déborder le panneau hors de l'espace de travail (il
  // est en overflow: hidden — il serait rogné, pas scrollable). Le clamp se
  // fait ICI et pas chez l'appelant : seul le panneau connaît sa propre
  // hauteur, qui dépend de son contenu.
  const [top, setTop] = useState(anchorTop);
  useLayoutEffect(() => {
    const el = panelRef.current;
    const container = el?.offsetParent as HTMLElement | null;
    if (!el || !container) return;
    const gutter = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--space-6")) || 0;
    const maxTop = container.clientHeight - el.offsetHeight - gutter;
    setTop(Math.max(gutter, Math.min(anchorTop, maxTop)));
  }, [anchorTop]);
  // Only the user's in-progress typed draft lives in state — the field
  // otherwise mirrors the live hue/saturation/lightness props (so a SV/hue
  // drag keeps the hex text in sync instead of showing the color from when
  // the picker opened). Cleared on successful commit AND on blur/Enter even
  // when invalid, so a bad entry reverts to showing the live color again
  // rather than leaving a stuck bad string.
  const [draft, setDraft] = useState<string | null>(null);
  const abandonHexRef = useRef(false);
  const lastDrawnHueRef = useRef<number | null>(null);

  // Redraw the SV square only when hue actually changed (not on every
  // saturation/lightness drag) — the grid's colors depend on hue alone.
  // useLayoutEffect (not the render body) because on the FIRST render
  // svCanvasRef.current is still null — refs attach during commit, which
  // happens after the render body runs — so a render-body guard would draw
  // nothing on initial mount and leave the canvas blank until some unrelated
  // re-render happened to fire. useLayoutEffect runs after the ref is
  // attached (including on mount) and, like the render-body version, only
  // reruns when `hue` itself changes — so a saturation/lightness drag still
  // doesn't trigger a redraw. Layout (not passive) effect avoids a visible
  // blank-canvas flash before the first paint.
  useLayoutEffect(() => {
    const canvas = svCanvasRef.current;
    if (!canvas || lastDrawnHueRef.current === hue) return;
    drawSvSquare(canvas, hue);
    lastDrawnHueRef.current = hue;
  }, [hue]);

  const handleSvPointer = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const canvas = svCanvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
      onChange({ saturation: x, lightness: 1 - y });
    },
    [onChange]
  );

  const handleHuePointer = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
      onChange({ hue: x * 360 });
    },
    [onChange]
  );

  // Pas de souris = pas de couleur : le carré SV et la bande de teinte
  // n'étaient pilotables qu'au pointeur, le champ Hex étant le seul repli
  // clavier — et il exige de taper une valeur complète, sans réglage fin
  // (audit pré-release 2026-07-30, finding U3).
  // Le commit vit sur `keyup`, pas sur `keydown` : une touche maintenue répète
  // l'événement, et committer à chaque répétition remplirait l'historique
  // d'undo d'un pas par frame. Même découpage que pointerdown/pointerup.
  //
  // Le jeu de touches est celui que `LabeledSlider` annonce dans son contrat
  // (labeled-slider.tsx:24-27 — « flèches/Home/End/PageUp/PageDown ») et que
  // les deux `input type="range"` du carré tiennent nativement. La bande de
  // teinte n'a pas d'élément natif dessous : elle doit le reproduire à la
  // main, sinon elle est le seul contrôle du panneau à ignorer la moitié du
  // jeu — et une touche ignorée n'est pas inerte, elle remonte au conteneur
  // défilant, qui déroule la colonne du dock pendant que le focus est sur le
  // curseur.
  const handleHueKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? COARSE_HUE_STEP : 1;
      // La teinte est cyclique : on enroule au lieu de buter à 0/360.
      const wrap = (next: number) => ((next % 360) + 360) % 360;
      switch (event.key) {
        case "ArrowLeft":
        case "ArrowDown":
          onChange({ hue: wrap(hue - step) });
          break;
        case "ArrowRight":
        case "ArrowUp":
          onChange({ hue: wrap(hue + step) });
          break;
        case "PageDown":
          onChange({ hue: wrap(hue - COARSE_HUE_STEP) });
          break;
        case "PageUp":
          onChange({ hue: wrap(hue + COARSE_HUE_STEP) });
          break;
        case "Home":
          onChange({ hue: 0 });
          break;
        case "End":
          // 360 et 0 sont le MÊME rouge : sur un axe cyclique, End ne mène pas
          // à une autre couleur, il pose le curseur au bout droit de la bande.
          // La valeur reste dans `aria-valuemin`..`aria-valuemax` et dans les
          // bornes du paramètre (duotone.ts:12 — hue min 0, max 360).
          onChange({ hue: 360 });
          break;
        default:
          return;
      }
      event.preventDefault();
    },
    [onChange, hue]
  );

  const commitOnValueKeyUp = useCallback(
    (event: React.KeyboardEvent) => {
      if (!VALUE_KEYS.has(event.key)) return;
      onCommit();
    },
    [onCommit]
  );

  const commitHexInput = useCallback(() => {
    // Abandon lu sur une REF, jamais sur l'état : le commit du `blur` court
    // AVANT le re-render, donc un `setDraft(null)` posé à la frappe d'`Échap`
    // ne serait pas encore visible ici et la saisie partirait quand même. Même
    // piège, et même parade, que `NumberField` et `LabeledSlider` — voir
    // `ui/draftField`.
    if (abandonHexRef.current) {
      abandonHexRef.current = false;
      setDraft(null);
      return;
    }
    if (draft === null) return;
    const match = /^#?[0-9a-fA-F]{6}$/.test(draft);
    if (!match) {
      setDraft(null); // revert invalid input — falls back to showing the live color again
      return;
    }
    const parsed = hexToHsl(draft);
    onChange(parsed);
    onCommit();
    setDraft(null);
  }, [draft, onChange, onCommit]);

  const currentHex = hslToHex(hue, saturation, lightness);

  return (
    <div ref={panelRef} className="color-picker-panel" style={{ ...style, top }} role="dialog" aria-label={`Sélecteur de couleur — ${label}`}>
      <div className="color-picker-panel__header">
        <span className="color-picker-panel__title">{label}</span>
        <IconButton label="Fermer le sélecteur de couleur" size="compact" onClick={onClose}>
          <X className="icon-sm icon-stroke" aria-hidden />
        </IconButton>
      </div>
      <div className="color-picker-panel__body">
        <div className="color-picker-panel__sv-wrap">
          {/* CLAVIER — deux `<input type="range">` natifs en `sr-only` plutôt
              qu'un rôle ARIA sur le carré. Trois tentatives ont été écartées :
              `role="slider"` sur le carré ment (il pilote DEUX valeurs, un seul
              `aria-valuenow` en cacherait une), `role="application"` est classé
              non interactif par `jsx-a11y` donc invalide avec `tabIndex`, et un
              canvas rendu focusable devient interactif — un rôle non interactif
              dessus est refusé pour la même raison. Les contrôles natifs
              n'inventent rien : nom, valeur, pas et flèches viennent du
              navigateur. Le focus reste visible parce que l'enveloppe porte un
              `:focus-within` (ColorPickerPanel.css).
              Audit pré-release 2026-07-30, finding U3. */}
          <input
            type="range"
            className="sr-only"
            aria-label="Saturation"
            min={0}
            max={100}
            step={1}
            value={Math.round(saturation * 100)}
            onChange={(e) => onChange({ saturation: Number(e.target.value) / 100 })}
            onKeyUp={commitOnValueKeyUp}
            onBlur={onCommit}
          />
          <input
            type="range"
            className="sr-only"
            aria-label="Luminosité"
            min={0}
            max={100}
            step={1}
            value={Math.round(lightness * 100)}
            onChange={(e) => onChange({ lightness: Number(e.target.value) / 100 })}
            onKeyUp={commitOnValueKeyUp}
            onBlur={onCommit}
          />
          <canvas
            ref={svCanvasRef}
            width={SV_SIZE}
            height={SV_SIZE}
            className="color-picker-panel__sv"
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId);
              handleSvPointer(e);
            }}
            onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && handleSvPointer(e)}
            onPointerUp={(e) => {
              e.currentTarget.releasePointerCapture(e.pointerId);
              onCommit();
            }}
            // Perte de capture (alt-tab, interruption OS/tactile) : relâcher SANS
            // committer — pointercancel n'est pas une validation. Même sémantique
            // que TransformHandles.tsx et ui/dragReorder.ts.
            onPointerCancel={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
            }}
          />
          {/* Mêmes axes que drawSvSquare : saturation en X, luminosité en Y
              INVERSÉE (haut = clair). Toute divergence ici décalerait le
              repère par rapport au dégradé qu'il annote. */}
          <div
            className="color-picker-panel__sv-thumb"
            style={{ left: `${saturation * 100}%`, top: `${(1 - lightness) * 100}%` }}
          />
        </div>
        {/* La teinte, elle, EST unidimensionnelle : `role="slider"` s'applique
            sans compromis, avec sa valeur réelle en degrés. */}
        <div
          className="color-picker-panel__hue-band"
          role="slider"
          tabIndex={0}
          aria-label="Teinte"
          aria-valuemin={0}
          aria-valuemax={360}
          aria-valuenow={Math.round(hue)}
          aria-valuetext={`${Math.round(hue)} degrés`}
          onKeyDown={handleHueKeyDown}
          onKeyUp={commitOnValueKeyUp}
          // Filet, comme sur les deux `input type="range"` du carré : si le
          // focus part alors qu'une touche est encore enfoncée, le `keyup`
          // n'arrive jamais ici et la dernière valeur resterait hors
          // historique. `handleParamCommit` (App.tsx:708-715) est gardé par
          // `paramDirtyRef` — un blur sans changement ne pose rien.
          onBlur={onCommit}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            handleHuePointer(e);
          }}
          onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && handleHuePointer(e)}
          onPointerUp={(e) => {
            e.currentTarget.releasePointerCapture(e.pointerId);
            onCommit();
          }}
          // Idem bande de teinte : annulation = pas de commit.
          onPointerCancel={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
          }}
        >
          <div className="color-picker-panel__hue-thumb" style={{ left: `${(hue / 360) * 100}%` }} />
        </div>
        <label className="color-picker-panel__hex">
          <span>Hex</span>
          <input
            type="text"
            value={draft ?? currentHex}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitHexInput}
            onKeyDown={(e) => {
              const action = draftKeyAction(e.key);
              if (action === null) return;
              e.preventDefault();
              if (action === "abandon") abandonHexRef.current = true;
              // Le commit passe par le seul `blur`, comme partout ailleurs :
              // l'appeler ici EN PLUS doublerait l'entrée d'historique.
              e.currentTarget.blur();
            }}
            placeholder={currentHex}
          />
        </label>
      </div>
    </div>
  );
}
