/**
 * steps.js
 * ─────────────────────────────────────────────────────────
 * The four UAF simulation steps + logging helpers + reset.
 *
 * Depends on:
 *   memory.js  → wasmMemory, fontAddr, stalePtr, newObjAddr,
 *                t0, MAGIC_*, VTABLE_*, BASE_OFFSET, FONT_SIZE,
 *                writeU32, writeStr, readU32, readStr, clearRegion, u8
 *   ui.js      → renderHex, updateStructPanel, resetStructPanel,
 *                updateFontPtr, updateNewObjPtr, updateVtable,
 *                hex32, hex8, fmtAddr
 *   modal.js   → showModal, closeModal
 * ─────────────────────────────────────────────────────────
 */

// ── Log Helpers ──────────────────────────────────────────

/** Return a MM:SS timestamp relative to simulation start */
function ts() {
  const secs = Math.floor((Date.now() - t0) / 1000);
  return String(Math.floor(secs / 60)).padStart(2, '0') + ':'
       + String(secs % 60).padStart(2, '0');
}

/**
 * Append a colored entry to the memory event log.
 * @param {string} msg - Message text (may contain HTML)
 * @param {string} cls - CSS class: 'c-ok' | 'c-warn' | 'c-err' | 'c-danger' | 'c-dim'
 */
function log(msg, cls = 'c-ok') {
  const area = document.getElementById('logArea');
  const div  = document.createElement('div');
  div.className = 'le';
  div.innerHTML = `<span class="lt">${ts()}</span><span class="lm ${cls}">${msg}</span>`;
  area.appendChild(div);
  area.scrollTop = area.scrollHeight;
}

/** Enable/disable a step button */
function setBtn(id, disabled) {
  document.getElementById(id).disabled = disabled;
}

// ── Step 1: Allocate FontObject ──────────────────────────

/**
 * Simulates Chrome's C++ allocating a FontFeatureValues object
 * at BASE_OFFSET inside the real WebAssembly memory page.
 * Writes MAGIC_FONT, "HackFont", VTABLE_LEGIT, refcount=1.
 */
async function step1() {
  setBtn('btn1', true);

  // Set global state
  fontAddr  = BASE_OFFSET;
  stalePtr  = fontAddr; // pointer and object in sync — all valid

  // Write real bytes to real WASM memory
  writeU32(fontAddr,        MAGIC_FONT);
  writeStr(fontAddr + 4,   'HackFont', 32);
  writeU32(fontAddr + 0x24, 0x00000001);        // styleset value
  writeU32(fontAddr + 0x28, VTABLE_LEGIT);      // legitimate vtable
  writeU32(fontAddr + 0x2C, 0x00000001);        // reference count

  // Update UI
  renderHex(fontAddr, FONT_SIZE, 'alloc');
  updateStructPanel(fontAddr, 'alloc');
  updateFontPtr(fmtAddr(fontAddr), 'var(--green)', 'VALID', 'st-valid');
  updateVtable(hex32(VTABLE_LEGIT), 'var(--yellow)', '→ Chrome::FontEngine::render()');

  // Log
  log(`malloc(${FONT_SIZE}) → ${fmtAddr(fontAddr)}  (real WASM heap offset)`, 'c-ok');
  log(`Wrote FontObject to ${fmtAddr(fontAddr)} — magic: ${hex32(MAGIC_FONT)}`, 'c-ok');
  log(`vtable_ptr at ${fmtAddr(fontAddr + 0x28)} = ${hex32(VTABLE_LEGIT)}`, 'c-ok');

  // Modal
  await showModal(
    '✅',
    'Step 1: Memory Allocated — Real Bytes Written!',
    `// WebAssembly.Memory — real OS page
fontPtr = ${fmtAddr(fontAddr)}   ← REAL offset

Memory at ${fmtAddr(fontAddr)}:
  +0x00  magic    = ${hex32(MAGIC_FONT)}  (FontFeatureValues)
  +0x04  name     = "HackFont"
  +0x28  vtable   = ${hex32(VTABLE_LEGIT)}  ← render()
  +0x2C  refcount = 0x00000001`,
    `These are REAL bytes in a real 64 KB WebAssembly memory page allocated by Chrome. Open DevTools → Memory tab to verify. fontPtr holds the actual offset ${fmtAddr(fontAddr)} inside this buffer.`
  );

  setBtn('btn2', false);
}

// ── Step 2: Free Memory ──────────────────────────────────

/**
 * Simulates JavaScript deleting the CSS rule, which causes
 * Chrome's C++ destructor to call free() on the FontObject.
 *
 * Key bug: fontPtr is NOT cleared → dangling pointer created.
 * The allocator writes a freelist pointer (0xDEADDEAD) into
 * the first 4 bytes of the freed block immediately.
 */
