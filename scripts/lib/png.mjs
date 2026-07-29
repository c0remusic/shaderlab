// PNG 8 bits RGBA, encodage et decodage, sans dependance.
//
// Pourquoi ecrire ca plutot que prendre une lib : le harnais de non-regression
// de rendu (`scripts/render-check.mjs`) compare des PIXELS, jamais des octets
// de fichier. Le PNG n'est ici qu'un CONTENEUR de stockage — choisi parce
// qu'il est SANS PERTE (donc `decode(encode(px)) === px`, octet pour octet) et
// parce qu'un humain peut ouvrir la reference et la regarder. Une lib
// d'encodage ajouterait une dependance et, surtout, une inconnue : rien ne
// garantirait qu'elle ne fasse pas de conversion d'espace colorimetrique au
// passage. Ici la chaine est explicite et verifiee par `test/scripts/png.test.ts`.
//
// Portee volontairement etroite : profondeur 8 bits, type couleur 6 (RGBA),
// non entrelace. Tout le reste LEVE — on ne lit que nos propres fichiers, et
// un PNG exotique glisse dans le dossier de references doit se voir, pas se
// faire deviner.

import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Encode `pixels` (RGBA tightement pack, `width * height * 4` octets) en PNG.
 *  Le filtre de chaque ligne est choisi par l'heuristique classique de la
 *  specification (somme des valeurs absolues la plus faible) — purement une
 *  affaire de taille de fichier, sans effet sur les pixels relus. */
export function encodePng(pixels, width, height) {
  if (pixels.length !== width * height * 4)
    throw new Error(`encodePng: ${pixels.length} octets pour ${width}x${height} RGBA (attendu ${width * height * 4})`);
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  const candidates = [Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride), Buffer.alloc(stride)];
  for (let y = 0; y < height; y++) {
    const row = pixels.subarray(y * stride, y * stride + stride);
    const prev = y === 0 ? null : pixels.subarray((y - 1) * stride, (y - 1) * stride + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? row[x - 4] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= 4 ? prev[x - 4] : 0;
      candidates[0][x] = row[x];
      candidates[1][x] = (row[x] - a) & 0xff;
      candidates[2][x] = (row[x] - b) & 0xff;
      candidates[3][x] = (row[x] - ((a + b) >> 1)) & 0xff;
      candidates[4][x] = (row[x] - paeth(a, b, c)) & 0xff;
    }
    let best = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      let score = 0;
      for (let x = 0; x < stride; x++) score += candidates[f][x] < 128 ? candidates[f][x] : 256 - candidates[f][x];
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
    }
    raw[y * (stride + 1)] = best;
    candidates[best].copy(raw, y * (stride + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // profondeur
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Decode un PNG 8 bits RGBA non entrelace. Rend `{ width, height, pixels }`,
 *  `pixels` etant un `Uint8Array` RGBA tightement pack. */
export function decodePng(buffer) {
  const buf = Buffer.from(buffer);
  if (!buf.subarray(0, 8).equals(SIGNATURE)) throw new Error("decodePng: signature PNG absente");
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat = [];
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error(`decodePng: profondeur ${data[8]} non supportee (8 attendue)`);
      if (data[9] !== 6) throw new Error(`decodePng: type couleur ${data[9]} non supporte (6 = RGBA attendu)`);
      if (data[12] !== 0) throw new Error("decodePng: PNG entrelace non supporte");
    } else if (type === "IDAT") {
      idat.push(Buffer.from(data));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  if (raw.length !== (stride + 1) * height)
    throw new Error(`decodePng: ${raw.length} octets decompresses pour ${width}x${height} (attendu ${(stride + 1) * height})`);
  const pixels = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const out = pixels.subarray(y * stride, y * stride + stride);
    const prev = y === 0 ? null : pixels.subarray((y - 1) * stride, (y - 1) * stride + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[x - 4] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= 4 ? prev[x - 4] : 0;
      let value;
      if (filter === 0) value = src[x];
      else if (filter === 1) value = src[x] + a;
      else if (filter === 2) value = src[x] + b;
      else if (filter === 3) value = src[x] + ((a + b) >> 1);
      else if (filter === 4) value = src[x] + paeth(a, b, c);
      else throw new Error(`decodePng: filtre ${filter} inconnu (ligne ${y})`);
      out[x] = value & 0xff;
    }
  }
  return { width, height, pixels };
}
