-- Coeur partage : la liste des mesures et la boucle applique -> exporte.
-- Appele par MesurerCourbes.lua (menu) et AutoMesures.lua (au chargement,
-- si un fichier sentinelle le demande).
local LrApplication = import "LrApplication"
local LrExportSession = import "LrExportSession"
local LrPathUtils = import "LrPathUtils"
local LrFileUtils = import "LrFileUtils"
local LrProgressScope = import "LrProgressScope"

local M = {}

M.ZERO = {
  IncrementalTemperature = 0, IncrementalTint = 0,
  Exposure2012 = 0, Contrast2012 = 0, Highlights2012 = 0, Shadows2012 = 0,
  Whites2012 = 0, Blacks2012 = 0, Texture = 0, Clarity2012 = 0, Dehaze = 0,
  Vibrance = 0, Saturation = 0,
  ParametricShadows = 0, ParametricDarks = 0, ParametricLights = 0, ParametricHighlights = 0,
  ParametricShadowSplit = 25, ParametricMidtoneSplit = 50, ParametricHighlightSplit = 75,
  HueAdjustmentRed = 0, HueAdjustmentOrange = 0, HueAdjustmentYellow = 0, HueAdjustmentGreen = 0,
  HueAdjustmentAqua = 0, HueAdjustmentBlue = 0, HueAdjustmentPurple = 0, HueAdjustmentMagenta = 0,
  SaturationAdjustmentRed = 0, SaturationAdjustmentOrange = 0, SaturationAdjustmentYellow = 0,
  SaturationAdjustmentGreen = 0, SaturationAdjustmentAqua = 0, SaturationAdjustmentBlue = 0,
  SaturationAdjustmentPurple = 0, SaturationAdjustmentMagenta = 0,
  LuminanceAdjustmentRed = 0, LuminanceAdjustmentOrange = 0, LuminanceAdjustmentYellow = 0,
  LuminanceAdjustmentGreen = 0, LuminanceAdjustmentAqua = 0, LuminanceAdjustmentBlue = 0,
  LuminanceAdjustmentPurple = 0, LuminanceAdjustmentMagenta = 0,
  ColorGradeShadowHue = 0, ColorGradeShadowSat = 0, ColorGradeShadowLum = 0,
  ColorGradeMidtoneHue = 0, ColorGradeMidtoneSat = 0, ColorGradeMidtoneLum = 0,
  ColorGradeHighlightHue = 0, ColorGradeHighlightSat = 0, ColorGradeHighlightLum = 0,
  ColorGradeGlobalHue = 0, ColorGradeGlobalSat = 0, ColorGradeGlobalLum = 0,
  ColorGradeBlending = 50, ColorGradeBalance = 0,
  Sharpness = 0, LuminanceSmoothing = 0, ColorNoiseReduction = 0,
  PostCropVignetteAmount = 0, GrainAmount = 0,
  ShadowTint = 0, RedHue = 0, RedSaturation = 0, GreenHue = 0, GreenSaturation = 0,
  BlueHue = 0, BlueSaturation = 0,
  ConvertToGrayscale = false,
}

