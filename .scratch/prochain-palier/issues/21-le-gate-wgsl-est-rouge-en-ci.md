# La dérogation du gate WGSL est bornée, mais pas comptée

Type: task
Status: resolved
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

## ✅ RÉSOLU le 2026-08-16 — et le compteur a trouvé pire que ce qu'il comptait

La dérogation est désormais **comptée** : le test accumule le nombre de variantes
qui l'ont déclenchée et exige `tolerees === liste.length`. L'attendu est DÉRIVÉ
et non littéral — toute variante composée déclare `params`, donc toutes sont
touchées ; un nombre écrit en dur se périmerait au prochain effet ajouté.

Ce que ça ferme : si l'uniform devenait conforme, `tolerees` tomberait à 0 et le
test le dirait, au lieu de rester vert en tolérant une erreur qui ne se produit
plus.

### ⚠️ CE QUE L'ÉPREUVE DU COMPTEUR A TROUVÉ, et qui était plus grave

En vérifiant que le compteur comptait vraiment — assertion volontairement fausse
pour lire sa valeur — le gate a **rougi**, alors qu'il passait deux minutes plus
tôt. Cause : **`naga` colore sa sortie même derrière un tuyau** (`stdio: "pipe"`).
Mesuré :

```
ANSI present : true
lignes ^error: : 0
```

La borne « une seule erreur » repose sur `sortie.match(/^error:/gm)`. Avec les
codes ANSI en tête de ligne, l'ancre `^error:` ne matche AUCUNE ligne :
`erreurs.length` vaut 0 au lieu de 1, `seulementEcartConnu` rend faux, et le gate
rougit sur l'écart qu'il est censé tolérer.

**Et le verdict dépendait du SHELL.** Vert sous PowerShell et en CI, où naga ne
colore pas ; rouge sous Bash, où il colore. Un gate dont le résultat dépend du
terminal qui le lance est pire qu'un gate rouge — il donne raison au dernier qui
l'a lancé. Corrigé par un `sansAnsi()` en entrée, une fois, plutôt que par une
variable d'environnement que chaque appelant devrait penser à poser.

### Ce que ça a ajouté au fichier

`seulementEcartConnu` est **exportée** et testée sur cinq sorties écrites à la
main, codes ANSI compris. Deux raisons de ne pas passer que par naga : son
coloriage dépend du terminal, donc un test qui ne l'exerce qu'à travers lui
valide un comportement au hasard ; et les cas qu'on veut INTERDIRE (deux erreurs,
la même erreur sur une autre variable) ne se produisent pas aujourd'hui, donc
rien ne les exercerait. Éprouvé en retirant `sansAnsi` : deux tests rougissent,
dont le gate réel.

## Ce que le ticket demandait (énoncé d'origine, conservé)

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
