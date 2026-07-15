#!/usr/bin/env node
// Hand-rolled MINIDUMP parser for root-causing WebView2/Tauri crashes on
// Windows when WinDbg/cdb/dotnet-dump aren't installed (none are, on this
// machine, as of 2026-07-15 — see the "minidump-forensics-technique"
// project memory for the full writeup of why/how this was built).
//
// Crashpad writes real .dmp files to:
//   %LOCALAPPDATA%\<bundle-identifier>\EBWebView\Crashpad\reports\*.dmp
// (bundle identifier = the "identifier" field in src-tauri/tauri.conf.json,
// e.g. com.c0remusic.shaderlab)
//
// This won't symbolize closed-source Microsoft modules (msedge.dll etc.) —
// no public symbol server access here — but it WILL give you: the exact
// exception code/address, which module the crash is in, whether multiple
// crashes share an identical signature (same bug recurring vs. a new one),
// and a rough module-level stack walk from the crashing thread's RSP.
//
// Usage: node scripts/parse-minidump.mjs <path-to.dmp> [--stack]
//   --stack   also do the (slow-ish) RSP-based module stack walk

import { readFileSync } from "node:fs";

const path = process.argv[2];
const wantStack = process.argv.includes("--stack");
if (!path) {
  console.error("Usage: node scripts/parse-minidump.mjs <path-to.dmp> [--stack]");
  process.exit(1);
}

const buf = readFileSync(path);

// --- MINIDUMP_HEADER ---
const numStreams = buf.readUInt32LE(8);
const streamDirRva = buf.readUInt32LE(12);
const timeDateStamp = buf.readUInt32LE(20);

function readUtf16String(rva) {
  // MINIDUMP_STRING: u32 Length (bytes, no null terminator), then UTF-16LE buffer
  const len = buf.readUInt32LE(rva);
  return buf.toString("utf16le", rva + 4, rva + 4 + len);
}

// MINIDUMP_STREAM_TYPE — verified against the real Windows SDK enum, do
// NOT guess these from memory (Memory64ListStream=9 and
// MemoryInfoListStream=16 are easy to get backwards).
const STREAM_TYPES = {
  3: "ThreadListStream",
  4: "ModuleListStream",
  5: "MemoryListStream",
  6: "ExceptionStream",
  7: "SystemInfoStream",
  8: "ThreadExListStream",
  9: "Memory64ListStream",
  10: "CommentStreamA",
  11: "CommentStreamW",
  12: "HandleDataStream",
  13: "FunctionTableStream",
  14: "UnloadedModuleListStream",
  15: "MiscInfoStream",
  16: "MemoryInfoListStream",
  17: "ThreadInfoListStream",
  18: "HandleOperationListStream",
  19: "TokenStream",
  20: "JavaScriptDataStream",
  21: "SystemMemoryInfoStream",
  22: "ProcessVmCountersStream",
  23: "IptTraceStream",
  24: "ThreadNamesStream",
};

let modules = [];
let threads = [];
let memRanges = [];
let exceptionThreadId = null;
let exceptionInfo = null;