M.MESURES = {
  { "temoin", {} },
  { "exposition-m2", { Exposure2012 = -2 } }, { "exposition-m1", { Exposure2012 = -1 } },
  { "exposition-p1", { Exposure2012 = 1 } }, { "exposition-p2", { Exposure2012 = 2 } },
  { "contraste-m100", { Contrast2012 = -100 } }, { "contraste-m50", { Contrast2012 = -50 } },
  { "contraste-p50", { Contrast2012 = 50 } }, { "contraste-p100", { Contrast2012 = 100 } },
  { "hautes-lumieres-m100", { Highlights2012 = -100 } }, { "hautes-lumieres-m50", { Highlights2012 = -50 } },
  { "hautes-lumieres-p50", { Highlights2012 = 50 } }, { "hautes-lumieres-p100", { Highlights2012 = 100 } },
  { "ombres-m100", { Shadows2012 = -100 } }, { "ombres-m50", { Shadows2012 = -50 } },
  { "ombres-p50", { Shadows2012 = 50 } }, { "ombres-p100", { Shadows2012 = 100 } },
  { "blancs-m100", { Whites2012 = -100 } }, { "blancs-m50", { Whites2012 = -50 } },
  { "blancs-p50", { Whites2012 = 50 } }, { "blancs-p100", { Whites2012 = 100 } },
  { "noirs-m100", { Blacks2012 = -100 } }, { "noirs-m50", { Blacks2012 = -50 } },
  { "noirs-p50", { Blacks2012 = 50 } }, { "noirs-p100", { Blacks2012 = 100 } },
  { "texture-p100", { Texture = 100 } }, { "texture-m100", { Texture = -100 } },
  { "clarte-p100", { Clarity2012 = 100 } }, { "clarte-m100", { Clarity2012 = -100 } },
  { "voile-p100", { Dehaze = 100 } }, { "voile-m100", { Dehaze = -100 } },
  { "vibrance-p100", { Vibrance = 100 } }, { "vibrance-m100", { Vibrance = -100 } },
  { "vibrance-p50", { Vibrance = 50 } },
  { "saturation-p100", { Saturation = 100 } }, { "saturation-m100", { Saturation = -100 } },
  { "saturation-p50", { Saturation = 50 } },
  { "temperature-p100", { IncrementalTemperature = 100 } }, { "temperature-m100", { IncrementalTemperature = -100 } },
  { "temperature-p50", { IncrementalTemperature = 50 } },
  { "nuance-p100", { IncrementalTint = 100 } }, { "nuance-m100", { IncrementalTint = -100 } },
  { "param-hl-p100", { ParametricHighlights = 100 } }, { "param-hl-m100", { ParametricHighlights = -100 } },
  { "param-lights-p100", { ParametricLights = 100 } }, { "param-darks-p100", { ParametricDarks = 100 } },
  { "param-ombres-p100", { ParametricShadows = 100 } }, { "param-ombres-m100", { ParametricShadows = -100 } },
  { "param-splits-10-50-90", { ParametricShadows = 100, ParametricHighlights = -100, ParametricShadowSplit = 10, ParametricHighlightSplit = 90 } },
  { "hsl-teinte-rouge-p100", { HueAdjustmentRed = 100 } }, { "hsl-teinte-rouge-m100", { HueAdjustmentRed = -100 } },
  { "hsl-teinte-orange-p100", { HueAdjustmentOrange = 100 } },
  { "hsl-teinte-jaune-p100", { HueAdjustmentYellow = 100 } },
  { "hsl-teinte-vert-p100", { HueAdjustmentGreen = 100 } },
  { "hsl-teinte-aqua-p100", { HueAdjustmentAqua = 100 } },
  { "hsl-teinte-bleu-p100", { HueAdjustmentBlue = 100 } },
  { "hsl-teinte-violet-p100", { HueAdjustmentPurple = 100 } },
  { "hsl-teinte-magenta-p100", { HueAdjustmentMagenta = 100 } },
  { "hsl-sat-rouge-p100", { SaturationAdjustmentRed = 100 } }, { "hsl-sat-rouge-m100", { SaturationAdjustmentRed = -100 } },
  { "hsl-sat-bleu-p100", { SaturationAdjustmentBlue = 100 } }, { "hsl-sat-bleu-m100", { SaturationAdjustmentBlue = -100 } },
  { "hsl-lum-rouge-p100", { LuminanceAdjustmentRed = 100 } }, { "hsl-lum-rouge-m100", { LuminanceAdjustmentRed = -100 } },
  { "hsl-lum-bleu-p100", { LuminanceAdjustmentBlue = 100 } }, { "hsl-lum-bleu-m100", { LuminanceAdjustmentBlue = -100 } },
  { "hsl-lum-vert-p100", { LuminanceAdjustmentGreen = 100 } },
  { "nb", { ConvertToGrayscale = true } },
  { "etal-bleu-teinte-m100", { BlueHue = -100 } }, { "etal-bleu-teinte-p100", { BlueHue = 100 } },
  { "etal-bleu-sat-p100", { BlueSaturation = 100 } }, { "etal-rouge-teinte-p100", { RedHue = 100 } },
  { "etal-vert-teinte-p100", { GreenHue = 100 } }, { "etal-nuance-p100", { ShadowTint = 100 } },
  { "etal-nuance-m100", { ShadowTint = -100 } },
  { "grading-ombres-bleu", { ColorGradeShadowHue = 220, ColorGradeShadowSat = 60 } },
  { "grading-hl-orange", { ColorGradeHighlightHue = 40, ColorGradeHighlightSat = 60 } },
  { "grading-moyens-vert", { ColorGradeMidtoneHue = 120, ColorGradeMidtoneSat = 60 } },
  { "grading-global-lum-p50", { ColorGradeGlobalLum = 50 } },
  { "grading-balance-p100", { ColorGradeShadowHue = 220, ColorGradeShadowSat = 60, ColorGradeHighlightHue = 40, ColorGradeHighlightSat = 60, ColorGradeBalance = 100 } },
  { "grading-fusion-0", { ColorGradeShadowHue = 220, ColorGradeShadowSat = 60, ColorGradeHighlightHue = 40, ColorGradeHighlightSat = 60, ColorGradeBlending = 0 } },
  { "grading-fusion-100", { ColorGradeShadowHue = 220, ColorGradeShadowSat = 60, ColorGradeHighlightHue = 40, ColorGradeHighlightSat = 60, ColorGradeBlending = 100 } },
  { "vignette-m100", { PostCropVignetteAmount = -100 } }, { "vignette-p100", { PostCropVignetteAmount = 100 } },
}

