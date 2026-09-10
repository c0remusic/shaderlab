-- shaderlab : exporter les bornes des curseurs du module Développement.
-- Installation : Fichier > Gestionnaire de modules externes > Ajouter > ce dossier.
-- Usage : module Développement, une photo JPEG sélectionnée,
--         Fichier > Modules externes > « shaderlab : exporter les bornes ».
return {
  LrSdkVersion = 6.0,
  LrSdkMinimumVersion = 6.0,
  LrToolkitIdentifier = "dev.shaderlab.dumpranges",
  LrPluginName = "shaderlab : bornes du module Développement",
  LrExportMenuItems = {
    { title = "shaderlab : exporter les bornes", file = "DumpRanges.lua" },
  },
  VERSION = { major = 0, minor = 1, revision = 0 },
}
