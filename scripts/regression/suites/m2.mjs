// Masks and the Objects pane, second set: the interface.
import { readFileSync } from 'node:fs'

const BASE = readFileSync(new URL('./scene-base.js', import.meta.url), 'utf8')
const base = `await setSource(${JSON.stringify(BASE)}); S().select([]); S().setTime(0); S().setTool('select'); S().setHidden(S().hidden, false); S().setObjectsView('layers'); S().setAllCollapsed('objects', null); await tick(200);`
const PIX = `
const px = (wx, wy) => { const g = geom(); const canvas = g.el.querySelector('canvas'); const gl = canvas.getContext('webgl2'); const r = canvas.getBoundingClientRect(); const k = canvas.width / r.width; const x = Math.round((g.sx(wx) - r.left) * k); const y = Math.round(canvas.height - (g.sy(wy) - r.top) * k); const out = new Uint8Array(4); st.setState({}); gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out); return '#' + [...out.slice(0, 3)].map(v => v.toString(16).padStart(2, '0')).join('') };
`
const DOM = `
const layerRows = () => [...document.querySelectorAll('.object-list li[data-layer]')].map(li => li.dataset.layer);
const rowOf = (name) => [...document.querySelectorAll('.object-list li.object')].find(li => li.querySelector(':scope > .object-row .name')?.textContent === name);
const tickOf = (name) => rowOf(name)?.querySelector(':scope > .object-row .mask-tick') ?? null;
const ticks = () => Object.fromEntries([...document.querySelectorAll('.object-list .object-row')].filter(r => r.querySelector('.mask-tick')).map(r => [r.querySelector('.name').textContent, r.querySelector('.mask-tick').indeterminate ? 'some' : r.querySelector('.mask-tick').checked]));
const lines = () => [...document.querySelectorAll('.object-list li[data-layer]')].filter(li => li.querySelector(':scope > .mask-line')).map(li => li.dataset.layer + (li.querySelector(':scope > .mask-line').classList.contains('cap') ? ':cap' : '') + (li.querySelector(':scope > .mask-line').classList.contains('held') ? ':held' : ''));
const tools = () => [...document.querySelectorAll('.objects-tools button')].map(b => b.textContent.trim() + (b.classList.contains('active') || b.classList.contains('on') ? '*' : ''));
const heads = () => [...document.querySelectorAll('.object-list .group-head')].map(h => h.textContent.replace(/\\s+/g, ' ').trim());
`