local function merge(base, over)
  local t = {}
  for k, v in pairs(base) do t[k] = v end
  for k, v in pairs(over) do t[k] = v end
  return t
end

function M.dossier()
  return LrPathUtils.child(LrPathUtils.getStandardFilePath("documents"), "shaderlab-lightroom-mesures")
end

-- Applique chaque mesure a `photo` et exporte. Rend le dossier de sortie.
function M.executer(photo, journal)
  local catalog = LrApplication.activeCatalog()
  local dir = M.dossier()
  LrFileUtils.createAllDirectories(dir)
  local progress = LrProgressScope({ title = "shaderlab : mesures Lightroom" })
  local n = #M.MESURES
  for i, m in ipairs(M.MESURES) do
    local nom, delta = m[1], m[2]
    progress:setPortionComplete(i - 1, n)
    progress:setCaption(nom)
    if journal then journal(i .. "/" .. n .. " " .. nom) end
    catalog:withWriteAccessDo("shaderlab " .. nom, function()
      photo:applyDevelopSettings(merge(M.ZERO, delta), "shaderlab " .. nom, false)
    end)
    local session = LrExportSession({
      photosToExport = { photo },
      exportSettings = {
        LR_format = "JPEG", LR_jpeg_quality = 1.0, LR_export_colorSpace = "sRGB",
        LR_export_bitDepth = 8,
        LR_export_destinationType = "specificFolder", LR_export_destinationPathPrefix = dir,
        LR_export_useSubfolder = false, LR_collisionHandling = "overwrite",
        LR_renamingTokensOn = true, LR_tokens = "{{custom_token}}", LR_tokenCustomString = nom,
        LR_size_doConstrain = false, LR_outputSharpeningOn = false,
        LR_reimportExportedPhoto = false, LR_minimizeEmbeddedMetadata = true,
        LR_removeLocationMetadata = true, LR_useWatermark = false,
      },
    })
    session:doExportOnCurrentTask()
  end
  catalog:withWriteAccessDo("shaderlab retour a zero", function()
    photo:applyDevelopSettings(M.ZERO, "shaderlab zero", false)
  end)
  progress:done()
  return dir, n
end

return M
