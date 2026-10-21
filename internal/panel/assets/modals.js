// Shared keyboard/focus behavior; only decorative layers may conceal overflow.
let active = null, returnFocus = null;
export function showModal(id) {
  const modal = document.getElementById(id);
  if (active === modal) return;
  if (active) hideModal(active.id);
  returnFocus = document.activeElement; active = modal;
  modal.classList.add('on'); modal.removeAttribute('inert');
  document.querySelector('.shell').inert = true;
  (modal.querySelector('button:not([disabled]), input:not([disabled]), [tabindex="0"]') || modal).focus();
}
export function hideModal(id) {
  const modal = document.getElementById(id);
  modal.classList.remove('on'); modal.setAttribute('inert', '');
  if (active !== modal) return;
  active = null; document.querySelector('.shell').inert = false;
  returnFocus?.focus(); returnFocus = null;
}
document.addEventListener('keydown', event => {
  if (!active) return;
  if (event.key === 'Escape') {
    const close = active.querySelector('[data-modal-close]');
    if (close && !close.disabled) close.click();
  }
  if (event.key !== 'Tab') return;
  const items = [...active.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], [tabindex="0"]')].filter(el => !el.hidden && el.getClientRects().length);
  if (!items.length) { event.preventDefault(); active.focus(); return; }
  const first = items[0], last = items[items.length - 1];
  if (event.shiftKey && (document.activeElement === first || document.activeElement === active)) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});
