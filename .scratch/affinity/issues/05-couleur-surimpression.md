# La couleur de surimpression du masque

Type: task
Status: open
Parent: ../map.md

## Le défaut

Notre surimpression de masque est ROUGE en dur. Sur une photo à dominante rouge
— un coucher de soleil, une peau, une brique — **elle est invisible**, et on
peint à l'aveugle.

## Ce qu'Affinity fait

`MaskColour` et `SetMaskColour` : la couleur est un réglage.

## Pourquoi c'est le ticket le moins cher de la carte

C'est une couleur, un réglage, et une préférence à retenir — pas un mécanisme.
Le sélecteur de couleur existe déjà (`ColorGroupControl`), et il accepte une
cible d'OUTIL depuis le 2026-08-18 (`layerId: null`), donc un réglage qui
n'appartient à aucun calque a déjà son patron.

## À regarder avant d'écrire

- **Où le réglage vit** : préférence d'application, ou par document ? Les
  symboles d'Affinity ne le disent pas. Une préférence retenue en
  `localStorage` suit le patron du dépôt (dossier de textures, journal d'erreurs
  GPU).
- **L'opacité de la surimpression** est-elle réglable chez eux ? Non relevé, et
  c'est peut-être plus utile que la teinte.
- ⚠️ **Notre overlay a AUSSI un contour animé** (`wantsOverlay` dans `App.tsx`).
  Vérifier qu'il suit la même couleur, sinon on aura deux couleurs pour une
  seule chose — et ce serait pire que le rouge en dur.

## Ce qui prouve que le ticket est fini

La couleur change, elle est retenue entre deux lancements, le contour animé la
suit, et une capture le montre sur une photo rouge — le cas qui a motivé le
ticket.
