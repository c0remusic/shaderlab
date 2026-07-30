import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { initGpu, type GpuContext } from "./render/gpuContext";
import { Renderer } from "./render/renderer";
import { LayerStack } from "./layers/layerStack";
import type { LayerState } from "./layers/types";
// `hasImportedPhotoLayer` n'est PLUS importé ici : il gardait le round-trip
// Lightroom, déposé (ADR-0002). Il vit toujours dans `layers/photoLayer.ts`
// pour `presets/presetDocument.ts` — ne pas le réintroduire ici.
import { canAddPhotoLayer, countPhotoLayers } from "./layers/photoLayer";
import {
  PHOTO_CANVAS_FORMAT,
  canvasSizeFor,
  parseFreeCanvasRequest,
  type CanvasFormatRequest,
  type NamedCanvasFormat,
} from "./layers/canvasFormat";
import { MAX_CANVAS_PIXELS } from "./render/limits";
import { FrameScheduler } from "./render/frameScheduler";
import { changeLayerEffect } from "./layers/changeLayerEffect";
import { documentDisplayName } from "./layers/documentName";
import { duplicateLayer } from "./layers/duplicateLayer";
import { DocumentSession } from "./application/documentSession";
import { BrushToolbar } from "./components/BrushToolbar";
import { Canvas } from "./components/Canvas";
import { Toolbar } from "./components/Toolbar";
import { TransformHandles } from "./components/TransformHandles";
import { ErrorBanner } from "./components/ErrorBanner";
import { exportImage, resolveExportTargetAsync, resolveDefaultExportTarget } from "./export/exportImage";
import { messageFromUnknown } from "./lib/errors";
import {
  getLaunchPath,
  readImageFile,
  pickImageFile,
  logDiagnostic,
  writeImageFile,
  pathExists,
  defaultExportDir,
  pickExportFolder,
  joinExportTarget,
} from "./launch";
import { useGlobalControlWheel } from "./ui/activeControl";
import { openDocument } from "./layers/openedDocument";
import { hitTestPhotoLayer } from "./ui/hitTest";
import { getSyncedMaskPainter, type MaskPainterEntry } from "./mask/maskPainterSync";
import { getBrushRaster } from "./mask/brushSource";
import { PanelColumn } from "./components/dockedPanel/PanelColumn";
import { movePanelInDock, toFullDockTarget, visibleDockLayout, type DockDropTarget, type DockLayout } from "./ui/dockLayout";
import { clampDockWidth } from "./components/dockedPanel/dockWidth";
import { LayerControls, LayerPanel } from "./components/LayerPanel";
import { ParamPanel } from "./components/ParamPanel";
import { PhotoPanel } from "./components/PhotoPanel";
import { MaskPanel } from "./components/MaskPanel";
import { getEffect } from "./render/effects/registry";
import type { RefineEdgeParams } from "./mask/types";
import { MAX_COLOR_RANGE_SAMPLES } from "./mask/sources/colorRange";
import { planFold } from "./mask/foldPlan";
import { OverlayAnimationLoop } from "./render/overlayAnimationLoop";
import { hasValueChanged } from "./ui/valueChange";
import { Layers, SlidersHorizontal, Brush as BrushRailIcon, PackagePlus, Image as PhotoRailIcon } from "lucide-react";
import { useContextualPanel } from "./ui/contextualPanel";
import { PanelRail, type PanelRailItem } from "./components/dockedPanel/PanelRail";
import { ColorPickerPanel } from "./components/ColorPickerPanel";
import type { EffectParam } from "./render/effects/types";
import { usePresets } from "./hooks/usePresets";
import { usePhotoLayer } from "./hooks/usePhotoLayer";
import { useLayerIsolation } from "./hooks/useLayerIsolation";
import { PresetPanel } from "./components/PresetPanel";
import { TauriPresetStore } from "./presets/presetStore";
import { capture } from "./presets/presetDocument";
import { withPhotoLayersPreserved } from "./presets/preservePhotoLayers";
import { applyPresetImpactMessage } from "./presets/applyPresetImpact";
import { Dialog } from "./ui/Dialog";
import { Button } from "./components/ui/button";

