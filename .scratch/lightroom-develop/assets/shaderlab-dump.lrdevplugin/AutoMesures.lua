-- Execute au chargement du plugin (LrInitPlugin). Si le fichier sentinelle
-- Documents/shaderlab-mesures-go.txt existe, il contient le chemin de la mire :
-- la photo est ajoutee au catalogue si besoin, mesuree, puis un fichier
-- Documents/shaderlab-lightroom-mesures/DONE.txt est ecrit. Sans sentinelle,
-- ce script ne fait rien. C'est le pont « sans clic » : lancer Lightroom avec
-- le plugin dans %APPDATA%/Adobe/Lightroom/Modules suffit.
local LrApplication = import "LrApplication"
local LrTasks = import "LrTasks"
local LrPathUtils = import "LrPathUtils"
local LrFileUtils = import "LrFileUtils"
local mesures = require "mesures"

local docs = LrPathUtils.getStandardFilePath("documents")
local sentinelle = LrPathUtils.child(docs, "shaderlab-mesures-go.txt")
local journalPath = LrPathUtils.child(docs, "shaderlab-mesures-journal.txt")

local function journal(ligne)
  local f = io.open(journalPath, "a")
  if f then f:write(os.date("%H:%M:%S ") .. ligne .. "\n"); f:close() end
end

if LrFileUtils.exists(sentinelle) then
  LrTasks.startAsyncTask(function()
    local ok, err = pcall(function()
      journal("sentinelle trouvee")
      local chemin = (io.open(sentinelle, "r"):read("*l") or ""):gsub("%s+$", "")
      local catalog
      for _ = 1, 60 do
        local okc, c = pcall(LrApplication.activeCatalog)
        if okc and c then catalog = c; break end
        LrTasks.sleep(1)
      end
      if not catalog then error("catalogue indisponible") end
      local photo = catalog:findPhotoByPath(chemin)
      if not photo then
        journal("ajout de la mire au catalogue : " .. chemin)
        catalog:withWriteAccessDo("shaderlab ajout mire", function()
          photo = catalog:addPhoto(chemin)
        end)
      end
      if not photo then error("mire introuvable : " .. chemin) end
      local dir, n = mesures.executer(photo, journal)
      local f = io.open(LrPathUtils.child(dir, "DONE.txt"), "w")
      f:write(tostring(n) .. "\n"); f:close()
      journal("termine : " .. n .. " exports")
    end)
    if not ok then journal("ERREUR " .. tostring(err)) end
    LrFileUtils.delete(sentinelle)
  end)
end
