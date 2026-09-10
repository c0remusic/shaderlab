-- Écrit Documents/shaderlab-lightroom-ranges.txt : une ligne par paramètre
-- du module Développement, « clé<TAB>min<TAB>max<TAB>valeur courante ».
-- Les clés sont celles de LrDevelopController (SDK) ; une clé inconnue de
-- cette version rend « — » au lieu de faire échouer l'export.
local LrDevelopController = import "LrDevelopController"
local LrTasks = import "LrTasks"
local LrPathUtils = import "LrPathUtils"
local LrDialogs = import "LrDialogs"
local LrApplicationView = import "LrApplicationView"

local KEYS = {
  -- Réglages de base
  "Temperature", "Tint", "Exposure", "Contrast", "Highlights", "Shadows",
  "Whites", "Blacks", "Texture", "Clarity", "Dehaze", "Vibrance", "Saturation",
  -- Courbe paramétrique
  "ParametricShadows", "ParametricDarks", "ParametricLights", "ParametricHighlights",
  "ParametricShadowSplit", "ParametricMidtoneSplit", "ParametricHighlightSplit",
  "CurveRefineSaturation",
  -- HSL / N&B
  "HueAdjustmentRed", "HueAdjustmentOrange", "HueAdjustmentYellow", "HueAdjustmentGreen",
  "HueAdjustmentAqua", "HueAdjustmentBlue", "HueAdjustmentPurple", "HueAdjustmentMagenta",
  "SaturationAdjustmentRed", "SaturationAdjustmentOrange", "SaturationAdjustmentYellow",
  "SaturationAdjustmentGreen", "SaturationAdjustmentAqua", "SaturationAdjustmentBlue",
  "SaturationAdjustmentPurple", "SaturationAdjustmentMagenta",
  "LuminanceAdjustmentRed", "LuminanceAdjustmentOrange", "LuminanceAdjustmentYellow",
  "LuminanceAdjustmentGreen", "LuminanceAdjustmentAqua", "LuminanceAdjustmentBlue",
  "LuminanceAdjustmentPurple", "LuminanceAdjustmentMagenta",
  "GrayMixerRed", "GrayMixerOrange", "GrayMixerYellow", "GrayMixerGreen",
  "GrayMixerAqua", "GrayMixerBlue", "GrayMixerPurple", "GrayMixerMagenta",
  -- Color Grading / Virage partiel
  "ColorGradeShadowHue", "ColorGradeShadowSat", "ColorGradeShadowLum",
  "ColorGradeMidtoneHue", "ColorGradeMidtoneSat", "ColorGradeMidtoneLum",
  "ColorGradeHighlightHue", "ColorGradeHighlightSat", "ColorGradeHighlightLum",
  "ColorGradeGlobalHue", "ColorGradeGlobalSat", "ColorGradeGlobalLum",
  "ColorGradeBlending", "ColorGradeBalance",
  "SplitToningShadowHue", "SplitToningShadowSaturation",
  "SplitToningHighlightHue", "SplitToningHighlightSaturation", "SplitToningBalance",
  -- Détail
  "Sharpness", "SharpenRadius", "SharpenDetail", "SharpenEdgeMasking",
  "LuminanceSmoothing", "LuminanceNoiseReductionDetail", "LuminanceNoiseReductionContrast",
  "ColorNoiseReduction", "ColorNoiseReductionDetail", "ColorNoiseReductionSmoothness",
  -- Optique (manuel)
  "LensManualDistortionAmount", "VignetteAmount", "VignetteMidpoint",
  "DefringePurpleAmount", "DefringePurpleHueLo", "DefringePurpleHueHi",
  "DefringeGreenAmount", "DefringeGreenHueLo", "DefringeGreenHueHi",
  "LensProfileDistortionScale", "LensProfileVignettingScale",
  -- Transformation
  "PerspectiveVertical", "PerspectiveHorizontal", "PerspectiveRotate",
  "PerspectiveScale", "PerspectiveAspect", "PerspectiveX", "PerspectiveY",
  -- Effets
  "PostCropVignetteAmount", "PostCropVignetteMidpoint", "PostCropVignetteRoundness",
  "PostCropVignetteFeather", "PostCropVignetteHighlightContrast",
  "GrainAmount", "GrainSize", "GrainFrequency",
  -- Étalonnage
  "ShadowTint", "RedHue", "RedSaturation", "GreenHue", "GreenSaturation",
  "BlueHue", "BlueSaturation",
  -- Divers
  "ProfileAmount", "straightenAngle",
}

LrTasks.startAsyncTask(function()
  if LrApplicationView.getCurrentModuleName() ~= "develop" then
    LrDialogs.message("shaderlab", "Ouvre le module Développement avec une photo JPEG sélectionnée, puis relance.")
    return
  end
  local path = LrPathUtils.child(LrPathUtils.getStandardFilePath("documents"), "shaderlab-lightroom-ranges.txt")
  local f = assert(io.open(path, "w"))
  f:write("cle\tmin\tmax\tvaleur\n")
  local ok_count, ko = 0, {}
  for _, key in ipairs(KEYS) do
    local ok, lo, hi = pcall(LrDevelopController.getRange, key)
    local okv, val = pcall(LrDevelopController.getValue, key)
    if ok and lo ~= nil then
      f:write(string.format("%s\t%s\t%s\t%s\n", key, tostring(lo), tostring(hi), okv and tostring(val) or "—"))
      ok_count = ok_count + 1
    else
      f:write(string.format("%s\t—\t—\t%s\n", key, okv and tostring(val) or "—"))
      ko[#ko + 1] = key
    end
  end
  f:close()
  LrDialogs.message("shaderlab", string.format("%d bornes écrites, %d clés inconnues.\n%s", ok_count, #ko, path))
end)
