import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodePng } from "../../scripts/lib/png.mjs";

/**
 * GARDE SANS GPU SUR LES REFERENCES DE RENDU.
 *
 * `npm run test:render` est la seule preuve de non-regression du rendu, mais
 * il exige une fenetre WebView2 vivante et un Vite : il ne tourne pas en
 * pre-commit, et personne ne l'a lance entre le merge du harnais (matin du
 * 2026-07-28) et celui de la tranche T1 (soir), qui l'a casse. Les six
 * references sont restees rouges un jour entier sans que rien ne le dise.
 *
 * Le scenario redoute n'est PAS celui-la (un harnais rouge finit par se voir)
 * mais le suivant : un `--update` de bonne foi qui fige des images MORTES en
 * references. Le harnais redevient vert et n'a plus rien a detecter. Mesure du
 * 2026-07-29 : avec la toile videe par T1, cinq scenarios sur six ne bougeaient
 * plus d'un seul canal quand on perturbait volontairement le pipeline.
 *
 * Ce fichier ne rend rien : il RELIT ce qui est committe. Il tourne dans
 * `npm run test`, donc dans le pre-commit, donc sur chaque tranche — et il
 * echoue si une reference est une image ecrasee. C'est la moitie du garde-fou
 * qui n'a pas besoin d'un GPU ; l'autre moitie (la gate de signal) vit dans
 * `scripts/render-check.mjs` et s'oppose a l'ecriture, celle-ci s'oppose au
 * commit.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REF_DIR = path.join(HERE, "..", "render-refs");

/** Le contrat des scenarios, en dur : renommer/ajouter un scenario doit etre
 *  un geste CONSCIENT qui casse ce test, jamais un fichier qui apparait. */