async function step2() {
  setBtn('btn2', true);

  // Simulate allocator behaviour on free():
  //   - writes freelist ptr into first 4 bytes
  //   - rest of block is zeroed (for educational clarity)
  writeU32(fontAddr, 0xDEADDEAD); // freelist node overwrites magic
  for (let i = 4; i < FONT_SIZE; i++) u8()[fontAddr + i] = 0x00;

  // fontAddr object is gone, but stalePtr still holds the address!

  // Update UI
  renderHex(fontAddr, FONT_SIZE, 'free');
  updateStructPanel(fontAddr, 'free');
  updateFontPtr(
    fmtAddr(stalePtr) + '  ⚠️ DANGLING',
    'var(--red)',
    'DANGLING',
    'st-dangle'
  );
  updateVtable('UNDEFINED', 'var(--red)', '← reading freed memory!');

  // Log
  log(`free(${fmtAddr(fontAddr)}) — memory returned to allocator`, 'c-err');
  log(`Allocator wrote freelist node: ${hex32(0xDEADDEAD)} at offset +0x00`, 'c-warn');
  log(`fontPtr = ${fmtAddr(stalePtr)}  ← still set!  BUG: should be NULL`, 'c-err');
  log(`⚠️  DANGLING POINTER — memory at ${fmtAddr(stalePtr)} is now unowned`, 'c-err');

  // Modal
  await showModal(
    '⚠️',
    'Step 2: Memory Freed — Pointer Is Now Dangling!',
    `// Free called (CSS rule deleted by JS)
free(fontPtr);
// fontPtr = NULL;  ← THIS LINE MISSING! ❌

// Allocator immediately wrote into freed block:
Memory[${fmtAddr(fontAddr)}+0x00] = ${hex32(0xDEADDEAD)}  (freelist ptr)
Memory[${fmtAddr(fontAddr)}+0x04..] = 0x00  (zeroed)

fontPtr still = ${fmtAddr(stalePtr)}  ← DANGLING ☠️`,
    `The C++ destructor freed the FontObject. The allocator wrote a freelist pointer (0xDEADDEAD) into the first 4 bytes of the freed block — overwriting the magic number. But fontPtr was never cleared. It still points to ${fmtAddr(stalePtr)} which is now "no man's land".`
  );

  setBtn('btn3', false);
}

// ── Step 3: Fill Freed Slot ──────────────────────────────

/**
 * Simulates heap grooming — the attacker allocates objects
 * of the same size, causing the OS allocator to reuse
 * the freed slot at BASE_OFFSET.
 *
 * Attacker writes a FAKE vtable pointer into the slot,
 * which fontPtr (still dangling at this address) will read.
 */
async function step3() {
  setBtn('btn3', true);

  newObjAddr = fontAddr; // Same address — allocator reused the freed slot!

  // Write attacker-controlled data over the freed memory
  writeU32(newObjAddr,        MAGIC_NEW);          // new magic
  writeStr(newObjAddr + 4,   'INJECTED!', 32);    // attacker-controlled name
  writeU32(newObjAddr + 0x24, 0xAAAAAAAA);         // attacker value
  writeU32(newObjAddr + 0x28, VTABLE_FAKE);        // ← FAKE vtable pointer!
  writeU32(newObjAddr + 0x2C, 0xBBBBBBBB);        // attacker refcount

  // Update UI
  renderHex(fontAddr, FONT_SIZE, 'hijack');
  updateStructPanel(newObjAddr, 'hijack');
  updateNewObjPtr(fmtAddr(newObjAddr), 'var(--orange)');
  updateVtable(hex32(VTABLE_FAKE), '#ff3860', '← ATTACKER METHOD!');

  // Log
  log(`malloc(${FONT_SIZE}) → ${fmtAddr(newObjAddr)}  ← SAME address as freed FontObject!`, 'c-warn');
  log(`Wrote NewObject: magic=${hex32(MAGIC_NEW)}, name="INJECTED!"`, 'c-warn');
  log(`FAKE vtable written at ${fmtAddr(newObjAddr + 0x28)} = ${hex32(VTABLE_FAKE)}`, 'c-danger');
  log(`fontPtr still = ${fmtAddr(stalePtr)} and now points at attacker data!`, 'c-danger');

  // Modal
  await showModal(
    '🟡',
    'Step 3: Freed Slot Filled With Attacker Data!',
    `malloc(${FONT_SIZE}) → ${fmtAddr(newObjAddr)}  ← SAME slot!

// New object overwrites freed memory:
Memory[${fmtAddr(newObjAddr)}+0x00] = ${hex32(MAGIC_NEW)}  (BEEF)
Memory[${fmtAddr(newObjAddr)}+0x04] = "INJECTED!"
Memory[${fmtAddr(newObjAddr)}+0x28] = ${hex32(VTABLE_FAKE)}  ← FAKE vtable!
Memory[${fmtAddr(newObjAddr)}+0x2C] = ${hex32(0xBBBBBBBB)}

fontPtr = ${fmtAddr(stalePtr)}  ← still dangling here!`,
    `The new allocation landed at EXACTLY ${fmtAddr(newObjAddr)} — the same address fontPtr holds. The attacker wrote 0x${VTABLE_FAKE.toString(16).toUpperCase()} as the vtable pointer. When Chrome dereferences fontPtr and calls a virtual method, it will read this fake vtable.`
  );

  setBtn('btn4', false);
}

