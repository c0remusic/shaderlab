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
  VERSION = { major = 0, minor = 2, revision = 0 },
}
