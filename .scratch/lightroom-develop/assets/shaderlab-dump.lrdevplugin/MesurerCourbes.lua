-- Entree de menu : mesure LA MIRE (retrouvee par son chemin, ajoutee au
-- catalogue si besoin), jamais la photo selectionnee.
-- Si Documents/shaderlab-mesures-extra.txt existe, il REMPLACE la liste des
-- mesures (une par ligne : nom<TAB>Cle=Valeur;Cle=Valeur — valeur true/false
-- acceptee), ce qui permet d'ajouter des mesures sans recharger le plugin.
local LrApplication = import "LrApplication"
local LrTasks = import "LrTasks"
local LrDialogs = import "LrDialogs"
local LrPathUtils = import "LrPathUtils"
local LrFileUtils = import "LrFileUtils"
local mesures = require "mesures"

local DEFAUT = "C:\\Users\\LEETJ\\Pictures\\shaderlab-mire\\shaderlab-mire-lightroom.jpg"

local function lireExtra(chemin)
  local f = io.open(chemin, "r")
  if not f then return nil end
  local liste = {}
  for ligne in f:lines() do
    local nom, reste = ligne:match("^([%w%-%_]+)\t(.*)$")
    if nom then
      local delta = {}
      for cle, val in reste:gmatch("([%w]+)=([^;]+)") do
        if val == "true" then delta[cle] = true
        elseif val == "false" then delta[cle] = false
        else delta[cle] = tonumber(val) end
      end
      liste[#liste + 1] = { nom, delta }
    end
  end
  f:close()
  return liste
end

LrTasks.startAsyncTask(function()
  local docs = LrPathUtils.getStandardFilePath("documents")
  local sentinelle = LrPathUtils.child(docs, "shaderlab-mesures-go.txt")
  local extra = LrPathUtils.child(docs, "shaderlab-mesures-extra.txt")
  local chemin = DEFAUT
  if LrFileUtils.exists(sentinelle) then
    local f = io.open(sentinelle, "r")
    if f then local l = f:read("*l"); f:close(); if l and #l > 3 then chemin = l:gsub("%s+$", "") end end
  end
  local liste = lireExtra(extra)
  if liste then mesures.MESURES = liste end
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
  if liste then LrFileUtils.delete(extra) end
  LrDialogs.message("shaderlab", n .. " mesures de la mire exportees dans\n" .. dir)
end)
