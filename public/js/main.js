/**
 * Balai-Reserve – Main Client-side JavaScript
 */
(function () {
  'use strict';

  // ── Sidebar Toggle ─────────────────────────────────────────
  const sidebar        = document.getElementById('sidebar');
  const sidebarToggle  = document.getElementById('sidebarToggle');
  const sidebarClose   = document.getElementById('sidebarClose');
  const sidebarOverlay = document.getElementById('sidebarOverlay');

  function openSidebar() {
    if (!sidebar) return;
    sidebar.classList.add('open');
    if (sidebarOverlay) sidebarOverlay.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    if (!sidebar) return;
    sidebar.classList.remove('open');
    if (sidebarOverlay) sidebarOverlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  if (sidebarToggle)  sidebarToggle.addEventListener('click', openSidebar);
  if (sidebarClose)   sidebarClose.addEventListener('click', closeSidebar);
  if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);

  // Close sidebar on window resize (desktop)
  window.addEventListener('resize', () => {
    if (window.innerWidth >= 992) closeSidebar();
  });

  // ── Auto-dismiss Flash Alerts ──────────────────────────────
  const flashAlerts = document.querySelectorAll('.flash-alert');
  flashAlerts.forEach(alert => {
    setTimeout(() => {
      const bsAlert = bootstrap.Alert.getOrCreateInstance(alert);
      if (bsAlert) bsAlert.close();
    }, 5000);
  });

  // ── Professional Confirm Modal (replaces native window.confirm) ──────────
  // Usage:
  //   <button data-confirm="Message">              → default (primary) confirm
  //   <button data-confirm="Message"
  //           data-confirm-type="danger"           → red destructive confirm
  //           data-confirm-title="Cancel Booking"  → custom heading
  //           data-confirm-ok="Yes, cancel">        → custom confirm-button text
  //
  // Also exposed as window.confirmModal(opts) → Promise<boolean> for JS use.

  function ensureConfirmModal() {
    if (document.getElementById('appConfirmModal')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = [
      '<div class="modal fade" id="appConfirmModal" tabindex="-1" aria-hidden="true">',
      '  <div class="modal-dialog modal-dialog-centered">',
      '    <div class="modal-content" style="border:none;border-radius:.9rem;overflow:hidden;box-shadow:0 20px 60px rgba(0,0,0,.25);">',
      '      <div class="modal-body p-4 text-center">',
      '        <div id="appConfirmIcon" class="mx-auto mb-3 d-flex align-items-center justify-content-center" style="width:56px;height:56px;border-radius:50%;font-size:1.4rem;"></div>',
      '        <h5 id="appConfirmTitle" class="fw-bold mb-2">Please Confirm</h5>',
      '        <p id="appConfirmMsg" class="text-muted mb-4" style="font-size:.9rem;line-height:1.5;"></p>',
      '        <div class="d-flex gap-2 justify-content-center">',
      '          <button type="button" id="appConfirmCancel" class="btn btn-outline-secondary px-4" data-bs-dismiss="modal">Cancel</button>',
      '          <button type="button" id="appConfirmOk" class="btn btn-primary px-4">Confirm</button>',
      '        </div>',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');
    document.body.appendChild(wrap.firstElementChild);
  }

  function confirmModal(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      // Fallback if Bootstrap isn't available for some reason
      if (typeof bootstrap === 'undefined' || !bootstrap.Modal) {
        resolve(window.confirm(opts.message || 'Are you sure?'));
        return;
      }
      ensureConfirmModal();

      var modalEl = document.getElementById('appConfirmModal');
      var iconEl  = document.getElementById('appConfirmIcon');
      var titleEl = document.getElementById('appConfirmTitle');
      var msgEl   = document.getElementById('appConfirmMsg');
      var okBtn   = document.getElementById('appConfirmOk');

      var type = opts.type || 'primary';
      var isDanger = type === 'danger';

      titleEl.textContent = opts.title || (isDanger ? 'Please Confirm' : 'Please Confirm');
      msgEl.textContent   = opts.message || 'Are you sure you want to proceed?';

      // Icon + colour theming
      iconEl.style.background = isDanger ? '#fee2e2' : '#e8f3f1';
      iconEl.style.color      = isDanger ? '#dc2626' : '#0f5c66';
      iconEl.innerHTML = '<i class="fas fa-' + (isDanger ? 'exclamation-triangle' : 'question-circle') + '"></i>';

      okBtn.className = 'btn px-4 ' + (isDanger ? 'btn-danger' : 'btn-primary');
      okBtn.textContent = opts.okText || (isDanger ? 'Yes, Continue' : 'Confirm');

      var modal = bootstrap.Modal.getOrCreateInstance(modalEl);
      var settled = false;

      function cleanup(result) {
        if (settled) return;
        settled = true;
        okBtn.removeEventListener('click', onOk);
        modalEl.removeEventListener('hidden.bs.modal', onHide);
        resolve(result);
      }
      function onOk() { modal.hide(); cleanup(true); }
      function onHide() { cleanup(false); }

      okBtn.addEventListener('click', onOk);
      modalEl.addEventListener('hidden.bs.modal', onHide);
      modal.show();
    });
  }

  // Expose for direct JS use (e.g. cancel-booking form)
  window.confirmModal = confirmModal;

  // ── Professional Toast / Validation Message (replaces native alert) ───────
  // Usage: window.appNotify('Please select a room.', 'warning')
  //   types: 'success' | 'error' | 'warning' | 'info' (default 'info')
  function ensureToastHost() {
    var host = document.getElementById('appToastHost');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'appToastHost';
    // Sits below the fixed header so it doesn't overlap the navbar.
    host.style.cssText = 'position:fixed;top:4.75rem;left:50%;transform:translateX(-50%);z-index:20000;display:flex;flex-direction:column;gap:.5rem;align-items:center;pointer-events:none;width:auto;max-width:92vw;';
    document.body.appendChild(host);
    return host;
  }

  function appNotify(message, type) {
    type = type || 'info';
    if (!message) return;
    var theme = {
      success: { bg: '#ecfdf5', bd: '#10b981', fg: '#065f46', icon: 'check-circle' },
      error:   { bg: '#fef2f2', bd: '#ef4444', fg: '#991b1b', icon: 'exclamation-circle' },
      warning: { bg: '#fffbeb', bd: '#f59e0b', fg: '#92400e', icon: 'exclamation-triangle' },
      info:    { bg: '#eff6ff', bd: '#3b82f6', fg: '#1e40af', icon: 'info-circle' },
    }[type] || { bg: '#eff6ff', bd: '#3b82f6', fg: '#1e40af', icon: 'info-circle' };

    var host = ensureToastHost();
    var el = document.createElement('div');
    el.setAttribute('role', 'alert');
    el.style.cssText = 'pointer-events:auto;min-width:260px;max-width:92vw;background:' + theme.bg +
      ';border:1px solid ' + theme.bd + ';border-left:4px solid ' + theme.bd + ';color:' + theme.fg +
      ';border-radius:.6rem;box-shadow:0 10px 30px rgba(0,0,0,.15);padding:.75rem 1rem;font-size:.9rem;' +
      'display:flex;align-items:flex-start;gap:.6rem;opacity:0;transform:translateY(-8px);transition:opacity .18s ease,transform .18s ease;';
    el.innerHTML = '<i class="fas fa-' + theme.icon + '" style="margin-top:2px;"></i>' +
      '<div style="flex:1 1 auto;line-height:1.35;"></div>' +
      '<button type="button" aria-label="Dismiss" style="background:none;border:none;color:inherit;opacity:.6;cursor:pointer;font-size:1rem;line-height:1;">&times;</button>';
    el.querySelector('div').textContent = message;   // safe text insertion
    host.appendChild(el);
    requestAnimationFrame(function () { el.style.opacity = '1'; el.style.transform = 'translateY(0)'; });

    var removed = false;
    function dismiss() {
      if (removed) return; removed = true;
      el.style.opacity = '0'; el.style.transform = 'translateY(-8px)';
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 200);
    }
    el.querySelector('button').addEventListener('click', dismiss);
    setTimeout(dismiss, 4000);
    return dismiss;
  }

  // Expose globally so any page/inline script can show a professional message.
  window.appNotify = appNotify;

  // Intercept clicks on any element with data-confirm and route through the modal
  document.addEventListener('click', function (e) {
    const el = e.target.closest('[data-confirm]');
    if (!el) return;
    if (el.dataset.confirmed === '1') { delete el.dataset.confirmed; return; } // already confirmed, let it through

    e.preventDefault();
    e.stopImmediatePropagation();

    confirmModal({
      message: el.dataset.confirm || 'Are you sure?',
      title:   el.dataset.confirmTitle || 'Please Confirm',
      type:    el.dataset.confirmType || 'primary',
      okText:  el.dataset.confirmOk || null,
    }).then(function (ok) {
      if (!ok) return;
      // Re-dispatch the original action now that it's confirmed
      if (el.tagName === 'A' && el.href) {
        window.location.href = el.href;
      } else if (el.form || el.closest('form')) {
        el.dataset.confirmed = '1';
        (el.form || el.closest('form')).requestSubmit ? (el.form || el.closest('form')).requestSubmit(el) : (el.form || el.closest('form')).submit();
      } else {
        el.dataset.confirmed = '1';
        el.click();
      }
    });
  }, true);   // capture phase so we run before other handlers

  // ── Form Double-submit Prevention ─────────────────────────
  // Forms that manage their own submit flow (e.g. a confirm-modal step) can
  // opt out with data-no-autosubmit-lock so the button isn't disabled while
  // the form is only being validated / a modal is being shown.
  document.querySelectorAll('form').forEach(form => {
    if (form.hasAttribute('data-no-autosubmit-lock')) return;
    form.addEventListener('submit', function () {
      const btn = this.querySelector('[type="submit"]');
      if (btn) {
        setTimeout(() => {
          btn.disabled = true;
          btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span> Processing...';
        }, 10);
      }
    });
  });

  // ── Password Toggle ────────────────────────────────────────
  document.querySelectorAll('.btn-toggle-pass').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const input    = document.getElementById(targetId);
      const icon     = btn.querySelector('i');
      if (!input) return;
      if (input.type === 'password') {
        input.type = 'text';
        if (icon) { icon.classList.remove('fa-eye'); icon.classList.add('fa-eye-slash'); }
      } else {
        input.type = 'password';
        if (icon) { icon.classList.remove('fa-eye-slash'); icon.classList.add('fa-eye'); }
      }
    });
  });

  // ── Image Lightbox (payment proofs, QR codes, etc.) ──────────────────────
  // Any <a data-lightbox="/path/to/image.jpg"> or element with data-lightbox
  // opens the image in a centered modal instead of a new browser tab.
  function ensureLightbox() {
    if (document.getElementById('appLightbox')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = [
      '<div class="modal fade" id="appLightbox" tabindex="-1" aria-hidden="true">',
      '  <div class="modal-dialog modal-dialog-centered modal-lg">',
      '    <div class="modal-content" style="background:transparent;border:none;box-shadow:none;">',
      '      <div class="modal-header border-0 pb-2" style="justify-content:space-between;">',
      '        <span id="appLightboxTitle" class="text-white fw-semibold" style="font-size:.95rem;">Payment Proof</span>',
      '        <div class="d-flex gap-2">',
      '          <a id="appLightboxOpen" href="#" target="_blank" rel="noopener" class="btn btn-sm btn-light" title="Open original in new tab"><i class="fas fa-external-link-alt"></i></a>',
      '          <button type="button" class="btn btn-sm btn-light" data-bs-dismiss="modal" aria-label="Close"><i class="fas fa-times"></i></button>',
      '        </div>',
      '      </div>',
      '      <div class="modal-body text-center p-0">',
      '        <img id="appLightboxImg" src="" alt="Preview" style="max-width:100%;max-height:78vh;border-radius:.5rem;box-shadow:0 12px 40px rgba(0,0,0,.5);background:#fff;" />',
      '      </div>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');
    document.body.appendChild(wrap.firstElementChild);
  }

  document.addEventListener('click', function (e) {
    const trigger = e.target.closest('[data-lightbox]');
    if (!trigger) return;
    const src = trigger.getAttribute('data-lightbox');
    if (!src) return;

    // The portal photo galleries (rooms/venues/cottages) also use data-lightbox,
    // but store a JSON ARRAY of image paths and have their own gallery handler.
    // This global handler is only for single-image previews (e.g. payment proofs),
    // so ignore JSON-array values to avoid opening a second, empty modal.
    if (src.trim().charAt(0) === '[') return;

    e.preventDefault();

    if (typeof bootstrap === 'undefined' || !bootstrap.Modal) {
      window.open(src, '_blank');   // graceful fallback
      return;
    }
    ensureLightbox();
    document.getElementById('appLightboxImg').src = src;
    document.getElementById('appLightboxOpen').href = src;
    const titleAttr = trigger.getAttribute('data-lightbox-title');
    document.getElementById('appLightboxTitle').textContent = titleAttr || 'Payment Proof';
    bootstrap.Modal.getOrCreateInstance(document.getElementById('appLightbox')).show();
  });

  // ── Notification Bell Mark Read ───────────────────────────
  const notifDropdown = document.getElementById('notifDropdown');
  if (notifDropdown) {
    notifDropdown.addEventListener('click', () => {
      // Mark all visible notifications as read via fetch
      fetch('/notifications/clear', { method: 'POST' })
        .catch(() => {/* non-critical */});
      const badge = document.querySelector('.notif-badge');
      if (badge) badge.remove();
    });
  }

  // ── Date Range Picker Validation ──────────────────────────
  const checkInField  = document.getElementById('checkInDate');
  const checkOutField = document.getElementById('checkOutDate');
  if (checkInField && checkOutField) {
    // Set min dates (local date, not UTC)
    const now   = new Date();
    const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    checkInField.min  = today;
    checkOutField.min = today;

    checkInField.addEventListener('change', () => {
      if (checkOutField.value && checkOutField.value <= checkInField.value) {
        const next = new Date(checkInField.value);
        next.setDate(next.getDate() + 1);
        checkOutField.value = next.toISOString().slice(0, 10);
      }
      checkOutField.min = checkInField.value;
    });
  }

  // ── Date fields: say "onward" instead of the browser's "or later" ──
  const formatDateLabel = (value) => new Date(value + 'T00:00:00')
    .toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  document.addEventListener('invalid', (e) => {
    const field = e.target;
    if (field.type !== 'date' || !field.min || !field.validity.rangeUnderflow) return;
    field.setCustomValidity(`Please select ${formatDateLabel(field.min)} onward.`);
  }, true);
  document.addEventListener('input', (e) => {
    if (e.target.type === 'date') e.target.setCustomValidity('');
  }, true);

  // ── Data Tables: Search highlight ─────────────────────────
  function highlightSearchTerms() {
    const url    = new URL(window.location.href);
    const search = url.searchParams.get('search') || '';
    if (!search) return;
    const regex  = new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    document.querySelectorAll('tbody td').forEach(td => {
      if (!td.querySelector('a, button, span.badge, code')) {
        td.innerHTML = td.innerHTML.replace(regex, '<mark>$1</mark>');
      }
    });
  }
  highlightSearchTerms();

  // ── Responsive Table Scroll Hint ──────────────────────────
  document.querySelectorAll('.table-responsive').forEach(wrapper => {
    function checkScroll() {
      if (wrapper.scrollWidth > wrapper.clientWidth) {
        wrapper.classList.add('can-scroll');
        wrapper.title = 'Scroll horizontally to see more →';
      } else {
        wrapper.classList.remove('can-scroll');
        wrapper.title = '';
      }
    }
    checkScroll();
    window.addEventListener('resize', checkScroll);
  });

  // ── Print Support ─────────────────────────────────────────
  const printBtn = document.querySelector('.btn-print');
  if (printBtn) {
    printBtn.addEventListener('click', () => window.print());
  }

  // ── Active Nav Link Scroll Into View (sidebar) ─────────────
  const activeNavLink = document.querySelector('.sidebar .nav-link.active');
  if (activeNavLink) {
    activeNavLink.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ── Tooltip Init (Bootstrap) ──────────────────────────────
  const tooltipEls = document.querySelectorAll('[data-bs-toggle="tooltip"]');
  tooltipEls.forEach(el => {
    if (typeof bootstrap !== 'undefined') {
      bootstrap.Tooltip.getOrCreateInstance(el);
    }
  });

  // ── Auto-select Select2 Target ───────────────────────────
  // Allow select elements to pre-select based on URL params
  const urlParams = new URLSearchParams(window.location.search);
  document.querySelectorAll('select[name]').forEach(sel => {
    const paramVal = urlParams.get(sel.name);
    if (paramVal) {
      for (const opt of sel.options) {
        if (opt.value === paramVal) { opt.selected = true; break; }
      }
    }
  });

  // ── Stats Counter Animation ───────────────────────────────
  function animateCounter(el) {
    const target = parseFloat(el.textContent.replace(/[^0-9.]/g, ''));
    if (!target || isNaN(target)) return;
    const duration = 600;
    const start    = performance.now();
    const startVal = 0;

    function tick(now) {
      const elapsed  = now - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased    = 1 - Math.pow(1 - progress, 3); // ease-out cubic
      const current  = Math.round(startVal + (target - startVal) * eased);
      el.textContent = el.textContent.replace(/[\d,]+/, current.toLocaleString());
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // Only animate integer stat values
  document.querySelectorAll('.stat-value').forEach(el => {
    const text = el.textContent.trim();
    // Skip values with ₱, %, or letters
    if (/^\d[\d,]*$/.test(text)) {
      animateCounter(el);
    }
  });

})();
