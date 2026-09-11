-- Entree de menu : mesure la photo SELECTIONNEE (la mire).
local LrApplication = import "LrApplication"
local LrTasks = import "LrTasks"
local LrDialogs = import "LrDialogs"
local mesures = require "mesures"

LrTasks.startAsyncTask(function()
  local photo = LrApplication.activeCatalog():getTargetPhoto()
  if not photo then
    LrDialogs.message("shaderlab", "Selectionne la mire (shaderlab-mire-lightroom.jpg), puis relance.")
    return
  end
  local dir, n = mesures.executer(photo)
  LrDialogs.message("shaderlab", n .. " mesures exportees dans\n" .. dir)
end)