// ── Step 4: Use Stale Pointer ────────────────────────────

/**
 * Simulates Chrome's rendering engine using fontPtr to call
 * a virtual method — not knowing the object was freed.
 *
 * fontPtr → reads vtable at +0x28 → finds VTABLE_FAKE
 * In a real exploit this would jump to shellcode.
 */
async function step4() {
  setBtn('btn4', true);

  // Read through the stale pointer (this is the UAF!)
  const readMagic  = readU32(stalePtr);
  const readVtable = readU32(stalePtr + 0x28);

  // Update pointer panel — USE-AFTER-FREE state
  updateFontPtr(
    fmtAddr(stalePtr) + ' 💥',
    'var(--orange)',
    'USE-AFTER-FREE',
    'st-danger'
  );
  updateVtable(hex32(readVtable), '#ff3860', '← ATTACKER METHOD!');

  // Log
  log(`Chrome calls: fontPtr->render()`, 'c-danger');
  log(`Reads magic at ${fmtAddr(stalePtr)}+0x00 = ${hex32(readMagic)}  ← expected ${hex32(MAGIC_FONT)}`, 'c-danger');
  log(`Chrome expects vtable ${hex32(VTABLE_LEGIT)}, reads ${hex32(readVtable)} ← ATTACKER!`, 'c-danger');
  log(`Virtual call dispatched to ${hex32(readVtable)} → 💥 EXECUTION HIJACKED`, 'c-danger');
  log(`In real exploit: shellcode at ${hex32(readVtable)} now executes`, 'c-warn');
  log('─────────────────────────────────────────', 'c-dim');
  log('✅ UAF lifecycle complete. Fix: set fontPtr = nullptr after free().', 'c-ok');

  // Modal
  await showModal(
    '💥',
    'Step 4: CODE EXECUTION via Stale Pointer!',
    `// Chrome renderer dereferences stale fontPtr:
fontPtr->render();  // fontPtr = ${fmtAddr(stalePtr)}

// Reading through stale pointer (real WASM memory read):
*(fontPtr + 0x00) = ${hex32(readMagic)}    ← was ${hex32(MAGIC_FONT)} !
*(fontPtr + 0x28) = ${hex32(readVtable)}   ← vtable ptr

// Chrome dispatches virtual call:
call [${hex32(readVtable)}]  → ATTACKER METHOD RUNS 💥

// Fix:
free(fontPtr);
fontPtr = nullptr;  ← one line prevents this entire attack`,
    `Chrome read the vtable pointer through fontPtr (${fmtAddr(stalePtr)}) and got ${hex32(readVtable)} — the attacker's fake vtable. In a real exploit, this address would point to shellcode or a ROP chain. This entire attack was demonstrated using real bytes at real offsets in a real WebAssembly memory page inside your Chrome tab.`
  );
}

// ── Reset ─────────────────────────────────────────────────

/**
 * Clear all WASM memory, reset all UI panels and log,
 * re-enable Step 1 button only.
 */
function resetAll() {
  // Clear WASM memory
  if (fontAddr !== null) clearRegion(BASE_OFFSET, FONT_SIZE + 32);

  // Reset global state
  fontAddr   = null;
  stalePtr   = null;
  newObjAddr = null;
  t0         = Date.now();

  // Re-render hex dump (empty)
  renderHex(null, 0, '');
  resetStructPanel();
  document.getElementById('structAddr').textContent = '????';

  // Reset pointer panel
  const fp = document.getElementById('ptrFontVal');
  fp.textContent = 'uninitialized';
  fp.style.color  = 'var(--muted)';
  document.getElementById('ptrFontStatus').textContent = '';
  document.getElementById('ptrFontStatus').className   = 'ptr-status';

  const np = document.getElementById('ptrNewVal');
  np.textContent = '—';
  np.style.color  = 'var(--muted)';
  document.getElementById('ptrNewStatus').textContent = '';
  document.getElementById('ptrNewRow').style.opacity  = '0.3';

  // Reset vtable panel
  updateVtable('—', 'var(--muted)', '');

  // Clear log
  document.getElementById('logArea').innerHTML =
    `<div class="le">
      <span class="lt">00:00</span>
      <span class="lm c-dim">Reset complete. WebAssembly.Memory cleared. Click Step 1.</span>
    </div>`;

  // Reset buttons
  ['btn1', 'btn2', 'btn3', 'btn4'].forEach((id, i) => setBtn(id, i !== 0));
}
