/**
 * Condition d'affichage déclarative : « ceci ne s'affiche que si tel paramètre
 * à `choices` vaut tel index ».
 *
 * UN SEUL TYPE POUR TROIS PORTEURS — `CanvasControl.visibleWhen` (le premier,
 * 2026-08-02), `EffectParam.appliesWhen` et `EffectSection.appliesWhen`. Les
 * trois posent la même question et `validateEffect` les vérifie par la même
 * fonction. Trois copies auraient dérivé, et cette dérive-là ne se voit pas :
 * une condition mal validée ne casse rien, elle masque — un contrôle absent ne
 * se signale pas.
 *
 * ⚠️ LA CIBLE DOIT PORTER `choices` (vérifié). On compare un INDEX dans une
 * liste nommée, jamais une valeur continue : un seuil sur un curseur serait une
 * décision d'affichage cachée dans un nombre, que ni `validateEffect` ni un
 * relecteur ne pourraient rattacher à ce qui la commande.
 *
 * ⚠️ L'index d'un choix est PERSISTÉ dans les presets, et une condition le cite
 * en dur : ajouter une entrée à la FIN d'une liste de `choices` ne casse rien,
 * en insérer une au milieu décale toutes les conditions qui la visent.
 */
export interface DisplayCondition {
  /** Nom du paramètre à `choices` qui commande. */
  param: string;
  /** Index de choix — ou liste d'index — pour lesquels la condition est vraie. */
  equals: number | number[];
}