const ATTENDU = {
  "toile-vide.png": { width: 256, height: 256, valeurs: 1 },
  "toile-damier.png": { width: 256, height: 256, valeurs: 2 },
  "photo-de-fond-seule.png": { width: 256, height: 256, valeurs: null },
  // Le second calque de ce scenario etait `posterize` jusqu au 2026-08-03 ;
  // l effet est sorti du registre (ADR-0012) et `dither` a pris sa place, avec
  // les trois reglages qui redonnent son comportement. Le scenario verrouille
  // la COMPOSITION (cinq passes internes, deux opacites, deux modes de fusion),
  // pas la quantification — d ou le renommage plutot que la suppression.
  "effets-glow-dither.png": { width: 256, height: 256, valeurs: null },
  "grain-graine-fixe.png": { width: 256, height: 256, valeurs: null },
  "photo-double-exposure.png": { width: 256, height: 256, valeurs: null },
  // MIROIR — la paire qui gele l echelle NEGATIVE du calque photo (ticket 05).
  // Le temoin est a scaleX +1, le miroir a -1 ; la mire etant asymetrique
  // gauche/droite, le retournement se VOIT. Photo 176x132 sur une toile 256x256
  // et `fond: false` : le passe-partout autour est dans le cadre, ce qui est le
  // vrai sujet — c est la COUVERTURE que l inversion cassait.
  "photo-miroir-temoin.png": { width: 256, height: 256, valeurs: null },
  "photo-miroir.png": { width: 256, height: 256, valeurs: null },
  "masque-pinceau-degrade.png": { width: 256, height: 256, valeurs: null },
  "masque-edge-aware.png": { width: 256, height: 256, valeurs: null },
  // Meme chaine edge-aware, mais sur le calque le PLUS BAS (le calque photo de
  // fond). Le scenario ci-dessus la posait sur un calque d'effet en position 1,
  // dont le guide etait deja le composite en dessous : il ne pouvait pas voir
  // que le guide du calque du bas etait la toile VIDE. Voir
  // docs/adr/0004-image-de-guide-du-masque-edge-aware.md.
  "masque-edge-aware-calque-du-bas.png": { width: 256, height: 256, valeurs: null },
  // FEATHER A GRAND RAYON (2026-08-19) : la paire qui MONTRE le profil en S
  // du feather (quatre fenetres sur la SAT, FEATHER_WINDOWS) — les scenarios
  // refine ci-dessus travaillent a feather 2-6, ou la difference rampe/S
  // tient dans 9 LSB. Bord FRANC au temoin, transition ~48 px au feather 24.
  "masque-feather-fort-temoin.png": { width: 256, height: 256, valeurs: null },
  "masque-feather-fort.png": { width: 256, height: 256, valeurs: null },
  // L'OVERLAY DE MASQUE (safelight), et QUATRE références pour lui — deux
  // paires témoin/overlay. Il n'en avait AUCUNE jusqu'au 2026-08-14, et pas par
  // oubli : `maskOverlayFor` le refuse à la destination d'export par
  // construction, or tous les scénarios sauf le damier lisent `exportFrame`.
  // Le verrou était structurellement aveugle à lui — le modifier laissait
  // `test:render` vert.
  //
  // Chaque paire rend la MÊME pile, la seconde avec `setMaskOverlay` : l'écart
  // entre les deux EST l'aide de visée, jamais l'image en dessous. La première
  // porte un masque PEINT (frontière franche, le contour doit être une ligne),
  // la seconde un masque par TONALITÉ sur une image bruitée — le cas qui a fait
  // exploser le contour en hachures le 2026-08-13, et que le lissage à 25 taps
  // corrige. C'est cette correction que la mesure plus bas rend opposable.
  // LE DÉGRADÉ RADIAL (2026-08-14), promis en vague 1 par le PRD de masquage et
  // livré à moitié. La paire est sur une toile 320 × 192 À DESSEIN : sur une
  // toile carrée, un radial sans correction d'aspect rendrait un cercle quand
  // même, et la référence verrouillerait la propriété par accident.
  "masque-degrade-radial-temoin.png": { width: 320, height: 192, valeurs: null },
  "masque-degrade-radial.png": { width: 320, height: 192, valeurs: null },
  "masque-overlay-temoin.png": { width: 256, height: 256, valeurs: null },
  "masque-overlay-pinceau.png": { width: 256, height: 256, valeurs: null },
  "masque-overlay-tonalite-temoin.png": { width: 256, height: 256, valeurs: null },
  "masque-overlay-tonalite.png": { width: 256, height: 256, valeurs: null },
  // LIGHT LEAK (2026-08-05), et DEUX références pour un seul effet. Sur
  // `mireBokeh` pour la même raison que `lensFlare` : c'est la seule mire
  // essentiellement NOIRE du dossier, et une coulée posée en Écran ne se lit que
  // sur du sombre. Ses points isolés servent en prime de témoin du mode de
  // fusion.
  //
  // La seconde n'est pas une illustration : elle égalise les trois couches
  // d'émulsion (`chaleur` 0) sans rien changer d'autre, donc l'écart entre les
  // deux images EST la réponse chromatique du film. Les deux assertions plus bas
  // en font une mesure et pas une intention.
  "effet-light-leak.png": { width: 256, height: 256, valeurs: null },
  "effet-light-leak-neutre.png": { width: 256, height: 256, valeurs: null },
  // APLAT (2026-08-17), trois références pour trois propriétés distinctes.
  //
  // La paire rectangle/ellipse partage TOUTE sa géométrie : leur écart est donc
  // exactement la différence des deux primitives. ⚠️ Elle a un plancher de
  // signal, payé à la première exécution — à 0,5 × 0,32 elle ne s'écartait que
  // de 2,96 % des canaux et le gate a rougi. Leur différence n'est QUE les
  // quatre coins, dont l'aire vaut `1 - π/4` de la boîte englobante : 21,5 %
  // d'une petite boîte ne fait rien. À 0,8 × 0,6 la paire porte 8,3 %.
  "effet-aplat.png": { width: 256, height: 256, valeurs: null },
  "effet-aplat-ellipse.png": { width: 256, height: 256, valeurs: null },
  // La TROISIÈME est la seule qui verrouille `outAlpha = max(color.a,
  // couverture)` : toile 320 pour une mire de 256, rectangle à cheval sur le
  // bord gauche, donc une moitié tombe sur le passe-partout. Avec l'alpha
  // d'entrée préservé — l'écriture naturelle, celle de tous les autres effets —
  // cette moitié disparaîtrait, et l'effet aurait l'air correct partout où une
  // photo couvre.
  "effet-aplat-hors-photo.png": { width: 320, height: 320, valeurs: null },
  // Les deux CAPACITÉS ajoutées le 2026-08-17 (ticket 24), chacune comparée à
  // `effet-aplat` dont elles ne changent qu'une chose : le polygone ne change
  // que la primitive, le dégradé ne change que le remplissage.
  //
  // ⚠️ Le dégradé va du crème au bleu sombre, et ce n'est pas décoratif : ce
  // qu'il verrouille est que les deux arrêts sont convertis en LINÉAIRE avant
  // d'être interpolés. Un fondu mélangé en gamma passe par un milieu assombri —
  // visible sur une paire très contrastée, invisible sur deux teintes voisines.
  "effet-aplat-polygone.png": { width: 256, height: 256, valeurs: null },
  "effet-aplat-degrade.png": { width: 256, height: 256, valeurs: null },
  // L INVERSE (2026-08-18, ticket 12 tranche 2), sur le MEME hexagone que
  // `effet-aplat-polygone` : les deux images sont complementaires, la ou l une
  // porte l encre l autre porte la photo. C est la vignette a geometrie, que la
  // source de masque radiale ne sait pas produire — l inversion vivait sur le
  // MASQUE, dont les sources n ont aucune geometrie.
  "effet-aplat-inverse.png": { width: 256, height: 256, valeurs: null },
  // LES TROIS SOURCES PARAMÉTRIQUES, CHACUNE SEULE (2026-08-05). Le registre en
  // sert trois (`mask/sources/registry.ts`) et AUCUNE n'avait de verrou propre :
  // `masque-pinceau-degrade` ci-dessus fait tourner le dégradé, mais en passager
  // d'un scénario bâti pour autre chose — mêlé à un raster de pinceau, à un mode
  // intersect et à trois passes de refine edge. Même défaut, même correction que
  // pour `duotone` dans `masque-edge-aware` : un scénario par propriété.
  //
  // DEUX TÉMOINS POUR TROIS MASQUES, et c'est le montage qui compte. Chaque
  // masque se compare au MÊME effet sans masque, sur la MÊME mire : l'écart
  // mesuré est donc exactement ce que le masque retire. Un `contre` sur la photo
  // nue n'aurait prouvé que « l'effet agit ».
  //
  // ⚠️ LES CINQ PORTENT `fond: false`, ET C'EST LA CONDITION POUR QUE LE VERROU
  // MESURE QUELQUE CHOSE. `Renderer.parametricMaskSourceTexture()` sert au
  // masque la photo la plus BASSE de la pile — pas celle du calque masqué. Avec
  // le fond du harnais en place, la première version générait ses masques depuis
  // la mire commune pendant qu'on regardait une rampe, et les références en sont
  // sorties avec un damier imprimé dedans. Ni le harnais ni la gate de signal
  // n'ont bronché : les deux mesuraient bien un écart, simplement pas celui
  // qu'on croyait. Ça n'a été vu qu'en OUVRANT les images.
  "masque-rampe-temoin.png": { width: 256, height: 256, valeurs: null },
  // Le dégradé SEUL, vertical sur une rampe horizontale : les deux axes sont
  // orthogonaux, donc l'image porte les deux informations sans que l'une puisse
  // se faire passer pour l'autre.
  "masque-degrade.png": { width: 256, height: 256, valeurs: null },
  // La luminosité SEULE, et la mire est le test : la source sélectionne deux
  // PLAGES de ton en laissant les tons moyens dehors, donc la rampe doit sortir
  // duotonée aux deux bouts et GRISE au milieu. Aucun autre défaut ne produit
  // cette signature.
  "masque-luminosite.png": { width: 256, height: 256, valeurs: null },
  // Le range couleur, sur six pastilles de teintes franches — une mire écrite
  // pour lui, parce qu'aucune existante ne peut en témoigner : cette source
  // mesure une distance colorimétrique, il lui faut des couleurs SÉPARÉES et
  // PLATES, là où la mire commune est faite de deux dégradés continus.
  //
  // Le témoin applique une ROTATION CYCLIQUE des canaux et non un échange de
  // deux d'entre eux : un échange rouge/bleu laisse invariante toute couleur
  // dont le rouge et le bleu sont proches — la pastille verte en fait partie, et
  // elle ne témoignait donc de rien. Vu en comparant les deux références à
  // l'œil ; la gate de signal ne compte pas les pastilles, elle compte les
  // canaux.
  "masque-pastilles-temoin.png": { width: 256, height: 256, valeurs: null },
  "masque-range-couleur.png": { width: 256, height: 256, valeurs: null },
  // LENS BLUR (2026-08-01), et DEUX references pour un seul effet — ce n'est
  // pas une redondance. La premiere pose l'effet sur la mire commune : elle
  // verrouille la geometrie de champ (iris) et le raccord net/flou. La seconde
  // est un TEMOIN DE BOKEH sur des points lumineux isoles, et elle existe
  // parce que la premiere ne peut PAS voir la propriete principale de l'effet :
  // une tache de bokeh ne se lit que sur un petit point brillant contre du
  // sombre, et sous un damier un lens blur rend la meme chose qu'un gaussien.
  // Elle a paye son cout des sa premiere execution, en attrapant deux defauts
  // qu'aucun des dix-sept tests unitaires de l'effet ne voyait : un rayon
  // applique au double de sa valeur, et une collecte trop clairsemee qui
  // rendait des nuees granuleuses au lieu d'hexagones.
  "effet-lens-blur.png": { width: 256, height: 256, valeurs: null },
  "effet-lens-blur-bokeh.png": { width: 256, height: 256, valeurs: null },
  // COURBURE DES LAMES (2026-08-19). Le scenario ci-dessus est son temoin : il
  // tourne a courbure 0, celui-ci a 1, et rien d autre ne change. L ecart entre
  // les deux images EST l effet du parametre — un curseur mort ne deplacerait
  // aucun pixel, precisement parce qu il est mort.
  "effet-lens-blur-bokeh-courbe.png": { width: 256, height: 256, valeurs: null },
  // RETENUE DES NOIRS DU GLOW (2026-08-19), et la paire est indissociable. La
  // mire est mireLampes : moitie gauche DENSE, moitie droite CLAIRE, memes
  // sources des deux cotes. Le temoin est a retenue nulle (Pro-Mist, le halo se
  // pose partout et delave les noirs), l autre a fond (Black Pro-Mist, la
  // moitie dense reste dense pendant que les lampes fleurissent).
  "effet-glow-retenue-temoin.png": { width: 256, height: 256, valeurs: null },
  "effet-glow-retenue.png": { width: 256, height: 256, valeurs: null },
  // HATCHING (2026-08-01) : pose sur une rampe de gris NEUTRE et non sur la
  // mire commune, pour la meme raison que le temoin de bokeh a sa propre mire.
  // Le sujet de cet effet est sa REPONSE TONALE — trois couches de tailles qui
  // se relaient quand la precedente sature — et le damier de la mire commune
  // ferait sauter la luminance d'un texel a l'autre, rendant la progression
  // illisible. Une reference qui ne peut pas voir ce que l'effet pretend faire
  // ne verrouille que son bruit.
  "effet-hatching.png": { width: 256, height: 256, valeurs: null },
  // OUTLINES (2026-08-01) : cette reference a ete posee AVANT l extraction du
  // gradient de Scharr vers `effects/edgeGradient.ts`, precisement pour rendre
  // cette extraction prouvable. L effet n avait aucun verrou de pixels alors
  // que sa sortie depend d un noyau 3x3 sur huit taps, d une mesure de
  // chromaticite et d un plancher fwidth — rien n aurait vu une derive de l un
  // des trois. Elle reste ensuite comme verrou permanent. Sensibilite couleur a
  // 0.8 : la mire porte des damiers colores de meme luminance, donc le second
  // gradient est reellement sollicite.
  "effet-outlines.png": { width: 256, height: 256, valeurs: null },
  // LA ROUE D ORIENTATION (2026-08-01, sous le nom `effet-colored-edges`) : la
  // mire COMMUNE suffit, et c est assez rare pour etre dit. Son disque en hautes
  // lumieres est un contour FERME, donc il parcourt tout le cercle des
  // orientations, donc toute la roue chromatique — exactement la propriete que
  // ce mode pretend porter. Un damier seul n aurait montre que quatre teintes
  // (ses bords sont a 0 et 90 degres, dans les deux sens) et n aurait pas prouve
  // la continuite.
  //
  // RENOMMEE LE 2026-08-03 : `coloredEdges` a ete absorbe par `outlines` en tant
  // que mode d encre. Les reglages ont ete TRANSPOSES (`saturation` ->
  // `wheelChroma`, `lightness` -> `wheelLightness`, plus `inkMode` a 1) et
  // l image est ressortie IDENTIQUE A L OCTET — meme empreinte MD5 qu avant la
  // fusion. C est ce qui autorise a dire que la fusion ne perd rien.
  "effet-outlines-roue.png": { width: 256, height: 256, valeurs: null },
  // MOTION BLUR (2026-08-01) : mode ROTATION et non Directionnel. C est le seul
  // des trois dont une propriete se VERIFIE d un coup d oeil — la longueur de
  // trainee est proportionnelle au rayon, donc le centre reste net sans qu
  // aucun reglage ne le demande. Un file directionnel rend la meme chose
  // partout, et une reference posee dessus ne distinguerait pas un motion blur
  // d un flou quelconque etire.
  "effet-motion-blur.png": { width: 256, height: 256, valeurs: null },
  // `effet-surface-blur.png` a figure ici du 2026-08-02 au 2026-08-03. L effet
  // est sorti du registre sur verdict d usage (ADR-0011) et sa reference est
  // supprimee : une image qu aucun scenario ne sait plus produire ne verrouille
  // rien, et la garder ferait echouer le test de contenu exact du dossier — ce
  // qui est precisement le comportement voulu, puisqu il force le geste a etre
  // conscient des deux cotes.
  // PIXEL STRETCH (2026-08-01) : premier verrou de cet effet, pose le jour ou
  // Antoine a releve qu il ne rendait pas celui de Figma. La comparaison sur
  // image a montre pourquoi — le notre etait GLOBAL et mangeait la photo en
  // bandes, le leur se place sur la toile. Le scenario verrouille donc la
  // REGION : ecart de 6,4 % des canaux contre 43,1 % sans elle, c est-a-dire
  // une mire intacte tout autour de la coulure.
  "effet-pixel-stretch.png": { width: 256, height: 256, valeurs: null },
  // WARP, TYPE ANALYTIQUE (2026-08-01). Le scenario masque-pinceau-degrade
  // couvre deja le chemin du BRUIT fractal ; celui-ci couvre l autre famille,
  // les huit formes centrees venues de la fiche Figma. Tourbillon plutot qu un
  // autre des huit : sa decroissance gaussienne se verifie d un coup d oeil.
  "effet-warp-tourbillon.png": { width: 256, height: 256, valeurs: null },
  // HALFTONE (2026-08-01) : la ROSETTE est la seule propriete qui distingue une
  // vraie trame d une grille de points, et elle n apparait qu en CMJN — les
  // quatre encres tramees a 15, 75, 0 et 45 degres. Une trame au meme angle
  // partout donne un moire, pas une rosette : c est donc ce que cette reference
  // verrouille, et rien d autre ne pourrait le voir.
  "effet-halftone.png": { width: 256, height: 256, valeurs: null },
  // Trame + BAVURE D'ENCRE (`inkTexture.ts`, 2026-08-05). Elle contre
  // `effet-halftone`, donc l'écart mesuré est exactement ce que la bavure
  // ajoute : 42,9 % des canaux. C'est la SEULE référence qui verrouille
  // quelque chose de l'encre — celle de `effet-halftone` la laisse à zéro, où
  // elle est un no-op par construction.
  "effet-halftone-encre.png": { width: 256, height: 256, valeurs: null },
  // L'effet qui échantillonne un SCAN. Sa mire est GÉNÉRÉE dans la page
  // (`mireEncre`) et non lue sur disque : le harnais n'a pas d'IPC — ses
  // modules viennent d'un Vite séparé, et Tauri restreint ses commandes à
  // l'origine de l'application.
  "effet-texture.png": { width: 256, height: 256, valeurs: null },
  // ANAMORPHIC STREAK (2026-08-01) : sur la mire a POINTS LUMINEUX ISOLES, la
  // meme que le temoin de bokeh. Une trainee ne se lit que sur une source
  // ponctuelle contre du sombre ; sur un damier, l etalement directionnel se
  // confondrait avec un flou de mouvement. La reference a paye son cout des sa
  // premiere execution : elle a montre que la trainee PERLAIT en chapelet, un
  // trou structurel entre le nombre de taps et la croissance du pas.
  // PORTEE DE `anamorphicStreak` VERS `lensDistortion` le 2026-08-03 (ADR-0014),
  // reglages transposes a l identique — la trainee est le meme code, seuls ses
  // index de parametres ont bouge.
  "effet-lens-distortion-trainee.png": { width: 256, height: 256, valeurs: null },
  // LE FISHEYE SEUL, sur la mire commune : son damier a pas regulier est le seul
  // motif qui rende une deformation radiale mesurable a l oeil. Il verrouille
  // AUSSI que les quatre passes de trainee ne tournent pas a intensite nulle —
  // si elles tournaient, `prevPass` porterait la source et l image sortirait
  // avec la photo ajoutee en double.
  "effet-lens-distortion-fisheye.png": { width: 256, height: 256, valeurs: null },
  // LES TROIS MODES D ABERRATION, meme mire et meme force. Aucun ne se deduit
  // d un autre : la laterale est nulle au centre, la longitudinale se voit
  // PARTOUT (c est une mise au point, pas un deplacement), l anamorphique ne
  // deplace que sur l horizontale et ne croit pas avec le rayon. Les ecarts
  // mutuels des trois references sont ce qui l etablit.
  "effet-lens-distortion-laterale.png": { width: 256, height: 256, valeurs: null },
  "effet-lens-distortion-longitudinale.png": { width: 256, height: 256, valeurs: null },
  "effet-lens-distortion-anamorphique.png": { width: 256, height: 256, valeurs: null },
  // SLICE SHIFT (2026-08-02) : posee AVANT d ajouter le fondu des bords, pour
  // la meme raison qu outlines — l effet n avait aucun verrou, et « le nouveau
  // parametre a 0 ne change rien » serait reste une affirmation sans une
  // reference d avant le geste. Sur la RAMPE et non sur la mire commune : la
  // propriete a montrer est la MARCHE de valeur a la frontiere entre deux
  // tranches, et un damier saute deja d un texel a l autre, donc la marche s y
  // noierait. Mesure a l ecriture, colonne x=128 : quatre marches (y = 32, 128,
  // 192, 224, toutes multiples de l epaisseur de 32), transition sur UNE ligne
  // aux quatre. C est ce 1 que le fondu fait bouger.
  "effet-slice-shift.png": { width: 256, height: 256, valeurs: null },
  // SLICE SHIFT, FONDU A 16 PX (2026-08-02) : le SEUL couple de references du
  // dossier a ne differer que par un parametre, et c est delibere — meme mire,
  // meme graine, donc exactement les memes tranches aux memes endroits. Ce
  // couple est un A/B et pas deux images qui se ressemblent. Il porte le PROFIL
  // du fondu, et rien d autre : transition de 1 ligne a 13-15 aux memes y,
  // monotone aux quatre frontieres, coeur des tranches intact. Les trois sont
  // ASSERTEES plus bas, pas seulement decrites ici — sans quoi un `--update` de
  // bonne foi les effacerait en silence, ce que ce fichier existe pour empecher.
  //
  // ⚠️ CE QUE CE COUPLE NE PEUT PAS DIRE, et l avoir cru une premiere fois a
  // coute une revue : il ne decide PAS si le fondu melange des coordonnees ou
  // des couleurs. Sur une rampe AFFINE les deux sont algebriquement identiques
  // (`mix` commute avec un echantillonneur affine) ; seule la courbure du
  // transfert sRGB les separe, pour 0,03 niveau moyen. Le coeur intact n exclut
  // qu un flou GLOBAL, alors que le piege nomme dans la demande est une
  // operation LOCALE au bord — qui laisserait le coeur intact elle aussi.
  // C est `effet-slice-shift-fondu-barres.png` qui tranche ce point.
  "effet-slice-shift-fondu.png": { width: 256, height: 256, valeurs: null },
  // SLICE SHIFT SUR BARRES BINAIRES (2026-08-02) : la reference qui decide de la
  // NATURE du melange, et la seule qui le puisse. Barres de 16 px, deux niveaux,
  // uniformes en y et sur toute la largeur — donc deux lignes de decalages
  // differents echantillonnent un contenu statistiquement identique, et toute
  // valeur intermediaire est FABRIQUEE. Un melange de coordonnees ressort
  // toujours une valeur de la source (seuls les bords de barre sont
  // intermediaires) ; un melange de couleurs en fabrique partout ou les deux
  // copies different, soit des dizaines de pour cent. Mesure assertee plus bas.
  //
  // Le contraste, lui, ne discrimine PAS : un decalage fractionnaire passe par
  // une interpolation bilineaire qui attenue deja les hautes frequences, donc un
  // melange de coordonnees perd du contraste lui aussi (-25 % mesure sur les
  // rayures de 3 px de la mire commune, contre -29 % attendus d un melange de
  // couleurs — indiscernable). D ou une mire BINAIRE, ou l on compte une
  // population et pas une amplitude.
  "effet-slice-shift-fondu-barres.png": { width: 256, height: 256, valeurs: null },
  // MOTION BLUR, TRAINEE LONGUE (2026-08-02) : la reference qui exerce les DEUX
  // ETAGES de collecte, poses quand la plage est passee de 120 a 2000 px sur un
  // retour d Antoine (« pas assez extremes »). Rotation a 360 degres, ~800 px de
  // trainee au bord, donc CINQ segments — sous 192 px le second etage ne serait
  // pas sollicite et la reference ne verrouillerait que le chemin d avant.
  //
  // Le scenario porte aussi la preuve de la ROTATION VRAIE, et cette preuve est
  // analytique : integrer un tour complet, c est prendre la moyenne autour de
  // chaque cercle, donc le resultat exact est fait d anneaux CONSTANTS. Ecart-
  // type angulaire mesure, en part de la dynamique : 16 a 20 % avec l ancienne
  // approximation au premier ordre, 0,3 % avec la rotation exacte. Le seul
  // rayon qui depasse encore (5 % a r=60) est celui qui longe le bord du disque
  // en hautes lumieres de la mire — diffusion de reechantillonnage contre une
  // arete radiale, inherente a toute rotation multi-taps sur une grille.
  "effet-motion-blur-long.png": { width: 256, height: 256, valeurs: null },
  // MOTION BLUR DIRECTIONNEL (2026-08-02) : comble un trou que le retour
  // d Antoine (« le motion blur ne semble rien faire ») a rendu visible. Les
  // deux autres scenarios de cet effet sont en ROTATION ; le mode DIRECTIONNEL,
  // qui est son defaut et donc le premier qu on essaie, n avait aucun verrou.
  // Amplitude 60 px : au-dessus du seuil de reprise du net, sous le decoupage en
  // segments (192 px), donc il verrouille le chemin a UN segment — celui de tous
  // les reglages courants.
  "effet-motion-blur-directionnel.png": { width: 256, height: 256, valeurs: null },
  // POSTERIZE EN SERIGRAPHIE (2026-08-02) : les quatre controles ajoutes sur un
  // retour d Antoine (« posterize a tres peu de controles » — il en avait UN),
  // tous mis HORS de leur defaut, sans quoi la reference ne verrouillerait que
  // le chemin d avant.
  //
  // 32 valeurs DECLAREES et non le plancher generique de 64, et c est plus fort
  // que lui : 4 paliers par canal ne peuvent produire que 4³ couleurs au plus,
  // donc un compte bas EST la propriete de l effet. Le plancher protege contre
  // une image morte ; ici l image est vivante et volontairement pauvre.
  //
  // Ce que le tramage change est SPATIAL et non chromatique — il decale avant de
  // quantifier, donc la sortie n a de toute facon que `levels` valeurs par
  // canal. Mesure sur la longueur des plages constantes : 20,51 px sans tramage
  // (exactement celle de la mire nue, les aplats en suivent la structure) contre
  // 2,40 px sur la reference tramee, ou le motif hache tout. Et 4 niveaux de
  // vert exactement, le nombre de paliers demande.
  //
  // PORTEE DE `posterize` VERS `dither` le 2026-08-03 (ADR-0012), scenario et
  // reglages identiques : le rendu serigraphie EST la propriete qui permettait
  // de dire que dither couvre posterize, donc c est elle qu il fallait rendre
  // opposable avant de retirer le second.
  "effet-dither-serigraphie.png": { width: 256, height: 256, valeurs: 32 },
  // GOOEY MERGE (2026-08-02) : posee pour repondre a une question d Antoine —
  // « tres aliasé effet metal avec des artefacts, c est le but ? » — et la
  // reponse est NON, mesuree. Part de transitions fortes qui se font en UN seul
  // pixel (donc sans aucun pixel de couverture partielle) : 50,0 % sur la mire
  // NUE, 74,3 % avec cet effet, contre 3,0 % pour halftone et 30,6 % pour
  // outlines sur la meme mire. L effet AJOUTE donc des aretes franches, alors
  // que son fichier annonce une iso-surface « antialiasee analytiquement a toute
  // tension ». Tension a 1 dans le scenario, deliberement : c est le pire cas.
  //
  // Premier essai ECARTE, et garde en memoire : pose sur la mire a points
  // lumineux isoles, l effet rendait 5 valeurs distinctes et le garde de signal
  // a refuse d ecrire la reference. Cette mire est presque entierement noire,
  // donc tout tombe du meme cote du seuil — un effet de seuil a besoin d un
  // champ qui TRAVERSE le seuil, pas de taches isolees.
  "effet-gooey-merge.png": { width: 256, height: 256, valeurs: null },
  // CHANNEL MIXER (2026-08-02), et DEUX references dont la premiere existe pour
  // une raison de METHODE. L'effet n'avait ni test unitaire ni reference ; celle
  // de ses DEFAUTS a ete posee AVANT de lui ajouter les encres par canal, pas
  // apres. C'est elle qui a prouve que les dix nouveaux parametres laissent le
  // rendu identique AU BIT a leur defaut — une affirmation qu'aucune relecture
  // de diff ne peut faire, et que ce fichier aurait ete incapable de verifier
  // si la reference etait nee apres le changement.
  "effet-channel-mixer.png": { width: 256, height: 256, valeurs: null },
  "effet-channel-mixer-encres.png": { width: 256, height: 256, valeurs: null },
  // LE SEUIL DE FORME (2026-08-03), et sa PAIRE. Le second mode de detection
  // d outlines, verrouille le jour meme de sa livraison — la configuration
  // exacte qui a coute cher a hatching (livre, compilant, cable, verrouille par
  // rien pendant seize heures).
  //
  // La seconde image n est pas une illustration mais la PREUVE que « Luminance
  // inversee » n est ni inerte ni redondante. Memes reglages au bit pres, seule
  // l entree change, et ce qui bascule est QUEL COTE est peint — ce qu aucun
  // reglage du seuil ne produit. Si le remplissage disparaissait, les deux
  // references se rejoindraient : le verrou porte donc sur la JUSTIFICATION du
  // controle, pas seulement sur son cablage.
  "effet-outlines-seuil-de-forme.png": { width: 256, height: 256, valeurs: null },
  "effet-outlines-seuil-de-forme-inverse.png": { width: 256, height: 256, valeurs: null },
  // LES TROIS FORMES DE TAILLE de hatching (2026-08-02). Elles etaient livrees
  // depuis le 2026-08-01 et VERROUILLEES PAR RIEN : le scenario effet-hatching
  // tourne au defaut (Droites), donc il ne traverse aucune des trois autres
  // branches de hatch_coord. Elles compilaient et leurs parametres etaient
  // cables — la meme configuration exacte que lensBlur, qui avait dix-sept
  // tests verts en floutant au double du rayon regle.
  "effet-hatching-ondulations.png": { width: 256, height: 256, valeurs: null },
  "effet-hatching-zigzag.png": { width: 256, height: 256, valeurs: null },
  "effet-hatching-cercles.png": { width: 256, height: 256, valeurs: null },
  // LA ROUE AU CALQUE POSE (2026-08-02). Le scenario ci-dessus tourne a chroma
  // 0,85 / wash 0,85 : il EXAGERE la roue, ce qu'il faut pour la mesurer et pas
  // du tout pour juger l'effet. Le verdict d'usage « horrible, inutilisable »
  // portait sur le calque POSE — d'ou une seconde image.
  //
  // ⚠️ IL LISAIT LES DEFAUTS DE `coloredEdges`, QUI N'EXISTENT PLUS depuis la
  // fusion du 2026-08-03. Le scenario ECRIT donc desormais les anciens defauts,
  // faute de quoi il verrouillerait ceux d'`outlines` et l'image changerait de
  // sujet en silence. Meme empreinte MD5 qu'avant la fusion.
  "effet-outlines-roue-calque-pose.png": { width: 256, height: 256, valeurs: null },
  // OUTLINES SUR MIRE BRUITEE (2026-08-03), posee apres « outlines semble
  // bugge, l'effet n'est pas tres raffine ». La mire commune ne pouvait PAS
  // repondre : tous ses bords sont tres au-dessus du seuil, donc ils saturent
  // avant comme apres le correctif. Il fallait des aplats BRUITES et des
  // marches de contrastes DIFFERENTS pour que la reponse de l'effet se lise.
  "effet-outlines-bruit.png": { width: 256, height: 256, valeurs: null },
  // ECHO OUTLINES (2026-08-03) : l'effet que la fiche de reference decrit sous
  // le nom `Outlines`, et qui n'est PAS un detecteur de contours — « evenly
  // spaced outlines that echo your shape outward, like ripples ».
  "effet-outlines-echos.png": { width: 256, height: 256, valeurs: null },
  // DITHER (2026-08-03), et DEUX references pour un seul effet : c'est le seul
  // moyen de dire que Bayer et le bruit bleu ne sont pas le meme code. Tout est
  // identique par ailleurs — meme mire, meme taille, memes deux niveaux, memes
  // encres — donc ce qui separe les deux images ne peut venir que du motif.
  //
  // `valeurs: 2` est une ASSERTION et non un contournement du plancher : a deux
  // niveaux, encre noire et papier blanc, une image correcte ne PEUT contenir
  // que deux valeurs. Trois signaleraient une quantification qui fuit.
  "effet-dither.png": { width: 256, height: 256, valeurs: 2 },
  "effet-dither-bruit-bleu.png": { width: 256, height: 256, valeurs: 2 },
  // LES QUATRE STYLES AJOUTES LE 2026-08-03. Un scenario chacun, et ce n'est pas
  // du zele : les trois formes de `hatching` ont vecu une journee livrees et
  // verrouillees PAR RIEN, parce que leur scenario tournait au defaut et ne
  // traversait aucune des autres branches.
  "effet-dither-bayer-fin.png": { width: 256, height: 256, valeurs: 2 },
  "effet-dither-bruit-blanc.png": { width: 256, height: 256, valeurs: 2 },
  "effet-dither-lignes.png": { width: 256, height: 256, valeurs: 2 },
  "effet-dither-points.png": { width: 256, height: 256, valeurs: 2 },
  // ISOLINES (2026-08-03). Peu de valeurs, et c'est CONFORME : des traits noirs
  // antialiases sur un fond blanc uni n'en produisent qu'une par palier
  // d'antialiasing. Le compte declare devient une assertion de plus.
  "effet-isolines.png": { width: 256, height: 256, valeurs: 26 },
  "effet-isolines-maitresses.png": { width: 256, height: 256, valeurs: 25 },
  // LES QUATRE EFFETS QUI N'AVAIENT AUCUN VERROU PROPRE (2026-08-03), trouves
  // par un audit de couverture effet par effet. Deux n'avaient RIEN (`halation`,
  // `gradientMap`) ; les deux autres n'etaient que PASSAGERS d'un scenario bati
  // pour autre chose — `chromaticBleed` dans la double exposition, `duotone`
  // dans le masque edge-aware. Un passager fait tourner du code sans que sa
  // derive soit imputable : si la rampe de `duotone` bougeait, c'est la
  // reference du MASQUE qui changeait.
  //
  // Halation en DEUX references, et la seconde est un temoin, pas un doublon :
  // l'effacement sur fond clair est mathematiquement INERTE sur du noir
  // (`poidsFond` vaut 1), donc aucune mire sombre ne peut l'exercer. Le temoin
  // le met a 0 ; l'ecart entre les deux images EST la contribution du terme.
  "effet-halation.png": { width: 256, height: 256, valeurs: null },
  "effet-halation-fond-clair.png": { width: 256, height: 256, valeurs: null },
  // L'aberration laterale en deux orientations. A 45 degres le decalage devient
  // perpendiculaire au rayon (decentrement d'objectif), donc les franges
  // tournent autour du centre au lieu d'en partir.
  //
  // CES DEUX REFERENCES PORTAIENT `chromaticBleed`, absorbe par le mode Laterale
  // de `lensDistortion` le 2026-08-03 (ADR-0016). A la difference des quatre
  // absorptions precedentes, celle-ci n'est PAS identique a l'octet : les deux
  // implementations etaient independantes. Elle a ete mesuree AVANT le geste, a
  // 0,005 % de canaux d'ecart sur le cas radial — et c'est ce qui a autorise a
  // regenerer les images plutot qu'a garder l'effet.
  "effet-lens-distortion-laterale-damier.png": { width: 256, height: 256, valeurs: null },
  "effet-lens-distortion-laterale-decentree.png": { width: 256, height: 256, valeurs: null },
  // LE VERRE, TRANCHE 1 (2026-08-03). Treize references, toutes sur `mireVerre` —
  // une mire ECRITE POUR EUX, parce qu'aucune existante ne pouvait montrer les
  // quatre proprietes en meme temps (deplacement, dispersion, periodicite,
  // diffusion). Elle est entierement ACHROMATIQUE : la moindre couleur dans ces
  // images EST la dispersion.
  //
  // Treize pour QUATORZE branches, et l'ecart n'est pas un trou : le scenario du
  // cannele simple couvre a lui seul la matiere 0 et le profil 0, puisqu'il faut
  // bien une matiere pour eprouver un profil.
  //
  // La premiere passe n'en couvrait que sept, et sa note en annoncait six —
  // elle oubliait `Poli`. Les sept manquantes ont ete posees ensuite, chacune
  // mesuree contre la reference dont elle doit se DISTINGUER et non contre la
  // photo nue : `croise` contre `cannele` (le second axe), `gaufre` contre
  // `croise` (le produit contre la somme, seule chose qui les separe), `ecorce`
  // contre `martele` (ils partagent leur primitive), et les trois profils
  // contre `cannele` a parametres identiques.
  //
  // ⚠️ UNE QUATORZIEME REFERENCE MANQUE VOLONTAIREMENT — le meme `Poli` a
  // densite forte. Elle a ete produite, regardee, puis NON committee : elle
  // montre de l'aliasing (franges d'interference, image illisible), parce que
  // `Poli` est la seule branche pilotee par la densite dont le pas de
  // differences finies est constant la ou ses deux soeurs mettent le leur a
  // l'echelle. La figer aurait verrouille le defaut au lieu de le signaler.
  // LENS FLARE (2026-08-03), quatre references sur `mireBokeh` — la seule mire
  // du dossier qui porte des sources PONCTUELLES FRANCHES sur du sombre, et un
  // flare ne part de rien d'autre. Une par contribution : la premiere isole les
  // fantomes en excluant la photo (seuil a 1), les trois autres partent d'elle
  // et n'allument qu'une chose de plus. Patron temoin de `halation` — l'ecart
  // entre deux images EST la contribution du terme.
  "effet-lens-flare-source-posee.png": { width: 256, height: 256, valeurs: null },
  "effet-lens-flare-automatique.png": { width: 256, height: 256, valeurs: null },
  "effet-lens-flare-anneau.png": { width: 256, height: 256, valeurs: null },
  "effet-lens-flare-voile.png": { width: 256, height: 256, valeurs: null },
  // LES TROIS AUTRES FAMILLES + LE HORS CADRE (2026-08-03, seconde passe). La
  // premiere version ne modelisait que le ghosting, et l anneau comme le voile
  // ne rendaient RIEN avec une source hors champ — le lobe etait rasterise dans
  // une passe qui ne couvre que [0,1]. Cette reference verrouille les quatre.
  "effet-lens-flare-familles.png": { width: 256, height: 256, valeurs: null },
  // LA PLUME (2026-08-03, troisieme revue). Cinq photographies d Antoine, prises
  // avec son propre materiel, ne montraient NI chapelet NI anneau — toutes la
  // meme plume large, teintee par le revetement et coupee par un bord DROIT.
  // C est devenu le cœur de l effet ; cette reference l isole, source
  // au-dessus du cadre comme sur ses images.
  "effet-lens-flare-plume.png": { width: 256, height: 256, valeurs: null },
  "effet-verre-cannele.png": { width: 256, height: 256, valeurs: null },
  "effet-verre-bourrelet.png": { width: 256, height: 256, valeurs: null },
  "effet-verre-martele.png": { width: 256, height: 256, valeurs: null },
  "effet-verre-aluminium.png": { width: 256, height: 256, valeurs: null },
  "effet-verre-cathedrale.png": { width: 256, height: 256, valeurs: null },
  "effet-verre-depoli.png": { width: 256, height: 256, valeurs: null },
  "effet-verre-croise.png": { width: 256, height: 256, valeurs: null },
  "effet-verre-gaufre.png": { width: 256, height: 256, valeurs: null },
  "effet-verre-ecorce.png": { width: 256, height: 256, valeurs: null },
  "effet-verre-poli.png": { width: 256, height: 256, valeurs: null },
  "effet-verre-arc-plein.png": { width: 256, height: 256, valeurs: null },
  "effet-verre-prisme.png": { width: 256, height: 256, valeurs: null },
  "effet-verre-fond-plat.png": { width: 256, height: 256, valeurs: null },
  "effet-verre-pave-nuage.png": { width: 256, height: 256, valeurs: null },
  "effet-verre-pave-ondule.png": { width: 256, height: 256, valeurs: null },
  "effet-verre-pave-quadrille.png": { width: 256, height: 256, valeurs: null },
  "effet-verre-pave-alveolaire.png": { width: 256, height: 256, valeurs: null },
  "effet-verre-pave-lisse.png": { width: 256, height: 256, valeurs: null },
  // COURBES : identite GPU sur rampe, puis S-curve + dominante rouge mesuree
  // contre cette identite. Deux references separent la neutralite du signal.
  "effet-courbes-neutre.png": { width: 256, height: 256, valeurs: null },
  "effet-courbes.png": { width: 256, height: 256, valeurs: null },
  // SOLARISATION (2026-08-18, ticket 12 tranche 2) : une courbe qui DESCEND
  // puis remonte. La levee n a touche que `constrainCurvePoint`, cote interface,
  // la these etant que le shader savait deja le faire. Cette reference est le
  // seul endroit ou cette these se verifie sur des pixels — le jumeau
  // TypeScript de la courbe partage son code avec l apercu, il pourrait tres
  // bien etre le seul des deux a savoir descendre.
  "effet-courbes-solarisation.png": { width: 256, height: 256, valeurs: null },
  // DUOTONE ET GRADIENT MAP SUR LA MEME RAMPE, a dessein : « sont-ils des
  // doublons » en est a son troisieme tour sans avoir jamais eu de mesure. Deux
  // references sur la meme mire, aux memes tons, la rendent chiffrable — et si
  // un jour les deux effets rendaient la meme chose, le `contre` du harnais
  // rougirait de lui-meme. La troisieme replie la rampe quatre fois, ce que
  // trois teintes fixes ne peuvent pas faire.
  "effet-duotone.png": { width: 256, height: 256, valeurs: null },
  "effet-gradient-map.png": { width: 256, height: 256, valeurs: null },
  "effet-gradient-map-repetition.png": { width: 256, height: 256, valeurs: null },
  // TRANCHE T2 : la SEULE reference dont la toile n'a pas la taille de la mire
  // (320 x 320 pour une mire de 256 x 256). Sa presence ici, avec des dimensions
  // differentes des neuf autres, est la trace qu'une reference n'est plus
  // forcement 256 x 256.
  "toile-plus-grande-que-la-photo.png": { width: 320, height: 320, valeurs: null },
  // ── LES TROIS EFFETS DE LA TRANCHE 3 (2026-08-18, ticket 12) ─────────────
  //
  // RELIEF. Le couple `effet-emboss` / `effet-emboss-oppose` porte la seule
  // propriete qu aucun pourcentage global ne pourrait exprimer autrement :
  // retourner la lampe doit INVERSER le modele. Un noyau qui ne garderait que la
  // MAGNITUDE du gradient — c est-a-dire `outlines`, dont cet effet partage le
  // detecteur — rendrait ici deux images IDENTIQUES.
  "effet-emboss.png": { width: 256, height: 256, valeurs: null },
  "effet-emboss-oppose.png": { width: 256, height: 256, valeurs: null },
  "effet-emboss-sur-image.png": { width: 256, height: 256, valeurs: null },
  // CARTE DE DEPLACEMENT, un scenario par mode de lecture. La carte est
  // `mireEncre`, servie par le port de decodage du harnais.
  //
  // ⚠️ Ces deux-la dependent de `ensureTextureLoaded` : sans l attente, l effet
  // prend sa branche de repli 1x1 et rend l image INCHANGEE. La reference
  // ressemblerait a une reference et ne verrouillerait rien — meme piege que
  // celui deja attrape sur `effet-texture`.
  "effet-deplacement-pente.png": { width: 256, height: 256, valeurs: null },
  "effet-deplacement-canaux.png": { width: 256, height: 256, valeurs: null },
  // NETTETE, sur `mireBruit` — la seule mire qui porte a la fois des MARCHES
  // franches (l accentuation se lit sur un bord) et des plages PLATES bruitees
  // (sans elles, le masquage n aurait rien a epargner et son curseur ne
  // bougerait aucun canal).
  //
  // Le temoin est la mire seule. `accentuation` verrouille en prime un
  // branchement qui n a aucun autre temoin : ses sept passes de pyramide sont
  // ETEINTES par `EffectPass.enabled`, donc `prevPass` est la source elle-meme et
  // le flou se fait dans la passe finale. Si les passes cessaient d etre
  // sautees, le flou deviendrait large et l image changerait partout.
  "effet-nettete-temoin.png": { width: 256, height: 256, valeurs: null },
  "effet-nettete-accentuation.png": { width: 256, height: 256, valeurs: null },
  "effet-nettete-clarte.png": { width: 256, height: 256, valeurs: null },
  "effet-nettete-masquage.png": { width: 256, height: 256, valeurs: null },
  // ── LES SIX MODES DE FUSION (2026-08-18, ticket 12 tranche 1) ────────────
  //
  // Le registre en portait onze et n en verrouillait que TROIS, tous en
  // passagers d un scenario d effet (`screen`, `overlay`, `multiply`).
  //
  // Ce que le montage a de particulier : la chaine des `contre` du harnais fait
  // que chacun se mesure contre celui dont il doit se DISTINGUER, et pas contre
  // la photo nue. Un `contre` sur la photo nue prouverait seulement que le mode
  // agit ; ici l ecart repond a la question qui separe deux modes voisins —
  // Luminosite contre Couleur (le sens de la reprise), Teinte contre Couleur (l
  // origine de la saturation), Soustraction contre Difference (la surface ou la
  // valeur absolue replie une valeur negative).
  //
  // ⚠️ `fusion-couleur` porte peu de valeurs distinctes (1228 mesure) et c est
  // NORMAL, pas un aplat : le mode ne prend du dessus que sa chromaticite, et le
  // dessus est une mire a quatre bandes — donc quatre chromaticites, sur toute
  // la plage de luminosite du dessous.
  "fusion-couleur.png": { width: 256, height: 256, valeurs: null },
  "fusion-luminosite.png": { width: 256, height: 256, valeurs: null },
  "fusion-teinte.png": { width: 256, height: 256, valeurs: null },
  "fusion-saturation.png": { width: 256, height: 256, valeurs: null },
  "fusion-difference.png": { width: 256, height: 256, valeurs: null },
  "fusion-soustraction.png": { width: 256, height: 256, valeurs: null },
};

