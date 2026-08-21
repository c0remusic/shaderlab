Type: grilling
Status: resolved

> ✅ **Grilling 2026-08-21** : reste en Déformation (déjà comme PS met *Displace*),
> nom gardé, amplitude défaut 24 → 100 (codé, `db9777e`). Détail : `../map.md`
> § Décisions du grilling.

## Question

`displacementMap` (« Carte de déplacement ») « qui devrait être textures semble
cassé » (retour d'Antoine). Diagnostic : il FONCTIONNE (l'amplitude déforme bien,
vérifié au pixel de 24 à 200), mais (a) quasi invisible au défaut sur beaucoup de
textures, (b) il ne MONTRE pas la texture — il déforme la photo SELON elle, à
l'inverse de l'effet `Texture` qui la plaque. Le « semble cassé » est une attente
déçue, pas un bug.

À trancher :
- **Nom / catégorie** : « devrait être textures » — l'effet doit-il être renommé,
  re-catégorisé (`effects/catalog.ts` `EFFECT_CATEGORIES`), ou rapproché de
  l'effet `Texture` dans l'interface ? Les deux partagent le mécanisme
  `libraryTexture` (binding 7, ADR-0018) mais font des choses opposées.
- **Défaut** : monter l'amplitude par défaut (testé à 60 = encore subtil sur
  Cardboard) et/ou choisir une texture par défaut à fort relief — mais le rang de
  texture dépend du dossier de l'utilisateur, donc un défaut robuste est difficile.
- Lien avec le ticket 06 (doublon encre/textures) : la relation entre les effets
  à texture de bibliothèque mérite d'être clarifiée d'un bloc.

Décision de nommage/rangement/attente → grilling.
