/**
 * Balai-Reserve — event package form (views/packages/form.xian)
 * Adds / removes rows for included items and paid add-ons (renumbering the field names so the server
 * receives included[0..n] and addons[0..n]), and handles photo previews like the cottage form.
 */
(function () {
  'use strict';
  var form = document.getElementById('packageForm');
  if (!form) return;

  // ── Included items and add-ons ────────────────────────────────────────────
  function renumber(list) {
    var kind = list.getAttribute('data-kind');
    Array.prototype.forEach.call(list.children, function (li, i) {
      li.querySelectorAll('input[name], input[data-field]').forEach(function (inp) {
        var field = inp.getAttribute('data-field') || (inp.name.match(/\]\[(\w+)\]$/) || [])[1];
        if (field) { inp.setAttribute('data-field', field); inp.name = kind + '[' + i + '][' + field + ']'; }
      });
    });
    var empty = document.querySelector('[data-empty-for="' + list.id + '"]');
    if (empty) empty.hidden = list.children.length > 0;
  }
  document.querySelectorAll('[data-pkg-add]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var list = document.getElementById(btn.getAttribute('data-pkg-add'));
      var tpl = document.getElementById(list.getAttribute('data-kind') === 'included' ? 'tplIncluded' : 'tplAddons');
      var row = tpl.content.firstElementChild.cloneNode(true);
      list.appendChild(row);
      renumber(list);
      if (window.ikionsRender) window.ikionsRender(row);
      row.querySelector('input').focus();
    });
  });
  form.addEventListener('click', function (e) {
    var rm = e.target.closest('[data-pkg-remove]');
    if (!rm) return;
    var list = rm.closest('.pkg-rows');
    rm.closest('.pkg-row').remove();
    renumber(list);
  });
  // Enter in a row adds the next row instead of submitting the whole form.
  form.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || !e.target.closest('.pkg-row')) return;
    e.preventDefault();
    var list = e.target.closest('.pkg-rows');
    document.querySelector('[data-pkg-add="' + list.id + '"]').click();
  });
  document.querySelectorAll('.pkg-rows').forEach(renumber);

  // ── Photos: remove / undo an existing one ─────────────────────────────────
  document.querySelectorAll('.remove-img-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var wrapper = btn.closest('.existing-img-item'), inp = wrapper.querySelector('.keep-img-input');
      var removed = !wrapper.classList.contains('is-removed');
      if (inp) inp.disabled = removed;
      wrapper.classList.toggle('is-removed', removed);
      btn.textContent = removed ? 'Undo' : 'Remove';
      btn.classList.toggle('is-danger', !removed);
      btn.setAttribute('aria-pressed', removed ? 'true' : 'false');
    });
  });

  // ── Photos: new uploads with previews ─────────────────────────────────────
  var input = document.getElementById('imageInput'), preview = document.getElementById('newImagesPreview'), dropZone = document.getElementById('dropZone');
  if (!input || !preview || !dropZone || typeof DataTransfer === 'undefined') return;
  var dtFiles = new DataTransfer();
  function addFiles(files) {
    Array.prototype.forEach.call(files, function (file) {
      if (file.type.indexOf('image/') === 0 && dtFiles.items.length < 5) dtFiles.items.add(file);
    });
    input.files = dtFiles.files;
    renderPreviews();
  }
  function renderPreviews() {
    preview.innerHTML = '';
    Array.prototype.forEach.call(dtFiles.files, function (file, idx) {
      var item = document.createElement('div'); item.className = 'ap-thumb-item';
      var thumb = document.createElement('div'); thumb.className = 'ap-thumb';
      var img = document.createElement('img'); img.alt = file.name; img.src = URL.createObjectURL(file); thumb.appendChild(img);
      var name = document.createElement('span'); name.className = 'ap-thumb-caption';
      name.textContent = (idx === 0 && !document.querySelector('.keep-img-input:not(:disabled)') ? 'Cover · ' : 'New · ') + file.name;
      var remove = document.createElement('button'); remove.type = 'button'; remove.className = 'ap-act is-danger'; remove.textContent = 'Remove';
      remove.addEventListener('click', function () {
        var next = new DataTransfer();
        Array.prototype.forEach.call(dtFiles.files, function (f, fi) { if (fi !== idx) next.items.add(f); });
        dtFiles = next; input.files = dtFiles.files; renderPreviews();
      });
      item.append(thumb, name, remove);
      preview.appendChild(item);
    });
  }
  input.addEventListener('change', function () { addFiles(input.files); });
  dropZone.addEventListener('dragover', function (e) { e.preventDefault(); dropZone.classList.add('dragover'); });
  dropZone.addEventListener('dragleave', function () { dropZone.classList.remove('dragover'); });
  dropZone.addEventListener('drop', function (e) { e.preventDefault(); dropZone.classList.remove('dragover'); addFiles(e.dataTransfer.files); });
  dropZone.addEventListener('click', function (e) { if (e.target.tagName !== 'LABEL' && e.target.tagName !== 'INPUT') input.click(); });
})();