/** Meme plancher que `MIN_COULEURS` dans `scripts/render-check.mjs`. */
const MIN_COULEURS = 64;

function couleursDistinctes(pixels) {
  const vues = new Set();
  for (let i = 0; i < pixels.length; i += 4) {
    vues.add((pixels[i] << 24) | (pixels[i + 1] << 16) | (pixels[i + 2] << 8) | pixels[i + 3]);
    if (vues.size > 4096) break;
  }
  return vues.size;
}

describe("references de rendu committees", () => {
  it("le dossier contient exactement les references attendues", () => {
    const trouves = readdirSync(REF_DIR).filter((f) => f.endsWith(".png")).sort();
    expect(trouves).toEqual(Object.keys(ATTENDU).sort());
  });

  for (const [fichier, attente] of Object.entries(ATTENDU)) {
    it(`${fichier} est une image lisible, opaque et non ecrasee`, () => {
      const image = decodePng(readFileSync(path.join(REF_DIR, fichier)));
      expect(image.width).toBe(attente.width);
      expect(image.height).toBe(attente.height);

      // Toute reference sort d'une passe d'aplatissement : alpha 1 partout,
      // sur les deux surfaces. Un alpha qui fuit ici, c'est un JPEG noir en
      // aval (voir `assertOpaqueForJpeg`).
      let alphaMin = 255;
      for (let i = 3; i < image.pixels.length; i += 4) alphaMin = Math.min(alphaMin, image.pixels[i]);
      expect(alphaMin).toBe(255);

      const couleurs = couleursDistinctes(image.pixels);
      if (attente.valeurs !== null) expect(couleurs).toBe(attente.valeurs);
      else expect(couleurs).toBeGreaterThanOrEqual(MIN_COULEURS);
    });
  }

  // ADR-0006 : le fond d'un export est BLANC. Gardé SANS GPU, parce qu'un fond
  // d'export qui redeviendrait noir ne casserait aucun test unitaire de shader
  // (le WGSL n'est qu'une chaîne) et ne se verrait qu'en relançant le harnais.
  it("toile-vide est du BLANC opaque uniforme — le fond d'export d'ADR-0006", () => {
    const image = decodePng(readFileSync(path.join(REF_DIR, "toile-vide.png")));
    for (let i = 0; i < image.pixels.length; i += 4) {
      // Une seule assertion sur le premier pixel non conforme suffit à faire
      // rougir, mais boucler nomme LEQUEL — comme `assertOpaqueForJpeg`.
      if (
        image.pixels[i] !== 255 ||
        image.pixels[i + 1] !== 255 ||
        image.pixels[i + 2] !== 255 ||
        image.pixels[i + 3] !== 255
      ) {
        throw new Error(
          `pixel ${i / 4} = ${image.pixels.slice(i, i + 4).join(",")} au lieu de 255,255,255,255 ` +
            "— le fond d'export a cessé d'être blanc (ADR-0006).",
        );
      }
    }
  });

  // TRANCHE T2, le « done » de la tranche, gardé sans GPU : une photo de 256 x 256
  // centrée sur une toile de 320 x 320 laisse une bande de 32 px sur les quatre
  // côtés, et cette bande est BLANCHE dans le fichier exporté.
  it("toile-plus-grande-que-la-photo : la photo est centrée, le passe-partout est blanc", () => {
    const image = decodePng(readFileSync(path.join(REF_DIR, "toile-plus-grande-que-la-photo.png")));
    const at = (x, y) => {
      const i = (y * image.width + x) * 4;
      return [image.pixels[i], image.pixels[i + 1], image.pixels[i + 2]];
    };
    const MARGE = (320 - 256) / 2;
    expect(MARGE).toBe(32);

    // Les quatre coins et le milieu de chaque bord : blanc pur.
    for (const [x, y] of [[0, 0], [319, 0], [0, 319], [319, 319], [160, 31], [160, 288], [31, 160], [288, 160]]) {
      expect(at(x, y)).toEqual([255, 255, 255]);
    }

    // Le premier pixel DANS la photo n'est pas blanc : la frontière tombe bien à
    // 32 px, la photo n'est ni décalée ni rééchelonnée.
    expect(at(MARGE, 160)).not.toEqual([255, 255, 255]);
    expect(at(320 - MARGE - 1, 160)).not.toEqual([255, 255, 255]);

    // La part de blanc pur vaut EXACTEMENT l'aire non couverte : 320² - 256².
    let blanc = 0;
    for (let i = 0; i < image.pixels.length; i += 4) {
      if (image.pixels[i] === 255 && image.pixels[i + 1] === 255 && image.pixels[i + 2] === 255) blanc++;
    }
    expect(blanc).toBe(320 * 320 - 256 * 256);
  });

  // Et la zone centrale est la MÊME image que le document nu : la photo n'a subi
  // aucun rééchantillonnage du fait de la toile plus grande. C'est la
  // non-régression que la tranche T2 devait prouver.
  it("la zone centrale reproduit photo-de-fond-seule à l'octet", () => {
    const grande = decodePng(readFileSync(path.join(REF_DIR, "toile-plus-grande-que-la-photo.png")));
    const nue = decodePng(readFileSync(path.join(REF_DIR, "photo-de-fond-seule.png")));
    let differents = 0;
    for (let y = 0; y < 256; y++) {
      for (let x = 0; x < 256; x++) {
        const a = ((y + 32) * 320 + (x + 32)) * 4;
        const b = (y * 256 + x) * 4;
        for (let c = 0; c < 4; c++) if (grande.pixels[a + c] !== nue.pixels[b + c]) differents++;
      }
    }
    expect(differents).toBe(0);
  });

  /* ── SLICE SHIFT : le fondu des bords (2026-08-02) ──────────────────────────
   *
   * Les trois mesures ci-dessous vivaient en PROSE dans les commentaires
   * d'ATTENDU, et la revue adverse a eu raison de le relever : un `--update` de
   * bonne foi les aurait effacées sans rien faire rougir, ce qui est exactement
   * le scénario que l'en-tête de ce fichier dit vouloir empêcher. Elles sont
   * maintenant des assertions.
   */

  /** Canal vert de la colonne `x` d'une référence. Le vert est le seul canal que
   *  `chromaSplit` ne décale pas : ce qu'on y lit vient du décalage de tranche
   *  et de rien d'autre. */
  const colonneVerte = (fichier, x) => {
    const img = decodePng(readFileSync(path.join(REF_DIR, fichier)));
    return Array.from({ length: img.height }, (_, y) => img.pixels[(y * img.width + x) * 4 + 1]);
  };

  /** Nombre de lignes consécutives qui varient autour de `y0`. Une coupure
   *  franche en donne UNE, un fondu en donne autant que sa largeur. */
  const largeurTransition = (col, y0, rayon = 12) => {
    let n = 0;
    for (let y = y0 - rayon; y < y0 + rayon; y++) if (col[y] !== col[y + 1]) n++;
    return n;
  };

  // sliceSize 32 sur une toile de 256 : les frontières tombent aux multiples de
  // 32. Quatre d'entre elles portent une marche — les autres séparent deux
  // tranches immobiles (densité 0,5) ou fusionnées (irrégularité).
  const FRONTIERES = [32, 128, 192, 224];

  it("slice-shift : sans fondu, la frontière est une coupure d'UNE ligne", () => {
    const col = colonneVerte("effet-slice-shift.png", 128);
    for (const y0 of FRONTIERES) {
      expect(Math.abs(col[y0] - col[y0 - 1])).toBeGreaterThanOrEqual(4);
      expect(largeurTransition(col, y0)).toBe(1);
    }
  });

  it("slice-shift : avec un fondu de 16 px, la transition s'étale et reste monotone", () => {
    const col = colonneVerte("effet-slice-shift-fondu.png", 128);
    for (const y0 of FRONTIERES) {
      // Étalée : plus une coupure. La borne haute est celle de la bande de
      // fondu elle-même (16 px), pas un chiffre choisi après coup.
      const n = largeurTransition(col, y0);
      expect(n).toBeGreaterThanOrEqual(10);
      expect(n).toBeLessThanOrEqual(16);

      // Monotone : un fondu, pas une oscillation. Un profil non monotone
      // signalerait un pli — précisément ce que le choix de smoothstep évite.
      const signes = new Set();
      for (let y = y0 - 8; y < y0 + 8; y++) {
        const d = col[y + 1] - col[y];
        if (d !== 0) signes.add(Math.sign(d));
      }
      expect(signes.size).toBeLessThanOrEqual(1);
    }
  });

  it("slice-shift : le fondu ne touche QUE le bord — le cœur des tranches est intact", () => {
    const franc = decodePng(readFileSync(path.join(REF_DIR, "effet-slice-shift.png")));
    const fondu = decodePng(readFileSync(path.join(REF_DIR, "effet-slice-shift-fondu.png")));
    let compares = 0, differents = 0;
    for (let y = 0; y < 256; y++) {
      const local = y % 32;
      if (local < 12 || local > 20) continue; // cœur seul, hors bande de fondu
      for (let x = 0; x < 256; x++) {
        const i = (y * 256 + x) * 4 + 1;
        compares++;
        if (franc.pixels[i] !== fondu.pixels[i]) differents++;
      }
    }
    expect(compares).toBe(18432);
    expect(differents).toBe(0);
  });

  it("slice-shift : le fondu est un FONDU ENCHAÎNÉ — les deux tranches coexistent dans la bande", () => {
    // ⚠️ CETTE ASSERTION A ÉTÉ INVERSÉE LE 2026-08-02, ET C'EST VOULU. Elle
    // exigeait d'abord le contraire (un mélange de COORDONNÉES, donc peu de
    // valeurs fabriquées) parce que la note accompagnant la demande d'Antoine
    // qualifiait le mélange de couleurs de piège. Antoine a jugé le résultat sur
    // pièce — « ça ressemble plus à du warping » — et un décalage qui varie
    // cisaille en effet le contenu au lieu d'adoucir la limite. C'est donc la
    // SPEC qui a changé, pas la mesure : le même instrument, la même mire, le
    // seuil retourné.
    //
    // La mire BINAIRE reste ce qui rend la question décidable : sur des barres
    // à deux niveaux, toute valeur intermédiaire est FABRIQUÉE. Un fondu
    // enchaîné en fabrique partout où les deux tranches décalées diffèrent ; un
    // mélange de coordonnées n'en fabriquerait qu'aux bords de barre.
    const img = decodePng(readFileSync(path.join(REF_DIR, "effet-slice-shift-fondu-barres.png")));
    const MARGE = 12;
    const intermediaire = (v) => Math.abs(v - 32) > MARGE && Math.abs(v - 224) > MARGE;

    let dedans = 0, dedansTot = 0, dehors = 0, dehorsTot = 0;
    for (let y = 0; y < img.height; y++) {
      // Bande de fondu : ±8 px autour des frontières. `n = y + 0.5 - 128`,
      // parce que l'axe des tranches est compté depuis le CENTRE de l'image.
      const n = y + 0.5 - img.height / 2;
      const l = ((n % 32) + 32) % 32;
      const bande = Math.min(l, 32 - l) < 8;
      for (let x = 0; x < img.width; x++) {
        const v = img.pixels[(y * img.width + x) * 4 + 1];
        if (bande) { dedansTot++; if (intermediaire(v)) dedans++; }
        else { dehorsTot++; if (intermediaire(v)) dehors++; }
      }
    }

    // LE SEUIL EST CALIBRÉ CONTRE L'AUTRE IMPLÉMENTATION, pas choisi. Le
    // mélange de coordonnées, mesuré sur cette même mire quand il était en
    // place, donnait 3,67 % ; le fondu enchaîné donne 26,25 %. Le seuil est
    // leur moyenne géométrique — 10 % — donc à peu près la même marge de
    // chaque côté. Ce test aurait ROUGI sur l'implémentation précédente, et
    // c'est ce qui en fait une mesure et pas une décoration.
    expect(dedans / dedansTot).toBeGreaterThan(0.1);

    // Et HORS de la bande, rien n'est fabriqué au-delà des bords de barre : le
    // fondu ne touche que la limite. Sans cette seconde borne, un effet qui
    // fondrait toute l'image passerait aussi.
    expect(dehors / dehorsTot).toBeLessThan(0.05);
  });

  /* ── GOOEY MERGE : le liseré ne doit pas être un fil d'UN pixel (2026-08-02) ──
   *
   * D'où vient la question : « très aliasé, effet métal avec des artefacts, c'est
   * le but ? » (revue d'usage d'Antoine). Le verrou posé le matin même avait
   * répondu « non, et ce n'est pas l'empilement » — sur une mesure de part
   * d'arêtes franches donnée à 74,3 % contre 50,0 % pour la mire nue.
   *
   * ⚠️ CE COUPLE DE CHIFFRES NE SE REPRODUIT PAS. Cinq définitions de « transition
   * franche » ont été essayées sur les références committées ; aucune ne les rend,
   * et toutes classent gooey SOUS la mire nue au lieu d'au-dessus. Le relevé était
   * juste sur le diagnostic (il y a un défaut) et faux sur sa nature. Il n'a donc
   * pas été repris comme seuil : la mesure ci-dessous le remplace.
   *
   * CE QUE LE PROFIL MONTRE, LUI, ET QUI DÉCIDE. En travers du contour, avant
   * correctif : `60 61 62 62 | 180 | 140 96 97`. Ce n'est pas un bord crénelé —
   * c'est un PIC D'UN SEUL PIXEL au-dessus de la base, c'est-à-dire le liseré
   * spéculaire réduit à un fil. Un fil d'un pixel n'est pas un liseré fin : il
   * s'allume ou s'éteint selon l'endroit où la frontière tombe dans la grille,
   * donc il se lit comme un escalier de points brillants. Le « métal ».
   *
   * POURQUOI CETTE MÉTRIQUE PLUTÔT QU'UNE PART D'ARÊTES. Elle a une LIGNE DE BASE
   * EXACTEMENT NULLE : la mire nue ne contient aucun pixel isolé de ce genre (son
   * damier est fait de blocs de 16 px). Tout filament compté ici a donc été
   * FABRIQUÉ par l'effet, et aucun damier ne peut gonfler le chiffre — c'est
   * précisément ce qui manquait au premier relevé de la veille.
   *
   * ELLE N'EST PAS UNIVERSELLE, ET C'EST VOULU : `halftone` en compte 2488 et
   * `outlines` 1171 sur la même mire, sans que ce soit un défaut — leur sujet EST
   * une structure fine. Elle ne s'applique qu'à un effet dont le fichier promet
   * une iso-surface « toujours antialiasée analytiquement ».
   */

  /** Pixels qui dépassent leurs DEUX voisins d'au moins `seuil` sur un axe : ni
   *  montée ni descente, donc aucun pixel de couverture partielle. */
  const filaments = (fichier, seuil) => {
    const img = decodePng(readFileSync(path.join(REF_DIR, fichier)));
    const { width: w, height: h, pixels } = img;
    const L = new Int32Array(w * h);
    for (let i = 0; i < w * h; i++) {
      L[i] = Math.round(0.2126 * pixels[i * 4] + 0.7152 * pixels[i * 4 + 1] + 0.0722 * pixels[i * 4 + 2]);
    }
    let n = 0;
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const c = L[y * w + x];
        if (
          c - Math.max(L[(y - 1) * w + x], L[(y + 1) * w + x]) >= seuil ||
          c - Math.max(L[y * w + x - 1], L[y * w + x + 1]) >= seuil
        ) n++;
      }
    }
    return n;
  };

  it("la mire nue ne contient AUCUN filament — c'est ce qui rend le compte lisible", () => {
    // Sans cette ligne, le nombre du test suivant ne veut rien dire. Elle est la
    // correction de méthode que la veille avait manquée : un chiffre d'artefact
    // relevé sans sa ligne de base ne mesure pas l'artefact.
    for (const seuil of [16, 24, 32, 48]) {
      expect(filaments("photo-de-fond-seule.png", seuil)).toBe(0);
    }
  });

  /* ── LIGHT LEAK : la couleur est DÉRIVÉE, pas peinte (2026-08-05) ───────────
   *
   * Le cahier de postproduction (ligne 330) décrit la recette à la main :
   * « dégradés rouge, orange ou jaune ». La recopier aurait donné trois arrêts
   * de couleur posés dans un dégradé — la même palette, et rien derrière. Le
   * module part du mécanisme : les trois couches de l'émulsion ne saturent pas à
   * la même vitesse sous une lumière chaude, donc chaque canal suit
   * `1 - exp(-énergie · k)` avec kR > kV > kB.
   *
   * Les deux assertions ci-dessous sont ce qui rend cette phrase opposable. Sans
   * elles, remplacer le modèle par une rampe peinte passerait les références au
   * premier `--update` venu : les images se ressembleraient.
   */

  /** Écart max entre canaux d'un pixel — 0 sur un gris parfait. */
  const ecartCanaux = (p, i) =>
    Math.max(Math.abs(p[i] - p[i + 1]), Math.abs(p[i + 1] - p[i + 2]), Math.abs(p[i] - p[i + 2]));

  it("light leak : à couches ÉGALISÉES, la coulée est strictement neutre", () => {
    // `chaleur` à 0 met les trois vitesses de saturation à la même valeur. Le
    // modèle rend alors du gris PUR, ce qu'une rampe peinte à trois arrêts
    // chauds ne peut pas faire : il faudrait qu'elle désature ses arrêts, donc
    // qu'elle porte une seconde construction pour ce seul cas.
    const img = decodePng(readFileSync(path.join(REF_DIR, "effet-light-leak-neutre.png")));
    let mesures = 0, neutres = 0;
    for (let i = 0; i < img.pixels.length; i += 4) {
      const L = 0.2126 * img.pixels[i] + 0.7152 * img.pixels[i + 1] + 0.0722 * img.pixels[i + 2];
      if (L < 8) continue; // hors coulée : la mire est noire
      mesures++;
      if (ecartCanaux(img.pixels, i) <= 2) neutres++;
    }
    // La mesure porte sur des milliers de pixels, pas sur une poignée.
    expect(mesures).toBeGreaterThan(8000);
    // 97,5 % mesurés. Les 2,5 % restants ne sont PAS du bruit : ce sont les
    // seize points colorés de `mireBokeh` qui transparaissent sous l'Écran —
    // leur couleur vient de la mire, pas de la coulée. Le seuil est à 95 %,
    // donc au-dessus de ce que les points seuls peuvent expliquer.
    expect(neutres / mesures).toBeGreaterThan(0.95);
  });

  it("light leak : la chaleur culmine à MI-ÉNERGIE, elle ne monte pas avec la clarté", () => {
    // LA SIGNATURE DU MODÈLE, et ce qu'aucun dégradé peint ne produit
    // naturellement. Trois saturations exponentielles à vitesses différentes
    // donnent forcément une BOSSE : au pied de la coulée tout est faible donc
    // l'écart absolu R-B est petit ; à mi-course le rouge sature quand le bleu
    // traîne, donc l'écart est maximal ; au cœur les trois saturent et l'image
    // revient vers le blanc.
    //
    // Mesuré sur la référence, par tranches de 26 niveaux de luminance :
    //   15,0 · 25,7 · 37,4 · 30,9 · 58,4 · 64,7 · 67,0 · 60,9 · 45,9 · 27,8
    // Une rampe peinte du rouge au blanc rendrait une suite DÉCROISSANTE, et une
    // rampe du blanc au rouge une suite croissante ; les deux échoueraient ici.
    const img = decodePng(readFileSync(path.join(REF_DIR, "effet-light-leak.png")));
    const seaux = Array.from({ length: 10 }, () => []);
    for (let i = 0; i < img.pixels.length; i += 4) {
      const L = 0.2126 * img.pixels[i] + 0.7152 * img.pixels[i + 1] + 0.0722 * img.pixels[i + 2];
      if (L < 8) continue;
      seaux[Math.min(9, Math.floor(L / 26))].push(img.pixels[i] - img.pixels[i + 2]);
    }
    const peuplées = seaux.filter((s) => s.length >= 200);
    expect(peuplées.length).toBe(10);
    const chaleurs = peuplées.map((s) => s.reduce((a, b) => a + b, 0) / s.length);

    const sommet = chaleurs.indexOf(Math.max(...chaleurs));
    // Le sommet est INTÉRIEUR : ni au pied ni au cœur de la coulée.
    expect(sommet).toBeGreaterThan(0);
    expect(sommet).toBeLessThan(chaleurs.length - 1);
    // Et il domine franchement les deux extrémités. Mesuré : 4,5x le pied et
    // 2,4x le cœur ; le seuil est à 1,8x, donc sous les deux avec de la marge
    // des deux côtés.
    expect(chaleurs[sommet]).toBeGreaterThan(1.8 * chaleurs[0]);
    expect(chaleurs[sommet]).toBeGreaterThan(1.8 * chaleurs[chaleurs.length - 1]);
  });

  it("dégradé radial : l'empreinte du masque est un CERCLE sur une toile 320 × 192", () => {
    // CE QUE CETTE PAIRE TIENT, et pourquoi elle est sur une toile qui n'est
    // PAS carrée. L'espace UV n'est pas isotrope : un rayon exprimé en UV
    // donne 80 px sur un axe et 133 sur l'autre. Sur une toile carrée, un
    // radial sans correction d'aspect rendrait quand même un cercle — la
    // référence verrouillerait alors une propriété par accident, et le défaut
    // n'apparaîtrait que chez l'utilisateur, sur sa photo 3:2.
    //
    // La mesure est la boîte englobante des pixels que le masque CHANGE :
    // l'écart entre l'image masquée et son témoin sans masque est l'empreinte
    // du masque, et rien d'autre.
    const avec = decodePng(readFileSync(path.join(REF_DIR, "masque-degrade-radial.png")));
    const sans = decodePng(readFileSync(path.join(REF_DIR, "masque-degrade-radial-temoin.png")));
    expect(avec.width).toBe(320);
    expect(avec.height).toBe(192);

    let minX = Infinity, maxX = -1, minY = Infinity, maxY = -1;
    for (let y = 0; y < avec.height; y++) {
      for (let x = 0; x < avec.width; x++) {
        const i = (y * avec.width + x) * 4;
        const ecart = Math.max(
          Math.abs(avec.pixels[i] - sans.pixels[i]),
          Math.abs(avec.pixels[i + 1] - sans.pixels[i + 1]),
          Math.abs(avec.pixels[i + 2] - sans.pixels[i + 2]),
        );
        if (ecart < 8) continue;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    const largeur = maxX - minX + 1;
    const hauteur = maxY - minY + 1;

    // Mesuré : 132 × 134 px, soit un rapport de 0,985. ⚠️ LE SEUIL EST CALÉ EN
    // REJOUANT LE DÉFAUT : en remplaçant le facteur d'aspect par (1, 1), la
    // même scène rend 132 × 80, soit 1,650 — exactement l'aspect de la toile
    // (320/192 = 1,667). Une tolérance de 10 % est donc six fois plus serrée
    // que l'écart qu'elle doit attraper.
    expect(largeur).toBeGreaterThan(100);
    expect(largeur / hauteur).toBeGreaterThan(0.9);
    expect(largeur / hauteur).toBeLessThan(1.1);
  });

  it("overlay de masque : sur un masque par tonalité, le contour est une LIGNE et pas une surface", () => {
    // LA PROPRIÉTÉ QUE CETTE PAIRE EXISTE POUR TENIR. Le contour du safelight
    // s'allume là où le masque traverse 0,5. Sur un masque PEINT il ne le
    // traverse qu'une fois, sur une frontière franche. Sur un masque par
    // TONALITÉ posé sur une image bruitée, il le traverse des milliers de fois
    // — une par grain — et sans le lissage à 25 taps introduit le 2026-08-13,
    // le motif de pointillés remplit la SURFACE de la zone de transition au
    // lieu de tracer une ligne. C'est ce qu'Antoine a vu, et c'était une ligne
    // de contour qui avait explosé.
    //
    // Comment on le mesure sans confondre le contour avec le voile : les
    // pointillés sont ACHROMATIQUES et EXTRÊMES (noir pur ou blanc pur), le
    // voile est rouge et modéré. Compter les pixels quasi-gris et quasi-saturés
    // sépare donc les deux sans les opposer par un seuil arbitraire sur l'écart.
    const extremesAchromatiques = (pixels) => {
      let n = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
        const v = (r + g + b) / 3;
        if (Math.abs(r - g) < 10 && Math.abs(g - b) < 10 && (v < 30 || v > 225)) n++;
      }
      return n / (pixels.length / 4);
    };

    const avec = decodePng(readFileSync(path.join(REF_DIR, "masque-overlay-tonalite.png")));
    const sans = decodePng(readFileSync(path.join(REF_DIR, "masque-overlay-tonalite-temoin.png")));

    // Mesuré : 0,00 % dans le témoin. L'image sous l'overlay — deux paliers
    // gris bruités — n'a aucun pixel extrême, donc tout ce qu'on compte
    // ensuite vient de l'overlay et de lui seul.
    expect(extremesAchromatiques(sans.pixels)).toBeLessThan(0.0005);

    // Mesuré : 0,19 %. La frontière fait 256 px de haut ; une ligne d'un pixel
    // dont un pointillé sur deux est allumé en occupe ~0,2 % de l'image.
    const part = extremesAchromatiques(avec.pixels);
    // Le contour EXISTE.
    expect(part).toBeGreaterThan(0.0005);
    // Et il reste une LIGNE. ⚠️ LE SEUIL N'EST PAS CHOISI AU JUGÉ : la
    // régression a été REJOUÉE pour le caler. En remplaçant `mLisse` par la
    // valeur brute du masque — c'est-à-dire en retirant le lissage — la même
    // scène rend un quadrillage de hachures sur tout le quadrant supérieur
    // droit, et cette mesure passe de 0,19 % à 2,03 %. Le seuil est à 0,8 % :
    // quatre fois au-dessus du rendu correct, deux fois et demie sous le rendu
    // fautif. La référence de pixels, elle, voit le même défaut à 162 valeurs
    // d'écart maximum — les deux gardes tombent ensemble, par des chemins
    // différents.
    expect(part).toBeLessThan(0.008);
  });

  /* ── COLORED EDGES : la roue doit être PERCEPTUELLEMENT régulière (2026-08-02)
   *
   * L'effet promet « la teinte vient de l'orientation du bord ». En HSL, il
   * livrait « la teinte ET la clarté viennent de l'orientation » : un seul
   * curseur Clarté, et la clarté réellement perçue balayait un tiers de
   * l'échelle selon la direction du contour. C'est ce que le verdict d'usage
   * appelait « horrible ».
   *
   * La mesure ne peut se faire que sur les pixels PLEINEMENT encrés. Un pixel
   * de bord partiellement couvert est mélangé au papier : sa clarté parle de la
   * COUVERTURE, pas de la couleur de l'encre. Sans cette restriction, la mesure
   * répond à une autre question que celle qu'on pose — première version de ce
   * relevé, qui donnait une étendue de chroma en hausse après le correctif alors
   * que l'encre, elle, n'avait pas bougé.
   */
  const oklchDe = (r8, g8, b8) => {
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const r = lin(r8 / 255), g = lin(g8 / 255), b = lin(b8 / 255);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
    const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    const h = Math.atan2(B, A) / (2 * Math.PI);
    return { L, C: Math.hypot(A, B), h: h - Math.floor(h) };
  };

  it("colored-edges : la clarté de l'encre ne dépend PAS de l'orientation du bord", () => {
    const img = decodePng(readFileSync(path.join(REF_DIR, "effet-outlines-roue.png")));
    const tous = [];
    for (let i = 0; i < img.pixels.length; i += 4) {
      tous.push(oklchDe(img.pixels[i], img.pixels[i + 1], img.pixels[i + 2]));
    }
    // Pleine encre : à 90 % du chroma maximal observé. En dessous, le pixel est
    // mélangé au papier et ne renseigne pas sur la couleur posée.
    const cmax = tous.reduce((m, c) => Math.max(m, c.C), 0);
    const seaux = new Map();
    for (const c of tous) {
      if (c.C < 0.9 * cmax) continue;
      const k = Math.floor(c.h * 12);
      if (!seaux.has(k)) seaux.set(k, []);
      seaux.get(k).push(c.L);
    }
    const clartes = [...seaux.values()]
      .filter((g) => g.length >= 30)
      .map((g) => g.reduce((s, x) => s + x, 0) / g.length);

    // Au moins quatre secteurs de teinte peuplés, sinon la mesure ne porte sur
    // rien — une roue qui se serait effondrée sur une seule teinte passerait
    // l'étendue haut la main.
    expect(clartes.length).toBeGreaterThanOrEqual(4);

    // AVANT la refonte OKLCH : 0,290. APRÈS : 0,018. La borne est à 0,05, donc
    // à cinq fois sous l'ancienne valeur et au double de la nouvelle — ce test
    // aurait rougi sur la construction HSL, ce qui en fait une mesure.
    const etendue = Math.max(...clartes) - Math.min(...clartes);
    expect(etendue).toBeLessThan(0.05);
  });

  /* ── OUTLINES : un contour réel doit sortir PLEIN, le bruit ne doit rien
   * dessiner (2026-08-03)
   *
   * D'où : « outlines semble buggé, l'effet n'est pas très raffiné ». La mire
   * commune ne pouvait pas répondre — tous ses bords sont très au-dessus du
   * seuil, donc ils saturaient avant comme après. Il a fallu une mire à aplats
   * BRUITÉS et à deux marches de contrastes différents (0,32 et 0,14).
   *
   * AVANT correctif, sur cette mire :
   *   aplat bruité      0,0 % d'encre   (déjà bon)
   *   marche de 0,32   52,2 %           jamais le noir, et granuleuse
   *   marche de 0,14    4,9 %           invisible
   *   soit un rapport de 10,6 pour un rapport de contraste de 2,3.
   *
   * La cause était une échelle : `band = softness * 0.5` valait 0,175 au défaut
   * quand un contour franc de cette mire ne produit qu'un `mag` de 0,16. La
   * rampe du smoothstep était plus large que tout le signal utile. Rendue
   * proportionnelle au SEUIL, elle tranche de nouveau.
   */
  it("outlines : les deux contours sortent PLEINS, et le bruit ne dessine rien", () => {
    const img = decodePng(readFileSync(path.join(REF_DIR, "effet-outlines-bruit.png")));
    const { width: w, pixels } = img;
    const L = (x, y) => pixels[(y * w + x) * 4];
    /** Encre au plus fort, sur une fenêtre traversant le trait. 0 = noir plein. */
    const creux = (fixe, de, a, vertical) => {
      let m = 255;
      for (let k = de; k <= a; k++) m = Math.min(m, vertical ? L(k, fixe) : L(fixe, k));
      return m;
    };

    // Les deux marches, échantillonnées loin de leur croisement.
    const vertical = [];
    for (let y = 20; y < 110; y++) vertical.push(creux(y, 78, 92, true));
    const horizontal = [];
    for (let x = 140; x < 250; x++) horizontal.push(creux(x, 120, 136, false));

    // PLEINS : le contour le plus faible des deux atteint quand même l'encre.
    // Avant le correctif, la marche de 0,14 plafonnait à 4,9 %.
    const encre = (a) => 100 * (255 - a.reduce((s, v) => s + v, 0) / a.length) / 255;
    expect(encre(vertical)).toBeGreaterThan(95);
    expect(encre(horizontal)).toBeGreaterThan(90);

    // Et le bruit ne dessine RIEN. Sans cette seconde borne, un effet qui
    // encrerait toute l'image passerait le test ci-dessus haut la main — c'est
    // la moitié de la mesure qui empêche de « corriger » en baissant le seuil.
    let aplat = 0, n = 0;
    for (let y = 20; y < 100; y++) {
      for (let x = 150; x < 240; x++) { aplat += 255 - L(x, y); n++; }
    }
    expect(100 * (aplat / n) / 255).toBeLessThan(1);
  });

  /* ── ECHO OUTLINES : les échos sont ÉQUIDISTANTS (2026-08-03) ──────────────
   *
   * C'est LA propriété qui sépare cet effet d'un simple tracé de lignes de
   * niveau — celles-ci se resserrent là où le champ est raide, donc leur
   * espacement varierait le long de la coupe. La fiche de référence est
   * explicite : « a series of EVENLY SPACED outlines ».
   *
   * ⚠️ LA MESURE DOIT ÊTRE PERPENDICULAIRE. Une coupe verticale à travers des
   * anneaux diagonaux lit `espacement / cos θ`, pas l'espacement. La première
   * version de ce relevé l'ignorait et accusait l'effet d'une dispersion qui
   * était en partie la sienne — on estime donc la pente locale de chaque anneau
   * sur une colonne voisine, et on projette.
   *
   * Historique des mesures, qui est aussi celui des trois correctifs :
   *   estimation affine, pas d'un texel   moyenne 13,4 px   dispersion 32 %
   *   + linéarisation logit               moyenne 18,6 px   dispersion 34 %
   *   + zone de confiance élargie         moyenne 18,5 px   dispersion  8 %
   * pour un espacement DEMANDÉ de 18 px.
   */
  it("outlines-echos : les anneaux sont équidistants, à l'espacement demandé", () => {
    // ⚠️ CETTE MESURE EST LA SEULE SURVIVANTE D'`echoOutlines`, absorbé par
    // `outlines` le 2026-08-03 (ADR-0015) — l'effet n'avait pas de fichier de
    // test unitaire, donc l'équidistance ne se vérifiait QUE d'ici. La renommer
    // avec sa référence était le geste à ne pas rater : une propriété qu'un
    // seul test porte disparaît avec le fichier qui le porte.
    const img = decodePng(readFileSync(path.join(REF_DIR, "effet-outlines-echos.png")));
    const { width: w, height: h, pixels } = img;
    const L = (x, y) => pixels[(y * w + x) * 4];

    /** Ordonnées des centres de trait sur une colonne. */
    const centres = (x) => {
      const out = [];
      let debut = null;
      for (let y = 0; y < h; y++) {
        const sombre = L(x, y) < 128;
        if (sombre && debut === null) debut = y;
        if (!sombre && debut !== null) { out.push((debut + y - 1) / 2); debut = null; }
      }
      return out;
    };

    const DX = 6;
    const ecarts = [];
    for (const x of [30, 60, 90, 120, 150, 180]) {
      const a = centres(x), b = centres(x + DX);
      if (a.length !== b.length || a.length < 2) continue;
      for (let i = 0; i < a.length - 1; i++) {
        // Pente de l'anneau i (px de y par px de x) -> projection perpendiculaire.
        const p = (b[i] - a[i]) / DX;
        ecarts.push((a[i + 1] - a[i]) / Math.sqrt(1 + p * p));
      }
    }

    // Assez d'anneaux appariés pour que la statistique veuille dire quelque
    // chose. Un effet qui n'en tracerait qu'un passerait sinon sans rien dire.
    expect(ecarts.length).toBeGreaterThanOrEqual(8);

    const moyenne = ecarts.reduce((s, v) => s + v, 0) / ecarts.length;
    const ecartType = Math.sqrt(ecarts.reduce((s, v) => s + (v - moyenne) ** 2, 0) / ecarts.length);

    // L'espacement OBTENU est celui qu'on a DEMANDÉ (18 px dans le scénario).
    // Sans cette borne, des anneaux régulièrement espacés à 40 px passeraient
    // le test de dispersion en ne respectant aucun réglage.
    expect(moyenne).toBeGreaterThan(16);
    expect(moyenne).toBeLessThan(20);

    // ÉQUIDISTANTS. La borne à 15 % est à deux fois sous la dispersion de
    // l'estimation affine (32 %) et à deux fois au-dessus de celle mesurée
    // (8 %) — elle aurait rougi sur les deux implémentations précédentes.
    expect(ecartType / moyenne).toBeLessThan(0.15);
  });

  /* ── DITHER : les deux styles rendent la rampe, et ne sont PAS le même code ──
   *
   * Un tramage existe pour rendre un dégradé avec peu de niveaux. À deux
   * niveaux, la seule information qui reste est la DENSITÉ locale de points —
   * c'est elle, et rien d'autre, qui doit suivre la rampe.
   */
  const densiteParColonne = (fichier, bandes = 8) => {
    const img = decodePng(readFileSync(path.join(REF_DIR, fichier)));
    const { width: w, height: h, pixels } = img;
    const out = [];
    for (let b = 0; b < bandes; b++) {
      let sombres = 0, total = 0;
      for (let y = 0; y < h; y++) {
        for (let x = Math.floor((b * w) / bandes); x < Math.floor(((b + 1) * w) / bandes); x++) {
          if (pixels[(y * w + x) * 4] < 128) sombres++;
          total++;
        }
      }
      out.push(sombres / total);
    }
    return out;
  };

  /** Les six styles, dans l'ordre où la chaîne de scénarios les compare. */
  const STYLES_DITHER = [
    "effet-dither.png",
    "effet-dither-bruit-bleu.png",
    "effet-dither-bayer-fin.png",
    "effet-dither-bruit-blanc.png",
    "effet-dither-lignes.png",
    "effet-dither-points.png",
  ];

  for (const fichier of STYLES_DITHER) {
    it(`${fichier} : la densité d'encre suit la rampe, de façon monotone`, () => {
      const d = densiteParColonne(fichier);
      // La mire va du sombre (gauche) au clair (droite) : la densité d'encre ne
      // doit JAMAIS remonter. Une erreur de signe la donnerait croissante.
      //
      // ⚠️ NON-CROISSANT et non strictement décroissant. Première version de ce
      // test, qui exigeait le strict : elle échouait sur les styles à motif
      // grossier (Lignes, Points groupés), dont les deux premières bandes sont
      // toutes deux SATUREES en noir. Une saturation aux extrêmes est le
      // comportement correct d'une quantification, pas un défaut — c'est
      // l'assertion qui était fausse.
      for (let i = 1; i < d.length; i++) expect(d[i]).toBeLessThanOrEqual(d[i - 1]);

      // La course est réellement parcourue, d'un quasi-plein à un quasi-vide.
      // C'est CETTE paire, et non la monotonie, qui interdit la suite plate
      // qu'une trame posée à densité fixe produirait.
      expect(d[0]).toBeGreaterThan(0.8);
      expect(d[d.length - 1]).toBeLessThan(0.2);

      // Et la décroissance est PROGRESSIVE : au moins la moitié des marches
      // descendent vraiment. Sans ça, un effet qui basculerait d'un coup du
      // plein au vide — un seuil unique déguisé en trame — passerait les trois
      // bornes ci-dessus.
      const marches = d.slice(1).filter((v, i) => v < d[i] - 0.001).length;
      expect(marches).toBeGreaterThanOrEqual(Math.floor((d.length - 1) / 2));
    });
  }

  it("dither : les six styles rendent six images DIFFÉRENTES, deux à deux", () => {
    // Le test qui empêche qu'un style soit branché sur la fonction d'un autre —
    // panne qu'aucun test unitaire ne verrait, tous les shaders compilant et
    // tous les paramètres étant câblés. Comparaison DEUX À DEUX et pas
    // seulement de proche en proche : une chaîne où seul le 3e et le 5e
    // coïncideraient passerait une comparaison au voisin.
    const images = STYLES_DITHER.map((f) => decodePng(readFileSync(path.join(REF_DIR, f))).pixels);
    for (let i = 0; i < images.length; i++) {
      for (let j = i + 1; j < images.length; j++) {
        let differents = 0;
        for (let k = 0; k < images[i].length; k += 4) {
          if (images[i][k] !== images[j][k]) differents++;
        }
        const part = differents / (images[i].length / 4);
        expect(part, `${STYLES_DITHER[i]} vs ${STYLES_DITHER[j]}`).toBeGreaterThan(0.02);
      }
    }
  });

  /* ── ISOLINES : la largeur du trait est celle DEMANDÉE, pas celle de la pente
   *
   * C'est toute la promesse de l'effet, et ce qui le sépare d'un `posterize`
   * suivi d'un détecteur de contours : là-bas l'épaisseur suit le gradient local
   * — une bande dans un ciel doux, un cheveu sur une arête. Une carte dont
   * l'épaisseur dirait la pente au lieu de l'altitude n'est pas une carte.
   *
   * ⚠️ LA COUVERTURE SE MESURE EN LUMIÈRE LINÉAIRE. La composition
   * `mix(papier, encre, c)` se fait en linéaire, donc une couverture de 0,5 sort
   * à 0,735 en sRGB. Sommer les valeurs sRGB sous-compte les bords — première
   * version de ce relevé, qui donnait 1,60 px pour 2 px demandés et accusait
   * l'effet d'un déficit de 20 % qui était dans l'instrument.
   */
  const largeursDeTraits = (fichier, y = 128) => {
    const img = decodePng(readFileSync(path.join(REF_DIR, fichier)));
    const { width: w, pixels } = img;
    const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const out = [];
    let debut = null, somme = 0;
    for (let x = 0; x < w; x++) {
      const encre = 1 - lin(pixels[(y * w + x) * 4] / 255);
      if (encre > 0.02) {
        if (debut === null) { debut = x; somme = 0; }
        somme += encre;
      } else if (debut !== null) {
        out.push({ centre: (debut + x - 1) / 2, largeur: somme });
        debut = null;
      }
    }
    return out;
  };

  it("isolines : tous les traits font l'épaisseur demandée", () => {
    // Scénario : `thickness: 2`, courbe maîtresse désactivée.
    const traits = largeursDeTraits("effet-isolines.png");
    expect(traits.length).toBeGreaterThanOrEqual(8);
    const l = traits.map((t) => t.largeur);
    const moyenne = l.reduce((s, v) => s + v, 0) / l.length;
    const ecartType = Math.sqrt(l.reduce((s, v) => s + (v - moyenne) ** 2, 0) / l.length);

    // L'épaisseur OBTENUE est celle DEMANDÉE. Une largeur pilotée par la pente
    // n'aurait aucune raison de tomber sur le réglage — c'est la borne qui
    // distingue vraiment cet effet de l'empilement.
    expect(moyenne).toBeGreaterThan(1.8);
    expect(moyenne).toBeLessThan(2.2);
    // Et elle est la MÊME partout. Mesuré : 5,1 % de dispersion.
    expect(ecartType / moyenne).toBeLessThan(0.12);
  });

  it("isolines : une courbe sur quatre est une maîtresse, au rapport demandé", () => {
    // Scénario : `majorEvery: 4`, `majorWidth: 2.6`.
    const l = largeursDeTraits("effet-isolines-maitresses.png").map((t) => t.largeur);
    // Deux populations franches, et pas un continuum : c'est ce qui rend un
    // faisceau comptable à l'œil sur une carte.
    const grosses = l.filter((v) => v > 3.5);
    const fines = l.filter((v) => v > 1 && v <= 3.5);
    expect(grosses.length).toBeGreaterThanOrEqual(2);
    expect(fines.length).toBeGreaterThanOrEqual(6);

    const moy = (a) => a.reduce((s, v) => s + v, 0) / a.length;
    // Rapport mesuré : 2,66 pour 2,6 demandé. Les bornes tiennent l'échantillon
    // partiel des bords d'image sans laisser passer un rapport de 1 (mécanisme
    // mort) ni de 4 (mauvais facteur).
    const rapport = moy(grosses) / moy(fines);
    expect(rapport).toBeGreaterThan(2.2);
    expect(rapport).toBeLessThan(3.1);
  });

  it("gooey-merge : le liseré spéculaire couvre plus d'un pixel", () => {
    // AVANT correctif (`crest` dérivé de `coverage`, donc culminant sur un seul
    // pixel dès que la tension monte — et le scénario est à tension 1, le pire
    // cas) : 103 / 95 / 85 / 60 filaments aux quatre seuils. APRÈS : 0 partout.
    // Ce test aurait donc rougi sur l'implémentation précédente à n'importe
    // lequel des quatre seuils, ce qui en fait une mesure et pas une décoration.
    //
    // La borne est à 5 et non à 0 : elle doit tenir un changement de pilote ou
    // d'arrondi sans devenir une alarme, tout en restant à vingt fois sous le
    // chiffre qu'elle a attrapé.
    for (const seuil of [16, 24, 32, 48]) {
      expect(filaments("effet-gooey-merge.png", seuil)).toBeLessThanOrEqual(5);
    }
  });
});
