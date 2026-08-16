# La dérogation du gate WGSL est bornée, mais pas comptée

Type: task
Status: ready-for-agent
Parent: ../map.md

> ⚠️ **Ce ticket a été REQUALIFIÉ le 2026-08-16.** Il s'appelait « Le seul gate
> de shader qui tourne en CI est rouge » et affirmait que `wgslNaga.test.ts`
> échouait sur tous les effets du registre. **C'était faux, et il l'était déjà
> le jour de son écriture.** La mesure est plus bas ; le titre d'origine est
> conservé dans le nom de fichier pour ne pas casser les liens de la carte.

## Ce que la mesure dit, contre ce que le ticket disait

Mesuré le 2026-08-16, en local et dans la CI :

| Affirmation d'origine | Mesure |
| --- | --- |
| `test:wgsl` échoue | **Vert** — 2 tests, ~90 variantes composées validées |
| L'exception n'est pas implémentée | **Elle l'est**, `wgslNaga.test.ts:73` |
| Elle a été omise à l'écriture | **Présente au tout premier commit du fichier** (`677a39d`) |
| La CI est rouge à cause de ce gate | **`npm run test` passe en CI** : 128 fichiers verts (run `31895619303`) |

La dérogation en place :

```ts
const ECART_CONNU_PARAMS =
  /Global variable \[\d+\] 'params' is invalid[\s\S]*?stride 4 is not a multiple of the required alignment 16/;
```

Elle est **bornée dans les deux sens** que le ticket réclamait : par la variable
(`params` et rien d'autre) et par le nombre (`erreurs.length === 1` — une seconde
erreur, quelle qu'elle soit, annule la tolérance). C'est la forme 2 des trois que
le ticket proposait, resserrée d'un cran.

**La partie AFK n° 1 (« lire le test et voir s'il prévoit déjà un mécanisme
d'exclusion inutilisé ») était donc la bonne question, et elle avait déjà sa
réponse dans le fichier.** Personne ne l'a ouverte avant d'écrire le ticket.

## Ce qui reste, et c'est tout ce qui reste

**La dérogation est bornée mais pas COMPTÉE.** Le test tolère l'écart connu sans
dire combien de fois il l'a rencontré. Conséquences :

1. Si l'uniform devenait conforme demain, le test resterait vert sans que
   personne apprenne que la dérogation ne sert plus.
2. Si le nombre de variantes touchées changeait (un effet ajouté, un effet
   retiré), rien ne bougerait.

Forme attendue : le test accumule le nombre de variantes ayant déclenché
`seulementEcartConnu`, et **échoue si ce nombre s'écarte d'un attendu écrit en
dur**, avec le message qui dit dans quel sens. Même esprit que les gates de
pixels : un chiffre attendu, pas une tolérance ouverte.

## Ce qui n'est PAS dans ce ticket

- **Rendre l'uniform conforme** (`array<vec4<f32>, 12>`) reste un chantier avec
  ADR : chaque accès `params[N]` des 23 effets change, et les index sont gelés
  par les presets ET par 97 références de pixels. Rien ici ne l'engage.
- **Le rouge réel de la CI** : c'est `LayerPanel.stories.tsx`, antérieur à ce
  gate — voir [22](22-layerpanel-rouge-en-ci-vert-en-local.md).

## Ce qui rendrait ce ticket raté

Élargir la dérogation pour faire taire autre chose. Elle vaut par ce qu'elle
refuse : une erreur sur une autre variable, ou une seconde erreur sur `params`,
doivent continuer de rougir.

## La leçon, qui vaut plus que le ticket

Ce ticket a été écrit, poussé, référencé dans `CLAUDE.md` et repris dans un
commit intitulé « un gate annoncé vert qui est rouge » — **sans que le fichier
de test soit ouvert une seule fois**. Deux gestes de trente secondes
l'auraient évité : `npm run test:wgsl`, et `gh run view --log-failed`.

Une prémisse fausse dans un ticket ne reste pas dans le ticket : elle a produit
un chantier `vec4` avec ADR pour un problème qui n'existait pas, et elle a
masqué le rouge réel de la CI pendant deux jours.