export interface EffectParam {
  name: string;
  label: string;
  unit?: "percent" | "pixels" | "degrees" | "none";
  hint?: string;
  min: number;
  max: number;
  /**
   * Ce paramètre a-t-il un SENS aux réglages courants ? Absent = toujours (le
   * cas de tous les paramètres écrits jusqu'ici).
   *
   * D'OÙ ÇA VIENT. 39 paramètres du registre portaient dans leur infobulle une
   * mention « Sans objet en … » — une phrase que personne n'avait jamais
   * mesurée, et que rien n'obligeait à rester vraie quand le shader bougeait.
   * Campagne du 2026-08-05, 74 configurations rendues
   * (`docs/superpowers/plans/2026-08-05-applicabilite-task1-resultats.md`) : 38
   * déclarations exactes, et la 39ᵉ FAUSSE — `glass.flat` déplace 47 à 49 % des
   * canaux en Martelé et en Écorce, où son infobulle le disait sans objet.
   * Un curseur caché par sa propre documentation, que personne n'aurait trouvé.
   * Ce champ sort la déclaration de la prose et la met là où `validateEffect`
   * peut au moins la relire.
   *
   * ⚠️ CE N'EST PAS UNE VALIDATION DE VALEUR. Masquer ne borne rien : la valeur
   * reste dans le calque, part telle quelle dans les presets, et le shader
   * continue de la lire — ses clamps restent nécessaires. C'est voulu : revenir
   * dans un mode où le paramètre s'applique doit le rendre agissant AVEC son
   * réglage, masquer n'efface pas.
   *
   * ⚠️ CE N'EST PAS NON PLUS UN REMPLAÇANT D'INFOBULLE. Le masquage dit QUE le
   * paramètre ne sert pas ici, l'infobulle dit POURQUOI. Les deux se gardent :
   * porter une déclaration vers ce champ n'autorise pas à retirer le `hint`.
   *
   * Voie A tranchée (design §3) : déclaratif SEUL, aucune échappatoire
   * prédicat. Un prédicat saurait tout exprimer et ne se relirait plus — ni par
   * `validateEffect`, ni par qui cherche ce qui commande quoi.
   */
  appliesWhen?: DisplayCondition;
  /**
   * Maximum EFFECTIF aux réglages courants, quand il dépend d'un autre
   * paramètre. Absent = `max` tout court (le cas de tous les paramètres écrits
   * jusqu'ici).
   *
   * D'OÙ ÇA VIENT. `sliceShift.edgeFeather` déclare 200 px et le shader le borne
   * à `sliceSize` — 48 par défaut. **Les trois quarts du curseur ne faisaient
   * donc rien**, sans aucun retour dans le panneau : le pouce avançait, le
   * nombre montait, l'image ne bougeait plus. Défaut relevé et écrit dans le
   * fichier de l'effet le 2026-08-02, laissé en l'état faute de pouvoir
   * l'exprimer ; c'est ce trou que ce champ comble.
   *
   * ⚠️ CE N'EST PAS UNE VALIDATION, c'est un affichage. Le shader borne toujours
   * de son côté — un preset écrit à la main, ou un `updateParams` programmatique,
   * ne passent pas par le panneau (`LayerStack.updateParams` ne borne RIEN). Ce
   * champ rend le curseur honnête ; il ne rend pas la valeur sûre.
   *
   * ⚠️ Reçoit les paramètres RÉSOLUS du calque (défauts appliqués), comme
   * `EffectPass.enabled`. Doit rendre une valeur ≤ `max` : `validateEffect` le
   * vérifie sur les défauts, seul jeu qu'il puisse connaître au chargement.
   */
  maxFrom?: (params: Record<string, number>) => number;
  default: number;
  step: number;
  /** Groups this param with its hue/saturation/lightness siblings (same `key`)
   *  under a single swatch + disclosure control in ParamPanel, instead of a
   *  standalone slider. All three roles must be present for a given `key` —
   *  ParamPanel throws otherwise (see groupEffectParams). */
  colorGroup?: { key: string; role: "hue" | "saturation" | "lightness"; label: string };
  /** Renders this param as a named CHOICE list instead of a slider. The param
   *  value stays a number — the index into this array — because the uniform is
   *  `array<f32, N>` and nothing else may cross that boundary.
   *
   *  Why a list and not a slider with `step: 1`. A slider labels its value with
   *  the number itself: a mode param would read "0" or "1" and say nothing about
   *  what either is. Distinct from `colorGroup`, which groups three CONTINUOUS
   *  params under one control; here a single param has discrete named states.
   *
   *  Reserved for genuinely discrete states — two settings of the SAME operation
   *  belong on a slider (see `channelMixer`'s `monochrome`, deliberately
   *  continuous so partial desaturations stay reachable). Use this when the
   *  intermediate values would model nothing. Validated by `validateEffect`:
   *  `min` must be 0, `step` 1, and `max` exactly `choices.length - 1`. */
  choices?: string[];
}

export interface EffectPass {
  /** Resolution scale of this pass's output target relative to the image (1 = full, 0.5 = half...). */
  scale: number;
  /** WGSL body defining fs_main(uv, color) — `color` samples this pass's INPUT texture (bound as
   *  srcTexture, same as any single-pass effect). Internal passes never see the mask or `prevPass`. */
  wgsl: string;
  /**
   * Cette passe sert-elle, aux paramètres courants ? Absent = toujours (le
   * comportement de tous les effets multi-passes écrits jusqu'ici).
   *
   * D'OÙ ÇA VIENT. `runInternalPasses` itérait `passes` sans condition, ce qui
   * allait tant qu'un effet multi-passes n'avait qu'un seul régime. Un effet à
   * MODES casse ce présupposé : `outlines` devait absorber `echoOutlines`, or
   * celui-ci portait neuf passes de pyramide et les modes locaux n'en lisent
   * aucune. Sans ce prédicat, choisir « Crête de gradient » ferait quand même
   * tourner la pyramide entière — sur 24 Mpx, la seule cible à l'échelle 0,5
   * pèse 24 Mo, et la VRAM est un risque ouvert.
   *
   * Ce prédicat est arrivé AVANT le besoin qui l'a motivé, et l'absorption a
   * suivi le jour même (ADR-0015) : `outlines` est aujourd'hui son unique
   * utilisateur, et le seul effet du registre dont le coût dépende d'un choix.
   *
   * ⚠️ CE N'EST PAS UNE OPTIMISATION, c'est une condition de correction du
   * modèle : une passe inutile n'est pas seulement lente, elle ALLOUE. Le
   * prédicat est donc évalué AVANT d'emprunter une cible au pool.
   *
   * ⚠️ SI TOUTES LES PASSES SAUTENT, la passe finale reçoit en `prevPass` la
   * texture SOURCE et non la sortie d'une pyramide. C'est cohérent (le
   * chaînage part de la source) mais le shader final doit être écrit en le
   * sachant : il ne doit lire `prevPass` que dans les modes dont les passes
   * tournent. Un mode qui lirait la source en croyant lire un champ flouté
   * rendrait n'importe quoi, sans erreur de compilation.
   *
   * Reçoit les paramètres RÉSOLUS (défauts appliqués), par nom.
   */
  enabled?: (params: Record<string, number>) => boolean;
}

