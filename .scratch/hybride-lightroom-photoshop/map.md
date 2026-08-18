# Carte — L'hybride Lightroom / Photoshop

Label : `wayfinder:map`
Chartée le 2026-08-18, depuis un retour d'usage d'Antoine et une mesure sur
disque le même jour.

## Destination

**Un hybride de Lightroom et de Photoshop qui facilite le travail créatif**, et
non un clone de l'un des deux. Fin de carte = le geste courant — poser une
forme, doser un effet, revenir en arrière, retrouver un réglage — se fait sans
que l'app oblige à réapprendre une convention que ces deux outils ont déjà
fixée.

Ce n'est pas un axe « qualité de rendu » : celui-là vit dans `docs/ROADMAP.md`.
Ici, tout ce qui se joue est **le geste et la lisibilité**.

## L'énoncé d'origine, mot pour mot

> « petit problème de forme, on est pas non plus sur de la qualité photoshop. Le
> lock ne lock toujours pas correctement parce que quand on selectionne un calque
> dans la pile d'effet on peut toujours le modifier/déplacer. On a pas non plus
> de color picker pour la forme. Le pinceau fait quoi exactement ? Fait un max de
> recherche pour qu'on atteigne la qualité et le workflow photoshop, pareil pour
> le layout. On a pas le double click pour reset une valeur non plus dans les
> proprietés ni le marqueur de valeur par defaut. Y'a un probleme avec le
> placement et le taille/forme de l'icone de lock sur le calque. On cherche
> vraiment à faire un hybride de lightroom et photoshop en facilitant le workflow
> créatif. »

## ✅ Ce qui est déjà LIVRÉ le jour même

Cinq des sept points étaient des défauts localisables, mesurés puis corrigés
avant d'ouvrir cette carte. Ils ne sont pas des tickets : ils sont faits.

| Point | Ce que la mesure a trouvé |
| --- | --- |
| **le verrou ne verrouille pas** | `LayerStack` refuse quatorze opérations, mais **aucun geste vivant ne passe par ses mutateurs** — `App.tsx` écrit par `replaceLiveLayers`, la seule porte que les gardes ne couvrent pas. Fermée, plus la moitié visible : les manipulateurs ne se rendent plus sur un calque verrouillé |
| **l'icône de verrou** | `--icon-size-xs` **n'existait pas**. La règle était invalide, `width`/`height` retombaient à `auto`, et le cadenas se rendait à ~24 px dans une cellule de 28. Token déclaré, pastille posée sur le patron de `mask-count` |
| **double-clic pour revenir au défaut** | adopté au ticket 11, jamais construit. Livré sur la piste ET sur le libellé |
| **marqueur du défaut** | idem, et il n'apparaît que lorsque la valeur a quitté son défaut — la demande exacte d'Antoine devant la planche |
| **pas de color picker pour la forme** | la barre portait trois curseurs TSL nus. Elle reprend `ColorGroupControl`, et le picker accepte désormais une cible d'OUTIL (`layerId: null`) |
| **le pinceau fait quoi** | la barre ne le disait nulle part. Elle dit « Pinceau du masque · &lt;calque&gt; », et bascule en « Gomme du masque » |

⚠️ **Deux défauts trouvés PAR LA CORRECTION, pas par le signalement** :
`--disabled-opacity` était lu par six feuilles et déclaré nulle part — tout état
désactivé était donc visuellement inerte ; et la table de tokens de
`lint:tokens` était **incomplète depuis toujours**, son extraction lisant les
commentaires. Les deux sont corrigés, et le linter voit désormais un token
jamais déclaré.

## Ce que la recherche a établi, et qui change des choses

Sources primaires Adobe uniquement, relevées le 2026-08-18. Détail et citations :
[`research/01-conventions-adobe.md`](research/01-conventions-adobe.md).

**1. Un verrou n'est pas binaire chez Photoshop, et sa FORME le dit.** Quatre
verrous distincts — pixels transparents, pixels d'image, position, tout — et
l'icône est **pleine quand le calque est entièrement verrouillé, CREUSE quand il
l'est partiellement**. Le cas d'usage est nommé par Adobe : « verrouiller
partiellement un calque qui a la bonne transparence et les bons styles pendant
qu'on hésite encore sur son placement ». Notre verrou est un booléen, et notre
cadenas a une seule forme.

**2. Une forme reste ÉDITABLE après coup, et ses réglages vivent à DEUX
endroits.** Photoshop expose W, H, X, Y, l'angle et les rayons d'angle dans le
panneau Propriétés **et** en contrôles sur la toile, les deux pilotant la même
forme. Nous avons les poignées depuis aujourd'hui ; ce qui manque est la
symétrie — le panneau ne montre pas les mêmes grandeurs dans les mêmes unités.

**3. Le double-clic qui remet au défaut est la convention de Lightroom**, et il
y remet « à zéro » — c'est-à-dire au neutre du réglage, pas à une valeur
d'usine arbitraire. Notre défaut est `EffectParam.default`, ce qui est la bonne
lecture.

## Ce qui RESTE, et c'est là que la carte commence

- [Le geste de la forme n'est pas au niveau](issues/01-le-geste-de-la-forme.md)
  — le point que l'énoncé ouvre et que rien n'a encore mesuré.
- [Le verrou est binaire là où Photoshop en a quatre](issues/02-le-verrou-binaire.md)
- [La symétrie panneau / toile](issues/03-symetrie-panneau-toile.md)
- [Le layout, mesuré contre les deux références](issues/04-le-layout.md)

## Notes

**Lectures obligatoires** : `CLAUDE.md`, `CONTEXT.md`, `ARCHITECTURE.md`,
`.claude/decisions/INDEX.md` — et la carte close du palier précédent
(`.scratch/prochain-palier/`), dont les 29 tickets portent les arbitrages déjà
rendus. Ne pas rouvrir ce qui y est tranché.

**Règle de cette carte, héritée et non négociable** : un doublon se MESURE avant
de s'écrire, et une apparence se REGARDE avant de se déduire. Les deux ont déjà
mordu ici le jour de l'ouverture — le sélecteur de primitive affichait « 0 », et
deux tests écrits pour la couleur affirmaient un bleu qu'ils ne produisaient pas.

⚠️ **Ce que cette carte ne doit pas devenir** : une liste de fonctions de
Photoshop à recopier. L'énoncé dit « hybride » et « faciliter le workflow
créatif », pas « parité ». Chaque entrée doit dire quel GESTE elle débloque,
sinon elle n'a rien à faire ici.
