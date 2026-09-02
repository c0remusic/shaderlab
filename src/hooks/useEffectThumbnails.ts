import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { DocumentSession } from "../application/documentSession";
import type { Renderer } from "../render/renderer";
import {
  EffectThumbnailCache,
  effectThumbnailSignature,
} from "../render/effectThumbnailCache";
import { EffectThumbnailRenderer, reduceFrameToBitmap } from "../render/effectThumbnails";

/** Ce que le sélecteur affiche : l'effet DEMANDÉ, et son image quand elle
 *  existe. `url: null` est l'état « en fabrication », pas un échec — le composant
 *  s'en sert pour garder la place de l'aperçu au lieu de la faire apparaître. */
export interface EffectThumbnailPreview {
  effectId: string;
  url: string | null;
}

/** Les quatre prises que `EffectPicker` reçoit d'un bloc. Même patron que
 *  `textureLibrary` sur `ParamPanel` : un objet MÉMOÏSÉ plutôt que quatre props
 *  qui traversent `LayerPanel` une par une. */
export interface EffectThumbnailPicker {
  preview: EffectThumbnailPreview | null;
  onPreview: (effectId: string) => void;
  onPreviewEnd: () => void;
  onOpenChange: (open: boolean) => void;
}

interface Deps {
  /** Renderer de l'APPLICATION — lu pour composer la source (`exportFrame`) et
   *  pour connaître les dimensions du document. Jamais celui de l'aperçu. */
  rendererRef: RefObject<Renderer | null>;
  sessionRef: RefObject<DocumentSession>;
}

/** Source d'aperçu en cours de fabrication ou déjà prête, avec la signature du
 *  document dont elle est issue. */
interface SourceState {
  signature: string;
  /** `true` quand la source est chargée dans le renderer d'aperçu. */
  ready: Promise<boolean>;
}

/**
 * APERÇU AU SURVOL DANS LA GALERIE D'EFFETS (ticket 05).
 *
 * Hook et pas composant, et surtout pas `App.tsx` : `ARCHITECTURE.md` §7 R6,
 * « chaque feature apporte son propre hook module », et le §CLAUDE.md sur
 * `App.tsx` — +200 lignes y éteignent `react-hooks/refs` sur tout le fichier.
 * `App` n'en garde que deux lignes de câblage.
 *
 * ── LA CHRONOLOGIE, QUI EST TOUT LE SUJET ───────────────────────────────────
 *
 * 1. OUVERTURE du sélecteur → la source se fabrique : un `exportFrame` du
 *    document (261 ms, mesuré au ticket 04 sur 26 Mpx) réduit à ~240 × 160.
 *    UNE fois, et mémoïsé tant que la pile ne change pas.
 * 2. SURVOL d'un effet → la mini-pile « source + cet effet » rend (~4 ms), puis
 *    la vignette est mémorisée par effet.
 * 3. FERMETURE ou sortie du popup → l'aperçu s'efface, le cache reste.
 *
 * Tout est asynchrone et rien n'attend : un survol pendant la fabrication de la
 * source s'y accroche au lieu d'en lancer une seconde, et un balayage rapide de
 * la liste n'empile pas les rendus (jeton du cache).
 */