export interface CanvasControlVisibility { visibleWhen?: DisplayCondition }

export type CanvasControl =
  | ({ id: string; kind: "point"; x: string; y: string; label: string } & CanvasControlVisibility)
  | ({ id: string; kind: "disk"; x: string; y: string; radius: string; label: string } & CanvasControlVisibility)
  | ({ id: string; kind: "axis"; angle: string; length: string; label: string } & CanvasControlVisibility);

export interface CurvePointSlot { x: string; y: string }

export interface CurveChannelControl {
  id: string;
  label: string;
  startY: string;
  points: [CurvePointSlot, CurvePointSlot, CurvePointSlot];
  endY: string;
}

export interface CurveControl {
  id: string;
  label: string;
  channels: CurveChannelControl[];
}

export interface TonalRangeEffectControl {
  shadowsMin: string;
  shadowsMax: string;
  highlightsMin: string;
  highlightsMax: string;
}

export interface ColorRampStopControl {
  id: string;
  label: string;
  hue: string;
  saturation: string;
  lightness: string;
  /** Paramètre de position persistant. Absent = arrêt fixe à sa place nominale. */
  position?: string;
}

export interface ColorRampControl {
  id: string;
  label: string;
  stops: [ColorRampStopControl, ColorRampStopControl, ColorRampStopControl];
  blackPoint: string;
  whitePoint: string;
}

/**
 * Régime d'affichage d'une section — COMMENT ses contrôles se disposent.
 *
 * VOCABULAIRE FERMÉ, et c'est tout l'intérêt. « Que les contrôles soient
 * optimisés pour l'affichage optimal de chaque mode » (Antoine, 2026-08-05) se
 * lit naturellement comme une mise en page libre par effet : ce serait 21 mises
 * en page à maintenir, et de la logique métier remontée dans `ParamPanel` — la
 * frontière qu'`ARCHITECTURE.md` interdit de franchir (aucun `if (effectId)`
 * dans `components/`). Chaque entrée ci-dessous répond à un besoin DÉJÀ présent
 * dans le registre ; en ajouter une doit coûter une décision, faute de quoi la
 * liste redevient de la mise en page libre en trois ajouts.
 *
 * ⚠️ UN GABARIT NE CHOISIT PAS DES PIXELS, il choisit un régime. La densité
 * reste réglée par les tokens et par ADR-0001.
 *
 * - `liste`  — un curseur par ligne. L'existant, et le défaut.
 * - `paire`  — deux curseurs liés sur une ligne : `blackPoint`/`whitePoint`,
 *              qui traîne dans cinq effets, et les bornes d'une plage.
 * - `grille` — curseurs courts en deux colonnes : les huit réglages de pavé de
 *              `glass`, les quatre du mortier.
 * - `pose`   — le réglage se manipule SUR l'image et non au curseur : c'est
 *              `CanvasControl` (point / disque / axe), déjà là. Sans accent
 *              dans le code ; le design l'appelle « posé ».
 * - `figure` — un contrôle dessiné, propre à son domaine : `CurveControl`,
 *              `ColorRampControl`, déjà là aussi.
 */
