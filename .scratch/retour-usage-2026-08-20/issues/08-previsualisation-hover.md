Type: prototype
Status: open

> 🔵 **Grilling 2026-08-21** : tranché — modes de fusion en **aperçu live** sur la
> toile (cheap, comme PS scrub la liste) + effets en **vignette de galerie**
> basse-déf. Séquence : fusion d'abord (le code attend une validation live, il
> disturberait l'app dev). Coût des 27 vignettes d'effet à mesurer avant impl.
> Détail : `../map.md`.

## Question

« On peut ajouter une prévisualisation de l'effet en hover ? Pareil pour les
modes de fusion ? » (retour d'Antoine). Deux surfaces :
1. Le SÉLECTEUR d'effet (« Ajouter un effet ») : survoler un effet montre un
   aperçu de ce qu'il ferait.
2. Le sélecteur de MODE DE FUSION : survoler un mode montre le calque courant
   composé dans ce mode.

À prototyper/décider :
- Faisabilité et coût : rendre un aperçu par effet/mode en survol demande de
  composer une frame supplémentaire. Sur 27 effets et 17 modes, à quel coût ?
  Une vignette basse résolution ? Un aperçu de la vraie image ou d'une mire ?
- Quand pré-calculer (à l'ouverture du sélecteur) vs à la volée (au survol) ?
- Forme UI : vignette flottante, aperçu in-place sur la toile, les deux ?

Prototype (fidélité de la discussion) — la vraie question est « à quoi ça
ressemble et est-ce que ça vaut le coût ». Peut nécessiter un ticket research sur
le coût de composition d'aperçus.
