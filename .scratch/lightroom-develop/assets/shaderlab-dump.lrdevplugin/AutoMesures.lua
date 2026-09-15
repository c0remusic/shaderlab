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
local LrLogger = import "LrLogger"

local docs = LrPathUtils.getStandardFilePath("documents")
local sentinelle = LrPathUtils.child(docs, "shaderlab-mesures-go.txt")
local journalPath = LrPathUtils.child(docs, "shaderlab-mesures-journal.txt")

-- Preuve de chargement par les moyens OFFICIELS du SDK, au cas ou io serait
-- muet dans le bac a sable : un dossier cree, et un LrLogger en fichier
-- (Documents/LrClassicLogs/shaderlab.log).
LrFileUtils.createAllDirectories(LrPathUtils.child(docs, "shaderlab-plugin-charge"))
local log = LrLogger("shaderlab")
log:enable("logfile")

local function journal(ligne)
  log:info(ligne)
  local f = io.open(journalPath, "a")
  if f then f:write(os.date("%H:%M:%S ") .. ligne .. "\n"); f:close() end
end

journal("AutoMesures charge")

local okReq, mesures = pcall(require, "mesures")
if not okReq then
  journal("ERREUR require mesures : " .. tostring(mesures))
  mesures = nil
end

if mesures and LrFileUtils.exists(sentinelle) then
  LrTasks.startAsyncTask(function()
    local ok, err = LrTasks.pcall(function()
      journal("sentinelle trouvee")
      local fs = io.open(sentinelle, "r")
      local chemin = (fs:read("*l") or ""):gsub("%s+$", "")
      fs:close()
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
      -- Liste de mesures supplementaires (meme contrat que MesurerCourbes) :
      local extra = LrPathUtils.child(docs, "shaderlab-mesures-extra.txt")
      if LrFileUtils.exists(extra) then
        local fx = io.open(extra, "r")
        if fx then
          local liste = {}
          for ligne in fx:lines() do
            local nom, reste = ligne:match("^([%w%-%_]+)	(.*)$")
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
          fx:close()
          if #liste > 0 then mesures.MESURES = liste; journal("liste extra : " .. #liste .. " mesures") end
          LrFileUtils.delete(extra)
        end
      end
      local dir, n = mesures.executer(photo, journal)
      local f = io.open(LrPathUtils.child(dir, "DONE.txt"), "w")
      f:write(tostring(n) .. "\n"); f:close()
      journal("termine : " .. n .. " exports")
    end)
    if not ok then journal("ERREUR " .. tostring(err)) end
    LrFileUtils.delete(sentinelle)
  end)
else
  journal("pas de sentinelle ou module absent")
end