export type SectionLayout = "liste" | "paire" | "grille" | "pose" | "figure";

/**
 * Groupe nommé de paramètres d'un même effet, avec sa condition d'apparition et
 * son gabarit.
 *
 * D'OÙ ÇA VIENT. `glass` porte 22 paramètres et, en Poli, 15 sont sans objet :
 * l'utilisateur lit une liste plate dont les deux tiers ne servent à rien.
 * `outlines` en porte 26 pour 18 combinaisons de ses trois modes croisés.
 * `appliesWhen` seul ne suffit pas à ces deux-là — masquer ligne à ligne laisse
 * une liste plate, plus courte. Ce qui manque est le GROUPE : « ce qui fabrique
 * la pente » d'un côté, « ce qui s'applique aux quatorze matières » de l'autre.
 *
 * ⚠️ UN GROUPE N'EST PAS FORCÉMENT UN MODE. `lensFlare` a 30 paramètres et
 * aucun `choices` : ses trois phénomènes s'ADDITIONNENT au lieu de s'exclure
 * (ADR-0017), donc ses trois sections n'ont pas de condition. C'est la raison
 * pour laquelle le contrat s'articule sur des groupes qui apparaissent
 * ensemble, et pas sur « le mode ».
 *
 * ⚠️ C'EST UNE DONNÉE D'AFFICHAGE, PAS UN RÉORDONNANCEMENT DE `params[]`.
 * L'index d'un paramètre est persisté dans les presets : `params[]` ne bouge
 * jamais, une section regroupe des ITEMS DE RENDU. Corollaire non négociable :
 * `groupEffectParams` s'appuie sur l'ordre de `params[]` en deux endroits
 * (`spatialFirstIndex`, `firstIndexByKey`), donc une section déplace des BLOCS
 * ENTIERS et ne les traverse jamais.
 *
 * Un paramètre qu'aucune section ne cite reste rendu à sa place : déclarer des
 * sections n'oblige pas à toutes les écrire, et la moitié du registre n'a rien
 * à y gagner — `glow` a 4 paramètres, `grain` 5, et ils ne doivent rien changer.
 */
export interface EffectSection {
  /** Identifiant stable, unique dans l'effet (clé de rendu, état de repli). */
  id: string;
  /** Titre affiché. */
  label: string;
  /** Noms des paramètres regroupés. Chacun doit exister et n'être cité qu'une
   *  seule fois, toutes sections confondues — `validateEffect` le vérifie. */
  params: string[];
  /** Section absente quand la condition est fausse. Absent = toujours présente. */
  appliesWhen?: DisplayCondition;
  layout: SectionLayout;
}