export default function App() {
  useGlobalControlWheel();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const gpuRef = useRef<GpuContext | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  // "Ouvrir une image" n'est jamais désactivé pendant une ouverture en
  // cours — un second clic (ex. après avoir choisi un fichier corrompu,
  // dont `createImageBitmap` peut mettre plusieurs secondes à rejeter) peut
  // lancer un second appel à `openFile` avant que le premier ne se soit
  // résolu. Sans ce garde, le premier (en retard, en échec) peut écraser
  // l'état posé par le second (plus rapide, réussi) une fois son rejet
  // enfin réglé — le bandeau d'erreur réapparaît seul quelques secondes
  // après une ouverture pourtant réussie (bug trouvé au checkpoint visuel
  // 2026-07-24). Seul l'appel dont la génération est encore la plus
  // récente au moment de committer est autorisé à toucher l'état visible.
  const openGenerationRef = useRef(0);
  const overlayAnimationLoopRef = useRef(new OverlayAnimationLoop());
  const sessionRef = useRef(new DocumentSession());
  const presetStoreRef = useRef(new TauriPresetStore());
  const presets = usePresets(presetStoreRef.current);
  const [layers, setLayers] = useState<LayerState[]>([]);
  const presetIsDirty = presets.isDirtyOf(layers);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [sourcePath, setSourcePath] = useState<string | null>(null);
  // Nom AFFICHABLE du document, distinct de `sourcePath` — qui reste le chemin
  // disque, et lui seul, parce que c'est lui qui décide de l'écrasement à
  // l'export. Le glisser-déposer sur le canvas n'a PAS de chemin (le navigateur
  // ne le divulgue jamais) : dériver l'affichage de `sourcePath` faisait
  // disparaître le titre de la barre d'outils ET le nom du calque de fond sur le
  // chemin d'ouverture le plus courant. `documentDisplayName` rend toujours une
  // chaîne, jamais `null` — voir src/layers/documentName.ts.
  const [documentName, setDocumentName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const maskPaintersRef = useRef<Map<string, MaskPainterEntry>>(new Map());
  // True for the first sample of a stroke: forces a full live-preview
  // texture upload (the renderer's `liveMaskTexture` may hold a different
  // layer's content, or this same layer's content from BEFORE an undo/redo
  // that happened between strokes — a partial update on top of that stale
  // base would be silently wrong). Subsequent samples within the same
  // stroke use partial (dirtyRect-scoped) updates. Reset in
  // handleMaskStrokeEnd so the NEXT stroke also starts with a full upload.
  const maskStrokeIsFreshRef = useRef(true);
  const [brushSize, setBrushSize] = useState(30);
  const [brushHardness, setBrushHardness] = useState(0.5);
  const [erase, setErase] = useState(false);
  // Vrai pendant un drag de slider dont la valeur a bougé : le commit de fin
  // d'interaction ne pousse une entrée d'historique que si quelque chose a
  // réellement changé (un simple clic sans mouvement ne crée pas d'entrée).
  const paramDirtyRef = useRef(false);

  const [presetsFolded, setPresetsFolded] = useState(false);
  const [layersFolded, setLayersFolded] = useState(false);
  const [photoFolded, setPhotoFolded] = useState(false);
  const [paramsFolded, setParamsFolded] = useState(false);
  const [maskFolded, setMaskFolded] = useState(false);
  const [overlayForceHidden, setOverlayForceHidden] = useState(false);
  const [colorPicker, setColorPicker] = useState<{
    layerId: string;
    /** Effet du calque au moment de l'ouverture. Les `EffectParam` capturés
     *  ci-dessous n'appartiennent qu'à cet effet : si le calque en change
     *  (`setLayerEffect` vide aussi `params`), le picker doit disparaître au
     *  lieu de piloter des paramètres qui n'existent plus. Comparé au rendu. */
    effectId: string;
    key: string;
    label: string;
    hue: EffectParam;
    saturation: EffectParam;
    lightness: EffectParam;
    /** Déjà converti en coordonnée relative à `.workspace` (le conteneur
     *  positionné dans lequel le picker est rendu), pas en viewport. */
    anchorTop: number;
  } | null>(null);
  // Ordre par défaut du dock : `photo` s'insère entre `layers` et `params` —
  // inventaire (Calques) -> ce que le calque EST (Photo) -> ce qu'il FAIT
  // (Réglages) -> OÙ il agit (Masque). Voir design
  // `2026-07-27-shaderlab-panneau-photo-et-ecretage-design.md` §3.9.
  const [dockLayout, setDockLayout] = useState<DockLayout>([["presets", "layers", "photo", "params", "mask"]]);

  // Task 4 : id du preset en attente de confirmation de remplacement — non
  // nul seulement quand la pile courante n'est pas vide (voir
  // `requestApplyPreset`). Le PRD interdit d'écraser des masques déjà peints
  // sans confirmation explicite. `photoLayerCount` (Important 2, final-review
  // fix ; passé de booléen à COMPTE au fix de revue T5) : capturé au moment de
  // la demande, pas recalculé au clic de confirmation — la pile ne doit plus
  // bouger entre les deux, mais figer la valeur évite toute dépendance
  // implicite à cet invariant. Le compte (et pas un booléen) sert désormais à
  // dire ce qui est CONSERVÉ, pas ce qui est perdu : depuis T1 les calques
  // photo survivent à l'application d'un preset — voir
  // `presets/applyPresetImpact.ts`.
  const [pendingPresetApply, setPendingPresetApply] = useState<{ id: string; photoLayerCount: number } | null>(null);

  // Task 5 : nom en attente de saisie pour "Créer une copie" depuis la
  // bannière de dérive — non nul tant que le dialogue de nommage est ouvert.
  const [pendingPresetCopyName, setPendingPresetCopyName] = useState<string | null>(null);

  // Deux confirmations peuvent s'enchaîner sur un même enregistrement (C1
  // overwrite-by-name, puis exclusion de calque photo) — voir
  // requestSavePreset/gateOnPhotoLayers plus bas. `pendingPhotoLayerSave`
  // porte un `onConfirm` CALLBACK plutôt qu'un flag figé "overwrite ou pas" :
  // le Task 5 réutilise cette même porte pour "Mettre à jour"/"Créer une
  // copie", qui ne rentrent pas dans une forme overwrite-id mais ont besoin
  // du même contrat "confirmer, puis lancer cette écriture précise".
  // `resolve`/`onCancel` portent la résolution de la promesse rendue par
  // `requestSavePreset` (Mineur 4, revue tâche 3) : PresetPanel n'efface son
  // champ de saisie qu'une fois l'écriture réellement aboutie, jamais sur la
  // seule demande — donc chaque porte de confirmation doit savoir dire "annulé"
  // (false) aussi bien que "confirmé puis écrit" (true/false selon l'issue).
  const [pendingOverwrite, setPendingOverwrite] = useState<{ id: string; name: string; resolve: (written: boolean) => void } | null>(
    null
  );
  const [pendingPhotoLayerSave, setPendingPhotoLayerSave] = useState<{
    excludedLayerIndexes: number[];
    onConfirm: () => void;
    onCancel: () => void;
  } | null>(null);

  // Largeur du dock — état session, partagée par toutes les colonnes,
  // pas d'entrée d'historique (disposition d'interface, pas donnée de
  // calque, même principe que dockLayout ci-dessus).
  const [dockWidth, setDockWidth] = useState(320);
  const handleDockWidthChange = useCallback((width: number) => setDockWidth(clampDockWidth(width)), []);

  // DocumentSession est la source de vérité COMPLÈTE des calques (avec les
  // rasters de masque), pour le rendu GPU, l'historique et l'export. Le state
  // React `layers` n'en est qu'une PROJECTION D'AFFICHAGE, rasters retirés.
  //
  // Pourquoi : un raster r8 pleine résolution (~26 Mo à 24MP) placé dans le
  // state React fait CRASHER (hang WebView2, CDP inerte) au re-render déclenché
  // par setLayers() en fin de stroke. Root cause épinglée par A/B live sur la
  // vraie fenêtre (2026-07-18, docs/superpowers/specs/2026-07-17-native-wgpu-
  // decision.md) : setLayers() SANS raster (ajout de calque) à 24MP ne crashe
  // pas ; setLayers() AVEC le raster 26MB crashe ; ne pas appeler setLayers
  // ne crashe pas. Ce n'est donc ni le GPU (requestRender avec le masque
  // complet est OK) ni le re-render en soi, mais le buffer 26 Mo transitant par
  // l'état React. Le fix garde setLayers() (UI correcte) mais retire le raster de
  // ce qui y entre ; les panneaux n'affichent jamais les pixels du masque.
  const syncSession = useCallback(() => {
    setLayers(sessionRef.current.displayLayers());
    setSelectedId(sessionRef.current.selectedId());
  }, []);

  // COALESCING DE LA SYNCHRONISATION REACT (2026-07-30, profil CPU sur la vraie
  // fenêtre). Les chemins vivants d'un geste (drag d'image, drag de slider)
  // appelaient `syncSession()` sur CHAQUE `pointermove` brut, là où la ligne
  // voisine — `requestRender` — était déjà coalescée par son propre
  // `FrameScheduler` : le GPU se protégeait, React non. Mesuré : 21,9 ms de CPU
  // par move au drag d'image, 34,2 ms au drag de slider, un rendu de l'arbre
  // entier par échantillon, aucun coalescing d'événements (200 événements
  // absorbés en 3562 ms là où la souris les produit en 1600 ms — la file
  // grossit 2,2x plus vite que le temps réel).
  //
  // Le motif est celui de `Canvas.schedulePaint`/`endStroke` (peindre coûte
  // 7,9 ms/move précisément parce qu'il l'applique déjà), exprimé avec la
  // classe que le repo a pour ça plutôt qu'un second rAF manuel.
  //
  // Ce qui reste SYNCHRONE, délibérément : `syncSession` lui-même (sélection,
  // commit, ouverture de document, undo/redo) — un clic, une sélection ou un
  // panneau qui s'ouvre ne doit pas attendre une frame. Seuls les chemins de
  // GESTE passent par `scheduleSync`.
  //
  // Aucune valeur ne peut être perdue : on ne `cancel()` JAMAIS en cours de
  // session (seul le démontage annule), donc une frame en attente finit
  // toujours par s'exécuter, et elle relit l'état FRAIS de `sessionRef` au
  // moment où elle s'exécute. `flushSync` en fin de geste ne fait qu'avancer
  // cette exécution avant le commit, pour que les deux `setState` tombent dans
  // le même lot React.
  const syncSchedulerRef = useRef<FrameScheduler<void> | null>(null);
  if (syncSchedulerRef.current === null) {
    syncSchedulerRef.current = new FrameScheduler<void>(() => syncSession());
  }
  const scheduleSync = useCallback(() => syncSchedulerRef.current!.request(undefined), []);
  const flushSync = useCallback(() => syncSchedulerRef.current!.flush(), []);
  useEffect(() => () => syncSchedulerRef.current?.cancel(), []);

  const selectLayer = useCallback((id: string | null) => {
    sessionRef.current.select(id);
    setSelectedId(sessionRef.current.selectedId());
  }, []);

  const commit = useCallback(
    (stack: LayerStack) => {
      sessionRef.current.commit(stack);
      syncSession();
      rendererRef.current?.requestRender(sessionRef.current.layers());
    },
    [syncSession]
  );

  const currentStack = useCallback((): LayerStack => {
    // Depuis DocumentSession (COMPLET, avec les rasters de masque), jamais depuis le
    // state `layers` (projection d'affichage sans raster) — sinon toute
    // opération non-masque réécrirait des calques à raster null et effacerait
    // les masques.
    return sessionRef.current.currentStack();
  }, []);

  // Unique mesure du facteur de réduction CSS du canvas, appelée par
  // l'observateur de taille plus bas ET par `openFile`. Les deux sont
  // nécessaires : le facteur est un RAPPORT, et son dénominateur
  // (`canvas.width`) peut changer sans que la boîte de mise en page bouge d'un
  // pixel — ouvrir une photo de largeur différente alors que les deux débordent
  // déjà le conteneur donne exactement la même largeur affichée, donc aucun
  // `ResizeObserver` ne se déclenche, pour un facteur pourtant changé.
  //
  // Rend `false` quand il n'y a rien à mesurer, pour que l'appelant n'enchaîne
  // pas sur un rendu qu'aucune mesure ne justifie.
  const syncDisplayScale = useCallback((): boolean => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    if (!canvas || !renderer) return false;
    const displayed = canvas.getBoundingClientRect().width;
    // Une largeur nulle est une mise en page pas encore faite (ou un canvas
    // masqué), pas une mesure : la pousser ferait échouer `checkerCellPx`, qui
    // refuse à juste titre un facteur non positif.
    if (displayed <= 0 || canvas.width <= 0) return false;
    renderer.setDisplayScale(displayed / canvas.width);
    return true;
  }, []);

  const openFile = useCallback(async (
    file: File,
    path: string | null,
    // FORMAT DE TOILE demandé (tranche T2). Le défaut est « comme la photo » :
    // les trois autres points d'entrée d'un document (lancement en argument,
    // glisser-déposer, « Ouvrir ») ne le passent pas et retombent donc sur le
    // chemin d'avant T2, sans y penser — voir `PHOTO_CANVAS_FORMAT`.
    //
    // Le paramètre `fromLaunch` que portait cette signature a disparu avec la
    // dépose du round-trip (ADR-0002) : ouvrir par argument de lancement reste
    // possible, mais ne change plus rien à ce que fait l'export.
    canvasFormat: CanvasFormatRequest = PHOTO_CANVAS_FORMAT,
  ) => {
    if (!canvasRef.current) return;
    const generation = ++openGenerationRef.current;
    try {
      if (!gpuRef.current) {
        gpuRef.current = await initGpu(canvasRef.current, (message) => setError(message), logDiagnostic);
      }
      let bitmap: ImageBitmap;
      try {
        bitmap = await createImageBitmap(file);
      } catch {
        throw new Error("Image non supportée ou corrompue.");
      }

      // Build and load the candidate renderer BEFORE touching anything the
      // PREVIOUS document depends on (rendererRef, canvas size, app state).
      // Renderer.createLoaded disposes the candidate's own partial
      // resources on failure and rethrows — this used to dispose the
      // outgoing renderer FIRST, so a failed load (unsupported image, GPU
      // size limit) left the canvas backed by an already-destroyed
      // renderer, with the previous document unusable despite `sourcePath`/
      // `imageSize` state still pointing at it. Only once loading succeeds
      // do we touch the canvas, dispose the outgoing renderer, and commit
      // the new document's state.
      // UNE SEULE dérivation « format demandé + photo → dimensions de toile »,
      // et elle refuse (plutôt que de rogner) au-delà du budget VRAM nommé
      // `MAX_CANVAS_PIXELS`. Le rejet remonte au bandeau d'erreur par le
      // `catch` de cette fonction, avant qu'aucune texture ne soit allouée.
      const requestedCanvas = canvasSizeFor(canvasFormat, { width: bitmap.width, height: bitmap.height });
      const candidate = await Renderer.createLoaded(gpuRef.current, bitmap, logDiagnostic, requestedCanvas);

      if (generation !== openGenerationRef.current) {
        // A newer openFile() call already committed while we were still
        // decoding/loading — discard this stale result instead of
        // clobbering the newer document (canvas size, renderer, error
        // banner) with an outdated one.
        candidate.dispose();
        return;
      }

      // Posé AVANT le document : le nom ne dépend que du chemin et du fichier,
      // et il NOMME le calque de fond construit juste en dessous.
      const name = documentDisplayName(path, file.name);

      // L'OUVERTURE PROPREMENT DITE, dans un module unique que le harnais de
      // rendu APPELLE au lieu de le reproduire (`layers/openedDocument.ts`,
      // réserve R4). `openDocument` prend le RENDERER, donc App ne peut PAS
      // choisir de quoi le document hérite ses dimensions : ni `bitmap`, ni
      // `requestedCanvas` (ce qu'on a demandé), seulement `canvasSize` (ce qui a
      // été alloué). Les faire coïncider par confiance était exactement le
      // risque que la tranche T2 introduisait.
      const { stack, size: documentSize } = openDocument(candidate, name);
      canvasRef.current.width = documentSize.width;
      canvasRef.current.height = documentSize.height;
      rendererRef.current?.dispose();
      rendererRef.current = candidate;

      setImageSize(documentSize);
      setSourcePath(path);
      // Posé au MÊME instant que `imageSize` et `sourcePath` : un document
      // chargé a toujours un nom affichable. Il ne pilote plus la ligne
      // d'arrière-plan (supprimée en T1) mais reste le titre de la barre
      // d'outils, et il NOMME le calque de fond posé par `openDocument`.
      setDocumentName(name);
      sessionRef.current.replaceDocument(stack);
      presets.clearActive();
      // Important 6 (final-review fix): a new document has no relationship
      // to the previous one's layer ids — any entry left in
      // maskPaintersRef from the outgoing document is an orphaned ~24Mo
      // buffer for a layer that no longer exists anywhere. This gap was
      // pre-existing (not introduced by presets), but presets is what turns
      // it from theoretical into "leaks on every applyPreset() in a loop" —
      // see applyPreset's own purge below for the other half of this fix.
      maskPaintersRef.current.clear();
      syncSession();
      // AVANT le premier rendu du nouveau document : `canvas.width` vient de
      // changer, donc le facteur mesuré pour le document précédent est périmé.
      syncDisplayScale();
      rendererRef.current.render(sessionRef.current.layers());
      // Une ouverture réussie efface une éventuelle erreur laissée par une
      // tentative précédente (fichier corrompu, GPU indisponible...) — sinon
      // le bandeau d'erreur reste affiché au-dessus du document qui vient de
      // charger correctement.
      setError(null);
    } catch (e) {
      if (generation !== openGenerationRef.current) return;
      setError(messageFromUnknown(e));
    }
  }, [syncSession, presets.clearActive, syncDisplayScale]);

  // Le facteur de réduction CSS du canvas, mesuré et poussé dans le renderer.
  //
  // Ce fait n'existe QUE dans le DOM : le canvas a la résolution native de
  // l'image (aucun downscale, décision projet) et c'est la mise en page qui le
  // réduit pour le faire tenir dans l'espace laissé par la colonne de docks. Le
  // moteur de rendu ne peut pas le connaître, et il change sans qu'aucun rendu
  // soit demandé — redimensionnement de la fenêtre, ouverture ou fermeture d'un
  // panneau. Seul consommateur à ce jour : la taille de case du damier de
  // transparence, qui doit rester constante à l'écran (`render/presentPass.ts`).
  //
  // `ResizeObserver` plutôt qu'un `resize` de fenêtre : la largeur du canvas
  // change aussi à mise en page constante (dock replié, largeur de colonne).
  // Un rendu est redemandé à chaque changement — sans lui le navigateur se
  // contente de redimensionner l'image déjà dans le canvas, et le damier
  // garderait la taille de case du rendu précédent.
  // Le facteur de réduction CSS du canvas, mesuré et poussé dans le renderer.
  //
  // Ce fait n'existe QUE dans le DOM : le canvas a la résolution native de
  // l'image (aucun downscale, décision projet) et c'est la mise en page qui le
  // réduit pour le faire tenir dans l'espace laissé par la colonne de docks. Le
  // moteur de rendu ne peut pas le connaître, et il change sans qu'aucun rendu
  // soit demandé — redimensionnement de la fenêtre, ouverture ou fermeture d'un
  // panneau. Seul consommateur à ce jour : la taille de case du damier de
  // transparence, qui doit rester constante à l'écran (`render/presentPass.ts`).
  //
  // `ResizeObserver` plutôt qu'un `resize` de fenêtre : la largeur du canvas
  // change aussi à mise en page constante (dock replié, largeur de colonne).
  // Un rendu est redemandé à chaque changement — sans lui le navigateur se
  // contente de redimensionner l'image déjà dans le canvas, et le damier
  // garderait la taille de case du rendu précédent.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      if (!syncDisplayScale()) return;
      rendererRef.current?.requestRender(sessionRef.current.layers());
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [syncDisplayScale]);

  // Ouverture par argument de ligne de commande — « Ouvrir avec » de Windows,
  // double-clic sur un JPEG associé. CE CHEMIN SURVIT À LA DÉPOSE DU
  // ROUND-TRIP (ADR-0002) : ce que l'ADR retire est la sémantique
  // d'ÉCRASEMENT du fichier reçu, pas la capacité d'ouvrir un fichier passé
  // au lancement, qui est une affordance de n'importe quelle app de bureau.
  // Le document ouvert ainsi est désormais un document comme un autre — son
  // export part dans le dossier d'export, jamais par-dessus la source.
  useEffect(() => {
    getLaunchPath().then(async (path) => {
      if (!path) return;
      try {
        const bytes = await readImageFile(path);
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "image/jpeg" });
        await openFile(new File([blob], path, { type: "image/jpeg" }), path);
      } catch (e) {
        setError(messageFromUnknown(e));
      }
    });
  }, [openFile]);

  useEffect(() => {
    // Important 1 (revue tâche 3) : c'était le SEUL appel preset non gardé —
    // un preset corrompu fait rejeter `TauriPresetStore.list()`, et sans
    // `.catch` ici le rejet restait non géré : aucun bandeau d'erreur, le
    // panneau affichait juste "Aucun preset enregistré" comme si la
    // bibliothèque était vide. Fail-fast comme les trois autres chemins preset.
    presets.refresh().catch((e) => setError(messageFromUnknown(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is stable (useCallback), run once on mount only.
  }, []);

  const handleOpenFile = useCallback(async (canvasFormat: CanvasFormatRequest = PHOTO_CANVAS_FORMAT) => {
    try {
      const path = await pickImageFile();
      if (!path) return;
      // Dialogue "Ouvrir" : un vrai chemin absolu est maintenant connu, donc
      // l'export saura nommer le fichier de sortie. Il n'écrasera jamais
      // celui-ci pour autant — depuis la dépose du round-trip (ADR-0002),
      // `resolveExportTargetAsync` n'a plus aucun moyen de rendre le chemin
      // source, quel que soit le chemin d'ouverture.
      const bytes = await readImageFile(path);
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "image/jpeg" });
      await openFile(new File([blob], path, { type: "image/jpeg" }), path, canvasFormat);
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }, [openFile]);

  // Fermetures STABLES pour la barre d'outils (mémoïsée) : une arrow inline
  // dans le JSX y était recréée à chaque rendu et aurait suffi à rendre la
  // mémoïsation inopérante. `onOpenFile` reste fermée sur ZERO argument — voir
  // la note du même nom sur `Canvas` plus bas, c'est le même piège.
  const handleToolbarOpenFile = useCallback(() => void handleOpenFile(), [handleOpenFile]);
  const handleToolbarOpenFileWithFormat = useCallback(
    (format: NamedCanvasFormat) => void handleOpenFile({ kind: "nomme", format }),
    [handleOpenFile],
  );
  const handleToolbarOpenFileWithFreeSize = useCallback(() => setPendingFreeCanvas({ width: "", height: "" }), []);

  // Saisie libre de la toile : dimensions en attente de confirmation. Non nul
  // seulement pendant que le dialogue est ouvert. Le sélecteur de fichier
  // n'est ouvert QU'APRÈS la confirmation — l'ordre inverse (fichier puis
  // dimensions) obligerait à décoder l'image avant de savoir quoi en faire.
  const [pendingFreeCanvas, setPendingFreeCanvas] = useState<{ width: string; height: string } | null>(null);
  const freeCanvas =
    pendingFreeCanvas === null
      ? null
      : parseFreeCanvasRequest(pendingFreeCanvas.width, pendingFreeCanvas.height);

  const confirmFreeCanvas = useCallback(() => {
    if (freeCanvas?.kind !== "ok") return;
    setPendingFreeCanvas(null);
    void handleOpenFile(freeCanvas.request);
  }, [freeCanvas, handleOpenFile]);

  // Tout ce qui est propre au calque photo (mode canvas, import, transform)
  // vit dans usePhotoLayer — App n'en garde que le câblage.
  const photoLayer = usePhotoLayer({
    sessionRef,
    rendererRef,
    imageSize,
    paramDirtyRef,
    commit,
    currentStack,
    selectLayer,
    scheduleSync,
    flushSync,
    setError,
    selectedId,
    layers,
  });
  const { maskPaintMode, showTransformHandles, handleTransformChange, handleTransformCommit } = photoLayer;

  // Désignation directe d'une image au clic sur la toile (T1 du design
  // 2026-07-29). La taille des photos SOURCES vit dans le renderer
  // (`PhotoSourceStore`), hors state React — elle est passée en LOOKUP au
  // module pur, qui n'importe rien de `render/` et reste testable en Node.
  const photoSizeOf = useCallback(
    (sourceId: string) => rendererRef.current?.photoSources?.dimensions(sourceId) ?? null,
    [],
  );

  // `layers` (projection d'affichage) et non `sessionRef.current.layers()` :
  // le hit-test ne lit que des scalaires (transform, enabled, imageSource),
  // jamais un raster — aucun gros buffer n'entre ici.
  const pickPhotoLayerAt = useCallback(
    (x: number, y: number) => hitTestPhotoLayer(layers, { x, y }, imageSize, photoSizeOf),
    [layers, imageSize, photoSizeOf],
  );

  // Clic dans le vide = DÉSÉLECTION (arbitrage n°4 de la tranche) : geste
  // standard, seule sortie évidente de la sélection, et cohérent avec « ce que
  // je clique est ce que je sélectionne ».
  const handleCanvasPick = useCallback(
    (x: number, y: number) => selectLayer(pickPhotoLayerAt(x, y)),
    [pickPhotoLayerAt, selectLayer],
  );

  // Pont de debug DEV-ONLY. Raison d'être : le dialogue natif de sélection de
  // fichier (`pick_image_file`, rfd côté Rust) n'est pilotable NI par CDP NI
  // par computer-use sur ce projet (limite documentée dans CLAUDE.md § Méthode).
  // Sans ce pont, aucun scénario impliquant l'ouverture d'un document ou
  // l'import d'un calque photo ne peut être exécuté sur la vraie fenêtre —
  // donc ni la mesure VRAM exigée par ARCHITECTURE.md R1, ni un futur harnais
  // de parité pixel. Gardé par `import.meta.env.DEV` : Vite élimine ce bloc du
  // bundle de production, il ne peut pas fuiter.
  const importPhotoFromPath = photoLayer.importPhotoFromPath;
  const replacePhotoImageFromPath = photoLayer.replacePhotoImageFromPath;
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    (window as unknown as Record<string, unknown>).__shaderlabDebug = {
      // `canvasFormat` OMIS = « comme la photo », donc exactement le chemin
      // qu'empruntait ce pont avant T2. Il est exposé parce que la mesure VRAM
      // de T3 (2026-07-30) exige une toile STRICTEMENT plus grande que les
      // photos : sans lui, aucun scénario toile ≠ photo n'est atteignable sur
      // la vraie fenêtre — le choix de format vit dans le menu « Ouvrir », dont
      // le sélecteur de fichier natif n'est pilotable ni par CDP ni par
      // computer-use.
      openByPath: async (path: string, canvasFormat: CanvasFormatRequest = PHOTO_CANVAS_FORMAT) => {
        const bytes = await readImageFile(path);
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "image/jpeg" });
        await openFile(new File([blob], path, { type: "image/jpeg" }), path, canvasFormat);
      },
      importPhotoByPath: (path: string) => importPhotoFromPath(path),
      // Même raison que `importPhotoByPath` : le remplacement d'image passe
      // par le dialogue natif, donc sans ce point d'entrée aucun scénario de
      // remplacement n'est exécutable sur la vraie fenêtre (T2).
      replacePhotoImageByPath: (id: string, path: string) => replacePhotoImageFromPath(id, path),
      state: () => ({
        layers: sessionRef.current.layers().map((l) => ({
          id: l.id,
          effectId: l.effectId,
          hasImageSource: l.imageSource !== undefined,
          sourceId: l.imageSource?.sourceId ?? null,
          name: l.name ?? null,
          enabled: l.enabled,
        })),
      }),
    };
    return () => {
      delete (window as unknown as Record<string, unknown>).__shaderlabDebug;
    };
  }, [openFile, importPhotoFromPath, replacePhotoImageFromPath]);

  function handleAdd(effectId: string) {
    presets.clearActive();
    const stack = currentStack();
    // Même parité Photoshop que l'import photo : le calque d'effet se place
    // juste AU-DESSUS du calque sélectionné (`LayerStack.insertIndexAfter`),
    // pas systématiquement en haut de pile. Sans sélection -> haut de pile.
    const id = stack.addLayer(effectId, selectedId);
    commit(stack);
    selectLayer(id);
  }

  // Callbacks passés à LayerPanel/ParamPanel enveloppés dans useCallback :
  // LayerPanel mémoïse chaque ligne (React.memo, voir LayerRow) pour qu'un
  // drag d'opacité ne re-render QUE la ligne concernée, pas la liste entière
  // des calques — sans références stables ici, cette mémoïsation ne servirait
  // à rien (nouvelle fonction à chaque render du composant App = memo inutile).
  const handleToggle = useCallback(
    (id: string) => {
      const stack = currentStack();
      // Mutation outcome (Task 3) : id absent -> pas d'entrée d'historique.
      if (!stack.toggleLayer(id)) return;
      commit(stack);
    },
    [currentStack, commit]
  );

  // Isolation d'un calque (Alt+clic sur l'œil) : état d'interface transitoire,
  // hors modèle et hors historique — toute la logique vit dans
  // `useLayerIsolation`/`layers/isolation.ts`, App n'en garde que le câblage.
  const isolation = useLayerIsolation({ sessionRef, rendererRef, layers, toggleLayer: handleToggle });

  const handleRemove = useCallback(
    (id: string) => {
      presets.clearActive();
      const stack = currentStack();
      if (!stack.removeLayer(id)) return;
      maskPaintersRef.current.delete(id);
      commit(stack);
    },
    // presets.clearActive (not the whole `presets` object, which usePresets
    // returns as a fresh literal every render) — same narrowing already used
    // by openFile above. clearActive is `useCallback(..., [])` in
    // usePresets.ts, so it is referentially stable; the whole `presets`
    // object is not, and this callback is passed as onRemove to LayerRow
    // (memo()-ised in LayerPanel.tsx specifically so an opacity drag on one
    // layer doesn't re-render the others) — an unstable dependency here
    // defeated that memoization on every keystroke of any param drag.
    [currentStack, commit, presets.clearActive]
  );

  const handleDuplicate = useCallback(
    (id: string) => {
      // Garde photo, ordre des effets de bord et politique de masque : voir
      // `duplicateLayer` (layers/duplicateLayer.ts). Même forme que
      // handleEffectChange — la logique vit dans le module pur testé, ce
      // handler ne fait que l'alimenter en effets de bord d'App.
      duplicateLayer(currentStack(), id, {
        clearActivePreset: presets.clearActive,
        commit,
        selectLayer,
        setError,
      });
    },
    // presets.clearActive et non `presets` : même resserrement que
    // handleRemove, dont le commentaire explique pourquoi la mémoïsation de
    // LayerRow en dépend.
    [currentStack, commit, selectLayer, presets.clearActive]
  );

  const handleReorder = useCallback(
    (id: string, newIndex: number) => {
      const stack = currentStack();
      // Mutation outcome : id absent, index hors-borne, ou index inchangé
      // (no-op) -> pas d'entrée d'historique.
      if (!stack.reorderLayer(id, newIndex)) return;
      commit(stack);
    },
    [currentStack, commit]
  );

  function handleParamChange(id: string, params: Record<string, number>) {
    // Mise à jour vivante pendant le drag : état + rendu coalescé, PAS
    // d'entrée d'historique — la spec v1 exige UNE entrée par interaction,
    // pas une par frame de drag.
    //
    // Volontairement PAS currentStack()/LayerStack.clone() ici : clone()
    // crée un objet FRAIS pour CHAQUE calque, pas seulement celui qui bouge
    // — avec LayerRow mémoïsé (LayerPanel.tsx, même pattern pour l'opacité),
    // ça re-render la liste entière à chaque frame de drag. Ce .map() garde
    // la référence des calques NON touchés, seul le calque `id` change.
    const previous = sessionRef.current.layers().find((l) => l.id === id);
    if (previous && Object.entries(params).some(([key, value]) => hasValueChanged(previous.params[key], value))) {
      paramDirtyRef.current = true;
    }
    const full = sessionRef.current.layers().map((l) => (l.id === id ? { ...l, params: { ...l.params, ...params } } : l));
    sessionRef.current.replaceLiveLayers(full);
    // Coalescé sur rAF — voir `syncSchedulerRef`. Geste le plus cher mesuré
    // (34,2 ms de CPU par `pointermove`, 13 tâches longues pour un seul
    // glissement de curseur).
    scheduleSync();
    rendererRef.current?.requestRender(full);
  }

  /** Fin d'interaction pour TOUS les curseurs vivants de ce fichier (params
   *  d'effet, opacité, params de source de masque, affinage de bord, picker de
   *  couleur) : ils commitent tous ici. C'est donc le seul point où le flush
   *  doit être posé. */
  const handleParamCommit = useCallback(() => {
    // AVANT la garde : même raison que `handleTransformCommit` — la dernière
    // valeur du geste ne doit jamais rester en attente derrière un commit.
    flushSync();
    if (!paramDirtyRef.current) return;
    paramDirtyRef.current = false;
    commit(currentStack());
  }, [flushSync, commit, currentStack]);

  const handleOpacityChange = useCallback(
    (id: string, opacity: number) => {
      // Même raison que handleParamChange ci-dessus : pas de clone() complet
      // du stack pendant le drag, seul le calque `id` reçoit un objet frais
      // — condition nécessaire pour que LayerRow (React.memo) ne re-render
      // QUE la ligne dont l'opacité bouge, pas la liste entière des calques.
      const previous = sessionRef.current.layers().find((l) => l.id === id);
      if (previous && hasValueChanged(previous.opacity, opacity)) paramDirtyRef.current = true;
      const full = sessionRef.current.layers().map((l) => (l.id === id ? { ...l, opacity } : l));
      sessionRef.current.replaceLiveLayers(full);
      scheduleSync(); // curseur vivant -> coalescé, voir `syncSchedulerRef`
      rendererRef.current?.requestRender(full);
    },
    [scheduleSync]
  );

  const handleBlendModeChange = useCallback(
    (id: string, blendMode: string) => {
      const stack = currentStack();
      const layer = stack.layers.find((l) => l.id === id);
      if (layer) layer.blendMode = blendMode;
      commit(stack); // changement discret → une entrée d'historique directe
    },
    [currentStack, commit]
  );

  const handleEffectChange = useCallback(
    (id: string, effectId: string) => {
      // Ordre garde-puis-effets-de-bord et sa justification : voir
      // `changeLayerEffect` (layers/changeLayerEffect.ts). `clearActive`
      // parce que l'effectId fait partie de la projection capturée par un
      // preset (usePresets.toPresetLayers), comme handleAdd/handleRemove.
      changeLayerEffect(currentStack(), id, effectId, {
        clearActivePreset: presets.clearActive,
        commit, // changement discret → une entrée d'historique directe
      });
    },
    // presets.clearActive et non `presets` (littéral frais à chaque render) :
    // même resserrement que handleRemove, dont le commentaire explique
    // pourquoi la mémoïsation de LayerRow en dépend.
    [currentStack, commit, presets.clearActive]
  );

  const handleClipChange = useCallback(
    (id: string, clip: boolean) => {
      const stack = currentStack();
      // Mutation outcome (même discipline que handleEffectChange) : calque
      // absent, calque PHOTO (refusé par la garde de setLayerClip), ou valeur
      // inchangée -> pas d'entrée d'historique.
      if (!stack.setLayerClip(id, clip)) return;
      commit(stack); // changement discret -> une entrée d'historique directe
    },
    [currentStack, commit]
  );

  const handleToggleLock = useCallback(
    (id: string, locked: boolean) => {
      const stack = currentStack();
      // Même discipline que handleClipChange : calque absent ou valeur
      // inchangée -> pas d'entrée d'historique. Verrouiller/déverrouiller EST
      // en revanche annulable comme le reste (commit direct), sinon un verrou
      // posé par erreur ne se retire qu'à la main.
      // Le mutateur `setLayerLocked` est le SEUL de LayerStack à ne pas
      // consulter le verrou : un verrou qu'on ne peut pas retirer n'en est pas un.
      if (!stack.setLayerLocked(id, locked)) return;
      commit(stack);
    },
    [currentStack, commit]
  );

  // Les onze handlers de masque ci-dessous sont les props de `MaskPanel`,
  // désormais mémoïsé (2026-07-30). Une seule d'entre elles recréée à chaque
  // rendu suffirait à annuler la mémoïsation — sans aucun signe visible.
  const handleAddMaskSource = useCallback((layerId: string, type: "gradient" | "luminosity" | "colorRange") => {
    const stack = currentStack();
    stack.addMaskSource(layerId, type);
    commit(stack); // ajout d'une source = action discrète, une entrée directe
  }, [currentStack, commit]);

  const handleRemoveMaskSource = useCallback((layerId: string, sourceId: string) => {
    const stack = currentStack();
    if (!stack.removeMaskSource(layerId, sourceId)) return;
    commit(stack);
  }, [currentStack, commit]);

  const handleMaskSourceParamsChange = useCallback((layerId: string, sourceId: string, params: Record<string, number | number[]>) => {
    const previousSource = sessionRef.current.layers().find((l) => l.id === layerId)?.mask.sources.find((s) => s.id === sourceId);
    if (previousSource && Object.entries(params).some(([key, value]) => hasValueChanged((previousSource.params?.[key] as number | number[] | undefined) ?? 0, value))) {
      paramDirtyRef.current = true;
    }
    const stack = currentStack();
    stack.updateMaskSourceParams(layerId, sourceId, params);
    sessionRef.current.replaceLiveLayers(stack.layers);
    scheduleSync(); // curseur vivant -> coalescé, voir `syncSchedulerRef`
    rendererRef.current?.requestRender(stack.layers);
  }, [currentStack, scheduleSync]);

  const handleMaskSourceCombineModeChange = useCallback((layerId: string, sourceId: string, mode: "add" | "subtract" | "intersect") => {
    const stack = currentStack();
    if (!stack.setMaskSourceCombineMode(layerId, sourceId, mode)) return;
    commit(stack);
  }, [currentStack, commit]);

  const handleMaskSourceEnabledChange = useCallback((layerId: string, sourceId: string, enabled: boolean) => {
    const stack = currentStack();
    // setMaskSourceEnabled ne commite (une entrée d'historique) que si la
    // valeur a réellement changé — pas d'entrée vide sur un no-op (même
    // discipline que le reste des toggles discrets de ce fichier).
    if (!stack.setMaskSourceEnabled(layerId, sourceId, enabled)) return;
    commit(stack);
  }, [currentStack, commit]);

  const handleMaskInvertChange = useCallback((layerId: string, invert: boolean) => {
    const stack = currentStack();
    if (!stack.setMaskInvert(layerId, invert)) return;
    commit(stack);
  }, [currentStack, commit]);

  const handleMaskEnabledChange = useCallback((layerId: string, enabled: boolean) => {
    const stack = currentStack();
    if (!stack.setMaskEnabled(layerId, enabled)) return;
    commit(stack);
  }, [currentStack, commit]);

  const handleRefineEdgeChange = useCallback((layerId: string, refineEdge: Partial<RefineEdgeParams>) => {
    const previousLayer = sessionRef.current.layers().find((l) => l.id === layerId);
    if (
      previousLayer &&
      Object.entries(refineEdge).some(([key, value]) => {
        const previousValue = previousLayer.mask.refineEdge[key as keyof RefineEdgeParams];
        // edgeAware est un booléen (activation) — les autres champs de
        // RefineEdgeParams sont numériques, seuls comparables via
        // hasValueChanged (qui n'accepte que number|number[]).
        return typeof value === "boolean" ? previousValue !== value : hasValueChanged(previousValue as number, value as number);
      })
    ) {
      paramDirtyRef.current = true;
    }
    const stack = currentStack();
    stack.updateRefineEdge(layerId, refineEdge);
    sessionRef.current.replaceLiveLayers(stack.layers);
    scheduleSync(); // curseur vivant -> coalescé, voir `syncSchedulerRef`
    rendererRef.current?.requestRender(stack.layers);
  }, [currentStack, scheduleSync]);

  // Limitation documentée Tranche 3 (brief Task 6 Step 10) : pas de picker
  // interactif au clic sur le canvas (hors scope, Tranche 4/panneau
  // flottant) — cette action prend la couleur du pixel au CENTRE du canvas
  // comme valeur de test minimale. Le <canvas> est configuré WebGPU (pas de
  // contexte 2D dessus) : on le redessine sur un canvas 2D hors-écran de
  // 1x1 via drawImage pour lire un seul pixel, plutôt qu'un readback GPU
  // dédié — suffisant pour un échantillon de test, pas pour un vrai picker.
  const handleAddColorSample = useCallback((layerId: string, sourceId: string) => {
    const source = sessionRef.current.layers().find((l) => l.id === layerId)?.mask.sources.find((s) => s.id === sourceId);
    if (!source || !canvasRef.current || canvasRef.current.width === 0) return;
    const existing = (source.params?.samples as number[] | undefined) ?? [];
    if (existing.length / 3 >= MAX_COLOR_RANGE_SAMPLES) return;
    const sampleCanvas = document.createElement("canvas");
    sampleCanvas.width = 1;
    sampleCanvas.height = 1;
    const ctx2d = sampleCanvas.getContext("2d");
    if (!ctx2d) return;
    const cx = canvasRef.current.width / 2;
    const cy = canvasRef.current.height / 2;
    ctx2d.drawImage(canvasRef.current, cx, cy, 1, 1, 0, 0, 1, 1);
    const pixel = ctx2d.getImageData(0, 0, 1, 1).data;
    // sRGB -> linéaire (cohérent "linéaire strict", même conversion que le
    // reste du pipeline couleur du projet) — le canvas affiché est déjà en
    // sortie sRGB, la source colorRange compare en `colorLinear`.
    const toLinear = (c: number) => {
      const s = c / 255;
      return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    };
    const rgbLinear = [toLinear(pixel[0]), toLinear(pixel[1]), toLinear(pixel[2])];
    const params = { ...source.params, samples: [...existing, ...rgbLinear] };
    const stack = currentStack();
    // Toujours un ajout réel (echantillons.length croît strictement), mais
    // même discipline que les autres actions discrètes : ne commit que si
    // la mutation a effectivement changé quelque chose.
    if (!stack.updateMaskSourceParams(layerId, sourceId, params)) return;
    commit(stack); // ajout d'un échantillon = action discrète, une entrée directe
  }, [currentStack, commit]);

  const handleToggleOverlayForceHidden = useCallback(() => setOverlayForceHidden((v) => !v), []);

  function handleMaskStroke(x: number, y: number) {
    if (!selectedId || imageSize.width === 0) return;
    // Raster depuis DocumentSession (complet) — le state `layers` est la projection
    // d'affichage sans raster.
    const layer = sessionRef.current.layers().find((l) => l.id === selectedId);
    const currentMaskData = layer ? getBrushRaster(layer) : null;
    const entry = getSyncedMaskPainter(
      maskPaintersRef.current,
      selectedId,
      currentMaskData,
      imageSize.width,
      imageSize.height
    );
    // Interpolate from the last painted point when one exists (a real drag
    // fires far fewer coalesced samples than the raw pointer path — without
    // this, fast strokes leave visible gaps between isolated brush dabs,
    // reported live 2026-07-18). The stroke's very first point has no
    // anchor yet, so it paints a single dab like before.
    const dirtyRect = entry.lastPoint
      ? entry.painter.paintLine(entry.lastPoint.x, entry.lastPoint.y, x, y, brushSize, brushHardness, erase)
      : entry.painter.paintStroke(x, y, brushSize, brushHardness, erase);
    entry.lastPoint = { x, y };
    // Live preview only: render straight from the painter's own buffer via
    // a GPU texture upload, WITHOUT going through LayerStack.updateBrushMask()'s
    // immutable-copy semantics on every sample. That copy (~26MB per call on
    // a 24MP photo) firing on every coalesced pointer sample during a real
    // drag was traced via WebView2 crash-dump analysis (2026-07-15, exception
    // 0xE0000008, reproduced 4 times) to a reproducible renderer OOM abort —
    // confirmed by clean before/after tests, not assumed. A second round of
    // testing showed the SAME crash from a full-buffer GPU reupload alone
    // (no JS copy), so the real fix scopes each upload to the brush's
    // touched region (`dirtyRect`) instead of the whole image — only the
    // first sample of a stroke uploads the full buffer (`maskStrokeIsFreshRef`),
    // seeding the renderer's live-preview texture correctly even if an
    // undo/redo happened since the last stroke. `layers` state and history
    // are intentionally untouched here; the real, history-visible mask
    // update happens exactly once, in handleMaskStrokeEnd, matching the
    // "one entry per interaction" pattern already established for sliders.
    rendererRef.current?.requestRender(sessionRef.current.layers(), {
      layerId: selectedId,
      raster: entry.painter.getMaskData(),
      scope: maskStrokeIsFreshRef.current ? { kind: "full" } : { kind: "partial", rect: dirtyRect },
    });
    maskStrokeIsFreshRef.current = false;
  }

  function handleMaskStrokeEnd() {
    maskStrokeIsFreshRef.current = true;
    if (!selectedId) return;
    const entry = maskPaintersRef.current.get(selectedId);
    if (!entry) return;
    entry.lastPoint = null; // next stroke's first point has no interpolation anchor
    const stack = currentStack();
    // The one and only immutable-copy update for this stroke — see the
    // comment in handleMaskStroke for why this is deferred to stroke-end.
    // updateBrushMask only returns false if selectedId's layer was removed
    // mid-stroke (race, not the common case) — same "no mutation, no
    // history entry" discipline as the rest of this file's discrete
    // commits.
    if (!stack.updateBrushMask(selectedId, entry.painter.getMaskData())) return;
    commit(stack);
    const committedLayer = stack.layers.find((l) => l.id === selectedId);
    entry.syncedFrom = committedLayer ? getBrushRaster(committedLayer) : null;
  }

  // `useCallback` sur undo/redo/export/ouverture : ce sont les props de
  // `Toolbar`, désormais mémoïsée (2026-07-30). Une seule de ces fonctions
  // recréée à chaque rendu suffirait à annuler la mémoïsation en silence — la
  // barre d'outils se rendrait alors à chaque `pointermove` comme avant.
  const handleUndo = useCallback(() => {
    if (sessionRef.current.undo()) {
      syncSession();
      // Critique 1 (final-review fix): undo doesn't touch `activePresetId`
      // on its own — without this, undoing back through a preset
      // APPLICATION (e.g. to an empty stack) left the banner pointing at a
      // preset whose snapshot no longer matches, and "Mettre à jour" would
      // overwrite the preset file with the undone stack, unrecoverably (the
      // disk write itself isn't an undo-history entry). See
      // `usePresets.reconcileActiveAfterHistoryChange`'s doc comment for why
      // this is a STRUCTURAL check, not the full-value one that drives the
      // dirty banner.
      presets.reconcileActiveAfterHistoryChange(sessionRef.current.layers());
      rendererRef.current?.requestRender(sessionRef.current.layers());
    }
  }, [syncSession, presets.reconcileActiveAfterHistoryChange]);

  const handleRedo = useCallback(() => {
    if (sessionRef.current.redo()) {
      syncSession();
      presets.reconcileActiveAfterHistoryChange(sessionRef.current.layers());
      rendererRef.current?.requestRender(sessionRef.current.layers());
    }
  }, [syncSession, presets.reconcileActiveAfterHistoryChange]);

  // Raccourcis globaux Ctrl+Z/Ctrl+Y (undo/redo) et Ctrl+I (isoler le calque
  // sélectionné — le pendant clavier de l'Alt+clic sur l'œil, sans lequel
  // l'isolation ne serait atteignable qu'à la souris) : fonctionnent depuis
  // n'importe où dans la fenêtre, PAS seulement quand un bouton Toolbar a le
  // focus — sauf par-dessus un contrôle éditable (input/textarea/
  // contentEditable, ex. le champ de valeur d'un LabeledSlider en cours de
  // frappe), où Ctrl+Z doit rester l'undo texte natif du champ, pas l'undo
  // de calque.
  // « Latest ref » sur les handlers : `handleUndo`/`handleRedo` sont redéclarés
  // à chaque render (et `selectedId` change), donc les mettre en dépendances
  // rattacherait le listener à chaque render — exactement le comportement (non
  // intentionnel) qu'un `useEffect` sans tableau de dépendances produisait ici.
  // Le ref donne la correction fonctionnelle (aucune stale closure) avec un
  // listener attaché UNE seule fois.
  const shortcutsRef = useRef({
    undo: handleUndo,
    redo: handleRedo,
    isolate: () => isolation.toggleIsolation(selectedId),
  });
  shortcutsRef.current = {
    undo: handleUndo,
    redo: handleRedo,
    isolate: () => isolation.toggleIsolation(selectedId),
  };

  useEffect(() => {
    function handleWindowKeyDown(event: KeyboardEvent) {
      if (!event.ctrlKey && !event.metaKey) return;
      const target = event.target as HTMLElement | null;
      const tagName = target?.tagName;
      const isEditableTarget = tagName === "INPUT" || tagName === "TEXTAREA" || target?.isContentEditable;
      if (isEditableTarget) return;
      const key = event.key.toLowerCase();
      if (key === "z") {
        event.preventDefault();
        shortcutsRef.current.undo();
      } else if (key === "y") {
        event.preventDefault();
        shortcutsRef.current.redo();
      } else if (key === "i") {
        // Ctrl+I : « Isoler ». Retenu après vérification des conflits — les
        // seuls autres raccourcis clavier de l'app sont Ctrl+Z/Ctrl+Y (le
        // Ctrl+molette d'`activeControl` est un geste souris, pas une touche).
        // Ctrl+Alt+… est écarté : sur clavier AZERTY, Ctrl+Alt EST AltGr.
        // Ctrl+Maj+I est écarté : c'est l'ouverture des DevTools de WebView2.
        event.preventDefault();
        shortcutsRef.current.isolate();
      }
    }
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, []);

  const performExport = useCallback(async (resolveDir: () => Promise<string | null>, bareFirst: boolean) => {
    if (!rendererRef.current) return;
    if (!sourcePath) {
      setError(
        "Impossible d'exporter : ouvre le fichier via la boîte de dialogue \"Ouvrir\" plutôt que par glisser-déposer — l'export a besoin d'un vrai chemin sur le disque."
      );
      return;
    }
    try {
      const dir = await resolveDir();
      if (dir === null) return; // "Exporter sous..." annulé par l'utilisateur
      const base = await joinExportTarget(sourcePath, dir);
      const target = bareFirst
        ? await resolveDefaultExportTarget(base, { exists: pathExists })
        : await resolveExportTargetAsync(base, { exists: pathExists });
      await exportImage(
        rendererRef.current,
        { write: writeImageFile },
        sessionRef.current.layers(),
        target
      );
      // Même discipline que openFile : un export réussi efface une erreur
      // laissée par une tentative précédente, plutôt que de laisser un
      // bandeau d'erreur périmé affiché au-dessus d'un export qui a marché.
      setError(null);
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }, [sourcePath]);

  /** Runs `capture(sessionRef.current.layers(), name)` purely to inspect
   *  `skipped` — if it reports any excluded photo layer, blocks on the
   *  `pendingPhotoLayerSave` Dialog and defers `onConfirmed` to its
   *  "Enregistrer quand même" button; otherwise runs `onConfirmed`
   *  immediately. `name` is only used to compute `skipped` (a photo-layer
   *  exclusion doesn't depend on the target name) — callers that don't have
   *  a natural "new name" yet (Task 5's `updateActive`) pass the CURRENT
   *  preset's existing name, which is what would be recaptured anyway.
   *  Rend `false` si l'utilisateur annule la porte (Mineur 4), sinon le
   *  résultat de `onConfirmed` (issue réelle de l'écriture). */
  const gateOnPhotoLayers = useCallback((name: string, onConfirmed: () => Promise<boolean>): Promise<boolean> => {
    const { skipped } = capture(sessionRef.current.layers(), name);
    const excludedLayerIndexes = skipped.filter((s) => s.reason === "photo-layer").map((s) => s.layerIndex);
    if (excludedLayerIndexes.length > 0) {
      return new Promise<boolean>((resolve) => {
        setPendingPhotoLayerSave({
          excludedLayerIndexes,
          onConfirm: () => {
            onConfirmed().then(resolve);
          },
          onCancel: () => resolve(false),
        });
      });
    }
    return onConfirmed();
  }, []);

  const commitSavePreset = useCallback(async (name: string, overwriteId: string | null): Promise<boolean> => {
    try {
      if (overwriteId) {
        await presets.overwrite(overwriteId, sessionRef.current.layers(), name);
      } else {
        await presets.save(sessionRef.current.layers(), name);
      }
      return true;
    } catch (e) {
      setError(messageFromUnknown(e));
      return false;
    }
  }, [presets.overwrite, presets.save]);

  // ORDRE : `requestSavePreset` vient APRÈS les deux fonctions qu'elle appelle.
  // C'étaient des déclarations de fonction (hissées) ; en `useCallback` ce sont
  // des `const`, qui ne le sont pas — d'où ce déplacement, seul changement de
  // forme apporté à ce bloc.
  //
  // Mineur 4 (revue tâche 3) : rend une Promise<boolean> résolue à `true`
  // SEULEMENT si l'écriture a réellement abouti (aucune confirmation
  // annulée, aucune exception) — PresetPanel n'efface son champ de saisie
  // que sur `true`, jamais sur la seule demande d'enregistrement.
  const requestSavePreset = useCallback(async (name: string): Promise<boolean> => {
    const existing = presets.summaries.find((s) => s.name === name);
    if (existing) {
      return new Promise<boolean>((resolve) => {
        setPendingOverwrite({ id: existing.id, name, resolve });
      });
    }
    return gateOnPhotoLayers(name, () => commitSavePreset(name, null));
  }, [presets.summaries, gateOnPhotoLayers, commitSavePreset]);

  /** "Mettre à jour" (dirty banner). Reuses the active preset's own current
   *  name — `updateActive` keeps the name unchanged, `capture()` only needs
   *  SOME name to run its exclusion check. Routes through the SAME
   *  `gateOnPhotoLayers` gate as `requestSavePreset` (a photo layer must
   *  never be silently dropped from a written preset file). */
  function requestUpdateActive() {
    if (!presets.activePresetId) return;
    const layers = sessionRef.current.layers();
    // Critique 1 (final-review fix): never write an EMPTY stack over a
    // preset file. Reachable via undo (see handleUndo/reconcileActive...)
    // only through a race between the reconciliation and this click — kept
    // as a second, independent guard rather than relying solely on
    // `reconcileActiveAfterHistoryChange` clearing `activePresetId` in time.
    // The banner itself is also gated on `layers.length > 0` below (JSX), so
    // this button should already be unreachable when the stack is empty —
    // this is the belt to that suspenders.
    if (layers.length === 0) return;
    const activeSummary = presets.summaries.find((s) => s.id === presets.activePresetId);
    if (!activeSummary) {
      // Mineur (final-review fix): the old `?.name ?? ""` fallback let this
      // dialog open with an empty preset name on a lookup miss instead of
      // reporting the anomaly (activePresetId pointing at a preset removed
      // from the library, or summaries not yet refreshed) — fail loudly
      // rather than silently proceeding with a blank name.
      setError(`Preset actif introuvable dans la bibliothèque (id ${presets.activePresetId}) — impossible de le mettre à jour.`);
      return;
    }
    gateOnPhotoLayers(activeSummary.name, async () => {
      try {
        await presets.updateActive(layers);
        return true;
      } catch (e) {
        setError(messageFromUnknown(e));
        return false;
      }
    });
  }

  /** "Créer une copie" (dirty banner). Same photo-layer gate as
   *  `requestSavePreset`, AND now the same name-collision gate too
   *  (Important 3, final-review fix): before this fix, typing an
   *  already-taken name here created a silent duplicate — `requestSavePreset`
   *  asked to confirm an overwrite for the same event, `importFrom` instead
   *  auto-renamed to "(copie N)`, so the same feature had THREE different
   *  collision policies. Chosen here: reuse the SAME "Remplacer ?" dialog as
   *  `requestSavePreset` (not `resolveImportName`'s silent auto-rename) —
   *  unlike an import, the name here is something the user just TYPED
   *  themselves into a visible field, so a collision is very likely
   *  deliberate ("overwrite that one") and deserves the same explicit
   *  confirm/cancel as manual save, not a surprise "(copie 2)" they didn't
   *  ask for. */
  function requestCopyActiveAsNew(name: string): Promise<boolean> {
    const layers = sessionRef.current.layers();
    if (layers.length === 0) return Promise.resolve(false); // Critique 1 : jamais de preset vide
    const existing = presets.summaries.find((s) => s.name === name);
    if (existing) {
      return new Promise<boolean>((resolve) => {
        setPendingOverwrite({ id: existing.id, name, resolve });
      });
    }
    return gateOnPhotoLayers(name, async () => {
      try {
        await presets.copyActiveAsNew(layers, name);
        return true;
      } catch (e) {
        setError(messageFromUnknown(e));
        return false;
      }
    });
  }

  const handleRenamePreset = useCallback(async (id: string, name: string) => {
    try {
      await presets.rename(id, name);
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }, [presets.rename]);

  /** Applies preset `id` immediately — goes through the shared `commit`
   *  helper (`sessionRef.current.commit` + `syncSession` + `requestRender`),
   *  the SAME path as every other layer mutation: a hand-rolled
   *  `setLayers(sessionRef.current.layers())` would push full layer objects
   *  (with mask rasters) into React state, the 24MP OOM crash this file's
   *  `syncSession` comment documents as already fixed once, and would skip
   *  `requestRender` entirely (canvas wouldn't redraw). The confirmation gate
   *  lives in `requestApplyPreset` below, not here — this function always
   *  applies, it never asks. */
  const applyPreset = useCallback(async (id: string) => {
    try {
      // (Mineur, final-review fix) The `if (presets.activePresetId !== id)
      // presets.clearActive();` line that used to be here was dead code:
      // `applyTo` reposes `active` unconditionally right after via
      // `setActive({ id, snapshot: ... })`, so this conditional clear could
      // never have any observable effect — removed rather than left as a
      // no-op suggesting an intention it didn't have.
      await presets.applyTo(
        id,
        sessionRef.current.layers(),
        (newLayers) => {
          const stack = new LayerStack();
          // §2.3 du design 2026-07-28 : appliquer un preset ne doit PAS faire
          // disparaître les photos du document — depuis la tranche T1 le fond
          // en est une, et un remplacement total de la pile laisserait l'écran
          // sur le damier de la toile vide. Voir `withPhotoLayersPreserved`
          // pour le choix de position.
          const mergedLayers = withPhotoLayersPreserved(sessionRef.current.layers(), newLayers);
          stack.layers = mergedLayers;
          commit(stack);
          // Important 6 (final-review fix): applyPreset replaces the WHOLE
          // stack with FRESH layer ids (LayerStack's freshId counter never
          // reuses an id) — every entry left in maskPaintersRef for the
          // OUTGOING layers is now an orphaned ~24Mo buffer for an id that
          // exists nowhere anymore. Purging by id (rather than relying on
          // ids never colliding) keeps this correct even if that invariant
          // ever changes.
          const newIds = new Set(mergedLayers.map((l) => l.id));
          for (const layerId of maskPaintersRef.current.keys()) {
            if (!newIds.has(layerId)) maskPaintersRef.current.delete(layerId);
          }
        },
        (message) => setError(message)
      );
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }, [presets.applyTo, commit]);

  /** Hard confirmation floor (PRD) : appliquer un preset sur une pile non
   *  vide écraserait des masques déjà peints — jamais sans confirmation
   *  explicite. Pile vide -> applique immédiatement, aucune confirmation.
   *  Important 2 (final-review fix) : la pile remplacée peut aussi contenir
   *  un calque photo (double exposure) importé et transformé à la main —
   *  destruction au moins aussi coûteuse qu'un masque peint, mais que
   *  l'ancien dialogue ne mentionnait jamais alors que la CAPTURE d'un
   *  preset, elle, énumère nommément les calques photo exclus. */
  const requestApplyPreset = useCallback((id: string) => {
    const currentLayers = sessionRef.current.layers();
    if (currentLayers.length > 0) {
      setPendingPresetApply({ id, photoLayerCount: countPhotoLayers(currentLayers) });
      return;
    }
    applyPreset(id);
  }, [applyPreset]);

  const exportPresetFile = useCallback(async (id: string) => {
    try {
      const doc = await presetStoreRef.current.load(id);
      const sanitized = doc.name.replace(/[\\/:*?"<>|]/g, "_");
      await presetStoreRef.current.exportTo(`${sanitized}.json`, doc);
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }, []);

  const importPresetFile = useCallback(async () => {
    try {
      const doc = await presetStoreRef.current.importFrom();
      if (!doc) return; // annulé par l'utilisateur
      await presetStoreRef.current.save(doc.id, doc);
      await presets.refresh();
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }, [presets.refresh]);

  // Bouton "Exporter" : dossier fixe Images/shaderlab-export, nom nu tant
  // qu'il n'y a pas de collision réelle (resolveDefaultExportTarget).
  const handleExport = useCallback(async () => {
    await performExport(defaultExportDir, true);
  }, [performExport]);

  // Bouton "Exporter sous..." : dossier choisi par l'utilisateur, toujours
  // -edited en premier (comportement conservateur).
  const handleExportAs = useCallback(async () => {
    await performExport(pickExportFolder, false);
  }, [performExport]);

  const selectedLayer = layers.find((l) => l.id === selectedId) ?? null;
  const paramsPanelTitle = selectedLayer ? `Réglages · ${getEffect(selectedLayer.effectId).name}` : "Réglages";

  const presetsPanel = useContextualPanel(true, "static");
  const layersPanel = useContextualPanel(true, "static");
  const paramsPanel = useContextualPanel(selectedId !== null, selectedId);
  const maskPanel = useContextualPanel(selectedId !== null, selectedId);
  // Panneau « Photo » : même câblage que Réglages/Masque (condition liée à la
  // sélection), mais la condition est d'être un calque PHOTO. Le rail restant
  // l'unique moyen de fermeture, il peut aussi l'OUVRIR hors condition — d'où
  // l'état vide obligatoire de `PhotoPanel`.
  const isPhotoLayerSelected = selectedLayer?.imageSource !== undefined;
  const photoPanel = useContextualPanel(isPhotoLayerSelected, selectedId);

  // Table explicite plutôt qu'une chaîne de ternaires : sans branche par
  // défaut, un id inconnu héritait silencieusement de la visibilité du Masque.
  // Ce prédicat ne sert plus seulement à filtrer l'affichage, il alimente aussi
  // la traduction des index de glisser-déposer (`toFullDockTarget`) — un id
  // oublié y fausserait le déplacement sans jamais lever d'erreur. Le chantier
  // Presets ajoute un 4e panneau : il DOIT échouer bruyamment ici s'il oublie
  // sa ligne (fail-fast projet, pas de repli silencieux).
  const panelVisibility: Record<string, boolean> = useMemo(
    () => ({
      presets: presetsPanel.visible,
      layers: layersPanel.visible,
      photo: photoPanel.visible,
      params: paramsPanel.visible,
      mask: maskPanel.visible,
    }),
    [presetsPanel.visible, layersPanel.visible, photoPanel.visible, paramsPanel.visible, maskPanel.visible]
  );
  const isPanelVisible = useCallback(
    (id: string) => {
      const visible = panelVisibility[id];
      if (visible === undefined) throw new Error(`Panneau inconnu dans le dock : "${id}" (ajouter sa visibilité à panelVisibility).`);
      return visible;
    },
    [panelVisibility]
  );

  // Le dock ne reçoit QUE les panneaux visibles : une colonne dont tous les
  // panneaux sont masqués garderait sinon sa largeur (`.panel-column__stack`
  // est en `flex: 0 0 --dock-reserved-width`) et laisserait un trou. Filtrer le
  // LAYOUT plutôt que le tableau `panels` est ce qui fait disparaître la
  // colonne : une colonne vide reste une colonne.
  const visibleLayout = useMemo(() => visibleDockLayout(dockLayout, isPanelVisible), [dockLayout, isPanelVisible]);

  // `dockLayout` (complet) reste la source de vérité : il mémorise la place
  // d'un panneau masqué, qui la retrouve en réapparaissant. La cible de drop
  // rapportée par PanelColumn est donc exprimée dans les index de la
  // projection VISIBLE et doit être retraduite avant mutation, sinon masquer
  // un panneau décale les colonnes et le glisser-déposer atterrit à côté.
  const handlePanelMove = useCallback(
    (id: string, target: DockDropTarget) => {
      setDockLayout((previous) =>
        movePanelInDock(previous, id, toFullDockTarget(previous, visibleDockLayout(previous, isPanelVisible), target))
      );
    },
    [isPanelVisible]
  );

  // Overlay du masque (rouge + contour animé) : affiché tant qu'on travaille
  // réellement sur le masque du calque sélectionné (panneau Masque ouvert OU
  // pinceau actif) ET qu'il y a un masque actif à montrer — pas en continu
  // dès qu'un masque existe (bruit visuel pendant qu'on règle un autre
  // aspect du calque). `overlayForceHidden` (Task 1) reste prioritaire :
  // un utilisateur qui veut juger le rendu final sans quitter le panneau
  // doit pouvoir l'éteindre explicitement. Voir
  // docs/superpowers/specs/2026-07-23-shaderlab-mask-overlay-visibility-design.md.
  const hasActiveMask = selectedLayer ? planFold(selectedLayer.mask).length > 0 : false;
  const wantsOverlay = ((maskPanel.visible && !maskFolded) || maskPaintMode) && hasActiveMask && !!selectedId;

  // Délai de grâce de 750ms avant extinction : quand on ferme le panneau
  // Masque, change de calque, ou que le calque perd son masque actif,
  // `wantsOverlay` passe à `false` immédiatement — mais `graceVisible` ne
  // suit qu'après ce délai, pour laisser voir le résultat se stabiliser
  // plutôt qu'une coupure brutale. Annulé (`clearTimeout`) si `wantsOverlay`
  // redevient `true` avant l'échéance (ex: on rouvre le panneau vite).
  const [graceVisible, setGraceVisible] = useState(wantsOverlay);
  useEffect(() => {
    if (wantsOverlay) {
      setGraceVisible(true);
      return;
    }
    const timer = setTimeout(() => setGraceVisible(false), 750);
    return () => clearTimeout(timer);
  }, [wantsOverlay]);

  const showOverlay = !overlayForceHidden && graceVisible;

  // Tableau d'items d'identité STABLE : `PanelRail` est mémoïsé (2026-07-30) et
  // un littéral recréé dans le JSX à chaque rendu aurait annulé la mémoïsation
  // sans rien signaler. Les dépendances sont exactement ce que le rail affiche :
  // la visibilité de chaque panneau et son basculeur.
  const railItems = useMemo(
    () =>
      [
        { id: "presets", icon: PackagePlus, label: "Presets", active: presetsPanel.visible, onClick: presetsPanel.toggleRail },
        { id: "layers", icon: Layers, label: "Effets", active: layersPanel.visible, onClick: layersPanel.toggleRail },
        { id: "photo", icon: PhotoRailIcon, label: "Photo", active: photoPanel.visible, onClick: photoPanel.toggleRail },
        { id: "params", icon: SlidersHorizontal, label: "Réglages", active: paramsPanel.visible, onClick: paramsPanel.toggleRail },
        { id: "mask", icon: BrushRailIcon, label: "Masque", active: maskPanel.visible, onClick: maskPanel.toggleRail },
      ] satisfies PanelRailItem[],
    [
      presetsPanel.visible, presetsPanel.toggleRail,
      layersPanel.visible, layersPanel.toggleRail,
      photoPanel.visible, photoPanel.toggleRail,
      paramsPanel.visible, paramsPanel.toggleRail,
      maskPanel.visible, maskPanel.toggleRail,
    ],
  );

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setMaskOverlay(showOverlay && selectedId ? selectedId : null);
    r.requestRender(sessionRef.current.layers());

    if (showOverlay && selectedId) {
      overlayAnimationLoopRef.current.start((timeMs) => {
        rendererRef.current?.tickOverlayAnimation(timeMs);
      });
    } else {
      overlayAnimationLoopRef.current.stop();
    }
    return () => overlayAnimationLoopRef.current.stop();
  }, [showOverlay, selectedId]);

  return (
    <div className="app-shell">
      <Toolbar
        canUndo={sessionRef.current.canUndo()}
        canRedo={sessionRef.current.canRedo()}
        hasImage={imageSize.width > 0 && imageSize.height > 0}
        fileName={documentName}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onExport={handleExport}
        onExportAs={handleExportAs}
        onOpenFile={handleToolbarOpenFile}
        onOpenFileWithFormat={handleToolbarOpenFileWithFormat}
        onOpenFileWithFreeSize={handleToolbarOpenFileWithFreeSize}
        onImportPhotoLayer={photoLayer.handleImportPhotoLayer}
        canImportPhotoLayer={canAddPhotoLayer(layers)}
      />
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {maskPaintMode && (
        <BrushToolbar
          brushSize={brushSize}
          onBrushSizeChange={setBrushSize}
          brushHardness={brushHardness}
          onBrushHardnessChange={setBrushHardness}
          erase={erase}
          onEraseChange={setErase}
          onStop={photoLayer.stopMaskPaintMode}
        />
      )}
      {/* Deux mesures DISTINCTES, à ne pas confondre :
          --dock-reserved-width = largeur d'UNE colonne (lue par PanelColumn.css
          pour dimensionner chaque pile, et pilotée par la poignée de resize) ;
          --dock-total-width = place réellement occupée par le dock à l'écran,
          soit n colonnes et leurs n-1 gouttières. C'est cette seconde mesure que
          le canvas doit compenser : avec la première, masquer tous les panneaux
          depuis le rail laissait le canvas décalé de 320px pour un dock devenu
          invisible, et un dock à 2 colonnes n'était compensé que pour une. */}
      <main
        className="workspace"
        ref={workspaceRef}
        style={{
          "--dock-reserved-width": `${dockWidth}px`,
          "--dock-total-width":
            visibleLayout.length === 0
              ? "0px"
              : `calc(${visibleLayout.length} * ${dockWidth}px + ${visibleLayout.length - 1} * var(--space-4))`,
        } as React.CSSProperties}
      >
        <Canvas
          ref={canvasRef}
          onFileDropped={(file) => openFile(file, null)}
          hasImage={imageSize.width > 0 && imageSize.height > 0}
          // FERMÉ SUR ZÉRO ARGUMENT, jamais `onOpenFile={handleOpenFile}`.
          // `EmptyWorkspace` branche cette prop sur un `onClick`, donc React lui
          // passe un SyntheticEvent en premier argument — qui atterrissait dans
          // le paramètre `canvasFormat` de `handleOpenFile` (ajouté par la
          // tranche T2) et le faisait échouer sur un TypeError nu après que
          // l'utilisateur avait déjà choisi son fichier. Mesuré sur la vraie
          // fenêtre le 2026-07-30 : `canvasSizeFor(<event>, photo)` ->
          // « TypeError: Cannot read properties of undefined (reading 'width') ».
          // Le paramètre par défaut ne protège de rien ici : un événement n'est
          // pas `undefined`.
          onOpenFile={() => void handleOpenFile()}
          maskPaintMode={maskPaintMode}
          onMaskStroke={handleMaskStroke}
          onStrokeEnd={handleMaskStrokeEnd}
          brushSize={brushSize}
          brushHardness={brushHardness}
          // Sélection directe en mode `idle` UNIQUEMENT : jamais en `maskPaint`
          // (le pinceau garde la main), jamais en `crop` (les poignées de crop
          // prennent la place) — `src/ui/canvasMode.ts`.
          onPick={photoLayer.canvasMode.kind === "idle" ? handleCanvasPick : undefined}
        />
        {/* `showTransformHandles` = mode canvas `idle` (usePhotoLayer/CanvasMode).
            Avant T1, les poignées se montaient sur la seule SÉLECTION : un calque
            photo sélectionné en mode peinture superposait sa boîte de déplacement
            (pointerEvents: "auto" sur toute la boîte) au geste de pinceau. Les
            deux modes sont maintenant mutuellement exclusifs. */}
        {showTransformHandles && selectedLayer?.imageSource && selectedLayer.transform && (
          <TransformHandles
            transform={selectedLayer.transform}
            photoSize={rendererRef.current?.photoSources?.dimensions(selectedLayer.imageSource.sourceId) ?? { width: 1, height: 1 }}
            bgSize={imageSize}
            canvasRef={canvasRef}
            onTransformChange={(t) => handleTransformChange(selectedLayer.id, t)}
            onTransformCommit={handleTransformCommit}
            // La box de déplacement couvre toute la bounding box du calque
            // sélectionné et masque le canvas : un clic sur une image posée
            // par-dessus lui cède la sélection au lieu de déplacer la sélection
            // courante. Un clic qui ne touche AUCUNE autre image (y compris le
            // vide entre la box et la photo tournée) garde le déplacement — la
            // box reste une surface de drag, la désélection appartient au canvas.
            onPickThrough={(x, y) => {
              const hit = pickPhotoLayerAt(x, y);
              if (hit === null || hit === selectedLayer.id) return false;
              selectLayer(hit);
              return true;
            }}
          />
        )}
        <PanelColumn
          panels={[
            {
              id: "presets", title: "Presets", collapsed: presetsFolded, onCollapsedChange: setPresetsFolded,
              // Liste de longueur variable : c'est elle qui se comprime et
              // défile quand la colonne manque de place, pas les cartes à
              // contenu fixe (Photo, Réglages) — voir `variableLength`.
              variableLength: true,
              content: (
                <>
                  <PresetPanel
                    summaries={presets.summaries}
                    hasLayers={layers.length > 0}
                    onSave={requestSavePreset}
                    onRename={handleRenamePreset}
                    onApply={requestApplyPreset}
                    onExport={exportPresetFile}
                    onImport={importPresetFile}
                  />
                  {/* Critique 1 (final-review fix) : `layers.length > 0` —
                      même garde que le bouton "Enregistrer" de PresetPanel
                      (`hasLayers`), qui l'avait déjà et que cette bannière
                      n'avait pas. Une pile vidée par undo ne doit jamais
                      offrir "Mettre à jour"/"Créer une copie" : les deux
                      écriraient un preset vide sur disque. */}
                  {presetIsDirty && presets.activePresetId && layers.length > 0 && (
                    <div className="preset-panel__dirty-banner">
                      <span>Preset modifié.</span>
                      <Button size="sm" variant="secondary" onClick={requestUpdateActive}>
                        Mettre à jour
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setPendingPresetCopyName("")}>
                        Créer une copie
                      </Button>
                    </div>
                  )}
                </>
              )
            },
            {
              // LIBELLÉ « Effets » (décision Antoine sur maquette, 2026-07-27) :
              // dans shaderlab la pile n'est pas un empilement de contenus
              // comme dans Photoshop, c'est une chaîne de traitement appliquée
              // à une image de fond. L'IDENTIFIANT reste `layers` — il est lu
              // par dockLayout, panelVisibility et le rail ; aucun libellé
              // n'est persisté nulle part (vérifié : ni localStorage ni
              // document de preset ne porte de titre de panneau).
              id: "layers", title: "Effets", collapsed: layersFolded, onCollapsedChange: setLayersFolded,
              // La pile de calques est LA liste longue du dock.
              variableLength: true,
              // Contrôles du calque SÉLECTIONNÉ, dans la zone fixe de la carte
              // (ils ne défilent pas avec la liste) — ils étaient répétés sur
              // chaque ligne jusqu'au 2026-07-27.
              // PIED et non en-tête (décision Antoine 2026-07-28) : on lit
              // d'abord CE QUI est modifié — la ligne sélectionnée dans la
              // liste — puis les réglages qui s'y appliquent. L'ADR-0001 est
              // préservé : la zone reste unique, fixe, hors du conteneur
              // défilant ; seule sa position change.
              controlsPlacement: "bottom",
              controls: <LayerControls
                  layers={layers}
                  selectedId={selectedId}
                  onOpacityChange={handleOpacityChange}
                  onOpacityCommit={handleParamCommit}
                  onBlendModeChange={handleBlendModeChange}
                  onEffectChange={handleEffectChange}
                  // Verrou/duplication/suppression : migrés des lignes vers
                  // cette zone le 2026-07-29 (ADR-0001). Ils agissent sur le
                  // calque sélectionné ; les callbacks sont inchangés.
                  onToggleLock={handleToggleLock}
                  onDuplicate={handleDuplicate}
                  onRemove={handleRemove}
                />,
              content: <LayerPanel
                  layers={layers}
                  selectedId={selectedId}
                  hasImage={imageSize.width > 0 && imageSize.height > 0}
                  onSelect={selectLayer}
                  onToggle={isolation.handleEyeClick}
                  isolatedLayerId={isolation.isolatedLayerId}
                  onAdd={handleAdd}
                  onReorder={handleReorder}
                  thumbnailUrl={photoLayer.thumbnailUrl}
                />
            },
            {
              id: "photo", title: "Photo", collapsed: photoFolded, onCollapsedChange: setPhotoFolded,
              content: <PhotoPanel
                  layer={selectedLayer}
                  thumbnailUrl={photoLayer.thumbnailUrl}
                  onTransformChange={handleTransformChange}
                  onTransformCommit={handleTransformCommit}
                  onReset={photoLayer.handlePhotoReset}
                  onFitToCanvas={photoLayer.handlePhotoFitToCanvas}
                  onCenter={photoLayer.handlePhotoCenter}
                  onReplaceImage={photoLayer.handleReplacePhotoImage}
                />
            },
            {
              id: "params", title: paramsPanelTitle, collapsed: paramsFolded, onCollapsedChange: setParamsFolded,
              content: <ParamPanel
                  layer={selectedLayer}
                  onParamChange={handleParamChange}
                  onParamCommit={handleParamCommit}
                  onClipChange={handleClipChange}
                  onOpenColorPicker={(group) =>
                    // Re-cliquer la MÊME pastille referme le picker (bascule),
                    // au lieu de le laisser ouvert sans issue autre que le X.
                    setColorPicker((current) =>
                      // `effectId` dans la comparaison : un picker masqué parce
                      // que l'effet du calque a changé ne doit pas absorber le
                      // premier clic sur une pastille de MÊME clé du nouvel effet.
                      current && current.layerId === group.layerId && current.effectId === group.effectId && current.key === group.key
                        ? null
                        : {
                            ...group,
                            // viewport -> repère de `.workspace`, dans lequel le
                            // picker est positionné en absolu.
                            anchorTop: group.anchorTop - (workspaceRef.current?.getBoundingClientRect().top ?? 0),
                          }
                    )
                  }
                />
            },
            {
              id: "mask", title: "Masque", collapsed: maskFolded, onCollapsedChange: setMaskFolded,
              // Liste des sources de masque : longueur variable elle aussi.
              variableLength: true,
              content: <MaskPanel
                  // Props RESSERRÉES (2026-07-30) : le panneau ne reçoit plus
                  // le calque entier, dont l'identité change à chaque frame de
                  // tout geste vivant, mais les trois champs qu'il lit. Voir
                  // l'en-tête de `MaskPanel.tsx`.
                  layerId={selectedLayer?.id ?? null}
                  mask={selectedLayer?.mask ?? null}
                  locked={selectedLayer?.locked === true}
                  maskPaintMode={maskPaintMode}
                  onToggleMaskPaint={photoLayer.toggleMaskPaintMode}
                  overlayForceHidden={overlayForceHidden}
                  onToggleOverlayForceHidden={handleToggleOverlayForceHidden}
                  onAddMaskSource={handleAddMaskSource}
                  onRemoveMaskSource={handleRemoveMaskSource}
                  onMaskSourceParamsChange={handleMaskSourceParamsChange}
                  onMaskSourceParamsCommit={handleParamCommit}
                  onMaskSourceCombineModeChange={handleMaskSourceCombineModeChange}
                  onMaskSourceEnabledChange={handleMaskSourceEnabledChange}
                  onMaskInvertChange={handleMaskInvertChange}
                  onMaskEnabledChange={handleMaskEnabledChange}
                  onRefineEdgeChange={handleRefineEdgeChange}
                  onRefineEdgeCommit={handleParamCommit}
                  onAddColorSample={handleAddColorSample}
                />
            },
          ]}
          layout={visibleLayout}
          onMove={handlePanelMove}
          width={dockWidth}
          onWidthChange={handleDockWidthChange}
        />
        <PanelRail items={railItems} />
        {colorPicker && selectedLayer?.id === colorPicker.layerId && selectedLayer.effectId === colorPicker.effectId && (
          <ColorPickerPanel
            key={colorPicker.key}
            label={colorPicker.label}
            hue={layers.find((l) => l.id === colorPicker.layerId)?.params[colorPicker.hue.name] ?? colorPicker.hue.default}
            saturation={layers.find((l) => l.id === colorPicker.layerId)?.params[colorPicker.saturation.name] ?? colorPicker.saturation.default}
            lightness={layers.find((l) => l.id === colorPicker.layerId)?.params[colorPicker.lightness.name] ?? colorPicker.lightness.default}
            onChange={(values) => {
              const params: Record<string, number> = {};
              if (values.hue !== undefined) params[colorPicker.hue.name] = values.hue;
              if (values.saturation !== undefined) params[colorPicker.saturation.name] = values.saturation;
              if (values.lightness !== undefined) params[colorPicker.lightness.name] = values.lightness;
              handleParamChange(colorPicker.layerId, params);
            }}
            onCommit={handleParamCommit}
            onClose={() => setColorPicker(null)}
            anchorTop={colorPicker.anchorTop}
            // Ancré à GAUCHE du dock ENTIER, pas d'une seule colonne : le dock
            // fait `visibleLayout.length` colonnes de `dockWidth`, séparées par
            // --space-4. Les `length` gouttières comptées ici = les length-1
            // séparations internes + celle entre le picker et le dock. Sans le
            // facteur colonnes, le picker se posait PAR-DESSUS le dock dès
            // qu'il avait 2 colonnes (constaté au checkpoint 2026-07-25).
            // Même mesure que le canvas (--dock-total-width) : les deux doivent
            // s'accorder sur la place occupée par le dock, sinon l'un se recale
            // et l'autre pas.
            style={{
              right: "calc(var(--space-6) + var(--rail-width) + var(--space-4) + var(--dock-total-width) + var(--space-4))",
            }}
          />
        )}
        <Dialog
          open={pendingOverwrite !== null}
          title="Remplacer le preset existant ?"
          description={pendingOverwrite ? `Un preset nommé "${pendingOverwrite.name}" existe déjà. L'enregistrement va écraser son contenu.` : undefined}
          onClose={() => {
            // Mineur 4 : annuler l'écrasement (X / Échap) doit résoudre
            // `requestSavePreset` à `false` — sinon la Promise reste en
            // suspens et PresetPanel ne sait jamais que l'écriture n'a pas eu lieu.
            pendingOverwrite?.resolve(false);
            setPendingOverwrite(null);
          }}
          actions={
            <>
              <Button
                variant="secondary"
                autoFocus
                onClick={() => {
                  pendingOverwrite?.resolve(false);
                  setPendingOverwrite(null);
                }}
              >
                Annuler
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (pendingOverwrite) {
                    const { name, id, resolve } = pendingOverwrite;
                    gateOnPhotoLayers(name, () => commitSavePreset(name, id)).then(resolve);
                  }
                  setPendingOverwrite(null);
                }}
              >
                Écraser
              </Button>
            </>
          }
        />
        <Dialog
          open={pendingPhotoLayerSave !== null}
          title="Calque(s) photo exclu(s) du preset"
          description={
            pendingPhotoLayerSave
              ? // « photo », plus « photo (double exposure) » : depuis T1 la
                // photo d'ouverture est un calque photo comme un autre et peut
                // figurer dans cette liste — la nommer « double exposure »
                // serait faux. L'avis lui-même ne se déclenche plus que si le
                // document contient une photo IMPORTÉE (presetDocument.ts).
                `${pendingPhotoLayerSave.excludedLayerIndexes.length} calque${pendingPhotoLayerSave.excludedLayerIndexes.length > 1 ? "s" : ""} photo ne ${pendingPhotoLayerSave.excludedLayerIndexes.length > 1 ? "seront" : "sera"} pas inclus dans le preset — une source de photo n'a de sens que dans ce document.`
              : undefined
          }
          onClose={() => {
            pendingPhotoLayerSave?.onCancel();
            setPendingPhotoLayerSave(null);
          }}
          actions={
            <>
              <Button
                variant="secondary"
                autoFocus
                onClick={() => {
                  pendingPhotoLayerSave?.onCancel();
                  setPendingPhotoLayerSave(null);
                }}
              >
                Annuler
              </Button>
              <Button
                variant="default"
                onClick={() => {
                  pendingPhotoLayerSave?.onConfirm();
                  setPendingPhotoLayerSave(null);
                }}
              >
                Enregistrer quand même
              </Button>
            </>
          }
        >
          {pendingPhotoLayerSave && (
            <ul className="preset-panel__excluded-list">
              {pendingPhotoLayerSave.excludedLayerIndexes.map((layerIndex) => (
                <li key={layerIndex}>Calque {layerIndex + 1} — photo</li>
              ))}
            </ul>
          )}
        </Dialog>
        {/* Saisie libre des dimensions de la toile (tranche T2). Vient AVANT le
            sélecteur de fichier : rien ici ne dépend de la photo, et l'ordre
            inverse obligerait à décoder l'image pour poser un défaut. */}
        <Dialog
          open={pendingFreeCanvas !== null}
          title="Taille de la toile"
          description={`En pixels. La photo sera centrée sur cette toile, sans être redimensionnée. Budget maximal : ${(MAX_CANVAS_PIXELS / 1e6).toFixed(0)} Mpx.`}
          onClose={() => setPendingFreeCanvas(null)}
          actions={
            <>
              <Button variant="secondary" autoFocus onClick={() => setPendingFreeCanvas(null)}>
                Annuler
              </Button>
              <Button
                variant="default"
                disabled={freeCanvas?.kind !== "ok"}
                onClick={confirmFreeCanvas}
              >
                Choisir une photo...
              </Button>
            </>
          }
        >
          <div className="canvas-size-dialog">
            <label className="canvas-size-dialog__field">
              Largeur
              <input
                type="number"
                min={1}
                className="preset-panel__name-input"
                value={pendingFreeCanvas?.width ?? ""}
                onChange={(e) =>
                  setPendingFreeCanvas((current) => (current ? { ...current, width: e.target.value } : current))
                }
              />
            </label>
            <label className="canvas-size-dialog__field">
              Hauteur
              <input
                type="number"
                min={1}
                className="preset-panel__name-input"
                value={pendingFreeCanvas?.height ?? ""}
                onChange={(e) =>
                  setPendingFreeCanvas((current) => (current ? { ...current, height: e.target.value } : current))
                }
              />
            </label>
            {/* Le message de refus est visible AVANT le clic, jamais après :
                le bouton est désactivé tant que la saisie n'est pas valide. */}
            {freeCanvas?.kind === "erreur" && (
              <p className="canvas-size-dialog__error" role="status">
                {freeCanvas.message}
              </p>
            )}
          </div>
        </Dialog>
        <Dialog
          open={pendingPresetCopyName !== null}
          title="Créer une copie du preset"
          onClose={() => setPendingPresetCopyName(null)}
          actions={
            <>
              <Button variant="secondary" autoFocus onClick={() => setPendingPresetCopyName(null)}>
                Annuler
              </Button>
              <Button
                variant="default"
                disabled={!pendingPresetCopyName || pendingPresetCopyName.trim() === ""}
                onClick={() => {
                  if (pendingPresetCopyName) requestCopyActiveAsNew(pendingPresetCopyName.trim());
                  setPendingPresetCopyName(null);
                }}
              >
                Créer
              </Button>
            </>
          }
        >
          {/* `aria-label` et pas seulement le `placeholder` : un placeholder
              n'est qu'un nom accessible de DERNIER recours (HTML-AAM), et son
              jumeau de `PresetPanel` porte déjà l'attribut. Deux champs du même
              rôle nommés par deux mécanismes différents est une dérive, pas un
              choix. Relevé le 2026-07-30 en balayant les noms accessibles des
              contrôles du dock. */}
          <input
            type="text"
            className="preset-panel__name-input"
            aria-label="Nom de la copie du preset"
            placeholder="Nom du nouveau preset"
            value={pendingPresetCopyName ?? ""}
            onChange={(e) => setPendingPresetCopyName(e.target.value)}
          />
        </Dialog>
        <Dialog
          open={pendingPresetApply !== null}
          title="Remplacer la pile de calques ?"
          description={
            // T5 (2026-07-28) : cette phrase annonçait la perte des calques
            // photo. C'était vrai quand `applyPreset` remplaçait la pile
            // entière ; c'est FAUX depuis que T1 les préserve
            // (`withPhotoLayersPreserved`). Elle vit maintenant dans une
            // fonction testée — voir `presets/applyPresetImpact.ts` pour
            // pourquoi une fausse menace est aussi grave qu'un avis parasite.
            pendingPresetApply ? applyPresetImpactMessage(pendingPresetApply.photoLayerCount) : undefined
          }
          onClose={() => setPendingPresetApply(null)}
          actions={
            <>
              <Button variant="secondary" autoFocus onClick={() => setPendingPresetApply(null)}>
                Annuler
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (pendingPresetApply) applyPreset(pendingPresetApply.id);
                  setPendingPresetApply(null);
                }}
              >
                Remplacer
              </Button>
            </>
          }
        />
      </main>
    </div>
  );
}
