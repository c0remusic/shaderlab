import { PRESET_SCHEMA_VERSION, type PresetDocument, type PresetLayer } from "./presetTypes";

function isPresetLayer(value: unknown): value is PresetLayer {
  if (typeof value !== "object" || value === null) return false;
  const l = value as Record<string, unknown>;
  return (
    typeof l.effectId === "string" &&
    typeof l.params === "object" &&
    l.params !== null &&
    typeof l.enabled === "boolean" &&
    typeof l.opacity === "number" &&
    typeof l.blendMode === "string"
  );
}

/** Validates a parsed JSON value against the PresetDocument shape BEFORE
 *  any use — a hand-edited or corrupted file must fail here with a clear
 *  message, never reach `presetDocument.apply()`/crash the app (design.md
 *  §5.6, R8). Rust's `import_preset` does zero validation by design (§4.2) —
 *  this is the ONLY place schema validation happens. */
export function validatePresetDocument(raw: unknown): { valid: true; doc: PresetDocument } | { valid: false; error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { valid: false, error: "Fichier de preset invalide : contenu JSON attendu, objet introuvable." };
  }
  const d = raw as Record<string, unknown>;

  if (typeof d.schemaVersion !== "number") {
    return { valid: false, error: "Fichier de preset invalide : schemaVersion manquant." };
  }
  if (d.schemaVersion > PRESET_SCHEMA_VERSION) {
    return {
      valid: false,
      error: `Fichier de preset invalide : schemaVersion (${d.schemaVersion}) plus récent que celui supporté par cette version de l'app (${PRESET_SCHEMA_VERSION}).`,
    };
  }
  if (typeof d.name !== "string" || typeof d.id !== "string" || typeof d.createdAt !== "string" || typeof d.updatedAt !== "string") {
    return { valid: false, error: "Fichier de preset invalide : champs id/name/createdAt/updatedAt manquants ou mal typés." };
  }
  if (!Array.isArray(d.layers) || !d.layers.every(isPresetLayer)) {
    return { valid: false, error: "Fichier de preset invalide : le tableau layers est absent ou contient une entrée malformée." };
  }

  return { valid: true, doc: raw as PresetDocument };
}