export function useEffectThumbnails({ rendererRef, sessionRef }: Deps): EffectThumbnailPicker {
  const [preview, setPreview] = useState<EffectThumbnailPreview | null>(null);
  const thumbnailRendererRef = useRef<EffectThumbnailRenderer | null>(null);
  const cacheRef = useRef<EffectThumbnailCache | null>(null);
  const sourceRef = useRef<SourceState | null>(null);

  // Les deux naissent à la PREMIÈRE demande et jamais dans un effet : React 19
  // en `StrictMode` monte, démonte puis remonte chaque effet en dev, ce qui
  // détruirait un device créé là (même raison que `useTextureLibrary`, dont le
  // cache naît aussi à la demande). Cet effet ne fait donc que libérer.
  useEffect(
    () => () => {
      cacheRef.current?.dispose();
      cacheRef.current = null;
      thumbnailRendererRef.current?.dispose();
      thumbnailRendererRef.current = null;
      sourceRef.current = null;
    },
    [],
  );

  /**
   * Source d'aperçu pour l'état COURANT du document, fabriquée si besoin.
   *
   * La signature se calcule ICI, à l'ouverture et au survol, et jamais dans le
   * corps de rendu d'`App` : elle parcourt toute la pile, et la recalculer à
   * chaque `setLayers` la ferait payer à chaque échantillon de pointeur d'un
   * glissement de curseur. C'est aussi ce qui rend ce callback STABLE — il ne
   * lit que des refs, donc `picker` ci-dessous ne change pas d'identité à
   * chaque frame.
   */
  const ensureSource = useCallback(async (): Promise<{ signature: string; ok: boolean }> => {
    const renderer = rendererRef.current;
    if (renderer === null) return { signature: "", ok: false };
    const layers = sessionRef.current.layers();
    const signature = effectThumbnailSignature(layers, renderer.canvasSize);
    const current = sourceRef.current;
    if (current !== null && current.signature === signature) {
      return { signature, ok: await current.ready };
    }
    const ready = (async () => {
      try {
        const frame = await renderer.exportFrame(layers);
        const bitmap = await reduceFrameToBitmap(frame);
        thumbnailRendererRef.current ??= new EffectThumbnailRenderer();
        await thumbnailRendererRef.current.setSource(bitmap);
        return true;
      } catch (e) {
        // Jamais une exception qui remonte : le sélecteur doit rester
        // utilisable sans aperçu (c'est exactement ce qu'il était avant ce
        // ticket), et un GPU qui refuse un second device est un cas de
        // machine, pas un bug à faire tomber sur l'utilisateur.
        console.warn("Source d'aperçu des effets non fabriquée :", e);
        return false;
      }
    })();
    // L'ÉCHEC EST MÉMOÏSÉ au même titre que le succès, et c'est voulu : sans ça
    // chaque survol relancerait un `exportFrame` de 261 ms sur une machine où
    // l'aperçu ne peut pas marcher. Le prochain changement de pile réessaie.
    sourceRef.current = { signature, ready };
    return { signature, ok: await ready };
  }, [rendererRef, sessionRef]);

  const onOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        setPreview(null);
        return;
      }
      // Lancée À L'OUVERTURE et pas au premier survol : c'est la seule pièce
      // qui coûte des centaines de millisecondes, et la faire pendant que
      // l'utilisateur lit la liste la rend gratuite en pratique.
      void ensureSource();
    },
    [ensureSource],
  );

  const onPreview = useCallback(
    (effectId: string) => {
      // Affichage IMMÉDIAT de ce qu'on a déjà : sans ce `peek`, revenir sur un
      // effet déjà survolé repasserait par un état vide le temps d'un tour de
      // boucle, ce qui se voit comme un clignotement en balayant la liste.
      const known = sourceRef.current === null
        ? null
        : cacheRef.current?.peek(sourceRef.current.signature, effectId) ?? null;
      setPreview({ effectId, url: known });
      // ⚠️ PAS de retour anticipé sur un `peek` réussi, et c'est délibéré : la
      // signature de `sourceRef` est celle de la DERNIÈRE fabrication, pas de
      // l'état courant du document. Court-circuiter ici afficherait une vignette
      // périmée sans jamais la corriger, alors que `ensureSource` ci-dessous
      // rattrape le décalage. Une demande déjà en cache ne rappelle pas le port
      // (`EffectThumbnailCache.request`), donc ce chemin ne coûte qu'une
      // recherche dans une Map.
      void (async () => {
        const { signature, ok } = await ensureSource();
        if (!ok) return;
        const cache = (cacheRef.current ??= new EffectThumbnailCache({
          render: (id) => {
            const renderer = thumbnailRendererRef.current;
            if (renderer === null) throw new Error("Renderer d'aperçu absent.");
            return renderer.render(id);
          },
        }));
        const url = await cache.request(signature, effectId);
        if (url === null) return;
        // Garde de DESTINATAIRE : le curseur a pu partir ailleurs pendant la
        // fabrication. Poser l'image quand même afficherait la vignette d'un
        // effet que plus personne ne survole, sous le nom de l'effet courant.
        setPreview((current) => (current !== null && current.effectId === effectId ? { effectId, url } : current));
      })();
    },
    [ensureSource],
  );

  const onPreviewEnd = useCallback(() => setPreview(null), []);

  return useMemo(
    () => ({ preview, onPreview, onPreviewEnd, onOpenChange }),
    [preview, onPreview, onPreviewEnd, onOpenChange],
  );
}
