import type { EffectModule } from "./types";
import { HASH_WGSL, VALUE_NOISE_WGSL } from "./hash";
import { UV_SPACE_WGSL } from "./uvSpace";
import { SRGB_TO_LINEAR_VEC3_WGSL, SRGB_TO_LINEAR_WGSL } from "./srgbTransfer";

/**
 * Glass — ce qu'une feuille de verre IMPRIMÉ fait à l'image derrière elle.
 *
 * ─── D'OÙ ÇA VIENT ──────────────────────────────────────────────────────────
 *
 * Portage du système de réfraction d'Antoine, `C:\dev\portfolio\src\shaders\
 * verre\site.fs.glsl` (1 405 lignes GLSL), plan de portage validé le 2026-08-03
 * (`docs/superpowers/specs/2026-08-03-verre-plan-de-portage.md`).
 *
 * ⚠️ IL N'Y A PLUS QU'UNE TRANCHE : LA FEUILLE. La tranche 2 — cinq matières de
 * PAVÉ (grille de blocs, mortier, arête biseautée, moulage interne) livrées le
 * 2026-08-04 à la fin de la même liste — est RETIRÉE depuis le 2026-08-27, sur
 * verdict d'usage d'Antoine et après quatre refus datés (ADR-0021). Ne pas la
 * reproposer comme une idée neuve ; l'ADR dit ce qui part, ce qui est perdu et
 * pourquoi les trois corrections livrées n'ont pas suffi.
 *
 * DEUX CONSÉQUENCES QUI SE LISENT DANS LE CODE ET PAS AILLEURS :
 * - les cinq matières et leurs HUIT paramètres étaient les DERNIERS de leurs
 *   listes, donc le retrait ne déplace AUCUN index — ni de matière, ni de
 *   paramètre. Les treize références de pixels de la feuille rendent le même
 *   bit qu'avant, et c'est le gate discriminant du retrait ;
 * - un preset qui cite `material` 9 à 13 ne casse pas et ne retombe pas non plus
 *   sur une matière voisine. ⚠️ IL N'Y A AUCUN CLAMP SUR LE CHEMIN : ni
 *   `LayerStack.updateParams`, ni `EffectPassRunner`, ni le shader n'écrêtent
 *   `params[0]` — `max` ne borne que le CURSEUR. La valeur 9 traverse donc
 *   `verre_pentes` sans reconnaître aucune branche et sort par le bloc des
 *   cannelures, où `p` reste `vec2(0.0)` : une feuille PLANE, qui n'a plus que
 *   son micro-relief, et sur laquelle toute l'optique (réfraction, absorption,
 *   Fresnel, spéculaire) continue de s'appliquer. Un preset qui cite
 *   `blockSize` ou l'un des sept autres pose, lui, une clé que le shader ne lit
 *   plus. Aucun des deux ne jette : c'est la convention du dépôt, la même que
 *   pour un effet retiré (`presetDocument.ts` avertit, il ne jette jamais).
 *
 * DEUX CHIFFRES DE LA NOTE DE REPRISE ÉTAIENT FAUX, et les compter a changé le
 * découpage : la source porte NEUF matières de feuille utilisables (dix
 * branches, moins `beton` que son auteur a retiré), et CINQ profils de section,
 * pas six. Vérifiés dans `pente()`.
 *
 * ─── LA STRUCTURE, ET POURQUOI ELLE TIENT EN DEUX ÉTAGES ────────────────────
 *
 * Un seul mécanisme, décliné neuf fois. Chaque matière ne fait qu'une chose :
 * fabriquer une PENTE de surface en chaque point. Tout ce qui suit — réfraction,
 * dispersion, diffusion, Fresnel, spéculaire, absorption — est commun et ne sait
 * rien de la matière qui l'a produite. C'est ce qui permet à neuf matières de
 * tenir dans un fichier au lieu de neuf.
 *
 * Conséquence directe sur les paramètres : `profil` et `congé` ne sont lus que
 * par `pente()`/`bosse()`, donc ne concernent QUE les trois premières matières.
 * Un curseur inerte est l'échec silencieux que ce dépôt proscrit — d'où le
 * « Sans objet en … » de chaque infobulle, aujourd'hui doublé d'un
 * `appliesWhen` qui masque pour de bon (l'infobulle dit POURQUOI, le masquage
 * ne dit que QUE : les deux se gardent).
 *
 * ⚠️ CETTE PHRASE A LONGTEMPS CITÉ `plat` AVEC LES DEUX AUTRES, ET C'ÉTAIT
 * FAUX. Il est lu par trois branches, pas une : les cannelures (méplat entre
 * stries), l'Aluminium (profondeur du brossage) et le couple Martelé/Écorce
 * (largeur de la rainure, `verre_pentes` — la moitié des canaux de l'image).
 * Le troisième n'était documenté nulle part et son infobulle le disait « sans
 * objet ailleurs » : mesuré le 2026-08-05, il est le SEUL des trente-neuf
 * « Sans objet » du registre à être vivant. Voir sa déclaration plus bas.
 *
 * ─── CE QUI EMPÊCHE QUE ÇA RENDE CHEAP ──────────────────────────────────────
 *
 * 1. **La réfraction passe par `refract()` avec le BON ratio.** `eta = 1/IOR`
 *    (air vers verre), et non `IOR`. La note du fichier d'origine dit ce que
 *    l'erreur coûtait : avec `eta > 1` la réflexion totale devient possible, et
 *    elle survenait — des plaques entières de l'image basculaient en blanc sur
 *    les flancs raides. Avec `eta < 1`, `k = 1 − eta²(1 − cos²) ≥ 1 − eta² > 0`
 *    ne s'annule jamais.
 *
 * 2. **La dispersion varie l'INDICE, pas le déplacement.** L'écriture naïve
 *    `d · (1 ± disp)` multiplie le déplacement TOTAL, lequel croît avec
 *    l'épaisseur : à forte épaisseur les trois canaux vont lire trois endroits
 *    très éloignés et leur moyenne rend un barbouillage — un verre qui paraît
 *    FLOU alors que sa surface est nette. Ici seul l'indice change avec la
 *    longueur d'onde, donc la séparation reste proportionnelle à l'ANGLE de
 *    réfraction : nulle sur les parties planes, visible sur les seuls flancs
 *    inclinés, là où la frange colorée doit être.
 *    Et dans le bon SENS : l'indice décroît avec la longueur d'onde, donc le
 *    rouge dévie le MOINS et le bleu le PLUS.
 *
 * 3. **La diffusion s'étale LATÉRALEMENT.** Neuf prélèvements alignés ne font
 *    pas un flou, ils font neuf copies décalées — et la striure trahit le
 *    procédé. Le terme `sin(t · 9.42) · f · 0.38` rompt l'alignement. Il vient
 *    de la source et n'a l'air de rien ; l'enlever se voit immédiatement.
 *
 * 4. **Le verre est VERT, et il l'est par absorption.** `exp(-trajet · (0.055,
 *    0.018, 0.042))` — Beer-Lambert, le vert absorbé trois fois moins que le
 *    rouge. Et le trajet s'allonge avec l'inclinaison locale (`1 + (1 − cosi) ·
 *    2.2`) : les flancs raides sont donc plus sombres et plus verts que les
 *    plats, tout seuls, sans qu'aucune ombre ne soit peinte. C'est ce détail
 *    qui distingue un verre d'une lentille en plastique.
 *
 * 5. **`relief` n'atténue QUE la déviation.** Fresnel, spéculaire et absorption
 *    restent à pleine force. On obtient une dalle qui brille encore pendant que
 *    l'image redevient lisible — ce qu'on ne peut PAS obtenir en baissant le
 *    creux, qui éteint la matière en même temps que la déformation.
 *
 * ─── ESPACE DE COULEUR : DEUX TERMES, DEUX TRAITEMENTS ──────────────────────
 *
 * La chaîne est en linéaire (format `-srgb`, décodage à la lecture). Les deux
 * termes ajoutés par le verre n'y entrent donc pas de la même façon, et les
 * confondre est le genre d'erreur qu'aucun test ne voit :
 * - L'absorption de Beer-Lambert est PHYSIQUE. Elle multiplie du linéaire, tel
 *   quel, sans conversion.
 * - La couleur du reflet de Fresnel est une valeur PERCEPTUELLE (c'est un ton
 *   qu'on choisit à l'œil). Elle est décodée vers le linéaire avant mélange,
 *   comme l'encre de `duotone` et le fond d'`outlines`.
 *
 * ─── COÛT ───────────────────────────────────────────────────────────────────
 *
 * Trois évaluations de la fonction de matière (différences finies pour la
 * normale — de l'ALU, pas des lectures), puis 9 taps pour la traversée diffuse
 * et 3 de plus quand la dispersion est active. **9 ou 12 lectures**, une seule
 * passe, aucune texture intermédiaire.
 *
 * La dispersion ne coûte pas 27 lectures — trois flous complets — mais 12 : un
 * SEUL flou à neuf taps au décalage du vert, plus trois taps simples dont on ne
 * reporte que l'ÉCART chromatique. Une frange colorée est un phénomène de bord,
 * elle n'a pas besoin de la résolution de flou du fond.
 *
 * ⚠️ TOUS LES TAPS PASSENT PAR `textureSampleLevel`, jamais `textureSample`.
 * Rien ici n'a besoin de dérivée d'écran, et la traversée vit sous des branches
 * qui dépendent du PIXEL (l'épaisseur du flou suit la pente locale) — donc un
 * flux de contrôle non uniforme, où `textureSample` serait illégal. Ce n'est pas
 * une précaution, c'est la condition pour que le shader compile.
 */

