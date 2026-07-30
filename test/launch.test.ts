import { describe, it, expect } from "vitest";
import { resolveLaunchFile } from "../src/launch";

// Filet du chemin « Ouvrir avec » de Windows (audit pré-release 2026-07-30,
// finding R3). `App.tsx` n'est pas testable ici — convention du projet, voir
// test/App.test.ts — donc c'est la fonction extraite qui est couverte, et le
// composant ne garde que le branchement React.
//
// Les deux commandes IPC sont injectées : aucun `invoke` Tauri n'existe sous
// Vitest, et les faux ci-dessous enregistrent leurs appels pour prouver que la
// lecture n'a PAS lieu quand il n'y a pas d'argument de lancement.

describe("resolveLaunchFile", () => {
  it("rend null et ne lit aucun fichier quand l'app est lancée sans argument", async () => {
    const read: string[] = [];
    const launch = await resolveLaunchFile({
      getPath: async () => null,
      readFile: async (p) => {
        read.push(p);
        return new Uint8Array();
      },
    });
    expect(launch).toBeNull();
    expect(read).toEqual([]);
  });

  it("rend un File nommé par le chemin, chargé des octets lus, quand un chemin est passé", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const read: string[] = [];
    const launch = await resolveLaunchFile({
      getPath: async () => "C:\\photos\\éclair.jpg",
      readFile: async (p) => {
        read.push(p);
        return bytes;
      },
    });
    expect(read).toEqual(["C:\\photos\\éclair.jpg"]);
    expect(launch).not.toBeNull();
    expect(launch!.path).toBe("C:\\photos\\éclair.jpg");
    expect(launch!.file.name).toBe("C:\\photos\\éclair.jpg");
    expect(launch!.file.type).toBe("image/jpeg");
    // Les octets traversent réellement — un File vide passerait les
    // assertions de nom et de type sans rien ouvrir.
    expect(new Uint8Array(await launch!.file.arrayBuffer())).toEqual(bytes);
  });

  it("rejette quand le transport IPC casse — c'est ce rejet qui flottait (finding R2)", async () => {
    const ipcDown = new Error("ipc transport closed");
    await expect(
      resolveLaunchFile({
        getPath: async () => {
          throw ipcDown;
        },
        readFile: async () => new Uint8Array(),
      }),
    ).rejects.toBe(ipcDown);
  });

  it("rejette quand le fichier passé au lancement est illisible", async () => {
    const unreadable = new Error("Le fichier est introuvable");
    await expect(
      resolveLaunchFile({
        getPath: async () => "C:\\photos\\disparue.jpg",
        readFile: async () => {
          throw unreadable;
        },
      }),
    ).rejects.toBe(unreadable);
  });
});
