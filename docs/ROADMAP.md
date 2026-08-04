# Feuille de route — shaderlab

> **Ce document répond à une seule question : qu'est-ce qui RESTE ?**
> Le statut d'un chantier passé se lit dans `docs/INDEX.json`, les décisions
> tranchées dans `.claude/decisions/INDEX.md`, le vocabulaire dans `CONTEXT.md`.
> Ici, rien que l'ouvert.
>
> Écrit le 2026-08-04. Entretien : quand un bloc est soldé, il sort d'ici et son
> résultat va dans `INDEX.json` — pas de section « fait » qui s'accumule.
>
> ⚠️ **Deux sessions ont travaillé en parallèle sur `master` les 3 et 4 août** et
> se sont marché dessus sans dommage (le travail non commité de l'une a été
> ramassé par l'autre). Avant tout dispatch, `git worktree list` **et**
> `git log --oneline -3` : ce fichier peut retarder sur le code.

## Où en est le code — mesuré sur disque le 2026-08-04, pas de mémoire

- **21 effets** au registre (`src/render/effects/registry.ts`).
- `glass` **complet** : 14 matières (9 de feuille + 5 de pavé), 5 profils de
  section, **18 références de pixels — toutes les branches verrouillées**.
- Tout ce qui avait un plan exécutable est livré, testé, documenté, poussé.

**Il ne reste donc AUCUN code en attente d'un plan existant.** Ce qui suit se
répartit en trois natures très différentes : du jugement humain (1), un chantier
rouvert qui a son cadrage mais pas son plan (2), et un chantier qui n'a ni l'un
ni l'autre (3).

---

## 1. Reste immédiat — validation visuelle humaine

**Bloquant, et Antoine seul peut le faire.** Les sous-agents sont headless et le
canvas WebGPU rend noir en headless : la seule preuve possible est un checkpoint
humain sur la vraie fenêtre (`CLAUDE.md` § Méthode et § Moyen de preuve).

⚠️ **Point de méthode qui explique pourquoi ce bloc existe.** Une référence de
pixels prouve qu'un effet porte **sa propriété**, jamais qu'il est **beau**. Les
deux sont des questions distinctes ; le harnais ne répond qu'à la première, et
c'est la seconde qui est ouverte ici. Ne pas lire « 18 références vertes » comme
« le verre est validé ».

| # | Sujet | Ce qu'il faut juger |
| --- | --- | --- |
| 1 | **Courbes** | Fluidité ET esthétique, définitivement, sur une vraie photo |
| 2 | **Pile / Propriétés / Masque** | Le nouveau flux, sur une pile **dense** — c'est la densité qui est en question, pas le flux à deux calques |
| 3 | **Verre** | Les matières sur une vraie photo. Le **Dépoli** est marqué « à raffiner » par Antoine et n'a pas été retouché depuis |
| 4 | **Les cinq pavés** | À l'usage, et ajuster le rendu si besoin — livrés et verrouillés, jamais regardés sur une photo |

Protocole : `npm run dev:debug` puis `npm run dev:monitor`. Vérifier
`Get-Process -Name shaderlab` avant — le script tue toute instance de la machine.

⚠️ **Des Vite orphelins de sessions mortes squattent 1420/1421 et font échouer
`tauri dev` sur `Port 1420 is already in use`** (vécu le 2026-08-04, deux
instances datant des 1ᵉʳ et 2 août). Le symptôme ne nomme pas la cause : vérifier
les propriétaires des ports avant de conclure à autre chose.

---

## 2. Chantier ROUVERT — rationalisation des contrôles

**Pourquoi rouvert :** le travail précédent n'a traité que les contrôles
**spécialisés** (rampe de `gradientMap`, courbes, contrôles spatiaux). La
rationalisation **globale** des paramètres n'a jamais été faite, et le chantier a
été clôturé comme s'il l'était. C'est un manque de portée, pas un défaut de code.

Cadrage acquis, plan d'implémentation **à écrire**.

### Trois exigences fermes, sur les 21 effets

1. **Applicabilité conditionnelle.** Un contrôle sans effet dans la
   configuration courante se **masque**. Aujourd'hui il reste affiché et porte
   « Sans objet en … » dans son infobulle — un pis-aller assumé, écrit tel quel
   dans le plan du verre faute que `ParamPanel` sache masquer.
2. **Fusion** des réglages qui peuvent l'être.
3. **Ordre par catégories**, cohérent d'un effet à l'autre.

### Approche retenue : contrat DÉCLARATIF, jamais `if (effectId)` dans React

Chaque paramètre déclare sa catégorie et ses conditions d'applicabilité **dans
son module d'effet** ; `ParamPanel` ne fait qu'interpréter ce contrat,
uniformément. Une liste de cas particuliers dans le composant violerait la
frontière posée par `ARCHITECTURE.md` (« `components/` ne contient aucune
logique métier »).

**Le patron existe déjà deux fois dans le dépôt** — ce n'est pas une invention :
- `EffectPass.enabled` — une passe interne déclare qu'elle ne sert à rien
  (`outlines`, dont les neuf passes de pyramide ne tournent qu'en mode Échos).
- `EffectParam.maxFrom` — un maximum dynamique lu sur les paramètres résolus.

### ⚠️ Trois contraintes dures que ce chantier ne peut pas casser

- **L'index d'un paramètre est PERSISTÉ dans les presets.** Réordonner
  l'affichage, oui ; réordonner `params[]`, non. La catégorie est une donnée
  d'**affichage**, pas un tri du tableau. Même règle pour les `choices` d'une
  liste : on ajoute à la fin.
- **Les dix-neuf premiers index d'`outlines` sont gelés** par sept références de
  pixels et par les presets. C'est l'effet le plus chargé du registre (26
  paramètres) — donc le principal bénéficiaire du chantier, et le plus risqué.
- **Densité UI = ADR-0001**, checklist au moment où le contrôle est ajouté,
  jamais en lot de rattrapage.

### Un piège de mesure propre à ce chantier

Masquer un contrôle inerte suppose de **savoir** qu'il est inerte, et cette
connaissance a déjà été fausse dans les deux sens :
- `sliceShift` avait deux courses **mortes** non déclarées (corrigé, D11).
- `glass` déclarait « Sans objet en Poli » sur un curseur **vivant**, qui à fond
  de course produisait de l'aliasing (trouvé le 2026-08-04 en écrivant son
  verrou, corrigé en figeant `dens`).

**Une applicabilité se MESURE avant de se déclarer** — le harnais de rendu est le
seul instrument du dépôt qui sache le faire : deux scénarios identiques sauf le
curseur en question, et l'écart de canaux tranche.

---

## 3. Prochain grand chantier — « éléments et composition »

**Ni design ni plan.** Il demande les deux avant la première ligne de code.

- textures / scans et light leaks ;
- formes ;
- typographie ;
- finalisation du recadrage ;
- éventuelles extensions du modèle de document / calques.

### La vraie question de design, et ce n'est pas le rendu

Jusqu'ici un calque est **une photo** ou **un effet** (`LayerState`,
`src/layers/types.ts`). « Formes » et « typographie » sont un **troisième
genre** : du contenu vectoriel généré, sans texture source. Le rendu de chacun
est du travail connu ; c'est le **modèle de document** qui est la question
ouverte, et elle touche la couche la plus partagée du projet — `LayerState` est
consommé par `render/`, `mask/`, `export/`, `components/`, `application/`.

