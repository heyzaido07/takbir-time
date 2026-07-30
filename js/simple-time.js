// ═══════════════════════════════════════════════════════════════════
// Simple time picker — progressive enhancement for the jamat-time forms.
//
// Goal: let anyone (no keyboard skills, no 24-hour-clock knowledge) set a
// prayer time by tapping big + / − buttons and an AM/PM switch. We DON'T
// replace the form's data model: each prayer still has its original
// <input type="time" name="fajr"> as the single source of truth — we just
// hide it and drive its value from the tap UI, dispatching 'change' so all
// existing app.js read logic keeps working untouched.
//
// Also turns the cryptic "Maghrib offset" <select> into plain labelled
// buttons ("At sunset", "5 min after", …).
//
// Enhances any .submit-grid (the Submit-times form AND the Suggest modal).
// Call window.simpleTime.sync(formEl) after programmatically setting input
// values (app.js does this on prefill) so the tap UI reflects them.
// ═══════════════════════════════════════════════════════════════════

const simpleTime = (() => {
  const LABELS = { fajr: 'Fajr', dhuhr: 'Dhuhr', zuhr: 'Dhuhr', asr: 'Asr', isha: 'Isha', jummah: 'Jummah' };
  // Sensible starting points when a prayer has no time yet — the user nudges
  // from here instead of starting at a blank/zero. Never submitted unless the
  // user actively taps "Set".
  const DEFAULTS = { fajr: '05:15', dhuhr: '13:15', asr: '17:00', isha: '20:00', jummah: '13:30' };
  const MAGHRIB_CHOICES = [
    { v: '0', label: 'At sunset' },
    { v: '3', label: '3 min after' },
    { v: '5', label: '5 min after' },
    { v: '10', label: '10 min after' },
    { v: '15', label: '15 min after' },
  ];

  function parse24(v) {
    if (typeof v !== 'string') return null;
    const m = v.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = +m[1], min = +m[2];
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return { h, min };
  }
  function to12(v) {
    const p = parse24(v);
    if (!p) return null;
    const ampm = p.h >= 12 ? 'PM' : 'AM';
    let h12 = p.h % 12; if (h12 === 0) h12 = 12;
    return { h12, mm: p.min, ampm };
  }
  function to24(h12, mm, ampm) {
    let h = h12 % 12;
    if (ampm === 'PM') h += 12;
    return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  }

  function setInput(input, value) {
    input.value = value;
    // Fire both so any listener (validation, live preview) reacts as if a
    // human typed it.
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Render one prayer row's inner controls based on the hidden input's value.
  function renderRow(row) {
    const input = row._input;
    const t = to12(input.value);
    if (!t) {
      row.classList.add('is-empty');
      row._body.innerHTML = `<button type="button" class="stime__set" data-act="set">+ Set time</button>`;
      return;
    }
    row.classList.remove('is-empty');
    row._body.innerHTML = `
      <div class="stime__stepper">
        <span class="stime__unit">
          <button type="button" class="stime__btn" data-act="h+" aria-label="Hour up">+</button>
          <span class="stime__val stime__hh">${t.h12}</span>
          <button type="button" class="stime__btn" data-act="h-" aria-label="Hour down">−</button>
        </span>
        <span class="stime__colon">:</span>
        <span class="stime__unit">
          <button type="button" class="stime__btn" data-act="m+" aria-label="Minutes up">+</button>
          <span class="stime__val stime__mm">${String(t.mm).padStart(2, '0')}</span>
          <button type="button" class="stime__btn" data-act="m-" aria-label="Minutes down">−</button>
        </span>
        <button type="button" class="stime__ampm ${t.ampm === 'PM' ? 'is-pm' : ''}" data-act="ap">${t.ampm}</button>
        <button type="button" class="stime__clear" data-act="clear" aria-label="Clear time">✕</button>
      </div>`;
  }

  function handleRowAction(row, act) {
    const input = row._input;
    if (act === 'set') { setInput(input, DEFAULTS[row._name] || '12:00'); renderRow(row); return; }
    if (act === 'clear') { setInput(input, ''); renderRow(row); return; }
    const t = to12(input.value) || { h12: 12, mm: 0, ampm: 'AM' };
    let { h12, mm, ampm } = t;
    if (act === 'h+') h12 = (h12 % 12) + 1;
    else if (act === 'h-') h12 = (h12 === 1 ? 12 : h12 - 1);
    else if (act === 'm+') mm = (mm + 5) % 60;
    else if (act === 'm-') mm = (mm + 55) % 60;
    else if (act === 'ap') ampm = (ampm === 'AM' ? 'PM' : 'AM');
    setInput(input, to24(h12, mm, ampm));
    renderRow(row);
  }

  function buildPrayerRow(input) {
    const name = input.name;
    const row = document.createElement('div');
    row.className = 'stime';
    row._input = input;
    row._name = name;
    row.innerHTML = `<span class="stime__name">${LABELS[name] || name}</span><span class="stime__body"></span>`;
    row._body = row.querySelector('.stime__body');
    row.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      e.preventDefault();
      handleRowAction(row, btn.getAttribute('data-act'));
    });
    renderRow(row);
    return row;
  }

  function buildMaghribRow(select) {
    const row = document.createElement('div');
    row.className = 'stime stime--maghrib';
    const btns = MAGHRIB_CHOICES.map(c =>
      `<button type="button" class="stime__seg" data-val="${c.v}">${c.label}</button>`).join('');
    row.innerHTML = `
      <span class="stime__name">Maghrib<small>after sunset</small></span>
      <div class="stime__segrow">${btns}</div>`;
    const sync = () => {
      const cur = String(select.value || '3');
      row.querySelectorAll('.stime__seg').forEach(b =>
        b.classList.toggle('is-on', b.getAttribute('data-val') === cur));
    };
    row.addEventListener('click', (e) => {
      const b = e.target.closest('.stime__seg');
      if (!b) return;
      e.preventDefault();
      const v = b.getAttribute('data-val');
      // Make sure the option exists (offsets like 3/5/10/15 all do) before set.
      if (!select.querySelector(`option[value="${v}"]`)) {
        const opt = document.createElement('option');
        opt.value = v; opt.textContent = `+${v} min`;
        select.appendChild(opt);
      }
      select.value = v;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      sync();
    });
    row._sync = sync;
    sync();
    return row;
  }

  // Enhance one .submit-grid: hide the native labels, build a tap list that
  // mirrors the same inputs. Idempotent per grid.
  function enhanceGrid(grid) {
    if (!grid || grid.dataset.stEnhanced) return;
    // Only enhance grids that carry prayer times. Other .submit-grid uses
    // (e.g. the edit-masjid-details form: name/city/country) must be left
    // completely alone — enhancing them would hide their real fields.
    if (!grid.querySelector('input[type="time"]')) return;
    grid.dataset.stEnhanced = '1';

    const list = document.createElement('div');
    list.className = 'stime-list';
    grid._stRows = [];

    // Walk the grid's direct <label> children in order so the tap rows keep
    // the same sequence (Fajr, Dhuhr, Asr, Maghrib, Isha, Jummah).
    Array.from(grid.children).forEach(label => {
      const timeInput = label.querySelector('input[type="time"]');
      const offSelect = label.querySelector('select[name="maghribOffset"]');
      if (timeInput) {
        const row = buildPrayerRow(timeInput);
        list.appendChild(row);
        grid._stRows.push(row);
        label.classList.add('stime-hidden-src');
      } else if (offSelect) {
        const row = buildMaghribRow(offSelect);
        list.appendChild(row);
        grid._stRows.push(row);
        label.classList.add('stime-hidden-src');
      }
    });

    grid.parentNode.insertBefore(list, grid);
    grid.classList.add('stime-grid-enhanced');
  }

  // Re-read every input and repaint the tap rows. Call after app.js prefills.
  function sync(scope) {
    const grids = scope
      ? scope.querySelectorAll ? scope.querySelectorAll('.submit-grid') : []
      : document.querySelectorAll('.submit-grid');
    (scope && scope.classList?.contains('submit-grid') ? [scope] : grids).forEach(grid => {
      if (!grid.dataset.stEnhanced) enhanceGrid(grid);
      (grid._stRows || []).forEach(row => {
        if (row._sync) row._sync();          // maghrib segmented control
        else if (row._input) renderRow(row); // prayer stepper
      });
    });
  }

  function enhanceAll() {
    document.querySelectorAll('.submit-grid').forEach(enhanceGrid);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', enhanceAll);
  } else {
    enhanceAll();
  }

  return { enhanceAll, sync };
})();

window.simpleTime = simpleTime;
