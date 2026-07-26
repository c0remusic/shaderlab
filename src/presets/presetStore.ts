import type { PresetDocument } from "./presetTypes";
import {
  listPresetIds,
  readPreset,
  writePreset,
  deletePreset,
  pickPresetExportPath,
  exportPreset,
  pickPresetImportPath,
  importPreset,
} from "../launch";
import { validatePresetDocument } from "./presetImportValidation";
import { resolveImportName } from "./presetImportNaming";

export interface PresetSummary {
  id: string;
  name: string;
  updatedAt: string;
}

/** Port for the preset library — production (`TauriPresetStore`) and test
 *  (`InMemoryPresetStore`) implementations, same shape as `PathAvailability`
 *  in `src/export/exportImage.ts`. `rename` is load+patch+save, not a
 *  dedicated Rust command (design.md §4.2 — the file never moves). */
export interface PresetStore {
  list(): Promise<PresetSummary[]>;
  load(id: string): Promise<PresetDocument>;
  save(id: string, doc: PresetDocument): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  exportTo(defaultFileName: string, doc: PresetDocument): Promise<boolean>;
  importFrom(): Promise<PresetDocument | null>;
}

export class TauriPresetStore implements PresetStore {
  /** `id` comes from the FILENAME STEM returned by `list_preset_ids`
   *  (`src-tauri/src/lib.rs`'s `list_preset_ids`, which derives it from
   *  `path.file_stem()`), never from `doc.id` inside the parsed content.
   *  `save`/`rename` always keep the two in sync, but a hand-edited file on
   *  disk could diverge — using the content's `id` here would then produce a
   *  summary whose `id` doesn't match any real filename, and a later
   *  `load(id)`/`rename(id, ...)` call built from that summary would 404
   *  against `preset_path`. The stem is the source of truth for "which file
   *  is this", exactly like `TauriPresetStore.rename` already treats `id` as
   *  immutable and separate from `doc.name`. */
  async list(): Promise<PresetSummary[]> {
    const ids = await listPresetIds();
    const summaries: PresetSummary[] = [];
    for (const id of ids) {
      const doc: PresetDocument = JSON.parse(await readPreset(id));
      summaries.push({ id, name: doc.name, updatedAt: doc.updatedAt });
    }
    return summaries;
  }

  async load(id: string): Promise<PresetDocument> {
    return JSON.parse(await readPreset(id));
  }

  async save(id: string, doc: PresetDocument): Promise<void> {
    await writePreset(id, JSON.stringify(doc, null, 2));
  }

  async rename(id: string, name: string): Promise<void> {
    const doc = await this.load(id);
    const updated: PresetDocument = { ...doc, name, updatedAt: new Date().toISOString() };
    await this.save(id, updated);
  }

  async remove(id: string): Promise<void> {
    await deletePreset(id);
  }

  async exportTo(defaultFileName: string, doc: PresetDocument): Promise<boolean> {
    const path = await pickPresetExportPath(defaultFileName);
    if (!path) return false;
    await exportPreset(path, JSON.stringify(doc, null, 2));
    return true;
  }

  async importFrom(): Promise<PresetDocument | null> {
    const path = await pickPresetImportPath();
    if (!path) return null;
    const raw = JSON.parse(await importPreset(path));
    const result = validatePresetDocument(raw);
    if (!result.valid) throw new Error(result.error);
    // Decided by Antoine 2026-07-26 (design.md §9, P3): a name collision is
    // renamed to the first free "(copie[ N])" suffix, never silently
    // duplicated — resolveImportName is pure, this.list() supplies the
    // current names to check against.
    const existingNames = (await this.list()).map((s) => s.name);
    const resolvedName = resolveImportName(existingNames, result.doc.name);
    return { ...result.doc, id: crypto.randomUUID(), name: resolvedName }; // jamais l'id du fichier importé (design.md §5.6)
  }
}

/** In-memory double for tests — same role as the Set-backed
 *  `fakeAvailability` in `test/export/exportImage.test.ts`, no real IPC. */
export class InMemoryPresetStore implements PresetStore {
  private docs = new Map<string, PresetDocument>();

  async list(): Promise<PresetSummary[]> {
    return [...this.docs.values()].map((d) => ({ id: d.id, name: d.name, updatedAt: d.updatedAt }));
  }

  async load(id: string): Promise<PresetDocument> {
    const doc = this.docs.get(id);
    if (!doc) throw new Error(`Preset introuvable: ${id}`);
    return doc;
  }

  async save(id: string, doc: PresetDocument): Promise<void> {
    this.docs.set(id, doc);
  }

  async rename(id: string, name: string): Promise<void> {
    const doc = await this.load(id);
    this.docs.set(id, { ...doc, name, updatedAt: new Date().toISOString() });
  }

  async remove(id: string): Promise<void> {
    this.docs.delete(id);
  }

  async exportTo(): Promise<boolean> {
    throw new Error("exportTo: not implemented until Task 6");
  }

  async importFrom(): Promise<PresetDocument | null> {
    throw new Error("importFrom: not implemented until Task 6");
  }
}
