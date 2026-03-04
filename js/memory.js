/**
 * memory.js
 * ─────────────────────────────────────────────────────────
 * WebAssembly.Memory initialization, constants, and all
 * raw read/write helper functions.
 *
 * Globals exported (used by ui.js and steps.js):
 *   wasmMemory, fontAddr, stalePtr, newObjAddr, t0
 *   MAGIC_FONT, MAGIC_NEW, VTABLE_LEGIT, VTABLE_FAKE
 *   BASE_OFFSET, FONT_SIZE
 * ─────────────────────────────────────────────────────────
 */

// ── Constants ────────────────────────────────────────────
const MAGIC_FONT = 0xfafafafa; // FontFeatureValues object marker
const MAGIC_NEW = 0xbeefbeef; // Attacker-controlled object marker
const VTABLE_LEGIT = 0x00002000; // Chrome's real render() vtable ptr
const VTABLE_FAKE = 0x00004141; // Attacker's fake vtable (0x41 = 'A')

const BASE_OFFSET = 0x0100; // Start of our simulated heap (offset 256)
const FONT_SIZE = 48; // sizeof(FontObject) in bytes

/*
 * FontObject struct layout (offsets from BASE_OFFSET):
 *   +0x00  magic      (4 bytes)  = MAGIC_FONT
 *   +0x04  name[32]   (32 bytes) = "HackFont\0..."
 *   +0x24  value      (4 bytes)  = styleset ID
 *   +0x28  vtable_ptr (4 bytes)  = pointer to render()
 *   +0x2C  refcount   (4 bytes)  = reference count
 *   Total  = 48 bytes
 */

// ── Shared State ─────────────────────────────────────────
// Declared as var so they are accessible across all script files
var wasmMemory = new WebAssembly.Memory({ initial: 1 }); // 64 KB real OS page
var fontAddr = null; // current FontObject offset inside WASM memory
var stalePtr = null; // dangling pointer (retains old address after free)
var newObjAddr = null; // new object that fills the freed slot
var t0 = Date.now(); // simulation start time for log timestamps

// ── Memory Access Helpers ────────────────────────────────

/** Returns a live Uint8Array view of WASM memory */
function u8() {
  return new Uint8Array(wasmMemory.buffer);
}

/** Returns a live DataView of WASM memory */
function dv() {
  return new DataView(wasmMemory.buffer);
}

/**
 * Write a 32-bit unsigned integer (little-endian) to WASM memory.
 * @param {number} off - Byte offset into wasmMemory
 * @param {number} val - Value to write
 */
function writeU32(off, val) {
  dv().setUint32(off, val, true);
}

/**
 * Read a 32-bit unsigned integer (little-endian) from WASM memory.
 * @param {number} off - Byte offset into wasmMemory
 * @returns {number}
 */
function readU32(off) {
  return dv().getUint32(off, true);
}

/**
 * Write a null-terminated ASCII string into WASM memory.
 * Pads remaining bytes with 0x00 up to maxLen.
 * @param {number} off    - Byte offset to write to
 * @param {string} str    - String to write
 * @param {number} maxLen - Maximum field width (default 32)
 */
function writeStr(off, str, maxLen = 32) {
  const mem = u8();
  for (let i = 0; i < maxLen; i++) mem[off + i] = 0; // zero fill
  for (let i = 0; i < Math.min(str.length, maxLen - 1); i++) {
    mem[off + i] = str.charCodeAt(i);
  }
}

/**
 * Read a null-terminated ASCII string from WASM memory.
 * @param {number} off    - Byte offset to read from
 * @param {number} maxLen - Maximum bytes to scan (default 32)
 * @returns {string}
 */
function readStr(off, maxLen = 32) {
  const mem = u8();
  let s = "";
  for (let i = 0; i < maxLen; i++) {
    if (mem[off + i] === 0) break;
    s += String.fromCharCode(mem[off + i]);
  }
  return s;
}

/**
 * Zero out a region of WASM memory.
 * @param {number} off - Start offset
 * @param {number} len - Number of bytes to clear
 */
function clearRegion(off, len) {
  u8().fill(0, off, off + len);
}
