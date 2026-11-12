// The owner's second look, 2026-11-11.
import { readFileSync } from 'node:fs'

const BASE = readFileSync(new URL('./scene-base.js', import.meta.url), 'utf8')
const base = `await setSource(${JSON.stringify(BASE)}); S().select([]); S().setTime(0); S().setTool('select'); S().setHidden(S().hidden, false); S().setObjectsView('layers'); S().setAllCollapsed('objects', null); await tick(200);`
const DOM = `
const rowOf = (name) => [...document.querySelectorAll('.object-list li.object')].find(li => li.querySelector(':scope > .object-row .name')?.textContent === name);
`

export default {
  // A mask's row: its tag after its name; every row's type beside the eye, in one column.
  ROW1: `${base}${DOM}
const out = {};
const parts = (name) => [...rowOf(name).querySelector('.object-row').children].filter(c => c.getBoundingClientRect().width > 0 || c.classList.contains('eye')).map(c => c.className.split(' ').slice(0, 2).join('.') + (c.textContent.trim() ? ':' + c.textContent.trim() : ''));
out.mask = parts('spot');
out.plain = parts('badge');
const kindRight = (name) => Math.round(rowOf(name).querySelector('.object-row .kind').getBoundingClientRect().right);
const eyeLeft = (name) => Math.round(rowOf(name).querySelector('.object-row .eye').getBoundingClientRect().left);
out.kinds = ['badge', 'spot', 'logo', 'title', 'backdrop'].map(n => [n, kindRight(n), eyeLeft(n)]);
S().select(['spot']); await tick(350);
out.kindsHeld = ['badge', 'spot', 'logo', 'title'].map(n => [n, kindRight(n), eyeLeft(n)]);
out.scopeWidth = Math.round(rowOf('spot').querySelector('.members').getBoundingClientRect().width);
S().setObjectsView('type'); await tick(250);
await setSource(S().source + ${JSON.stringify("\ncards = Group({\n  members: 'bar1 bar2',\n})\n")}); await tick(250);
out.group = parts('cards');
out.inverted = (ops.setObjectProp('spot', 'inverted', true), await tick(250), parts('spot'));
return out`,

  // A click on the pane's empty space selects nothing; on a row it still selects.
  BLANK1: `${base}${DOM}
const out = {};
const list = document.querySelector('.object-list'); const r = list.getBoundingClientRect();
S().select(['badge']); await tick(150);
const tap = (x, y) => { const el = document.elementFromPoint(x, y); el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y })); return el.className };
out.target = tap(r.left + 100, r.bottom - 10); await tick(150);
out.afterBlank = S().selection;
S().selectAction('spot', 0); await tick(150);
tap(r.left + 100, r.bottom - 10); await tick(150);
out.afterBlankWithAction = { selection: S().selection, actions: S().selectedActions };
const row = rowOf('logo').querySelector('.object-row').getBoundingClientRect();
tap(row.left + 80, row.top + 10); await tick(150);
out.afterRow = S().selection;
// The heading of a type folds and leaves the selection.
S().setObjectsView('type'); await tick(200);
const head = document.querySelector('.object-list .group-head').getBoundingClientRect();
tap(head.left + 60, head.top + 8); await tick(150);
out.afterHead = S().selection;
return out`,

  // Hide reaches an export only when the preferences say so.
  EXPORT2: `${base}
const { FrameRenderer } = await import('/src/export/FrameRenderer.ts');
const at = (p, wx, wy) => { const i = ((540 - wy) * 1920 + (wx + 960)) * 4; return '#' + [p[i], p[i + 1], p[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('') };
const out = {};
S().setHidden(['badge', 'spot'], true); await tick(150);
out.pref = S().prefs.hideInExport ?? false;
let fr = new FrameRenderer(1920, 1080, '#1c1c1c', false); let p = fr.draw(S().model, 0); fr.dispose();
out.default = { badge: at(p, 700, 400), outsideMask: at(p, -460, -150) };
fr = new FrameRenderer(1920, 1080, '#1c1c1c', false, S().hidden); p = fr.draw(S().model, 0); fr.dispose();
out.withHidden = { badge: at(p, 700, 400), outsideMask: at(p, -460, -150) };
// In the preferences, and in the export dialog.
S().setPrefsOpen(true); await tick(300);
const box = [...document.querySelectorAll('.prefs-grid label.check')].find(l => l.textContent.includes('left out of exports')).querySelector('input');
out.prefRow = { label: box.closest('.row').previousElementSibling.textContent, checked: box.checked };
box.click(); await tick(150);
out.prefOn = { store: S().prefs.hideInExport, stored: JSON.parse(localStorage.getItem('quick-animator.prefs')).hideInExport };
S().setPrefsOpen(false); S().setExportOpen(true); await tick(300);
out.dialogOn = [...document.querySelectorAll('.export-grid > *')].map(e => e.textContent.trim()).slice(-2);
S().setExportOpen(false); S().setPrefs({ hideInExport: false }); S().setExportOpen(true); await tick(300);
out.dialogOff = [...document.querySelectorAll('.export-grid > *')].map(e => e.textContent.trim()).slice(-2);
S().setExportOpen(false); S().setPrefs({ hideInExport: undefined }); S().setHidden(S().hidden, false); await tick(100);
out.end = { prefs: localStorage.getItem('quick-animator.prefs') };
return out`,

  // Show Masks is off until turned on.
  SHOWOFF1: `${base}
return { stored: localStorage.getItem('quick-animator.showMasks'), on: S().showMasks, button: [...document.querySelectorAll('.preview-tools button')].find(b => b.textContent.trim() === 'Show Masks')?.classList.contains('on'), edges: (st.setState({}), QA.getRenderer().maskEdgeCount()) }`,
}
