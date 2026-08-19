# Le contrat `.8bf` réel — un filtre Photoshop est-il LIVE chez Affinity ?

Type: research
Status: open
Parent: ../map.md

## ⚠️ Ce ticket a PERDU son enjeu le 2026-08-19, sans avoir été répondu

Il s'ouvrait sur « pourquoi ce ticket décide de tout ». Ce n'est plus vrai :
le [ticket 12](12-plugin-perfs-et-qualite.md) a mesuré qu'un plugin serait plus
LENT que notre pile — 6 à 25 fois — et que le gain de qualité est disponible
chez nous pour moins cher. **La question « live ou destructif » ne décide plus
de Q1, quel que soit son résultat** : elle ne peut plus que rendre un « non »
un peu moins net ou un peu plus net.

Ce qui a quand même été trouvé, et qui n'est qu'un INDICE :

- Deux corrections de module. `PhotoshopPluginWrapper`,
  `RasterFilterPluginWrapper`, `SupportsPhotoshopPlugins`, `AllowUnknownPlugins`
  et `.8bf` ne sont pas dans `libpersona.dll` comme l'écrivait le relevé, mais
  dans `Serif.Affinity.dll`. Le fait tient, le module cité était faux.
- Dans leur vocabulaire, un « RasterFilter » est la famille DESTRUCTIVE (celle
  du menu Filtres) et un filtre non destructif est un « LiveFilter »
  (172 occurrences dans le même assembly). Le plugin Photoshop est enveloppé par
  un `RasterFilterPluginWrapper`. **Ça penche vers « appliqué une fois ».**
- Vérifié au passage : les commandes de filtre du SDK sont bien DESTRUCTIVES —
  l'annulation dit « Croissance », « Demi-ton », « Flou de l'objectif », et
  aucun calque n'apparaît dans l'arbre du document.

⚠️ **Deux noms voisins dans un tas de chaînes ne prouvent pas un héritage.** Ce
qui trancherait reste ce que dit ce ticket : poser un `.8bf` libre et regarder
la pile de calques. Ça demande l'accord d'Antoine — c'est du code tiers exécuté
dans son application, et tout le relevé est resté en lecture seule.

**Le ticket reste donc ouvert, mais il n'est plus bloquant.** À faire seulement
si Antoine veut la réponse pour elle-même.

---

Énoncé d'origine, conservé :

## Pourquoi ce ticket décide de tout

Affinity 3 héberge les plugins Photoshop — établi au symbole dans
`libpersona.dll` : `.8bf`, `PIPL`, `PIMI`, `PluginMain`,
`?LoadPiPL@PhotoshopPluginFile@@`, une fonction prenant `FilterRecord@PSP@@`, et
une page de préférences complète dans `Serif.Affinity.dll` (dossiers de
recherche, dossiers détectés, statuts `Working`/`Broken`/`Unknown`).

Donc « porter nos effets dans Affinity » n'est plus un non technique. Reste UNE
question, et elle change la réponse du tout au tout :

> **Un filtre `.8bf` est-il appliqué UNE FOIS, destructivement — ou Affinity
> l'enveloppe-t-il en LIVE FILTER, non destructif et remodifiable ?**

- **Appliqué une fois** : on perd ce qui fait shaderlab — dosage après coup,
  empilement, masque par calque, presets. Nos effets deviendraient des boutons à
  sens unique. La réponse à Q1 serait alors « non », mais pour une raison de
  PRODUIT et plus du tout technique.
- **Enveloppé en live filter** : nos vingt-sept effets deviendraient des calques
  de filtre dans Affinity, avec LEURS masques et LEUR historique. Q1 devient un
  vrai arbitrage, et il n'est plus évident.

## Comment le mesurer

D'abord au symbole, sans rien installer : chercher un
`AddPluginFilterLiveFilterCommand` ou équivalent à côté des quarante-quatre
`Add*LiveFilterCommand` déjà relevés. `RasterFilterPluginWrapper` et
`PhotoshopPluginWrapper` existent — voir ce qu'ils dérivent.

Si le symbole ne tranche pas : poser un `.8bf` libre dans un dossier de plugins
et regarder ce que la pile de calques montre après application.

⚠️ **Faire valider le choix du plugin par Antoine avant de l'installer.** C'est
du code tiers exécuté dans son application, et tout le relevé jusqu'ici était en
lecture seule. Cette limite est dans les notes de la carte.

## Ce qui prouve que le ticket est fini

Une réponse binaire, sourcée — un symbole qui le dit, ou une capture de la pile
après application — et l'écriture de ce que ça implique pour Q1.

## Ce qui n'est PAS dans ce ticket

Le coût d'écriture d'un `.8bf` : C++, SDK Photoshop, et le portage de nos WGSL
sur une API que le plugin ouvrirait lui-même. Il ne se chiffre que si la réponse
ci-dessus est favorable.
