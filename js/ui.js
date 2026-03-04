/**
 * ui.js
 * ─────────────────────────────────────────────────────────
 * All DOM update functions:
 *   - Hex dump renderer (live byte-level view of WASM memory)
 *   - Struct inspector panel
 *   - Pointer state panel
 *
 * Depends on: memory.js (u8, readU32, readStr, hex8, fmtAddr)
 * ─────────────────────────────────────────────────────────
 */

// ── Formatting Helpers ───────────────────────────────────

/** Format a number as 8-digit uppercase hex: 0xDEADDEAD */
function hex32(n) {
  return '0x' + n.toString(16).toUpperCase().padStart(8, '0');
}

/** Format a byte as 2-digit uppercase hex: FA */
function hex8(n) {
  return n.toString(16).toUpperCase().padStart(2, '0');
}

/** Format a WASM memory offset as a full 8-nibble address string */
function fmtAddr(off) {
  return '0x' + off.toString(16).toUpperCase().padStart(8, '0');
}

// ── Hex Dump ─────────────────────────────────────────────

/**
 * Re-render the entire hex dump table.
 *
 * Shows BASE_OFFSET-16 through BASE_OFFSET+FONT_SIZE+32,
 * 16 bytes per row, with address | hex bytes | ASCII columns.
 *
 * @param {number|null} highlightFrom - Start offset of highlighted region
 * @param {number}      highlightLen  - Length of highlighted region
 * @param {string}      mode          - 'alloc' | 'free' | 'hijack' | ''
 */
function renderHex(highlightFrom, highlightLen, mode) {
  const startOff  = BASE_OFFSET - 16;
  const totalBytes = FONT_SIZE + 32 + 16;
  const mem    = u8();
  const tbody  = document.getElementById('hexBody');
  tbody.innerHTML = '';

  const rowCount = Math.ceil(totalBytes / 16);

  for (let row = 0; row < rowCount; row++) {
    const rowOff = startOff + row * 16;
    const tr     = document.createElement('tr');

    // Row background highlight
    if (highlightFrom !== null &&
        rowOff >= highlightFrom &&
        rowOff < highlightFrom + highlightLen) {
      if (mode === 'alloc')   tr.className = 'row-active';
      else if (mode === 'free')   tr.className = 'row-freed';
      else if (mode === 'hijack') tr.className = 'row-hijack';
    }

    // Address column
    const tdAddr = document.createElement('td');
    tdAddr.className = 'hex-addr';
    tdAddr.textContent = fmtAddr(rowOff) + ':';
    tr.appendChild(tdAddr);

    // Hex bytes column
    const tdHex = document.createElement('td');
    tdHex.className = 'hex-bytes hex-divider';
    let hexHtml = '';
    for (let col = 0; col < 16; col++) {
      const absOff  = rowOff + col;
      const byteVal = mem[absOff] || 0;
      const cls     = getByteClass(absOff, byteVal, highlightFrom, highlightLen, mode);
      hexHtml += `<span class="${cls}">${hex8(byteVal)}</span> `;
      if (col === 7) hexHtml += ' '; // mid-row spacer
    }
    tdHex.innerHTML = hexHtml;
    tr.appendChild(tdHex);

    // ASCII column
    const tdAsc = document.createElement('td');
    tdAsc.className = 'hex-ascii';
    let ascHtml = '';
    for (let col = 0; col < 16; col++) {
      const absOff  = rowOff + col;
      const b       = mem[absOff] || 0;
      const cls     = getByteClass(absOff, b, highlightFrom, highlightLen, mode);
      const ch      = (b >= 0x20 && b < 0x7F) ? String.fromCharCode(b) : '.';
      ascHtml += `<span class="${cls}">${ch}</span>`;
    }
    tdAsc.innerHTML = ascHtml;
    tr.appendChild(tdAsc);

    tbody.appendChild(tr);
  }
}

/**
 * Determine the CSS class for a single byte based on its position
 * within the struct and the current simulation mode.
 *
 * @param {number}      off  - Absolute byte offset in WASM memory
 * @param {number}      val  - Byte value
 * @param {number|null} from - Start of highlighted region
 * @param {number}      len  - Length of highlighted region
 * @param {string}      mode - 'alloc' | 'free' | 'hijack' | ''
 * @returns {string} CSS class name
 */
function getByteClass(off, val, from, len, mode) {
  // Outside highlighted region → dim
  if (from === null || off < from || off >= from + len) {
    return val === 0 ? 'byte-zero' : 'byte-normal';
  }

  const rel = off - from; // offset relative to struct start

  if (mode === 'free') {
    return rel < 4 ? 'byte-freed' : (val === 0 ? 'byte-zero' : 'byte-freed');
  }

  if (mode === 'hijack') {
    if (rel < 4)              return 'byte-attacker'; // magic
    if (rel >= 4 && rel < 36) return 'byte-name';     // name string
    if (rel >= 36 && rel < 40) return 'byte-attacker'; // value field
    if (rel >= 40 && rel < 44) return 'byte-fakevt';   // fake vtable ← danger
    return 'byte-attacker';
  }

  // mode === 'alloc'
  if (rel < 4)              return 'byte-magic';  // magic header
  if (rel >= 4 && rel < 36) return 'byte-name';   // name string
  if (rel >= 36 && rel < 40) return val > 0 ? 'byte-magic' : 'byte-zero'; // value
  if (rel >= 40 && rel < 44) return 'byte-vtable'; // vtable pointer
  return val > 0 ? 'byte-magic' : 'byte-zero';    // refcount
}

