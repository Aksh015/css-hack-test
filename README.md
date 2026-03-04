# 🕵️ CSS Hack Demo — UAF Memory Simulator

> **Vibe coded project 🤪💀** — built by vibing with an AI, going deep into browser security internals.

---

## What is this?

A **Use-After-Free (UAF) vulnerability simulator** running real `WebAssembly.Memory` (64 KB OS-backed RAM page) inside the browser. Visualizes the full 4-stage attack as live hex bytes at real memory offsets.

---

## How UAF Works

```
malloc(48)  → FontObject at 0x0100  (fontPtr = 0x0100)
free()      → memory released, but fontPtr still = 0x0100  ← DANGLING ☠️
malloc(48)  → new object lands at 0x0100 (same size class)
fontPtr->render() → reads FAKE vtable @ 0x0100+0x28 → 💥 RCE
```

**Root cause:** pointer not nulled after `free()`. Allocator reuses same address for new object. Virtual dispatch reads attacker-controlled vtable.

---

## Real Attack vs. Simulation

| Real Attacker                                   | Our Simulation                                  |
| ----------------------------------------------- | ----------------------------------------------- |
| `@font-feature-values` CSS allocates C++ object | `writeU32(0x0100, 0xFAFAFAFA)` into WASM memory |
| `deleteRule()` → C++ destructor → `free()`      | `writeU32(fontAddr, 0xDEADDEAD)` + zero fill    |
| Heap spray fills freed slot with fake vtable    | `writeU32(0x0100+0x28, 0x00004141)`             |
| `fontPtr->render()` → jumps to shellcode        | `readU32(stalePtr+0x28)` returns `0x00004141`   |

We skip ASLR bypass, sandbox escape, and shellcode — pure concept simulation.

---

## Struct Layout (48 bytes @ 0x0100)

```
+0x00  magic      4B   0xFAFAFAFA (FontObject) / 0xBEEFBEEF (attacker)
+0x04  name[32]  32B   "HackFont" / "INJECTED!"
+0x28  vtable     4B   0x00002000 (legit) / 0x00004141 (fake) ← attack surface
+0x2C  refcount   4B   ref count
```

---

## Files

```
├── uaf_wasm_demo.html   ← entry point
├── css/styles.css       ← styling
└── js/
    ├── memory.js        ← WebAssembly.Memory + read/write helpers
    ├── ui.js            ← hex dump + panels
    ├── modal.js         ← popups
    └── steps.js         ← step1–4 + log + reset
```

---

## Run

```bash
npx serve .
# open http://localhost:3000/uaf_wasm_demo.html
```

CVE class demonstrated: **UAF → vtable hijack → RCE** (ref: CVE-2023-4762)

_Vibe coded into existence, technically grounded in reality. 🤙_
