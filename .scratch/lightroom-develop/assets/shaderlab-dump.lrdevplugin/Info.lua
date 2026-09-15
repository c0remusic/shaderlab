-- shaderlab : instruments de mesure du module Développement de Lightroom.
-- Installation : Fichier > Gestionnaire de modules externes > Ajouter > ce dossier.
-- Deux entrées dans Fichier > Modules externes :
--   « shaderlab : exporter les bornes »   (module Développement, une photo sélectionnée)
--   « shaderlab : mesurer les courbes »   (la mire shaderlab-mire-lightroom.jpg
--                                          importée et sélectionnée ; ~80 exports JPEG)
return {
  LrSdkVersion = 6.0,
  LrSdkMinimumVersion = 6.0,
  LrToolkitIdentifier = "dev.shaderlab.mesures",
  LrPluginName = "shaderlab : mesures du module Développement",
  LrExportMenuItems = {
    { title = "shaderlab : exporter les bornes", file = "DumpRanges.lua" },
    { title = "shaderlab : mesurer les courbes", file = "MesurerCourbes.lua" },
  },
  LrLibraryMenuItems = {
    { title = "shaderlab : mesurer les courbes", file = "MesurerCourbes.lua" },
  },
  LrInitPlugin = "AutoMesures.lua",
  -- ⚠️ SANS CE DRAPEAU, LrInitPlugin NE TOURNE PAS AU DÉMARRAGE. Le SDK DIFFÈRE
  -- son exécution jusqu'au premier USAGE du module externe (un clic de menu, une
  -- ouverture du Gestionnaire) : un simple redémarrage de Lightroom ne mesurait
  -- donc jamais rien, sentinelle posée ou non. Constat du 2026-09-15 — le dossier
  -- de preuve de chargement datait du 11/09 alors que Lightroom avait redémarré
  -- depuis, et le journal n'existait même pas. C'est ce qui a fait conclure à tort
  -- que « seul un redémarrage par Antoine charge le plugin » : ce n'était pas QUI
  -- lançait Lightroom, c'était qu'il fallait toucher le module externe après coup.
  LrForceInitPlugin = true,
  VERSION = { major = 0, minor = 2, revision = 0 },
}