/** Indice de réfraction du verre sodocalcique. */
const IOR = 1.52;

/** Demi-écart d'indice à dispersion pleine : `(IOR − 1) · DISP_K`. Calé sur la
 *  source, où la valeur a été choisie pour qu'une dispersion de 1 donne une
 *  frange visible sans virer à l'arc-en-ciel. */
const DISP_K = 0.175;

/** Part de la demi-cellule qui reste PLATE au fond du profil « Fond plat ». */
const FOND_PLAT = 0.38;

/** Matières. ⚠️ L'index est PERSISTÉ dans les presets : on ajoute à la FIN, on
 *  ne réordonne jamais. C'est ce contrat qui a rendu le retrait des cinq PAVÉ
 *  (ADR-0021, 2026-08-27) gratuit pour les neuf autres — ils étaient les cinq
 *  DERNIERS, donc aucun index historique n'a bougé. */
const MATERIALS = [
  "Cannelé simple",
  "Cannelé croisé",
  "Gaufré",
  "Martelé",
  "Écorce",
  "Aluminium brossé",
  "Poli",
  "Dépoli",
  "Cathédrale",
] as const;

const MAT_CANNELE = 0;
const MAT_CROISE = 1;
const MAT_GAUFRE = 2;
const MAT_MARTELE = 3;
const MAT_ECORCE = 4;
const MAT_ALU = 5;
const MAT_POLI = 6;
const MAT_DEPOLI = 7;
const MAT_CATHEDRALE = 8;

/** Profils de section — la FORME de la strie, vue en coupe. Lus par `pente()`
 *  et `bosse()` seules, donc sans objet hors des trois premières matières.
 *  Même contrat d'index : on ajoute à la fin. */
const PROFILES = ["Arc doux", "Arc plein", "Prisme", "Fond plat", "Bourrelet"] as const;

const PROF_ARC_DOUX = 0;
const PROF_ARC_PLEIN = 1;
const PROF_PRISME = 2;
const PROF_FOND_PLAT = 3;

/**
 * APPLICABILITÉS — les listes d'index de matière que citent les `appliesWhen`
 * ci-dessous.
 *
 * `DisplayCondition.equals` est une liste POSITIVE : « sans objet en Poli et en
 * Dépoli » s'écrit donc en énumérant les sept AUTRES. Deux fonctions plutôt que
 * sept nombres recopiés, et ce n'est pas de l'esthétique — une dixième matière
 * ajoutée à la fin de `MATERIALS` doit arriver avec ses réglages VISIBLES.
 * Recopiée à la main, chaque liste l'aurait masquée en silence, et un contrôle
 * absent ne se plaint pas. Le retrait des cinq PAVÉ (ADR-0021) l'a vérifié par
 * l'autre bout : les listes se sont raccourcies toutes seules.
 *
 * ⚠️ CHAQUE `appliesWhen` DE CE FICHIER TRANSCRIT UNE MESURE, PAS UNE LECTURE DU
 * SHADER. Les configurations sont celles de la campagne du 2026-08-05
 * (`scripts/applicabilite-table.mjs`, résultats dans
 * `docs/superpowers/plans/2026-08-05-applicabilite-task1-resultats.md`) : 74
 * rendus, 38 déclarations inertes, une VIVANTE. Là où le code suggère une
 * exclusion plus large que ce qui a été mesuré, on s'en tient à la mesure — un
 * curseur visible et inerte se voit et se corrige, un curseur vivant et masqué
 * ne se voit jamais. C'est exactement le sort qu'a failli connaître `flat`.
 */
const MATIERES = MATERIALS.map((_, index) => index);
const MATIERES_SAUF = (...exclues: number[]) => MATIERES.filter((index) => !exclues.includes(index));

