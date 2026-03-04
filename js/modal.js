/**
 * modal.js
 * ─────────────────────────────────────────────────────────
 * Controls the modal overlay — used by steps.js to pause
 * execution at each UAF stage until the user continues.
 * ─────────────────────────────────────────────────────────
 */

/**
 * Show the modal with given content and return a Promise
 * that resolves when the user clicks "Continue →".
 *
 * @param {string} icon  - Emoji icon displayed at top
 * @param {string} title - Bold title text
 * @param {string} pre   - Monospaced code block content
 * @param {string} body  - Explanatory paragraph text
 * @returns {Promise<void>}
 */
function showModal(icon, title, pre, body) {
  return new Promise((resolve) => {
    document.getElementById('mIcon').textContent  = icon;
    document.getElementById('mTitle').textContent = title;
    document.getElementById('mPre').textContent   = pre;
    document.getElementById('mBody').textContent  = body;
    document.getElementById('overlay').classList.add('show');
    window._modalResolve = resolve;
  });
}

/**
 * Close the modal and resolve the pending Promise.
 * Bound to the "Continue →" button via onclick in HTML.
 */
function closeModal() {
  document.getElementById('overlay').classList.remove('show');
  if (window._modalResolve) {
    window._modalResolve();
    window._modalResolve = null;
  }
}

// ── Welcome Modal ─────────────────────────────────────────

/**
 * Show the welcome/intro modal on page load.
 * Uses a separate overlay (#welcomeOverlay) so it doesn't
 * interfere with the step modals that use Promises.
 */
function showWelcome() {
  document.getElementById('welcomeOverlay').classList.add('show');
}

/**
 * Close the welcome modal.
 * Bound to the "Start Demo →" button in the welcome overlay.
 */
function closeWelcome() {
  document.getElementById('welcomeOverlay').classList.remove('show');
}

