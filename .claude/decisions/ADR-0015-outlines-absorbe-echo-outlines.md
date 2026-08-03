---
id: ADR-0015
status: active
date: 2026-08-03
---

# ADR-0015 : `outlines` absorbe `echoOutlines` (mode de détection)

## Contexte

Cette fusion était **décidée depuis ADR-0013** (même arbitrage d'Antoine, même
journée) et explicitement rangée sous « Ce qui N'EST PAS fait, et pourquoi ». Le
blocage n'était pas du temps mais une capacité : `echoOutlines` porte neuf passes
de pyramide, `outlines` n'en avait aucune, et `runInternalPasses` itérait
`effect.passes!` sans condition. Fusionner en l'état aurait fait tourner la
pyramide entière en mode Crête de gradient, pour n'en rien lire — sur 24 Mpx, la
seule cible à l'échelle 0,5 pèse 24 Mo, et la VRAM est un risque ouvert déclaré.

**La capacité est arrivée le jour même, par un autre chemin** : `EffectPass.enabled`
(commit `d17acdd`), un prédicat sur les paramètres résolus, évalué AVANT
d'emprunter une cible au pool. Le blocage a disparu sans que cette fusion en soit
la cause.

Le reste du dossier était déjà instruit. Les deux effets répondent à la même
question — « où passe le trait ? » — et diffèrent par ce qu'ils demandent à
l'image :

- **Crête de gradient** : « où l'image CHANGE-t-elle ? » (magnitude de Scharr)
- **Seuil de forme** : « où est la FRONTIÈRE du niveau demandé ? » (isoligne)
- **Échos de la forme** : « à quelle DISTANCE de cette frontière suis-je ? »

Seule la troisième échappe à un opérateur local, d'où la pyramide.

## Décision

`echoOutlines` est absorbé par `outlines` sous la forme d'un troisième choix du
paramètre `detectMode` existant — *Échos de la forme*, ajouté **à la fin** de la
liste, l'index étant persisté dans les presets.

Trois contraintes ont commandé la forme exacte :

1. **Les dix-neuf premiers index sont ceux d'avant, inchangés.** Sept références
   de pixels et tous les presets `outlines` en dépendent. Les sept paramètres
   neufs sont ajoutés à la suite, et `detectMode` garde son défaut historique.
2. **La fusion devait être PROUVÉE sans perte.** Le scénario de rendu
   d'`echoOutlines` a été porté sur `outlines` en transposant ses réglages
   (`inputMode` → `inputSource` avec son remappage d'index, `count` →
   `echoCount`, `thickness` → celui d'`outlines`, `startHue/Saturation/Lightness`
   → `inkHue/inkSaturation/inkLightness`), le tout en mode 2. **L'image est
   ressortie identique à l'octet** — `aucun ecart` contre la référence produite
   par l'effet retiré, et `git mv` a détecté le renommage à 100 %.
