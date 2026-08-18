# Quels mécanismes de lisibilité adopter

Type: grilling
Status: claimed
Blocked by: 09
Parent: ../map.md

## Question

[Ce que Photoshop et Lightroom rendent lisible](09-ce-que-photoshop-et-lightroom-rendent-lisible.md)
a rendu **31 mécanismes** sourcés, chacun avec son point d'accroche dans notre
code et son coût — voir
[`research/09-lisibilite-photoshop-lightroom.md`](../research/09-lisibilite-photoshop-lightroom.md).

**Lesquels adopter, et lesquels refuser ?**

Le fichier de recherche n'arbitre rien, c'est ce ticket qui le fait. Il ne se
lit pas en entier avant de commencer : prendre les cinq à meilleur rapport
d'abord, puis la question de fond ci-dessous.

## Les cinq à trancher en premier

Tous à accrochage existant, aucun ne demande de nouvelle architecture :

1. **Retour au défaut** — double-clic sur le nom d'un curseur, Alt-clic pour
   tout le groupe. Donnerait enfin une fonction à `EffectSection.label`,
   aujourd'hui purement décoratif.
2. **Avant/après par touche maintenue** — `framePipelineExecutor.ts:313` filtre
   déjà sur `layer.enabled`, donc ni passe ni shader nouveau.
3. **Mode Solo des cartes** — borne le NOMBRE de cartes ouvertes, là où
   ADR-0001 ne borne que leur hauteur. C'est un complément à la règle, pas un
   contournement.
4. **Un œil par section** — quatre fonctions (lire, comparer, éteindre,
   remettre au défaut) sur une seule case.
5. **Filtre par nom dans Presets et Textures** — le patron est déjà écrit dans
   `EffectPicker`. Mesuré le 2026-08-11 : `PresetPanel.tsx:110` n'a qu'un champ
   de SAISIE (« Nom du preset »), `TextureLibrary.tsx` n'a rien.

## La question de fond, qui vaut plus que les cinq

Lightroom **fane et met en italique** un preset inapplicable au lieu de le
retirer — et fait du retrait une PRÉFÉRENCE de l'utilisateur. Nous avons
choisi l'inverse : `EffectParam.appliesWhen` masque.

Le chantier des contrôles a été soldé le 2026-08-05 sur ce choix, et ses
corollaires sont écrits dans `CLAUDE.md` (masquer ne borne pas ; un paramètre
qu'aucune section ne cite n'est pas un défaut). **Une troisième voie existe et
n'a jamais été instruite.** Faner au lieu de masquer garde la découvrabilité —
on voit qu'un réglage existe et pourquoi il dort — au prix de la densité, que
ADR-0001 protège. Ce ticket est le bon endroit pour la peser, une fois, plutôt
que de la redécouvrir dans six mois.

## Contraintes dures

- **ADR-0001** : un contrôle qui se répète par ligne devient UN contrôle dans
  une zone fixe hors du conteneur défilant. Jamais un défilement de colonne.
- **Le dock est content-sized, sans splitter.** `react-resizable-panels` a été
  RETIRÉ le 2026-07-21 ; ne rien proposer qui le suppose.
- **`components/` ne porte aucune logique métier.** Cette frontière ne bouge
  pas pour ajouter un geste.
- **`test:render` doit rendre zéro écart** après tout travail de panneau —
  c'est le gate discriminant : un écart prouve qu'on a touché au rendu en
  croyant toucher à l'affichage.

## Trois choses où nous faisons MIEUX qu'eux

À ne pas dégrader en copiant, et à vérifier avant d'adopter un mécanisme qui
les toucherait : un masque **par effet** (Photoshop n'en a qu'un pour toute sa
chaîne de Smart Filters), une applicabilité **déclarée et relue** par
`validateEffect`, et `EffectParam.maxFrom`, dont Spectrum n'a pas d'équivalent.

---

## État au 2026-08-18 — quatre adoptés, la question de fond en attente d'un œil

### Les cinq accrochages, vérifiés sur disque avant d'être proposés

Tous exacts. Deux valent d'être notés parce qu'ils étaient plus favorables que
le ticket ne le disait :

- `EffectPicker` porte bien le patron de filtre complet (`query` +
  `buildEffectCatalog(effectRegistry, query)`), donc il est copiable tel quel ;
  `PresetPanel` n'a qu'un champ de SAISIE de nom, et **`TextureLibrary` n'a
  aucun champ** — zéro occurrence d'`input`.
- `LayerPanel:40-45` porte **déjà l'Alt-clic d'isolation** sur l'œil d'un
  calque, sans toucher la visibilité stockée. Le patron du Solo existe donc un
  cran plus bas que la carte : le mode Solo des cartes le remonte, il ne
  l'invente pas.

### Adoptés par Antoine

1. **Filtre par nom** dans Presets et Textures.
2. **Avant/après par touche maintenue.**
3. **Retour au défaut** par double-clic (Alt-clic pour le groupe) — donne enfin
   une fonction à `EffectSection.label`, dont `ParamPanel:214` ne se sert
   aujourd'hui que pour afficher.
4. **Mode Solo des cartes du dock.**

⚠️ **Le cinquième — « un œil par section » — N'A PAS ÉTÉ PROPOSÉ**, par mon
oubli : la question n'en offrait que quatre. Il reste à trancher, et il n'est
pas neutre puisqu'il empile quatre fonctions (lire, comparer, éteindre, remettre
au défaut) sur une seule case.

### La question de fond : planche demandée, planche faite

Antoine n'a pas tranché faner-ou-masquer sur le raisonnement — il a demandé à
voir. Planche : [`docs/wireframes/faner-ou-masquer.html`](../../../docs/wireframes/faner-ou-masquer.html).

Cas montré : `glass` sur la matière **Poli**. Choisi parce que c'est le pire cas
réel du registre — 22 paramètres, 3 sections, **14 conditions**, dont la section
*Pavé* entière ; à « Poli », **13 des 22 paramètres n'ont aucun objet**. Libellés,
conditions et tokens extraits du code, pas reconstitués (l'extraction est passée
par vitest, le grep mentant sur ces structures).

**La planche se MESURE elle-même** — les hauteurs sont lues au rendu, jamais
écrites à la main, précisément parce qu'un chiffre de densité se périme au
premier ajustement de padding.

| Variante | Contrôles | Hauteur de carte | Écart | Part du budget de colonne (1345 px) |
| --- | --- | --- | --- | --- |
| **A** — masquer (en vigueur) | 9 | **445 px** | — | 33,1 % |
| **B** — faner tout | 22 | **1030 px** | **+585 px** | **76,6 %** |
| **C** — faner en section, repliée | 9 | **489 px** | +44 px | 36,4 % |

**Ce que le chiffre dit et que le raisonnement ne disait pas** : B ne coûte pas
« un peu de densité », il consomme **les trois quarts du budget de colonne avec
UNE carte** — et la colonne en empile plusieurs. C, lui, coûte **44 px**, un
dixième de A.

L'écart entre B et C ne vient pas du nombre de conditions mais de leur
RÉPARTITION : les 8 paramètres de *Pavé* sont groupés, donc une seule ligne
repliée les remplace ; les 5 isolés de *Matière* ne se replient pas.

### Ce qui reste à trancher, et qui attend Antoine

- **Faner ou masquer**, devant la planche.
- **Le cinquième mécanisme** (un œil par section), non proposé par erreur.

Le ticket reste ouvert tant que ces deux-là ne sont pas répondus.