export interface EffectModule {
  id: string;
  name: string;
  params: EffectParam[];
  /** WGSL fragment shader body. Must define fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32>
   *  and read params via the shared `params: array<f32, MAX_EFFECT_PARAMS>` uniform (index order matches `params` above).
   *  Single-pass body (used directly when `passes` is absent). For multi-pass effects, this is the
   *  FINAL composite pass and additionally may sample `prevPass` (binding 4, the last internal
   *  pass's output) — this is also the only pass masking is applied to. */
  wgsl: string;
  /** Optional chain of internal passes run in order, each at its own resolution scale, before the
   *  final composite (`wgsl` above) runs. Each pass's input is the previous pass's output (the
   *  first pass's input is the layer's normal source texture). Masking is NOT applied to internal
   *  passes — only to the final composite. */
  passes?: EffectPass[];
  /** Regroupement d'AFFICHAGE des paramètres (voir `EffectSection`). Absent =
   *  la liste plate, qui reste le défaut de tout le registre. */
  sections?: EffectSection[];
  canvasControls?: CanvasControl[];
  curveControls?: CurveControl[];
  tonalRangeControl?: TonalRangeEffectControl;
  colorRampControls?: ColorRampControl[];
  /**
   * Déclare qu'un DISQUE de cet effet se manipule directement sur la toile,
   * en nommant les paramètres qui le portent. `RegionHandles` en dessine alors
   * un cercle déplaçable, et le panneau garde ses curseurs.
   *
   * DÉCLARATIF ET NON DEVINÉ. La tentation était de repérer les paramètres au
   * nom (`regionX`/`centerX`…) : ça marche jusqu'au jour où un effet nomme
   * autrement, et ça échoue alors SANS RIEN DIRE — le manipulateur ne s'affiche
   * simplement pas. Ici, `validateEffect` vérifie que les trois noms existent
   * vraiment dans `params`, donc une faute de frappe lève au chargement du
   * registre.
   *
   * ⚠️ LES DEUX UNITÉS DIFFÈRENT, et `ui/regionHandles.ts` est le seul endroit
   * qui les convertit : le centre est en UV (0..1 du cadre), le rayon est en
   * espace ISOTROPE (pixels / sqrt(W*H)). Un effet qui exposerait un rayon en
   * UV ne peut pas se déclarer ici sans changer cette convention.
   */

  /**
   * Déclare que cet effet ÉCHANTILLONNE UNE TEXTURE DE LA BIBLIOTHÈQUE, en
   * nommant le paramètre qui porte son RANG dans le catalogue.
   *
   * C'est ce qui permet à un effet de désigner une image, ce que
   * `LayerState.params` ne permet pas seul : il est un `Record<string, number>`
   * parce que l'uniform est `array<f32, MAX_EFFECT_PARAMS>`. Le paramètre porte
   * le RANG (un nombre), et le binding 7 porte les pixels — voir
   * `ComposeOptions.hasLibraryTexture` et `render/textureLibraryStore.ts`.
   *
   * DÉCLARATIF ET NON DEVINÉ, même raison que `regionControl` ci-dessus :
   * repérer le paramètre à son nom marcherait jusqu'au jour où un effet nomme
   * autrement, et échouerait alors SANS RIEN DIRE. `validateEffect` vérifie que
   * `indexParam` existe vraiment dans `params`.
   *
   * ⚠️ **CONTRAT DU SHADER : tester `textureDimensions(libraryTexture)` et
   * rendre l'entrée inchangée quand un côté vaut 1.** Le chargement est
   * asynchrone, et le binding est TOUJOURS fourni — `TextureLibraryStore`
   * sert une texture 1×1 de repli tant que la vraie n'est pas là, précisément
   * pour que le corps WGSL reste une chaîne fixe (voir `viewFor`). Sans ce
   * test, l'effet afficherait un aplat pendant une frame.
   */
  libraryTexture?: { indexParam: string };

  /**
   * Mode de fusion et opacité posés sur un calque FRAÎCHEMENT créé pour cet
   * effet. Absents = `normal` à 1, le comportement de tous les effets écrits
   * jusqu'ici, et le bon défaut pour un effet qui TRAITE ce qui est en dessous.
   *
   * Ils existent pour les effets qui PRODUISENT du contenu au lieu de traiter :
   * `texture` sort le scan brut, donc posé en `normal` à 1 il cacherait la
   * photo. Le premier geste serait toujours de corriger les deux — ce n'est pas
   * une préférence à deviner, c'est un défaut manquant.
   *
   * ⚠️ Ce sont des VALEURS INITIALES, pas une contrainte : l'utilisateur les
   * change dans les contrôles du calque comme sur n'importe quel autre, et rien
   * ne les repose ensuite. `defaultBlendMode` doit désigner un id réel de
   * `render/blend/registry.ts` — `getBlendMode` lève sinon, et `validateEffect`
   * ne peut pas le vérifier sans faire dépendre `effects/` de `blend/`.
   */
  defaultBlendMode?: string;
  defaultOpacity?: number;
}