3. **Les neuf passes portent un prédicat sur `detectMode`.** Hors mode Échos,
   elles sont écartées avant toute allocation, et `prevPass` reçoit la texture
   source (comportement documenté d'`EffectPass.enabled`). Comme
   `framePipelineExecutor` lie `prevPass` dès que l'effet **déclare** des passes
   et non dès qu'il en exécute, les trois modes partagent **une seule variante de
   shader**, donc une seule entrée de cache de pipeline.

**Sept paramètres neufs sur dix-huit**, parce que onze se recouvrent réellement :
le seuil de la forme EST le seuil, l'épaisseur du trait EST l'épaisseur, la
couleur du premier écho EST l'encre, et l'effacement, le fond et le remplissage
existaient déjà à l'identique. Ne restent que le lissage, l'espacement, le nombre
d'échos, l'atténuation et les trois composantes du dernier écho.

## Conséquences

- **L'id `echoOutlines` disparaît** : un preset qui le cite perd ce calque avec un
  avertissement, jamais une exception (même mécanisme qu'ADR-0011 à 0014).
- **`MAX_EFFECT_PARAMS` passe de 24 à 32.** `outlines` monte à 26 paramètres. La
  marge visée reste celle des deux élargissements précédents : 6 slots au-dessus
  du plus gourmand. Coût réel : 96 → 128 octets d'uniforme par passe et par frame.
- **`outlines.threshold` voit son maximum passer de 0,6 à 1** — et ce n'est pas
  seulement un besoin du mode Échos. Les deux scénarios du Seuil de forme
  verrouillaient déjà `threshold: 0.8` : `updateParams` ne borne pas, mais
  `ParamPanel` borne le curseur à `param.max`. **Les références figeaient donc un
  rendu inaccessible depuis l'interface.** Le plafond était calibré pour un
  CONTRASTE minimal ; il n'avait plus de sens depuis que le même curseur sert de
  NIVEAU de seuillage.
- **`outlines.thickness` voit son maximum passer de 12 à 40 px**, la course de
  l'effet absorbé. Aucune valeur existante ne change de rendu ; seule la course du
  curseur s'allonge, dans les trois modes puisque le paramètre est le même.
- **Le mode Échos paie huit taps de Scharr qu'il ne lit pas.** `fwidth(mag)` exige
  un flux de contrôle uniforme, donc le gradient reste hoisté avant toute branche
  (contrainte déjà posée par ADR-0013). Huit taps contre neuf passes pleine
  chaîne : le rapport ne justifiait pas de fragiliser l'antialiasing des deux
  autres modes.
- **La question de NOM que le cahier de références laissait ouverte s'éteint.**
  Elle venait de ce que « Outlines » désignait deux choses — l'effet à échos chez
  Figma, le détecteur chez nous. Il n'y en a plus qu'une, et elle contient les
  deux lectures. Aucun nom d'affichage à arbitrer.
- **Le registre passe de vingt à dix-neuf effets.**
- **`edgeGradient.ts` n'a plus qu'un lecteur** et reste néanmoins un fichier à
  part : c'est la copie qui coûte, pas le fichier, et le prochain effet à bords
  doit trouver le noyau et sa preuve d'isotropie ailleurs que dans les 500 lignes
  d'`outlines.ts`.

## Ce qui a été rapatrié plutôt que perdu

`echoOutlines` n'avait **aucun fichier de test unitaire** : ses propriétés
vivaient dans son en-tête et dans une seule mesure, l'équidistance des anneaux
(`test/scripts/renderRefs.test.mjs`). Cette mesure a été renommée avec sa
référence au lieu de disparaître avec le fichier — le piège relevé lors du retrait
de `posterize`, où une décision rangée dans le test d'un effet s'en va avec lui.
Le prédicat des neuf passes est désormais verrouillé dans `outlines.test.ts`.

## Alternatives écartées

- **Garder les deux effets.** L'argument « deux entrées, deux intentions » vaut
  ici moins qu'ailleurs : les deux portaient déjà onze paramètres redondants, et
  la fiche de référence les désigne du même nom.
- **Ne pas élargir `MAX_EFFECT_PARAMS`, et réutiliser les paramètres de la roue
  d'orientation pour la couleur du dernier écho.** Trois slots gagnés, et un
  contrôle dont le sens change selon un autre mode — exactement la classe de
  confusion que le renommage `wheelChroma`/`wheelLightness` d'ADR-0013 venait
  d'écarter.
- **Faire du mode Échos un réglage du Seuil de forme (« nombre d'échos », 0 = un
  seul trait).** Séduisant, et faux : les deux ne mesurent pas la même chose. Le
  Seuil de forme lit une pente LOCALE, le mode Échos une distance obtenue par
  pyramide et linéarisée en espace logit. Un `count` à 0 sur la machinerie de
  pyramide ne redonnerait pas le trait local, et le confondre aurait fait payer
  neuf passes au cas simple.