for (let i = 0; i < numStreams; i++) {
  const entryOff = streamDirRva + i * 12;
  const streamType = buf.readUInt32LE(entryOff);
  const rva = buf.readUInt32LE(entryOff + 8);

  if (streamType === 4) {
    // MINIDUMP_MODULE_LIST
    const numModules = buf.readUInt32LE(rva);
    let off = rva + 4;
    const MODULE_SIZE = 108; // sizeof(MINIDUMP_MODULE)
    for (let m = 0; m < numModules; m++) {
      const base = buf.readBigUInt64LE(off);
      const size = buf.readUInt32LE(off + 8);
      const nameRva = buf.readUInt32LE(off + 20); // NOT +12 — CheckSum/TimeDateStamp are in between
      const name = readUtf16String(nameRva);
      modules.push({ base, end: base + BigInt(size), name: name.split("\\").pop() });
      off += MODULE_SIZE;
    }
  }

  if (streamType === 6) {
    // MINIDUMP_EXCEPTION_STREAM
    exceptionThreadId = buf.readUInt32LE(rva);
    const excOff = rva + 8; // after ThreadId(4) + alignment(4)
    exceptionInfo = {
      code: buf.readUInt32LE(excOff),
      flags: buf.readUInt32LE(excOff + 4),
      address: buf.readBigUInt64LE(excOff + 16),
    };
  }

  if (streamType === 3) {
    // MINIDUMP_THREAD_LIST — each MINIDUMP_THREAD is 48 bytes:
    // ThreadId(4) SuspendCount(4) PriorityClass(4) Priority(4) Teb(8)
    // Stack{StartOfMemoryRange(8) DataSize(4) Rva(4)} ThreadContext{DataSize(4) Rva(4)}
    const numThreads = buf.readUInt32LE(rva);
    let off = rva + 4;
    for (let t = 0; t < numThreads; t++) {
      threads.push({
        threadId: buf.readUInt32LE(off),
        stackStart: buf.readBigUInt64LE(off + 24),
        stackDataSize: buf.readUInt32LE(off + 32),
        stackRva: buf.readUInt32LE(off + 36),
        contextDataSize: buf.readUInt32LE(off + 40),
        contextRva: buf.readUInt32LE(off + 44),
      });
      off += 48;
    }
  }

  if (streamType === 5) {
    // MINIDUMP_MEMORY_LIST
    const numRanges = buf.readUInt32LE(rva);
    let off = rva + 4;
    for (let r = 0; r < numRanges; r++) {
      memRanges.push({
        start: buf.readBigUInt64LE(off),
        size: buf.readUInt32LE(off + 8),
        rva: buf.readUInt32LE(off + 12),
      });
      off += 16;
    }
  }
}

function findModule(addr) {
  return modules.find((m) => addr >= m.base && addr < m.end);
}

console.log("file:", path);
console.log("crash time (unix):", timeDateStamp, new Date(timeDateStamp * 1000).toISOString());
console.log("numStreams:", numStreams, "numModules:", modules.length, "numThreads:", threads.length);

if (exceptionInfo) {
  const mod = findModule(exceptionInfo.address);
  console.log("\nEXCEPTION:");
  console.log("  threadId:", exceptionThreadId);
  console.log("  code: 0x" + exceptionInfo.code.toString(16));
  console.log(
    "  address: 0x" + exceptionInfo.address.toString(16),
    mod ? `(${mod.name} +0x${(exceptionInfo.address - mod.base).toString(16)})` : "(unknown module)"
  );
}

if (wantStack && exceptionThreadId !== null) {
  const thread = threads.find((t) => t.threadId === exceptionThreadId);
  if (!thread) {
    console.log("\nCould not find exception thread in thread list — no stack walk possible.");
  } else {
    // AMD64 CONTEXT layout: Rsp at offset 0x98, Rip at offset 0xF8
    const rsp = buf.readBigUInt64LE(thread.contextRva + 0x98);
    const rip = buf.readBigUInt64LE(thread.contextRva + 0xf8);
    const ripMod = findModule(rip);
    console.log("\nCONTEXT at crash:");
    console.log("  RIP: 0x" + rip.toString(16), ripMod ? `(${ripMod.name})` : "");
    console.log("  RSP: 0x" + rsp.toString(16));

    const stackRange = memRanges.find((r) => rsp >= r.start && rsp < r.start + BigInt(r.size));
    if (!stackRange) {
      console.log("\nNo captured MemoryListStream range contains RSP — stack walk not possible from this dump.");
    } else {
      console.log("\nModule-frequency stack scan (poor man's walk — no frame-pointer unwinding,");
      console.log("just scanning qwords from RSP forward and matching against known module ranges):");
      const tally = new Map();
      const startOffset = Number(rsp - stackRange.start);
      for (let o = startOffset; o + 8 <= stackRange.size; o += 8) {
        const val = buf.readBigUInt64LE(stackRange.rva + o);
        const mod = findModule(val);
        if (mod) tally.set(mod.name, (tally.get(mod.name) || 0) + 1);
      }
      [...tally.entries()]
        .sort((a, b) => b[1] - a[1])
        .forEach(([name, count]) => console.log(`  ${name}: ${count}`));
    }
  }
}
