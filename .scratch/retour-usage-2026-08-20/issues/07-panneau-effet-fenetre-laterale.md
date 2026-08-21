Type: prototype
Status: open

> 🔵 **Grilling 2026-08-21** : tranché — réglages en **panneau à côté** de la pile
> (deuxième colonne, comme PS *Properties* / Lightroom). Accordéon sous la ligne
> (ticket 10) ÉCARTÉ (pas PS, casse ADR-0001). Wireframe envoyé :
> `docs/wireframes/reglages-panneau-lateral.html` (3 questions ouvertes : côté de
> la colonne, sort de l'onglet Masque, validation du libellé « Verrous : »).
> Attend ta réaction avant code. Détail : `../map.md`.

## Question

« C'est bizarre que les effets s'ouvrent au-dessus des calques, la fenêtre
devrait s'ouvrir dans une fenêtre sur le côté des calques, ça serait plus
instinctif » (retour d'Antoine). Le panneau Propriétés (réglages de l'effet
sélectionné) occupe aujourd'hui le haut de la colonne de dock, au-dessus de la
carte Pile. Antoine veut les réglages À CÔTÉ des calques, pas au-dessus.

À prototyper/décider :
- Où vivent les réglages de l'effet vs la pile de calques : deux colonnes
  côte à côte ? un panneau latéral distinct ?
- Contrainte forte : ADR-0001 (densité), la colonne NE DÉFILE PAS, les cartes
  sont content-sized, groupes à onglets (modèle Photoshop). Un panneau latéral
  ne doit pas rouvrir le layout déjà tranché dans `hybride-lightroom-photoshop/`
  ticket 04 (résolu par groupes à onglets).
- Référence imposée : comparer à Photoshop ET Lightroom d'abord (où vivent les
  réglages d'un calque d'ajustement vs la pile).

Prototype de layout → réaction d'Antoine. Se lit avec `hybride-lightroom-photoshop/`.
