-- Entree de menu : mesure LA MIRE (retrouvee par son chemin, ajoutee au
-- catalogue si besoin), jamais la photo selectionnee. Le chemin vient de
-- Documents/shaderlab-mesures-go.txt s'il existe, sinon du chemin par defaut.
local LrApplication = import "LrApplication"
local LrTasks = import "LrTasks"
local LrDialogs = import "LrDialogs"
local LrPathUtils = import "LrPathUtils"
local LrFileUtils = import "LrFileUtils"
local mesures = require "mesures"

local DEFAUT = "C:\\Users\\LEETJ\\Pictures\\shaderlab-mire\\shaderlab-mire-lightroom.jpg"

LrTasks.startAsyncTask(function()
  local docs = LrPathUtils.getStandardFilePath("documents")
  local sentinelle = LrPathUtils.child(docs, "shaderlab-mesures-go.txt")
  local chemin = DEFAUT
  if LrFileUtils.exists(sentinelle) then
    local f = io.open(sentinelle, "r")
    if f then local l = f:read("*l"); f:close(); if l and #l > 3 then chemin = l:gsub("%s+$", "") end end
  end
  local catalog = LrApplication.activeCatalog()
  local photo = catalog:findPhotoByPath(chemin)
  if not photo then
    catalog:withWriteAccessDo("shaderlab ajout mire", function()
      photo = catalog:addPhoto(chemin)
    end)
  end
  if not photo then
    LrDialogs.message("shaderlab", "Mire introuvable : " .. chemin)
    return
  end
  local dir, n = mesures.executer(photo)
  local f = io.open(LrPathUtils.child(dir, "DONE.txt"), "w")
  if f then f:write(tostring(n) .. "\n"); f:close() end
  if LrFileUtils.exists(sentinelle) then LrFileUtils.delete(sentinelle) end
  LrDialogs.message("shaderlab", n .. " mesures de la mire exportees dans\n" .. dir)
end)
