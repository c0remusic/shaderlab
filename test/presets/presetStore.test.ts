import { describe, expect, it, vi, beforeEach } from "vitest";
import { InMemoryPresetStore, PartialPresetListError, TauriPresetStore } from "../../src/presets/presetStore";
import type { PresetDocument } from "../../src/presets/presetTypes";
import * as launch from "../../src/launch";

const doc: PresetDocument = {
  schemaVersion: 1,
  id: "preset-1",
  name: "Mon preset",
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:00:00.000Z",
  layers: [],
};

describe("InMemoryPresetStore", () => {
  it("saves then lists a summary with id/name/updatedAt", async () => {
    const store = new InMemoryPresetStore();
    await store.save(doc.id, doc);
    expect(await store.list()).toEqual([{ id: "preset-1", name: "Mon preset", updatedAt: doc.updatedAt }]);
    expect(await store.load(doc.id)).toEqual(doc);
  });

  it("rename updates the name and is visible in list()", async () => {
    const store = new InMemoryPresetStore();
    await store.save(doc.id, doc);
    await store.rename(doc.id, "Nouveau nom");
    const [summary] = await store.list();
    expect(summary.name).toBe("Nouveau nom");
  });

  it("remove deletes the preset", async () => {
    const store = new InMemoryPresetStore();
    await store.save(doc.id, doc);
    await store.remove(doc.id);
    expect(await store.list()).toEqual([]);
  });
});

describe("TauriPresetStore", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("list() calls listPresetIds then readPreset per id, mapping to summaries", async () => {
    vi.spyOn(launch, "listPresetIds").mockResolvedValue(["preset-1"]);
    vi.spyOn(launch, "readPreset").mockResolvedValue(JSON.stringify(doc));
    const store = new TauriPresetStore();
    const summaries = await store.list();
    expect(summaries).toEqual([{ id: "preset-1", name: "Mon preset", updatedAt: doc.updatedAt }]);
  });

  it("list() uses the FILENAME STEM as id, not doc.id from the file's content, when they diverge", async () => {
    // A hand-edited file: the disk filename is "stem-on-disk.json" but the
    // JSON content's own `id` field still says "preset-1" — proves list()
    // doesn't silently trust the content over the real filename (see
    // presetStore.ts's `list()` doc comment).
    vi.spyOn(launch, "listPresetIds").mockResolvedValue(["stem-on-disk"]);
    vi.spyOn(launch, "readPreset").mockResolvedValue(JSON.stringify(doc)); // doc.id === "preset-1"
    const store = new TauriPresetStore();
    const summaries = await store.list();
    expect(summaries).toEqual([{ id: "stem-on-disk", name: "Mon preset", updatedAt: doc.updatedAt }]);
  });

  it("save() calls writePreset with the id and a JSON-stringified doc", async () => {
    const writeSpy = vi.spyOn(launch, "writePreset").mockResolvedValue(undefined);
    const store = new TauriPresetStore();
    await store.save(doc.id, doc);
    expect(writeSpy).toHaveBeenCalledWith(doc.id, JSON.stringify(doc, null, 2));
  });

  it("load() calls readPreset and parses the JSON", async () => {
    vi.spyOn(launch, "readPreset").mockResolvedValue(JSON.stringify(doc));
    const store = new TauriPresetStore();
    expect(await store.load(doc.id)).toEqual(doc);
  });

  it("rename() loads, patches name+updatedAt, then saves under the same id", async () => {
    vi.spyOn(launch, "readPreset").mockResolvedValue(JSON.stringify(doc));
    const writeSpy = vi.spyOn(launch, "writePreset").mockResolvedValue(undefined);
    const store = new TauriPresetStore();
    await store.rename(doc.id, "Renommé");
    const [id, contents] = writeSpy.mock.calls[0];
    expect(id).toBe(doc.id);
    expect(JSON.parse(contents).name).toBe("Renommé");
  });

  it("remove() calls deletePreset", async () => {
    const deleteSpy = vi.spyOn(launch, "deletePreset").mockResolvedValue(undefined);
    const store = new TauriPresetStore();
    await store.remove(doc.id);
    expect(deleteSpy).toHaveBeenCalledWith(doc.id);
  });

  // Important 5 (final-review fix): one corrupt preset file used to reject
  // list() ENTIRELY, hiding every other, perfectly valid preset — this test
  // proves the fix: the sane presets still come back, and the failure is
  // reported by NAME rather than swallowed.
  it("list() ignores an unparseable entry but still returns the readable ones, naming the bad id", async () => {
    const doc2: PresetDocument = { ...doc, id: "preset-2", name: "Autre preset" };
    vi.spyOn(launch, "listPresetIds").mockResolvedValue(["preset-1", "corrupt-preset", "preset-2"]);
    vi.spyOn(launch, "readPreset").mockImplementation(async (id: string) => {
      if (id === "corrupt-preset") return "{not valid json";
      if (id === "preset-1") return JSON.stringify(doc);
      return JSON.stringify(doc2);
    });
    const store = new TauriPresetStore();
    await expect(store.list()).rejects.toMatchObject({
      summaries: [
        { id: "preset-1", name: "Mon preset", updatedAt: doc.updatedAt },
        { id: "preset-2", name: "Autre preset", updatedAt: doc2.updatedAt },
      ],
      unreadableIds: ["corrupt-preset"],
    });
  });

  it("list() throws a PartialPresetListError instance (not a bare Error) so callers can recover the parsed summaries", async () => {
    vi.spyOn(launch, "listPresetIds").mockResolvedValue(["corrupt-preset"]);
    vi.spyOn(launch, "readPreset").mockResolvedValue("{not valid json");
    const store = new TauriPresetStore();
    try {
      await store.list();
      expect.unreachable("list() should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(PartialPresetListError);
      expect((e as PartialPresetListError).message).toContain("corrupt-preset");
    }
  });

  it("list() returns normally (no throw) when every entry parses", async () => {
    vi.spyOn(launch, "listPresetIds").mockResolvedValue(["preset-1"]);
    vi.spyOn(launch, "readPreset").mockResolvedValue(JSON.stringify(doc));
    const store = new TauriPresetStore();
    await expect(store.list()).resolves.toEqual([{ id: "preset-1", name: "Mon preset", updatedAt: doc.updatedAt }]);
  });
});