// ── Struct Inspector ──────────────────────────────────────

/**
 * Update the struct inspector panel to reflect the current
 * bytes at `addr` in WASM memory.
 *
 * @param {number|null} addr - WASM memory offset of the struct
 * @param {string}      mode - 'alloc' | 'free' | 'hijack'
 */
function updateStructPanel(addr, mode) {
  document.getElementById('structAddr').textContent =
    (addr || 0).toString(16).toUpperCase().padStart(4, '0');

  if (!addr) { resetStructPanel(); return; }

  const magic  = readU32(addr);
  const name   = readStr(addr + 4, 32);
  const val    = readU32(addr + 0x24);
  const vtPtr  = readU32(addr + 0x28);
  const refcnt = readU32(addr + 0x2C);

  function setField(id, text, color) {
    const el = document.getElementById(id);
    el.textContent  = text;
    el.style.color  = color;
  }

  if (mode === 'alloc') {
    setField('sf-magic',    hex32(magic),       'var(--green)');
    setField('sf-name',     `"${name}"`,        'var(--cyan)');
    setField('sf-value',    val.toString(),     'var(--text)');
    setField('sf-vtable',   hex32(vtPtr),       'var(--yellow)');
    setField('sf-refcount', refcnt.toString(),  'var(--text)');
  } else if (mode === 'free') {
    setField('sf-magic',    hex32(magic),  'var(--red)');
    setField('sf-name',     '[ garbage ]', 'var(--muted)');
    setField('sf-value',    '???',         'var(--muted)');
    setField('sf-vtable',   '???',         'var(--muted)');
    setField('sf-refcount', '???',         'var(--muted)');
  } else if (mode === 'hijack') {
    setField('sf-magic',    hex32(magic),   'var(--orange)');
    setField('sf-name',     `"${name}"`,    'var(--orange)');
    setField('sf-value',    hex32(val),     'var(--orange)');
    setField('sf-vtable',   hex32(vtPtr),   '#ff3860');
    setField('sf-refcount', hex32(refcnt),  'var(--orange)');
  }
}

/** Reset all struct inspector fields to their default empty state. */
function resetStructPanel() {
  ['sf-magic', 'sf-name', 'sf-value', 'sf-vtable', 'sf-refcount'].forEach(id => {
    const el = document.getElementById(id);
    el.textContent = '—';
    el.style.color = 'var(--muted)';
  });
}

// ── Pointer Panel ─────────────────────────────────────────

/**
 * Update the fontPtr row in the pointer state panel.
 *
 * @param {string} valText   - Text to show for the pointer value
 * @param {string} valColor  - CSS color for the value
 * @param {string} statusTxt - Badge label ('VALID' | 'DANGLING' | 'USE-AFTER-FREE')
 * @param {string} statusCls - CSS class for badge ('st-valid' | 'st-dangle' | 'st-danger')
 */
function updateFontPtr(valText, valColor, statusTxt, statusCls) {
  const el = document.getElementById('ptrFontVal');
  el.textContent = valText;
  el.style.color = valColor;
  document.getElementById('ptrFontStatus').textContent = statusTxt;
  document.getElementById('ptrFontStatus').className   = 'ptr-status ' + statusCls;
}

/**
 * Update the newObjPtr row (becomes visible in Step 3).
 *
 * @param {string} valText  - Text to show for the pointer value
 * @param {string} valColor - CSS color for the value
 */
function updateNewObjPtr(valText, valColor) {
  document.getElementById('ptrNewRow').style.opacity = '1';
  const el = document.getElementById('ptrNewVal');
  el.textContent = valText;
  el.style.color = valColor;
  const badge = document.getElementById('ptrNewStatus');
  badge.textContent  = 'IN USE';
  badge.className    = 'ptr-status';
  badge.style.cssText = 'background:rgba(255,107,53,0.1);color:var(--orange)';
}

/**
 * Update the vtable call result row.
 *
 * @param {string} valText  - Hex value shown
 * @param {string} valColor - CSS color
 * @param {string} fnText   - Descriptive label (e.g. '→ Chrome::render()')
 */
function updateVtable(valText, valColor, fnText) {
  document.getElementById('vtableVal').textContent = valText;
  document.getElementById('vtableVal').style.color = valColor;
  document.getElementById('vtableFn').textContent  = fnText;
}
