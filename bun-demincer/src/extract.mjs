import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";

const TRAILER = "\n---- Bun! ----\n";
const SECTION_HEADER_SIZE = 8; // u64 size header in __BUN Mach-O section

const binaryPath = process.argv[2];
if (!binaryPath) {
  console.error("Usage: node extract.mjs <bun-binary> [output-dir]");
  process.exit(1);
}
const outDir = process.argv[3] || "./extracted";

console.log(`Reading binary: ${binaryPath}`);
const buf = readFileSync(binaryPath);
const fileSize = buf.length;
console.log(`Binary size: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

// --- Step 1: Find the __BUN section offset via Mach-O parsing ---
// Look for the __bun section name in the load commands
let sectionOffset = -1;
let sectionSize = 0;

// Search for "__bun" section marker in Mach-O headers (first 4KB)
for (let i = 0; i < Math.min(fileSize, 8192); i++) {
  // Look for "__bun\0" followed by "__BUN\0"
  if (buf[i] === 0x5f && buf[i+1] === 0x5f && buf[i+2] === 0x62 &&
      buf[i+3] === 0x75 && buf[i+4] === 0x6e && buf[i+5] === 0x00) {
    // This is a section header - check if segname is __BUN
    if (buf[i+16] === 0x5f && buf[i+17] === 0x5f && buf[i+18] === 0x42 &&
        buf[i+19] === 0x55 && buf[i+20] === 0x4e) {
      // Read offset and size from section_64 header
      // For 64-bit: addr(8), size(8), offset(4), align(4)...
      sectionOffset = buf.readUInt32LE(i + 48); // offset field
      sectionSize = Number(buf.readBigUInt64LE(i + 40)); // size field
      console.log(`Found __BUN/__bun section: offset=${sectionOffset}, size=${sectionSize}`);
      break;
    }
  }
}

if (sectionOffset === -1) {
  console.log("No Mach-O section found, searching for trailer directly...");
}

// --- Step 2: Find the trailer ---
const trailerBuf = Buffer.from(TRAILER);
let trailerOffset = -1;
for (let i = fileSize - trailerBuf.length; i >= Math.max(0, fileSize - 4 * 1024 * 1024); i--) {
  if (buf[i] === 0x0a && buf.subarray(i, i + trailerBuf.length).equals(trailerBuf)) {
    trailerOffset = i;
    break;
  }
}
if (trailerOffset === -1) {
  console.error("Could not find Bun trailer!");
  process.exit(1);
}
console.log(`Trailer at offset: ${trailerOffset}`);

// --- Step 3: Read Offsets struct (32 bytes before trailer) ---
// Offsets = { byte_count: u64, modules_ptr: {u32,u32}, entry_point_id: u32,
//             exec_argv_ptr: {u32,u32}, flags: u32 }
const os = trailerOffset - 32;
const byteCount = Number(buf.readBigUInt64LE(os));
const modOffset = buf.readUInt32LE(os + 8);
const modLength = buf.readUInt32LE(os + 12);
const entryPointId = buf.readUInt32LE(os + 16);
const flags = buf.readUInt32LE(os + 28);

console.log(`\nOffsets: byteCount=${byteCount}, modules={off:${modOffset},len:${modLength}}, entry=${entryPointId}, flags=0x${flags.toString(16)}`);

// --- Step 4: Calculate data_start ---
// On Mach-O, the __BUN section has an 8-byte size header, then the data
// StringPointer offsets are relative to the start of data (after the header)
let dataStart;
if (sectionOffset >= 0) {
  dataStart = sectionOffset + SECTION_HEADER_SIZE;
} else {
  // Fallback: compute from trailer
  dataStart = trailerOffset + trailerBuf.length - byteCount;
}
console.log(`Data starts at: ${dataStart}`);

// --- Step 5: Parse module table ---
const MODULE_SIZE = 52;
const numModules = Math.floor(modLength / MODULE_SIZE);
console.log(`\nModules: ${numModules}`);

mkdirSync(outDir, { recursive: true });

const modules = [];
for (let i = 0; i < numModules; i++) {
  const base = dataStart + modOffset + i * MODULE_SIZE;

  const nameOff = buf.readUInt32LE(base);
  const nameLen = buf.readUInt32LE(base + 4);
  const contOff = buf.readUInt32LE(base + 8);
  const contLen = buf.readUInt32LE(base + 12);
  const smapOff = buf.readUInt32LE(base + 16);
  const smapLen = buf.readUInt32LE(base + 20);
  const bcOff = buf.readUInt32LE(base + 24);
  const bcLen = buf.readUInt32LE(base + 28);
  const encoding = buf[base + 48];  // 0=binary, 1=latin1, 2=utf8
  const loader = buf[base + 49];    // 1=js
  const modFormat = buf[base + 50]; // 0=none, 1=esm, 2=cjs
  const side = buf[base + 51];      // 0=server, 1=client

  const name = buf.subarray(dataStart + nameOff, dataStart + nameOff + nameLen).toString("utf-8");

  modules.push({
    index: i,
    name,
    contOff, contLen,
    smapOff, smapLen,
    bcOff, bcLen,
    encoding, loader, modFormat, side,
    isEntry: i === entryPointId,
  });

  const loaderNames = { 0: 'file', 1: 'js', 9: 'wasm', 10: 'napi' };
  const formatNames = { 0: 'none', 1: 'esm', 2: 'cjs' };
  const encNames = { 0: 'binary', 1: 'latin1', 2: 'utf8' };

  console.log(`  [${i}]${i === entryPointId ? " ENTRY" : ""} ${name}`);
  console.log(`      source: ${(contLen/1024).toFixed(1)}KB | bytecode: ${(bcLen/1024).toFixed(1)}KB | loader: ${loaderNames[loader]||loader} | format: ${formatNames[modFormat]||modFormat} | enc: ${encNames[encoding]||encoding} | side: ${side === 0 ? 'server' : 'client'}`);
}

// --- Step 6: Extract files ---
console.log(`\nExtracting to ${outDir}/...`);

for (const mod of modules) {
  if (mod.contLen === 0) continue;

  // Create path structure
  let relPath = mod.name
    .replace(/^\/\$bunfs\/root\//, "")
    .replace(/^\$bunfs\/root\//, "");

  const outPath = join(outDir, relPath);
  const dir = dirname(outPath);
  mkdirSync(dir, { recursive: true });

  // Extract content as Buffer (handles both text and binary)
  const content = buf.subarray(dataStart + mod.contOff, dataStart + mod.contOff + mod.contLen);
  writeFileSync(outPath, content);

  const sizeStr = mod.contLen > 1024*1024
    ? `${(mod.contLen/1024/1024).toFixed(1)}MB`
    : `${(mod.contLen/1024).toFixed(1)}KB`;
  console.log(`  ${relPath} (${sizeStr})`);

  // Extract sourcemap if present
  if (mod.smapLen > 0) {
    const smap = buf.subarray(dataStart + mod.smapOff, dataStart + mod.smapOff + mod.smapLen);
    writeFileSync(outPath + ".map", smap);
    console.log(`  ${relPath}.map (${(mod.smapLen/1024).toFixed(1)}KB)`);
  }
}

// --- Step 7: Write manifest ---
const manifest = {
  binaryPath,
  entryPoint: modules[entryPointId]?.name,
  entryPointId,
  flags,
  modules: modules.map(m => ({
    index: m.index,
    name: m.name,
    sourceSize: m.contLen,
    bytecodeSize: m.bcLen,
    sourcemapSize: m.smapLen,
    isEntry: m.isEntry,
    encoding: m.encoding,
    loader: m.loader,
    format: m.modFormat,
    side: m.side,
  }))
};
writeFileSync(join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`\nManifest: ${outDir}/manifest.json`);
console.log("Done!");