À trancher avant de coder : un troisième genre de calque, ou un effet qui
synthétise son propre contenu sur un calque existant ? Les deux marchent ; ils
ne coûtent pas la même chose.

### Matière première déjà sur disque

`docs/superpowers/specs/2026-08-03-references-postproduction.md` — cahier dicté
par Antoine, ~500 lignes de workflows Photoshop/Lightroom. Il alimente
directement ce chantier (§4 textures et matières, §6 collage, ombres graphiques,
scan de tirage) et porte **son propre tri à faire**, écrit en fin de fichier :

- beaucoup de ses recettes sont des **piles**, pas des effets — la question
  n'est pas « quel effet écrire » mais « que manque-t-il à la pile » ;
- la famille des **courbes** y revient partout (elle existe désormais :
  `curves`) ;
- ce qui **ne se crée pas en postproduction** doit être dit et non simulé ;
- plusieurs recettes demandent une **géométrie posée sur l'image**, pas des
  curseurs — ce qui rejoint le chantier 2.

---

## Ce que cette feuille ne porte pas, et où c'est

| Question | Fichier |
| --- | --- |
| Statut d'un chantier passé | `docs/INDEX.json` |
| Décisions tranchées (ADR) | `.claude/decisions/INDEX.md` |
| Vocabulaire de domaine | `CONTEXT.md` |
| Couches, ports de test, risques | `ARCHITECTURE.md` |
| Règles permanentes, commandes | `CLAUDE.md` |