export const glass: EffectModule = {
  id: "glass",
  name: "Glass",
  // SOURCE À PYRAMIDE (ticket 19, 2026-08-17). Cet effet est le seul du registre
  // à la demander, et pour une raison mesurée : ce qui le rend cher n'est ni son
  // calcul ni sa géométrie mais la DISPERSION de ses adresses de lecture — à
  // `Creux = 0` un pavé coûtait exactement ce que coûte une feuille. Lire un
  // niveau plus grossier rend ces lectures locales : 98,6 ms → 25,6 ms sur un
  // Pavé quadrillé à 26 Mpx.
  //
  // ⚠️ CETTE MESURE EST HISTORIQUE DEPUIS ADR-0021 — elle a été prise sur des
  // matières qui n'existent plus, et les trois plus chères du relevé étaient des
  // pavés. LE DRAPEAU RESTE, et le retirer serait un changement de RENDU, pas un
  // ménage : `verre_niveau` dérive encore un niveau > 0 dès que l'étalement d'une
  // feuille dépasse le texel (forte Épaisseur, forte Diffusion), et sans pyramide
  // ce niveau retomberait sur le mip 0 — donc d'autres pixels, donc les treize
  // références de la feuille. Ce que le retrait des pavés change est le GAIN
  // qu'il apporte, plus jamais son exactitude.
  //
  // ⚠️ Le niveau est DÉRIVÉ de l'étalement réel et borné à 2 (`verre_niveau`),
  // donc les matières qui déplacent peu restent au niveau 0 et rendent le même
  // bit qu'avant. Voir `EffectModule.sourceMipmaps` pour ce que le drapeau coûte,
  // et `verre_niveau` pour pourquoi ce plafond a d'abord été posé à 1 par erreur.
  sourceMipmaps: true,
  params: [
    { name: "material", label: "Matière", unit: "none", min: 0, max: MATERIALS.length - 1, default: MAT_CANNELE, step: 1, choices: [...MATERIALS], hint: "Quel verre. Chacune fabrique sa pente de surface à sa façon ; tout ce qui suit — réfraction, dispersion, reflets, absorption — est commun. Plusieurs réglages ci-dessous ne concernent qu'une partie d'entre elles, et le disent" },
    { name: "density", label: "Densité du motif", unit: "none", min: 1, max: 200, default: 42, step: 1, hint: "Combien de stries, de cellules ou d'accidents sur la largeur de l'image. Sans objet en Poli, dont l'ondulation tient plusieurs fois l'écran par construction, et en Dépoli, qui n'a aucun motif", appliesWhen: { param: "material", equals: MATIERES_SAUF(MAT_POLI, MAT_DEPOLI) } },
    { name: "depth", label: "Creux", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, hint: "Amplitude du relief, donc de la déviation. Sans objet en Dépoli : un verre sablé n'a pas de galbe, il n'a qu'une rugosité — c'est la Diffusion qui le règle", appliesWhen: { param: "material", equals: MATIERES_SAUF(MAT_DEPOLI) } },
    { name: "profile", label: "Profil de section", unit: "none", min: 0, max: PROFILES.length - 1, default: PROF_ARC_DOUX, step: 1, choices: [...PROFILES], hint: "La forme de la strie vue en coupe. Arc doux et Arc plein bombent ; Prisme est un V à pente constante ; Fond plat a un plateau au centre et des flancs en S ; Bourrelet est une nervure ronde jointive, tangente à sa voisine. Sans objet hors de Cannelé simple, Cannelé croisé et Gaufré", appliesWhen: { param: "material", equals: [MAT_CANNELE, MAT_CROISE, MAT_GAUFRE] } },
    // ⚠️ `flat` A ÉTÉ LE SEUL RÉGLAGE RESTREINT DE `glass` SANS `appliesWhen`,
    // du 2026-08-04 au 2026-08-18 — il en porte un depuis, et le paragraphe le
    // plus bas raconte pourquoi il l'a attendu deux semaines. Cette phrase est
    // gardée pour ça et pour rien d'autre : elle est HISTORIQUE.
    //
    // Son infobulle a dit « Sans objet ailleurs » jusqu'au 2026-08-05, où la
    // mesure l'a démentie : en Martelé il déplace 47,1 % des canaux, en Écorce
    // 49,0 % — il y règle la largeur de la RAINURE entre cellules de Voronoï
    // (`verre_pentes`, branche Martelé/Écorce). Un contrôle caché par sa propre
    // documentation, et le porter sur la foi de cette phrase l'aurait masqué
    // pour de bon SANS QUE RIEN NE ROUGISSE : un curseur qu'on masque ne bouge
    // plus aucun pixel, donc aucune référence de rendu n'aurait bronché.
    //
    // Il porte donc TROIS sens sous un curseur, et l'infobulle les nomme tous
    // les trois. La mesure du 2026-08-05 l'a éprouvé inerte sur HUIT matières
    // — Poli, Dépoli, Cathédrale et les cinq Pavé ; les cinq derniers sont
    // partis avec ADR-0021, donc il n'en reste que TROIS à masquer, et ce sont
    // les trois que la mesure a vues.
    // ⚠️ LE DERNIER PARAMÈTRE DE `glass` À RECEVOIR SA CONDITION, et il l'a
    // attendue deux semaines pour une raison instructive : son infobulle
    // déclarait une inertie DEPUIS TOUJOURS (« sans effet sur les autres
    // matières »), mais la première mesure du 2026-08-04 l'a trouvé VIVANT là où
    // elle le disait mort — 47 % des canaux en Martelé. La déclaration était
    // fausse, pas le curseur.
    //
    // Elle a été corrigée le 2026-08-05 (Martelé et Écorce nommés), et personne
    // n'a reporté la correction dans un `appliesWhen` : le gate d'applicabilité
    // a donc affiché « 40 inertes, 1 VIVANT » pendant deux semaines sur une
    // déclaration qui n'était plus celle du code. Un VIVANT qu'on s'habitue à
    // voir cesse d'être un signal.
    //
    // SIX matières le lisent, chacune pour un sens différent : la largeur du
    // méplat sur les trois cannelures, la profondeur du brossage en Aluminium,
    // la largeur de la rainure entre cellules en Martelé et en Écorce.
    { name: "flat", label: "Part plate", unit: "percent", min: 0, max: 0.9, default: 0, step: 0.01, appliesWhen: { param: "material", equals: [MAT_CANNELE, MAT_CROISE, MAT_GAUFRE, MAT_MARTELE, MAT_ECORCE, MAT_ALU] }, hint: "Un curseur, trois sens selon la matière : sur les trois cannelures, la largeur du méplat entre deux stries — 0 = elles se touchent ; en Aluminium brossé, la profondeur du BROSSAGE ; en Martelé et en Écorce, la largeur de la RAINURE entre cellules, où il déplace près de la moitié de l'image (mesuré le 2026-08-05). Sans effet sur les autres matières" },
    { name: "fillet", label: "Congé de raccord", unit: "percent", min: 0, max: 0.5, default: 0.12, step: 0.01, hint: "Adoucit le raccord au bord de chaque strie. Sans lui, les profils en arc ont une pente qui DIVERGE au bord puis retombe net : un trait dur et un escalier de pixels à chaque limite. Un verre réel a toujours un congé là. Sans objet hors des trois premières matières", appliesWhen: { param: "material", equals: [MAT_CANNELE, MAT_CROISE, MAT_GAUFRE] } },
    { name: "orientation", label: "Orientation", unit: "none", min: 0, max: 1, default: 0, step: 1, choices: ["Verticale", "Horizontale"], hint: "Axe du motif. Sans objet sur les matières sans direction — Cannelé croisé, Gaufré, Martelé, Aluminium, Poli, Dépoli", appliesWhen: { param: "material", equals: MATIERES_SAUF(MAT_CROISE, MAT_GAUFRE, MAT_MARTELE, MAT_ALU, MAT_POLI, MAT_DEPOLI) } },
    { name: "irregularity", label: "Irrégularité", unit: "percent", min: 0, max: 1, default: 0.25, step: 0.01, hint: "Chaque strie prend son propre creux et sa propre position, au lieu d'un peigne parfait. Sur les matières à cellules, c'est le basculement propre à chaque plaque. Sans objet en Poli et en Dépoli", appliesWhen: { param: "material", equals: MATIERES_SAUF(MAT_POLI, MAT_DEPOLI) } },
    { name: "grain", label: "Micro-relief", unit: "percent", min: 0, max: 1, default: 0.3, step: 0.01, hint: "Rugosité fine ajoutée à la SURFACE, donc qui dévie le rayon comme le reste — pas du bruit posé sur l'image. Un verre laminé n'est poli nulle part. C'est le seul relief du Dépoli" },
    // PLAFOND À 2, ET C'EST UNE MESURE. Posé à 0,5 au premier jet, il rendait
    // les matières à FACETTES quasi inertes : une facette d'aluminium incline de
    // ~0,09, soit une déviation de ~0,03, soit UN pixel à épaisseur 0,14 — deux
    // niveaux de ton sur une rampe, donc rien. Les cannelures, elles, s'en
    // sortaient : un profil en arc a une pente qui diverge au bord de la
    // cellule, donc une déviation dix fois plus grande à réglage égal. Le même
    // curseur doit couvrir les deux régimes.
    { name: "thickness", label: "Épaisseur", unit: "percent", min: 0, max: 2, default: 0.35, step: 0.01, hint: "Distance parcourue dans le verre. Elle fait DEUX choses à la fois, et c'est physique : plus le verre est épais, plus l'image se déplace, et plus elle verdit — un rayon qui traverse plus de matière en perd davantage, et le vert en perd trois fois moins que le rouge" },
    { name: "specular", label: "Reflet spéculaire", unit: "percent", min: 0, max: 1, default: 0.35, step: 0.01, hint: "L'éclat que la source lumineuse laisse sur les flancs orientés vers elle. Exposant élevé : un point serré, pas un voile" },
    { name: "dispersion", label: "Dispersion", unit: "percent", min: 0, max: 1, default: 0.25, step: 0.01, hint: "Frange colorée aux endroits inclinés — le verre ne dévie pas toutes les longueurs d'onde pareil. Nulle sur les parties planes, par construction : c'est l'INDICE qui varie, pas le déplacement" },
    { name: "diffusion", label: "Diffusion", unit: "percent", min: 0, max: 1, default: 0.08, step: 0.005, hint: "Étalement de la lecture — le verre translucide au lieu du verre transparent. C'est le réglage principal du Dépoli, qui ne déforme rien et ne fait que ça" },
    { name: "relief", label: "Présence du relief", unit: "percent", min: 0, max: 1, default: 1, step: 0.01, hint: "N'atténue QUE la déviation de l'image : reflets, absorption et spéculaire restent à pleine force. À 0, une dalle plane qui brille encore — ce qu'on ne peut pas obtenir en baissant le Creux, qui éteint la matière en même temps que la déformation" },
    // ⚠️ LA LISTE S'ARRÊTE ICI, ET C'EST LE POINT LE PLUS UTILE DU RETRAIT.
    // Huit réglages de PAVÉ (`blockSize`, `mortar`, `mortarHue`,
    // `mortarLightness`, `edgeDepth`, `edgeWidth`, `bevel`, `inner`) occupaient
    // les index 14 à 21 — les huit DERNIERS. Les retirer (ADR-0021) ne déplace
    // donc aucun des quatorze index qui restent, et c'est ce qui rend le retrait
    // neutre au bit près pour les treize références de la feuille.
  ],
  /**
   * DEUX SECTIONS, ET ELLES SUIVENT UNE FRONTIÈRE DU SHADER.
   *
   * Ce fichier tient en deux étages : chaque matière ne fait QUE fabriquer une
   * pente de surface, et tout ce qui suit — réfraction, dispersion, diffusion,
   * Fresnel, spéculaire, absorption — est commun et ne sait rien d'elle. Les
   * deux sections sont exactement ces deux étages. Ce n'est donc pas un
   * rangement de goût : un réglage change de section le jour où il change de
   * côté dans `verre_pentes`, pas avant.
   *
   * ⚠️ UNE TROISIÈME SECTION A EXISTÉ — « Pavé », huit réglages en grille,
   * conditionnée aux cinq matières qui les possédaient. Elle est partie AVEC
   * elles (ADR-0021, 2026-08-27) : une section dont la condition ne peut plus
   * être vraie n'est pas une section, c'est du code mort. Elle était aussi le
   * seul endroit de l'effet où une condition était portée DEUX fois — sur les
   * huit paramètres ET sur leur section — parce que les deux disaient des choses
   * différentes (une propriété mesurée du shader d'un côté, une décision
   * d'affichage de l'autre). C'est un précédent qui reste valable.
   *
   * CE QUE ÇA CHANGE POUR QUI S'EN SERT : en Poli, sept des quatorze curseurs
   * sont sans objet. La liste plate les montrait tous.
   *
   * ⚠️ AUCUN RÉORDONNANCEMENT — l'index d'un paramètre est persisté dans les
   * presets. Les deux sections sont deux blocs CONTIGUS de `params[]` (0..8,
   * 9..13) dans leur ordre d'origine, ce qui est la condition posée par
   * `groupEffectParams` : il s'appuie sur l'ordre du tableau en deux endroits
   * (`spatialFirstIndex`, `firstIndexByKey`), donc une section déplace un bloc
   * entier et ne le traverse jamais.
   */
  sections: [
    {
      id: "matiere",
      label: "Matière",
      // `grille` (2026-08-18, ticket 16) : neuf rangées en une colonne étaient la
      // deuxième section la plus haute du parc. Le gabarit les rend en cinq
      // lignes sans rien scinder ni renommer.
      layout: "grille",
      params: ["material", "density", "depth", "profile", "flat", "fillet", "orientation", "irregularity", "grain"],
    },
    {
      id: "optique",
      label: "Optique",
      layout: "liste",
      params: ["thickness", "specular", "dispersion", "diffusion", "relief"],
    },
  ],
  wgsl: `
${UV_SPACE_WGSL}${HASH_WGSL}${VALUE_NOISE_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}

/** Micro-relief : trois octaves serrées, en DIFFÉRENCES FINIES. Ce n'est pas du
 *  bruit ajouté à l'image, c'est du relief ajouté à la SURFACE — il dévie donc
 *  le rayon comme tout le reste, et disparaît quand le verre est plat. */
fn verre_microRelief(c: vec2<f32>) -> vec2<f32> {
  let e = 0.0016;
  let h0 = valueNoise(c * 190.0) * 0.55 + valueNoise(c * 420.0) * 0.30 + valueNoise(c * 900.0) * 0.15;
  let cx = c + vec2<f32>(e, 0.0);
  let cy = c + vec2<f32>(0.0, e);
  let hx = valueNoise(cx * 190.0) * 0.55 + valueNoise(cx * 420.0) * 0.30 + valueNoise(cx * 900.0) * 0.15;
  let hy = valueNoise(cy * 190.0) * 0.55 + valueNoise(cy * 420.0) * 0.30 + valueNoise(cy * 900.0) * 0.15;
  return vec2<f32>(hx - h0, hy - h0) / e;
}

/** PENTE d'une strie, en fonction de la position dans la cellule. Cinq profils,
 *  et chacun règle un défaut visible du précédent — l'ordre de la liste est
 *  celui dans lequel ils ont été écrits.
 *
 *  Le CONGÉ éteint la pente sur les derniers pour-cents de la cellule. Sans
 *  lui, les profils en arc ont une pente qui diverge au bord puis retombe net à
 *  zéro sur la partie plane : rupture de normale, donc un trait dur, et un
 *  escalier de pixels puisque la transition tient sur moins d'un pixel. */
fn verre_pente(k: f32) -> f32 {
  let creux = clamp(params[2], 0.0, 1.0);
  let plat = clamp(params[4], 0.0, 0.9);
  let lissage = clamp(params[5], 0.0, 0.5);
  let profil = i32(params[3] + 0.5);

  let demi = max(1.0 - plat, 0.04);
  let u = (fract(k) - 0.5) * 2.0 / demi;
  if (abs(u) >= 1.0) { return 0.0; }
  let conge = 1.0 - smoothstep(1.0 - lissage, 1.0, abs(u));

  if (profil == ${PROF_ARC_DOUX}) {
    return -creux * u / sqrt(max(1.0 - u * u, 1e-4)) * 0.35 * conge;
  }
  if (profil == ${PROF_ARC_PLEIN}) {
    return -creux * u / sqrt(max(1.0 - u * u, 1e-4)) * conge;
  }
  if (profil == ${PROF_PRISME}) {
    return -creux * sign(u) * 0.8 * conge;
  }
  if (profil == ${PROF_FOND_PLAT}) {
    // FOND PLAT. Le cosinus surélevait le centre : la courbure y était maximale
    // et l'œil lisait une gorge, pas un creux de verre. Ici la hauteur est
    // \`1 - smoothstep(FOND_PLAT, 1, |u|)\` — plateau exactement plat au centre,
    // flanc en S, et dérivée NULLE aux deux raccords. Normale continue partout,
    // aucune pointe en V, aucune pente infinie.
    let t = clamp((abs(u) - ${FOND_PLAT}) / (1.0 - ${FOND_PLAT}), 0.0, 1.0);
    return -creux * sign(u) * 6.0 * t * (1.0 - t) / (1.0 - ${FOND_PLAT}) * 0.227 * conge;
  }
  // BOURRELET CONVEXE JOINTIF, l'inverse exact du précédent : bombé au centre,
  // dérivée nulle aux deux BORDS, donc les nervures se raccordent
  // tangentiellement et le congé n'a plus rien à rattraper.
  return -creux * sin(3.14159265 * u) * 1.5707963 * 0.35 * conge;
}

/** HAUTEUR normalisée de la même strie, 1 au sommet et 0 au bord. Sert au
 *  Gaufré, qui module la pente d'un axe par la hauteur de l'autre — c'est ce
 *  produit qui fait des dômes au lieu d'une grille de sillons croisés. */
fn verre_bosse(k: f32) -> f32 {
  let plat = clamp(params[4], 0.0, 0.9);
  let profil = i32(params[3] + 0.5);
  let demi = max(1.0 - plat, 0.04);
  let u = (fract(k) - 0.5) * 2.0 / demi;
  if (abs(u) >= 1.0) { return 0.0; }
  if (profil > ${PROF_FOND_PLAT}) {
    return 0.5 + 0.5 * cos(3.14159265 * u);
  }
  if (profil == ${PROF_FOND_PLAT}) {
    let t = clamp((abs(u) - ${FOND_PLAT}) / (1.0 - ${FOND_PLAT}), 0.0, 1.0);
    return 1.0 - t * t * (3.0 - 2.0 * t);
  }
  return sqrt(max(1.0 - u * u, 1e-4));
}

/** VORONOÏ LU PAR SES ARÊTES (\`F2 − F1\`), et c'est la bonne primitive — la
 *  mauvaise a été corrigée dans la source avant le portage. Lire un Voronoï par
 *  sa DISTANCE AU GERME donne des dômes ronds, séparés, de tailles très
 *  inégales ; la photographie d'un verre martelé montre l'inverse exact, une
 *  mosaïque de cellules POLYGONALES JOINTIVES de taille quasi constante,
 *  séparées par des rainures étroites. C'est \`F2 − F1\` qui dit ça.
 *
 *  Partagé par Martelé et Écorce : la seule différence entre les deux est
 *  l'étirement vertical du second (les plaques d'un tronc sont plus hautes que
 *  larges) et la largeur de sa rainure. */
fn verre_voronoiArete(c: vec2<f32>, densite: f32, rainure: f32, bascule: f32) -> f32 {
  let p = c * densite;
  let i = floor(p);
  let f = fract(p);
  var d1 = 8.0;
  var d2 = 8.0;
  var germe = vec2<f32>(0.0);
  for (var y = -1; y <= 1; y = y + 1) {
    for (var x = -1; x <= 1; x = x + 1) {
      let g = vec2<f32>(f32(x), f32(y));
      let cellule = i + g;
      let o = vec2<f32>(hash(cellule), hash(cellule + vec2<f32>(23.9, 41.1)));
      let d = length(g + o - f);
      if (d < d1) { d2 = d1; d1 = d; germe = cellule; }
      else if (d < d2) { d2 = d; }
    }
  }
  let plaque = smoothstep(0.0, max(rainure, 0.02), d2 - d1);
  // Basculement propre à la plaque, et fentes fines dans son épaisseur : sans
  // eux, toutes les cellules sont le même dôme et la mosaïque redevient un
  // motif régulier — le défaut que la primitive vient d'éviter.
  let t = vec2<f32>(hash(germe + vec2<f32>(7.7, 3.3)), hash(germe + vec2<f32>(13.1, 29.4))) - 0.5;
  let fente = smoothstep(0.55, 0.95, valueNoise(c * densite * 6.5 + germe * 3.1));
  return plaque * (1.0 + dot(t, f - 0.5) * 2.2 * bascule) - fente * 0.22 * plaque;
}

/** Bruit fractal anisotrope, trois octaves — le relief de la Cathédrale. */
fn verre_fractal3(q: vec2<f32>, sc: vec2<f32>) -> f32 {
  return valueNoise(q * sc) * 0.60
       + valueNoise(q * sc * 2.1 + vec2<f32>(5.9, 1.7)) * 0.27
       + valueNoise(q * sc * 4.7 + vec2<f32>(2.1, 8.3)) * 0.13;
}

/** Bruit fractal deux octaves — l'ondulation lente du verre Poli. */
fn verre_fractal2(q: vec2<f32>, dens: f32) -> f32 {
  return valueNoise(q * dens) * 0.70
       + valueNoise(q * dens * 2.3 + vec2<f32>(5.9, 1.7)) * 0.30;
}

/** LA PENTE DE SURFACE, pour la matière choisie. C'est le seul endroit où les
 *  neuf matières diffèrent ; tout ce qui suit est commun.
 *
 *  \`q\` est CENTRÉ et CORRIGÉ DE L'ASPECT (voir \`uvSpace.ts\`) : une même
 *  distance y vaut le même nombre de pixels en x et en y, donc les stries ont
 *  le même pas sur les deux axes et les cellules du martelé sont rondes sur une
 *  photo 3:2. Sans ça, tourner l'orientation changerait la densité.
 *
 *  ⚠️ IL A PRIS \`uv\` ET \`dims\` EN PLUS DE \`q\` JUSQU'AU 2026-08-27, et rien que
 *  pour la branche des pavés : eux seuls raisonnaient en pixels NATIFS (une
 *  taille de bloc en pixels, une grille alignée sur le cadre) là où toutes les
 *  matières de feuille vivent dans l'espace corrigé de l'aspect. Les pavés
 *  partis (ADR-0021), les deux arguments n'avaient plus de lecteur. */
fn verre_pentes(q: vec2<f32>) -> vec2<f32> {
  let mat = i32(params[0] + 0.5);
  let n = max(params[1], 1.0);
  let creux = clamp(params[2], 0.0, 1.0);
  let plat = clamp(params[4], 0.0, 0.9);
  let irreg = clamp(params[7], 0.0, 1.0);
  let grain = clamp(params[8], 0.0, 1.0);
  let horizontal = params[6] > 0.5;

  // Micro-relief commun : ajouté à TOUTES les matières, y compris celles qui
  // n'ont aucun relief macroscopique. C'est lui, et lui seul, qui porte le
  // Dépoli.
  let micro = verre_microRelief(q) * grain * 0.00035;

  if (mat == ${MAT_DEPOLI}) {
    // DÉPOLI. Aucun galbe, aucune maille, aucune direction : un verre sablé n'a
    // qu'une rugosité à l'échelle du micron, qui ne DÉVIE pas l'image par
    // masses mais la DIFFUSE. Le relief se réduit donc au micro-relief, à une
    // amplitude plus forte, et l'essentiel du rendu vient de l'étalement des
    // neuf prélèvements — c'est la Diffusion qui le règle, pas le Creux.
    return verre_microRelief(q) * grain * 0.0011;
  }

  if (mat == ${MAT_POLI}) {
    // POLI. Aucun motif, aucune répétition : une feuille lisse dont la surface
    // ondule très lentement, comme un verre flotté de grande dimension.
    // Amplitude minuscule, longueur d'onde de plusieurs écrans — l'image reste
    // NETTE et se déplace seulement, par larges masses. C'est la déformation
    // qu'on lit sur une vitrine sans savoir la nommer.
    // Échelle fixe : le contrôle Densité annonce « sans objet en Poli » et ne
    // doit donc pas modifier secrètement cette branche. Cela supprime aussi le
    // régime aliasé observé à forte densité avec le pas de dérivation constant.
    let dens = 0.35;
    let e = 0.06;
    let h0 = verre_fractal2(q, dens);
    let hx = verre_fractal2(q + vec2<f32>(e, 0.0), dens);
    let hy = verre_fractal2(q + vec2<f32>(0.0, e), dens);
    return -vec2<f32>(hx - h0, hy - h0) / e * creux * 0.09 + micro;
  }

  if (mat == ${MAT_CATHEDRALE}) {
    // CATHÉDRALE. Un bruit FORTEMENT anisotrope, étiré d'un facteur douze sur
    // le second axe : des stries serrées en largeur, corrélées sur une dizaine
    // de fois cette distance en hauteur. Une écorce de bouleau, pas une coulée.
    // Un bruit isotrope, qui était la première version de la source, ne
    // correspond à aucun verre réel.
    let base = select(q, q.yx, horizontal);
    // FACTEURS DE DENSITÉ REPRIS DE LA SOURCE TELS QUELS, et c'est une leçon
    // payée à la première exécution : les avoir « ajustés » au portage a rendu
    // le martelé à 2,7 cellules pour 27 attendues et la cathédrale quarante
    // fois trop grossière. Ils sont calés par mesure sur des produits réels
    // (les stries de Cotswold se comptent par dizaines sur une largeur d'écran,
    // pas par unités), pas choisis. \`q\` couvre la même étendue que l'\`uv\` de
    // la source — un rayon de 0,5 sur chaque axe, corrigé de l'aspect — donc
    // les facteurs se transposent sans conversion.
    let dens = max(n * 1.6, 0.05);
    let etire = 0.085;
    let e = 0.35 / dens;
    let sc = vec2<f32>(dens, dens * etire);
    let h0 = verre_fractal3(base, sc);
    let hx = verre_fractal3(base + vec2<f32>(e, 0.0), sc);
    let hy = verre_fractal3(base + vec2<f32>(0.0, e), sc);
    var g = vec2<f32>(hx - h0, hy - h0) / (e * dens);
    if (horizontal) { g = g.yx; }
    return -g * creux * 0.30 + micro;
  }

  if (mat == ${MAT_ALU}) {
    // ALUMINIUM BROSSÉ. Deux traits, et rien d'autre.
    //
    // FACETTES PLANES d'abord : chaque cellule est un plan à inclinaison
    // propre, donc sa pente est CONSTANTE à l'intérieur et saute brutalement à
    // la frontière. C'est l'arête vive du métal, l'inverse exact du congé de
    // raccord des autres matières, et c'est voulu. Aucune différence finie
    // n'est nécessaire ici : le gradient d'un plan EST son inclinaison.
    //
    // BROSSAGE ensuite : des rainures très fines et très allongées sur un seul
    // axe, qui étirent les reflets en traînées au lieu de les concentrer en
    // points. C'est ce qui sépare l'aluminium brossé d'un miroir.
    let dens = max(n * 0.16, 1.0);
    let p = q * dens;
    let i = floor(p);
    let f = fract(p);
    var d1 = 8.0;
    var germe = vec2<f32>(0.0);
    for (var y = -1; y <= 1; y = y + 1) {
      for (var x = -1; x <= 1; x = x + 1) {
        let g = vec2<f32>(f32(x), f32(y));
        let cellule = i + g;
        let o = vec2<f32>(hash(cellule), hash(cellule + vec2<f32>(37.1, 12.7)));
        let d = length(g + o - f);
        if (d < d1) { d1 = d; germe = cellule; }
      }
    }
    let inclinaison = (vec2<f32>(hash(germe + vec2<f32>(2.1, 8.8)), hash(germe + vec2<f32>(15.4, 3.6))) - 0.5) * 2.0;
    let raie = valueNoise(vec2<f32>(q.x * dens * 1.4, q.y * dens * 140.0)) - 0.5
             + (valueNoise(vec2<f32>(q.x * dens * 3.1, q.y * dens * 420.0)) - 0.5) * 0.45;
    let g = inclinaison * irreg + vec2<f32>(0.0, raie * plat * 2.2);
    return -g * creux * 0.30 + micro;
  }

  if (mat == ${MAT_ECORCE} || mat == ${MAT_MARTELE}) {
    // MARTELÉ et ÉCORCE partagent leur primitive et ne diffèrent que par deux
    // constantes : l'étirement vertical (les plaques d'un tronc sont plus
    // hautes que larges, celles d'un verre martelé ne le sont pas) et la
    // largeur de la rainure. Les écrire deux fois les aurait fait diverger.
    let etireY = select(1.0, 0.42, mat == ${MAT_ECORCE});
    let facteur = select(0.055, 0.030, mat == ${MAT_MARTELE});
    let base = vec2<f32>(q.x, q.y * etireY);
    let dens = max(n * 0.30, 1.0);
    let e = 0.10 / dens;
    let rainure = mix(0.06, 0.40, 1.0 - plat);
    let h0 = verre_voronoiArete(base, dens, rainure, irreg);
    let hx = verre_voronoiArete(base + vec2<f32>(e, 0.0), dens, rainure, irreg);
    let hy = verre_voronoiArete(base + vec2<f32>(0.0, e), dens, rainure, irreg);
    return -vec2<f32>(hx - h0, hy - h0) / (e * dens) * creux * facteur + micro;
  }

  // LES TROIS CANNELURES. Seules matières à passer par \`verre_pente\`, donc les
  // seules que le Profil, la Part plate et le Congé concernent.
  //
  // L'irrégularité agit à DEUX endroits : elle décale la phase (les stries ne
  // sont plus équidistantes) et elle donne à chacune son propre creux. Sans le
  // second, un verre cannelé irrégulier reste un peigne — juste un peigne mal
  // rangé.
  let serpente = (valueNoise(vec2<f32>(q.y * 2.3, 1.7)) - 0.5) * 0.6 * irreg;
  let kx = q.x * n + serpente;
  let ky = q.y * n + (valueNoise(vec2<f32>(q.x * 3.1, 4.7)) - 0.5) * 0.6 * irreg;
  let vx = mix(1.0, 0.55 + hash(vec2<f32>(floor(kx), 3.7)) * 0.95, irreg);
  let vy = mix(1.0, 0.55 + hash(vec2<f32>(floor(ky), 9.1)) * 0.95, irreg);

  var p = vec2<f32>(0.0);
  if (mat == ${MAT_CANNELE}) {
    p = select(vec2<f32>(verre_pente(kx) * vx, 0.0), vec2<f32>(0.0, verre_pente(ky) * vy), horizontal);
  } else if (mat == ${MAT_CROISE}) {
    p = vec2<f32>(verre_pente(kx) * vx, verre_pente(ky) * vy);
  } else if (mat == ${MAT_GAUFRE}) {
    // GAUFRÉ : la pente d'un axe MODULÉE par la hauteur de l'autre. C'est ce
    // produit qui fait des dômes ; la somme, elle, ferait une grille de sillons
    // croisés, ce qui est déjà le Cannelé croisé.
    p = vec2<f32>(verre_pente(kx) * vx * verre_bosse(ky), verre_pente(ky) * vy * verre_bosse(kx));
  }
  return p + micro;
}

/** Une lecture du fond, repliee, a un niveau de mipmap CHOISI PAR L APPELANT.
 *
 *  \`textureSampleLevel\` et non \`textureSample\` : voir l en-tete — le flux de
 *  controle n est pas uniforme ici, et rien n a besoin de derivee d ecran. Le
 *  niveau etait une constante 0 jusqu au 2026-08-17 ; il est devenu un argument
 *  parce que la diffusion et la dispersion n ont pas les memes besoins.
 *
 *  ⚠️ CE QUE LE NIVEAU CHANGE N EST PAS QUE DU DETAIL, C EST LE COUT. Ce qui
 *  rend cet effet cher n est ni son calcul ni sa geometrie mais la DISPERSION
 *  de ses adresses de lecture : une lecture dispersee coute ~25 fois une lecture
 *  coherente (ticket 19). Un niveau plus grossier divise la surface lue par
 *  quatre, donc rend les lectures locales. Mesure du 2026-08-17 sur Pave
 *  quadrille a 26 Mpx : 98,6 ms au niveau 0, 25,6 ms au niveau 1. */
fn verre_lire(uv: vec2<f32>, niveau: f32) -> vec3<f32> {
  return textureSampleLevel(srcTexture, srcSampler, mirrorUv(uv), niveau).rgb;
}

/** Niveau de mipmap pour un etalement donne, exprime en UV.
 *
 *  Un niveau vaut deux fois la taille de texel du precedent : le niveau juste
 *  suffisant pour un etalement de N texels est donc \`log2(N)\`. En dessous d un
 *  texel d etalement, rien a gagner — on reste au niveau 0, et le rendu est
 *  alors INCHANGE AU BIT PRES par rapport a l avant-2026-08-17.
 *
 *  ⚠️ BORNE A 2, ET LE CHEMIN POUR Y ARRIVER EST LA VRAIE LECON. Le plafond a
 *  d abord ete pose a 1, sur une mesure qui disait « le niveau 2 rend 28,8 ms la
 *  ou le niveau 1 en rend 25,6, donc il est moins bon ». Cette mesure forcait un
 *  niveau CONSTANT partout ; ici le niveau est DERIVE, donc le plafond ne mord
 *  que sur les pixels dont l etalement le justifie deja. Les deux experiences ne
 *  disent pas la meme chose, et generaliser la premiere a couté la moitie du
 *  gain.
 *
 *  Mesure en production, meme protocole des deux cotes, Pave quadrille a 26 Mpx :
 *
 *    plafond 1 -> 26,7 images/s sur la course pleine d Epaisseur, 39,9 au defaut
 *    plafond 2 -> 47,4 images/s sur la course pleine, 38,3 au defaut (bruit)
 *
 *  Donc le plafond 2 double la cadence la ou le deplacement est fort, et ne coute
 *  rien la ou il est faible — parce que la derivation l y laisse a 0 ou 1.
 *
 *  ⚠️ Le plafond 3 n a PAS ete eprouve. La cible d usage (« le confort au
 *  pointeur », arbitrage du 2026-08-17) est atteinte a 2, et chaque cran coute
 *  17 references a regenerer et a relire : monter encore echangerait de l image
 *  contre une vitesse dont on n a pas besoin. */
fn verre_niveau(etalementUv: f32, dims: vec2<f32>) -> f32 {
  let texels = etalementUv * max(dims.x, dims.y);
  return clamp(log2(max(texels, 1.0)), 0.0, 2.0);
}

/** TRAVERSÉE DIFFUSE, neuf prélèvements.
 *
 *  ⚠️ L'ÉTALEMENT LATÉRAL N'EST PAS DÉCORATIF. Neuf taps alignés ne font pas un
 *  flou, ils font neuf copies décalées — et la striure, sur l'axe du décalage,
 *  trahit le procédé à l'œil nu. Le terme \`sin(t · 9.42) · f · 0.38\` rompt
 *  l'alignement pour un coût nul. Il vient de la source, où il avait été ajouté
 *  après coup pour cette raison exacte. */
fn verre_traverser(uv: vec2<f32>, d: vec2<f32>, f: f32, niveau: f32) -> vec3<f32> {
  var s = vec3<f32>(0.0);
  var somme = 0.0;
  // NEUF PRELEVEMENTS EN SPIRALE D'OR, ponderes en gaussienne — et non plus
  // neuf le long d'un AXE. Le procede precedent etalait sur un segment et
  // corrigeait sa propre striure par un decalage lateral sinusoidal ; a forte
  // diffusion il rendait des paquets, ce qu'Antoine a vu sur le Depoli avant
  // de demander des references reelles.
  //
  // Ce que disent ces references : un verre sable a une rugosite Ra de 0,4 a
  // 1,2 micrometre et diffuse selon une distribution GAUSSIENNE, sans
  // composante speculaire. A 26 Mpx un pixel couvre deja ~50 micrometres
  // d'objet, donc le grain est cinquante fois plus petit qu'un pixel : un
  // depoli ne doit montrer AUCUNE structure, seulement un etalement lisse.
  // Neuf points sur un segment ne peuvent pas produire ca, quel que soit le
  // terme correctif qu'on leur ajoute.
  //
  // La spirale de Vogel couvre le disque uniformement (rayon en racine de la
  // fraction, angle par multiples de l'angle d'or), donc l'etalement est
  // ISOTROPE : aucune direction privilegiee a trahir. Le poids exp(-2 r²) est
  // la gaussienne elle-meme.
  //
  // ⚠️ NEUF, ET PAS SEIZE. Le passage a seize a ete pousse puis annule le meme
  // jour : il coutait 37 % de cadence pour un gain nul, la GEOMETRIE de
  // l'echantillonnage apportant tout le benefice, pas son nombre de points.
  // Ce commentaire a dit « seize » pendant que la boucle en faisait neuf.
  //
  // ⚠️ AUCUNE GARDE, ET C'EST LE PREMIER POSTE DE COUT DE L'EFFET. Ces neuf
  // lectures sont payees meme a Diffusion nulle. Sur une matiere de FEUILLE
  // elles sont gratuites (67,6 contre 64,8 images/s a une seule lecture) ; sur
  // un PAVE, ou le deplacement disperse les adresses, elles coutent ~7,4 ms
  // chacune sur 26 Mpx et font tomber la cadence a 10 images/s. Mesure en build
  // de production du 2026-08-14, protocole et tableaux dans
  // .scratch/prochain-palier/issues/19-le-cout-du-verre.md — ne pas re-mesurer
  // en developpement pour conclure.
  let angleOr = 2.39996323;
  for (var i = 0; i < 9; i = i + 1) {
    let fraction = (f32(i) + 0.5) / 9.0;
    let rayon = sqrt(fraction);
    let a = f32(i) * angleOr;
    let poids = exp(-2.0 * fraction);
    s = s + poids * verre_lire(uv + d + vec2<f32>(cos(a), sin(a)) * rayon * f, niveau);
    somme = somme + poids;
  }
  return s / somme;
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(srcTexture));
  let ar = aspectScale(dims);
  let q = (uv - vec2<f32>(0.5)) * ar;
  let mat = i32(params[0] + 0.5);

  let epaisseur = max(params[9], 0.0);
  let spec = clamp(params[10], 0.0, 1.0);
  let disp = clamp(params[11], 0.0, 1.0);
  let diffusion = max(params[12], 0.0);
  let relief = clamp(params[13], 0.0, 1.0);

  // NORMALE de la surface, depuis la pente. \`z = 1\` : la pente est une dérivée,
  // donc le vecteur (-dh/dx, -dh/dy, 1) est normal au graphe de la hauteur.
  let dh = verre_pentes(q);
  let N = normalize(vec3<f32>(-dh.x, -dh.y, 1.0));
  let I = vec3<f32>(0.0, 0.0, -1.0);

  // eta = n_incident / n_transmis = air / verre = 1/IOR. Passer IOR simulerait
  // une sortie verre -> air, et rendrait la réflexion totale possible sur les
  // flancs raides — des plaques entières basculant en blanc. Avec eta < 1,
  // k = 1 - eta²(1 - cos²) >= 1 - eta² > 0 ne s'annule jamais.
  let eta = 1.0 / ${IOR};
  let T = refract(I, N, eta);

  // Déplacement, en unités ISOTROPES puis reconverti en UV. \`relief\` n'agit que
  // là : les reflets et l'absorption plus bas gardent la normale pleine.
  let dIso = vec2<f32>(T.x, T.y) / -T.z * epaisseur * relief;
  let d = dIso / ar;
  // La diffusion croît avec l'inclinaison locale : un flanc raide étale plus
  // qu'un plat, ce qui est la même physique que l'absorption ci-dessous prise
  // par l'autre bout.
  let f = diffusion * 0.25 + length(d) * 0.10;

  // NIVEAU DE MIPMAP DES LECTURES DE FOND, derive de l etalement reel (ticket
  // 19). A etalement inferieur a un texel il vaut 0, donc le rendu des matieres
  // qui deplacent peu est INCHANGE AU BIT PRES ; c est sur les pavés, ou l
  // etalement atteint des dizaines de texels, qu il monte a 1 et fait tomber le
  // cout d un facteur ~3,9.
  //
  // ⚠️ Le meme niveau sert a la DISPERSION plus bas, et c est voulu : ses taps
  // ne rendent qu un ECART a une reference prise au meme endroit, donc flouter
  // les deux termes identiquement preserve la frange. Ce qui ne doit PAS le
  // recevoir est l ambiance du mortier, dont la mesure dit qu elle ne coute
  // rien — la deplacer bougerait 18 references pour aucun gain.
  let niveau = verre_niveau(f, dims);

  var c = verre_traverser(uv, d, f, niveau);

  if (disp > 0.001) {
    // DISPERSION PAR L'INDICE. Un seul flou à neuf taps, au décalage du vert ;
    // R et B en taps SIMPLES, et on ne reporte que leur ÉCART à une référence
    // prise au même décalage vert. 9 + 3 lectures au lieu de 27 — une frange
    // colorée est un phénomène de bord, elle n'a pas besoin de la résolution de
    // flou du fond. À dispersion nulle ce bloc ne s'exécute pas, donc le chemin
    // sans dispersion est inchangé au bit.
    //
    // SENS PHYSIQUE : l'indice DÉCROÎT avec la longueur d'onde, donc le rouge a
    // l'indice le plus bas et dévie le MOINS, le bleu le PLUS. La première
    // version de la source faisait l'inverse.
    let demi = (${IOR} - 1.0) * ${DISP_K} * disp;
    let Tr = refract(I, N, 1.0 / (${IOR} - demi));
    let Tb = refract(I, N, 1.0 / (${IOR} + demi));
    let dr = vec2<f32>(Tr.x, Tr.y) / -Tr.z * epaisseur * relief / ar;
    let db = vec2<f32>(Tb.x, Tb.y) / -Tb.z * epaisseur * relief / ar;
    // \`refVert\` et non \`ref\` : \`ref\` est un mot RÉSERVÉ de WGSL et le
    // compilateur le refuse comme nom de variable. Quatrième occurrence de ce
    // piège dans le dossier après \`trait\` (echoOutlines), \`active\`
    // (sliceShift) et \`smooth\` (pixelStretch) — attrapé par
    // \`npm run test:gpu-shaders\`, jamais par tsc, qui ne voit qu'une chaîne.
    let refVert = verre_lire(uv + d, niveau);
    c = c + vec3<f32>(verre_lire(uv + dr, niveau).r - refVert.r, 0.0, verre_lire(uv + db, niveau).b - refVert.b);
  }

  // ABSORPTION DE BEER-LAMBERT, et c'est elle qui rend le verre VERT. Le vert
  // est absorbé trois fois moins que le rouge — ce sont les coefficients d'un
  // verre sodocalcique, pas une teinte choisie.
  //
  // Le trajet s'allonge avec l'INCLINAISON locale : un rayon qui entre de biais
  // traverse plus de matière. Les flancs raides sont donc plus sombres et plus
  // verts que les plats, tout seuls, sans qu'aucune ombre ne soit peinte. C'est
  // ce détail-là qui sépare un verre d'une lentille en plastique.
  //
  // Elle multiplie du LINÉAIRE tel quel : c'est une loi physique, pas une
  // couleur choisie à l'œil, donc aucune conversion.
  let cosi = clamp(dot(N, -I), 0.0, 1.0);
  // FACTEUR 1,2 ET NON 6, corrigé sur pièce : le couplage épaisseur-absorption
  // est voulu et physique, son ÉCHELLE ne l'était pas. À 6, une épaisseur de
  // 1,6 — nécessaire pour que les matières à facettes déplacent quoi que ce
  // soit — rendait un vert bouteille sur toute l'image. À 1,2, le défaut est à
  // peine teinté et le maximum de la course donne un verre franchement vert
  // sans devenir opaque.
  //
  // ⚠️ LE TRAJET ETAIT MODULE PAR DEUX TERMES DE PAVE, PARTIS AVEC EUX
  // (ADR-0021) : l'arete du bloc, qui l'allongeait au ras du mortier, et une
  // variation de teinte tiree par bloc. Les deux valaient exactement 1 sur une
  // matiere de feuille — le premier parce que \`profilArete\` restait nul, le
  // second parce qu'il n'etait tire que sous la branche pave. Leur retrait est
  // donc neutre au bit pres pour les treize references de la feuille, et c'est
  // ce que le gate de rendu verifie.
  let trajet = epaisseur * 1.2 * (1.0 + (1.0 - cosi) * 2.2);
  c = c * exp(-trajet * vec3<f32>(0.055, 0.018, 0.042));

  // FRESNEL. Le reflet du ciel sur la surface, d'autant plus fort que
  // l'incidence est rasante — approximation de Schlick, F0 = 0.04 pour du verre.
  // La couleur, elle, est PERCEPTUELLE (un ton choisi à l'œil) : décodée vers le
  // linéaire avant mélange, comme l'encre de duotone.
  let F = 0.04 + 0.96 * pow(1.0 - cosi, 5.0);
  c = mix(c, srgb_to_linear3(vec3<f32>(0.86, 0.89, 0.95)), F * 0.55);

  // SPÉCULAIRE. Blinn-Phong à exposant élevé : un point serré sur les flancs
  // orientés vers la source, pas un voile. C'est une ÉMISSION, donc une
  // addition en linéaire — le verre renvoie de la lumière, il n'en remplace pas.
  let L = normalize(vec3<f32>(-0.40, 0.58, 0.71));
  let Hv = normalize(L - I);
  c = c + pow(max(dot(N, Hv), 0.0), 120.0) * spec;

  // ⚠️ SOIXANTE-DEUX LIGNES DE MORTIER ONT DISPARU ICI (ADR-0021), et c'est le seul
  // bloc du fichier qui PEIGNAIT au lieu de refracter : un joint opaque, sa
  // granulometrie, son ombre de contact et le lisere d'arete du bloc. Il ne
  // lisait rien de la pente de surface — il posait une couleur par-dessus, sous
  // le masque de la grille.
  //
  // C'est aussi pourquoi il ne laisse RIEN derriere lui sur une feuille : sa
  // condition (matiere superieure ou egale a 9) etait fausse sur les neuf
  // matieres qui restent, donc le bloc ne s'executait jamais pour elles. Le
  // retrait est neutre au bit pres.
  //
  // Ce qui est PERDU et n'a aucun equivalent : le seul verre A CELLULES du
  // registre, celui qui decoupe l'image en blocs separes par un joint. Ni un
  // masque ni une autre matiere ne le rendent — l'ADR le dit sans le
  // relativiser.

  return vec4<f32>(c, color.a);
}
`,
};