export default {
  // The two views, the mask's row, the boxes, the line, and the eye.
  PANE1: `${base}${PIX}${DOM}
const out = {};
out.layers = { rows: layerRows(), tools: tools(), heads: heads(), ticks: ticks(), lines: lines() };
S().select(['spot']); await tick(200);
out.held = { ticks: ticks(), lines: lines(), maskRow: rowOf('spot').querySelector('.object-row').textContent.replace(/\\s+/g, ' ').trim(), edge: QA.getRenderer().maskEdgeCount() };
// A click on a box takes the row in or lets it out, and the mask stays in hand.
tickOf('title').click(); await tick(250);
out.untick = { scope: obj('spot').attrs.masks, ticks: ticks(), selection: S().selection, lines: lines() };
tickOf('badge').click(); await tick(250);
out.tickAbove = { scope: obj('spot').attrs.masks, ticks: ticks() };
// A class has its row by type, not among the layers (D342).
S().setObjectsView('type'); await tick(200);
[...document.querySelectorAll('.object-list .class-row')].find(r => r.querySelector('.name').textContent === 'bar').querySelector('.mask-tick').click(); await tick(250);
out.untickClass = { scope: obj('spot').attrs.masks, ticks: ticks() };
S().setObjectsView('layers'); await tick(200);
// The eye: off in the view, the mask hides nothing there.
const before = px(-460, -150);
${''}await setSource(${JSON.stringify(BASE)}); S().select(['spot']); await tick(200);
const hidden = px(-460, -150);
rowOf('spot').querySelector('.eye').click(); await tick(200);
out.eye = { before, hidden, off: px(-460, -150), hidden: S().hidden, rowClass: rowOf('spot').className, selection: S().selection };
rowOf('spot').querySelector('.eye').click(); await tick(200);
out.eyeOn = { on: px(-460, -150), hidden: S().hidden };
// By type.
[...document.querySelectorAll('.objects-tabs button')].find(b => b.textContent === 'Type').click(); await tick(200);
out.type = { view: S().objectsView, heads: heads(), tools: tools(), rows: rows(), ticks: ticks() };
return out`,

  // Show Only Active and the two folds.
  PANE2: `${base}${DOM}
const out = {};
await setSource(S().source.replace("fill: '#10b981',", "fill: '#10b981',\\n  at: 3,") + "\\ntitle.fade({\\n  opacity: 0,\\n  at: 1,\\n  duration: 1,\\n})\\n"); await tick(200);
const btn = (label) => [...document.querySelectorAll('.objects-tools button')].find(b => b.textContent.trim().startsWith(label));
out.all = { rows: layerRows(), label: tools() };
btn('Show Only Active').click(); await tick(200);
out.active0 = { rows: layerRows(), label: tools(), actions: [...document.querySelectorAll('.object-list .action-row')].map(r => r.textContent.replace(/\\s+/g, ' ').trim()) };
S().setTime(1.5); await tick(200);
out.active15 = { rows: layerRows(), actions: [...document.querySelectorAll('.object-list .action-row')].map(r => r.textContent.replace(/\\s+/g, ' ').trim()) };
S().setTime(3.5); await tick(200);
out.active35 = { rows: layerRows() };
btn('Show All').click(); await tick(200); S().setTime(0); await tick(100);
out.back = { rows: layerRows().length, label: tools() };
// Animations fold under their objects with one press, and open with the next.
const actionCount = () => document.querySelectorAll('.object-list .action-row').length;
out.fold = { before: actionCount() };
btn('Animations').click(); await tick(150); out.fold.collapsed = actionCount(); out.fold.keys = Object.keys(S().collapsed.objects);
btn('Animations').click(); await tick(150); out.fold.expanded = actionCount();
// By type, the objects fold under their headings with one press.
S().setObjectsView('type'); await tick(200);
const objectCount = () => document.querySelectorAll('.object-list li.object').length;
out.foldType = { tools: tools(), before: objectCount() };
btn('Objects').click(); await tick(150); out.foldType.collapsed = objectCount(); out.foldType.heads = heads();
btn('Objects').click(); await tick(150); out.foldType.expanded = objectCount();
return out`,

  // A layer's row dragged up or down moves its declaration, and with it what a mask hides.
  DRAG1: `${base}${DOM}
const out = {};
const order = () => S().model.objects.map(o => o.name);
const dragRow = async (name, onto, above, drop = true) => {
  const from = rowOf(name).querySelector(':scope > .object-row'); const fr = from.getBoundingClientRect();
  const to = rowOf(onto).getBoundingClientRect();
  const y = above ? to.top + 3 : to.bottom - 3;
  pe(from, 'pointerdown', fr.left + 40, fr.top + 10);
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: fr.left + 40, clientY: fr.top + 18, bubbles: true }));
  window.dispatchEvent(new PointerEvent('pointermove', { clientX: fr.left + 40, clientY: y, bubbles: true })); await tick(80);
  const mark = [...document.querySelectorAll('.object-list li.object')].filter(li => li.classList.contains('drop-above') || li.classList.contains('drop-below') || li.classList.contains('dragging')).map(li => li.dataset.layer + ':' + [...li.classList].filter(c => c.startsWith('drop') || c === 'dragging').join(','));
  if (drop) window.dispatchEvent(new PointerEvent('pointerup', { clientX: fr.left + 40, clientY: y, bubbles: true }));
  else window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await tick(250);
  return mark;
};
out.start = { rows: layerRows(), order: order(), targets: S().model.masks[0].targets };
// The badge, on top, dragged beneath the mask: now the mask hides it.
out.mark1 = await dragRow('badge', 'spot', false);
out.badgeDown = { rows: layerRows(), order: order(), targets: S().model.masks[0].targets, selection: S().selection };
// The mask dragged to the bottom: nothing is beneath it.
out.mark2 = await dragRow('spot', 'backdrop', false);
out.maskBottom = { rows: layerRows(), targets: S().model.masks[0].targets, err: S().error };
// And to the top again.
out.mark3 = await dragRow('spot', 'badge', true);
out.maskTop = { rows: layerRows(), targets: S().model.masks[0].targets };
// Escape lets go without moving.
out.mark4 = await dragRow('title', 'badge', true, false);
out.escaped = { rows: layerRows(), dragging: document.querySelectorAll('.object-list li.dragging, .object-list li.drop-above, .object-list li.drop-below').length };
return out`,

  // In the preview a mask is not picked unless it is in hand; what it hides is not picked where it hides it.
  PICK1: `${base}
const out = {};
const g = geom();
await click(g, { x: -200, y: -150 }); out.barInside = S().selection;
await click(g, { x: -460, y: -150 }); out.barHidden = S().selection;
await click(g, { x: 0, y: -20 }); out.center = S().selection;
// A marquee over everything leaves the mask out.
S().select([]); await drag(g, { x: -1100, y: 620 }, { x: 1100, y: -620 }); out.marquee = [...S().selection].sort();
// In hand, the mask is picked before anything drawn, and drags.
S().select(['spot']); await tick(150);
await drag(g, { x: 0, y: -20 }, { x: 200, y: 80 });
out.dragged = { selection: S().selection, x: obj('spot').attrs.x, y: obj('spot').attrs.y, err: S().error };
// Outside its picture, what is drawn is picked as ever.
await click(g, { x: 700, y: 400 }); out.afterClickBadge = S().selection;
return out`,

  // The timeline's sections, their order from the preferences, and no reorder of a mask by its clip.
  TL1: `${base}
const out = {};
const lanes = () => [...document.querySelectorAll('.tl-row.lane')].map(l => l.dataset.lane + ':' + [...l.querySelectorAll('.oclip')].map(c => c.dataset.object ?? 'class').join(','));
await setSource(S().source + "\\ncards = Group({\\n  members: 'bar1 bar2',\\n})\\n"); await tick(250);
out.lanes = lanes();
S().setPrefs({ timelineOrder: ['masks', 'objects'] }); await tick(200);
out.masksFirst = lanes().map(l => l.split(':')[0]);
S().setPrefs({ timelineOrder: undefined }); await tick(200);
out.reset = lanes().map(l => l.split(':')[0]);
// In the preferences: a row dragged, and moved by the arrow keys.
S().setPrefsOpen(true); await tick(300);
const prefRows = () => [...document.querySelectorAll('.section-order-row')].map(r => r.textContent.trim());
out.prefRows = prefRows();
const row = (label) => [...document.querySelectorAll('.section-order-row')].find(r => r.textContent.trim() === label);
const masksRow = row('Masks'); const r0 = masksRow.getBoundingClientRect(); const top = row('Objects').getBoundingClientRect();
pe(masksRow, 'pointerdown', r0.left + 20, r0.top + 8);
window.dispatchEvent(new PointerEvent('pointermove', { clientX: r0.left + 20, clientY: top.top + 2, bubbles: true })); await tick(120);
out.draggedLive = { rows: prefRows(), dragging: !!document.querySelector('.section-order-row.dragging') };
window.dispatchEvent(new PointerEvent('pointerup', { clientX: r0.left + 20, clientY: top.top + 2, bubbles: true })); await tick(150);
out.dragged = { rows: prefRows(), saved: S().prefs.timelineOrder, lanes: lanes().map(l => l.split(':')[0]), reset: [...document.querySelectorAll('.prefs-grid button.small')].map(b => b.textContent.trim()) };
row('Masks').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })); await tick(150);
out.arrow = prefRows();
[...document.querySelectorAll('.prefs-grid button.small')].find(b => b.textContent.trim() === 'Reset')?.click(); await tick(150);
out.afterReset = { rows: prefRows(), saved: S().prefs.timelineOrder ?? null, stored: JSON.parse(localStorage.getItem('quick-animator.prefs')).timelineOrder ?? null };
S().setPrefsOpen(false); await tick(150);
return out`,

  // The Selected pane: a mask's own values on a mask, nowhere else.
  SEL1: `${base}
const out = {};
const sections = () => [...document.querySelectorAll('.now-values tr.now-section')].map(t => t.textContent.trim());
const keys = () => [...document.querySelectorAll('.now-values tr td.k')].map(t => t.textContent.trim());
S().select(['bar1']); await tick(250);
out.plain = { sections: sections(), hasMasks: keys().includes('masks'), hasInverted: keys().includes('inverted') };
S().select(['spot']); await tick(250);
out.mask = { sections: sections(), keys: keys().filter(k => k === 'masks' || k === 'inverted'), head: document.querySelector('.now-head').textContent.replace(/\\s+/g, ' ').trim() };
const rowOfKey = (name) => [...document.querySelectorAll('.now-values tr')].find(tr => tr.querySelector('td.k')?.textContent.trim() === name);
const box = rowOfKey('inverted').querySelector('input[type=checkbox]'); box.click(); await tick(250);
out.invertedOn = { decl: decl('spot'), inverted: S().model.masks[0].inverted };
rowOfKey('inverted').querySelector('input[type=checkbox]').click(); await tick(250);
out.invertedOff = decl('spot');
const field = rowOfKey('masks').querySelector('input, textarea'); field.focus();
const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value').set; setter.call(field, 'title logo'); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); field.blur(); await tick(300);
out.typed = { scope: obj('spot').attrs.masks, targets: S().model.masks[0].targets };
return out`,

  // The menus, and the Mask kind where objects are added.
  MENU1: `${base}
const out = {};
const rowOf = (name) => [...document.querySelectorAll('.object-list li.object')].find(li => li.querySelector(':scope > .object-row .name')?.textContent === name)?.querySelector(':scope > .object-row');
const sub = async (label) => { const b = [...document.querySelectorAll('.context-menu button')].find(b => b.textContent.trim().startsWith(label)); if (!b) return null; b.parentElement.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); b.parentElement.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false })); await tick(150); return [...document.querySelectorAll('.context-menu.submenu button')].map(x => x.textContent.trim()) };
const close = async () => { S().closeMenu(); await tick(80) };
out.plain = await menu(rowOf('bar1')); out.plainMask = S().contextMenu.items.find(i => i.label === 'Mask').children.map(c => c.label + (c.children ? ' > ' + c.children.map(k => k.label + (k.keyword ?? '')).join(',') : '')); await close();
out.mask = await menu(rowOf('spot')); out.maskMask = S().contextMenu.items.find(i => i.label === 'Mask').children.map(c => c.label + (c.keyword ?? '')); await close();
// Masked by: a tick lets it out.
await menu(rowOf('title')); S().contextMenu.items.find(i => i.label === 'Mask').children.find(c => c.label === 'Masked by').children[0].run(); await close(); await tick(200);
out.maskedBy = obj('spot').attrs.masks;
// Add mask from the menu, for two things.
S().select(['bar1', 'bar2']); await tick(200);
await menu(rowOf('bar1')); const many = S().contextMenu.items.find(i => i.label === 'Mask').children; out.manyItems = many.map(c => c.label); many.find(c => c.label === 'Add mask').run(); await close(); await tick(250);
out.addMask = { selection: S().selection, decl: decl(S().selection[0]) };
// Where objects are added, Mask is among the kinds.
const blank = document.querySelector('.object-list'); blank.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 60, clientY: blank.getBoundingClientRect().bottom - 6, button: 2 })); await tick(150);
out.addKinds = S().contextMenu?.items[0]?.children?.map(c => c.label) ?? null; await close();
S().setTool('object'); await tick(150);
out.toolKinds = [...document.querySelectorAll('.preview-modes button')].map(b => b.textContent.trim());
[...document.querySelectorAll('.preview-modes button')].find(b => b.textContent.trim() === 'Mask').click(); await tick(100);
const g = geom(); await click(g, { x: 300, y: 200 }); await tick(250);
out.placed = { selection: S().selection, decl: decl(S().selection[0]) };
S().setTool('select'); S().setAddKind('Rect');
return out`,
}
