// The owner's review of the pane and masks, 2026-11-10: each point, in the real window.
import { readFileSync } from 'node:fs'

const BASE = readFileSync(new URL('./scene-base.js', import.meta.url), 'utf8')
const base = `await setSource(${JSON.stringify(BASE)}); S().select([]); S().setTime(0); S().setTool('select'); S().setHidden(S().hidden, false); if (!S().showMasks) S().toggleShowMasks(); S().setObjectsView('layers'); S().setAllCollapsed('objects', null); await tick(200);`
const PIX = `
const px = (wx, wy) => { const g = geom(); const canvas = g.el.querySelector('canvas'); const gl = canvas.getContext('webgl2'); const r = canvas.getBoundingClientRect(); const k = canvas.width / r.width; const x = Math.round((g.sx(wx) - r.left) * k); const y = Math.round(canvas.height - (g.sy(wy) - r.top) * k); const out = new Uint8Array(4); st.setState({}); gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out); return '#' + [...out.slice(0, 3)].map(v => v.toString(16).padStart(2, '0')).join('') };
`
const DOM = `
const layerRows = () => [...document.querySelectorAll('.object-list li[data-layer]')].map(li => li.dataset.layer);
const rowOf = (name) => [...document.querySelectorAll('.object-list li.object')].find(li => li.querySelector(':scope > .object-row .name')?.textContent === name);
const classRow = (name) => [...document.querySelectorAll('.object-list .class-row')].find(r => r.querySelector('.name').textContent === name);
const ticks = () => Object.fromEntries([...document.querySelectorAll('.object-list .object-row')].filter(r => r.querySelector('.mask-tick')).map(r => [r.querySelector('.name').textContent, r.querySelector('.mask-tick').indeterminate ? 'some' : r.querySelector('.mask-tick').checked]));
const heads = () => [...document.querySelectorAll('.object-list .group-head')].map(h => h.textContent.replace(/\\s+/g, ' ').trim());
const btn = (label) => [...document.querySelectorAll('.objects-tools button')].find(b => b.textContent.trim() === label);
const tools = () => [...document.querySelectorAll('.objects-tools-row')].map(r => [...r.querySelectorAll('input, button')].map(e => e.tagName === 'INPUT' ? 'search' : e.textContent.trim() + (e.classList.contains('active') ? '*' : '') + (e.disabled ? '(off)' : '')));
`
const LATE = ['late = Rect({', '  x: 600,', '  y: -400,', '  width: 100,', '  height: 60,', "  fill: '#ff0000',", '  at: 3,', '})', '', 'duo = Group({', "  members: 'late',", '})', ''].join('\n')

export default {
  // The pane's order, the folds that stay, the boxes at the head, and what each view lists.
  PANE1: `${base}${DOM}
const out = {};
out.tools = tools();
out.layers = { rows: layerRows(), heads: heads(), slots: [...document.querySelectorAll('.object-list .object-row')].map(r => Math.round(r.querySelector('.tick-slot').getBoundingClientRect().width)), first: document.querySelector('.object-list .object-row').firstElementChild.className, icons: document.querySelectorAll('.object-list .glyph svg.kind-icon').length, eyes: document.querySelectorAll('.object-list .object-row .eye').length };
S().select(['spot']); await tick(350);
const row = rowOf('title').querySelector('.object-row'); const tick0 = row.querySelector('.mask-tick'); const name0 = row.querySelector('.name');
out.held = { ticks: ticks(), tickLeftOfName: tick0.getBoundingClientRect().right <= name0.getBoundingClientRect().left, slot: Math.round(row.querySelector('.tick-slot').getBoundingClientRect().width), maskRow: rowOf('spot').querySelector('.object-row').textContent.replace(/\\s+/g, ' ').trim(), maskIcon: getComputedStyle(rowOf('spot').querySelector('.glyph')).color, line: !!rowOf('title').querySelector(':scope > .mask-line.held') };
btn('Type').click(); await tick(250);
out.type = { tools: tools(), heads: heads(), ticks: ticks() };
classRow('bar').querySelector('.mask-tick').click(); await tick(250);
out.untickClass = { scope: obj('spot').attrs.masks, ticks: ticks() };
// The filter: the one that is on is the one lit.
btn('Show Only Active').click(); await tick(150);
out.filterOn = tools()[1];
btn('Show All').click(); await tick(150);
out.filterOff = tools()[1];
// The folds stay, grayed when there is nothing of their kind.
btn('Layers').click(); await tick(150);
await setSource(S().source.replace(/\\nspot\\.move\\(\\{[^}]*\\}\\)\\n/, '\\n')); await tick(250);
out.noAnimations = tools()[2];
return out`,

  // The rows dim by what is on screen at the playhead, whether or not the filter is on.
  ACTIVE1: `${base}${DOM}
await setSource(S().source + ${JSON.stringify('\n' + LATE)}); await tick(250);
const state = (name) => { const li = rowOf(name); return li ? (li.classList.contains('inactive') ? 'inactive' : 'active') + (li.title ? ' / ' + li.title : '') : 'no row' };
const out = { err: S().error };
out.at0 = { late: state('late'), badge: state('badge') };
S().setTime(3.5); await tick(250);
out.at35 = { late: state('late'), badge: state('badge') };
S().setObjectsView('type'); await tick(250);
out.groupAt35 = state('duo');
S().setTime(1); await tick(250);
out.groupAt1 = state('duo');
S().setTime(3.5); await tick(250);
out.groupBack = state('duo');
return out`,

  // The eye on every object: hidden in the view alone, grayed in the timeline with its eye, and back.
  HIDE1: `${base}${PIX}${DOM}
const out = {};
const clip = (name) => document.querySelector('.oclip[data-object="' + name + '"]');
out.before = { badge: px(700, 400), eyes: document.querySelectorAll('.object-list .object-row .eye').length, rows: layerRows().length };
rowOf('badge').querySelector('.eye').click(); await tick(250);
out.hidden = { badge: px(700, 400), hidden: S().hidden, row: rowOf('badge').className, clip: clip('badge').className, clipEye: !!clip('badge').querySelector('.oclip-eye'), selection: S().selection, source: S().source.includes('hidden') };
// Hidden, it is not picked; what is beneath is.
const g = geom(); await click(g, { x: 700, y: 400 }); out.pickThrough = S().selection;
// The timeline's eye shows it again.
clip('badge').querySelector('.oclip-eye').click(); await tick(250);
out.shown = { badge: px(700, 400), hidden: S().hidden, clip: clip('badge').className };
// Right-click, Hide, in the timeline, the preview, and the pane.
S().select([]); clip('logo').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: clip('logo').getBoundingClientRect().left + 30, clientY: clip('logo').getBoundingClientRect().top + 6, button: 2 })); await tick(150);
out.timelineMenu = S().contextMenu.items.map(i => i.label).filter(l => l === 'Hide' || l === 'Show'); S().contextMenu.items.find(i => i.label === 'Hide').run(); S().closeMenu(); await tick(200);
out.afterTimelineHide = { hidden: S().hidden, logo: px(0, -290) };
clip('logo').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: clip('logo').getBoundingClientRect().left + 30, clientY: clip('logo').getBoundingClientRect().top + 6, button: 2 })); await tick(150);
out.timelineMenu2 = S().contextMenu.items.map(i => i.label).filter(l => l === 'Hide' || l === 'Show'); S().contextMenu.items.find(i => i.label === 'Show').run(); S().closeMenu(); await tick(200);
g.el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: g.sx(700), clientY: g.sy(400), button: 2 })); await tick(150);
out.previewMenu = S().contextMenu?.items.map(i => i.label) ?? null; S().contextMenu?.items.find(i => i.label === 'Hide')?.run(); S().closeMenu(); await tick(200);
out.afterPreviewHide = { hidden: S().hidden, badge: px(700, 400) };
S().setHidden(S().hidden, false); await tick(100);
// A hidden mask does not mask in the view; an export is as the code says.
rowOf('spot').querySelector('.eye').click(); await tick(200);
out.maskHidden = { outside: px(-460, -150), hidden: S().hidden };
const { FrameRenderer } = await import('/src/export/FrameRenderer.ts');
S().setHidden(['badge'], true); await tick(100);
const fr = new FrameRenderer(1920, 1080, '#1c1c1c', false); const p = fr.draw(S().model, 0); fr.dispose();
const at = (wx, wy) => { const i = ((540 - wy) * 1920 + (wx + 960)) * 4; return '#' + [p[i], p[i + 1], p[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('') };
out.export = { badge: at(700, 400), outside: at(-460, -150) };
S().setHidden(S().hidden, false); await tick(100);
// A group hidden hides what it carries.
await setSource(S().source + ${JSON.stringify("\ncards = Group({\n  members: 'bar1 bar2',\n})\n")}); S().setObjectsView('type'); await tick(250);
rowOf('cards').querySelector('.eye').click(); await tick(250);
out.groupHidden = { bar1: px(-200, -150), rows: [rowOf('bar1').className.includes('is-hidden'), rowOf('cards').className.includes('is-hidden')], clip: clip('bar1').className.includes('is-hidden') };
clip('bar1').querySelector('.oclip-eye').click(); await tick(250);
out.groupShown = { bar1: px(-200, -150), hidden: S().hidden };
return out`,

  // Show Masks: the edges of the masks on what is selected, or of every mask with nothing selected.
  SHOW1: `${base}${DOM}
const out = {};
const edges = () => { st.setState({}); return QA.getRenderer().maskEdgeCount() };
const button = [...document.querySelectorAll('.preview-options button')].find(b => b.textContent.trim() === 'Show Masks');
const paths = [...document.querySelectorAll('.preview-options button')].find(b => b.textContent.trim() === 'Show Paths');
out.button = { there: !!button, on: button.classList.contains('on'), besidePaths: paths.nextElementSibling === button };
out.none = edges();
S().select(['title']); await tick(150); out.maskedSelected = edges();
S().select(['badge']); await tick(150); out.unmaskedSelected = edges();
S().select(['spot']); await tick(150); out.maskSelected = edges();
S().select([]); await tick(100);
await setSource(S().source.replace("badge = Rect({", ${JSON.stringify(['strip = Rect({', '  x: -300,', '  y: -150,', '  width: 200,', '  height: 300,', "  masks: 'bar',", '  at: 1,', '})', '', 'badge = Rect({'].join('\n'))})); await tick(250);
out.twoMasksAt0 = edges();
S().setTime(1.5); await tick(150); out.twoMasksAt15 = edges();
S().select(['bar1']); await tick(150); out.bar1 = edges();
S().select(['title']); await tick(150); out.title = edges();
S().select([]); S().setHidden(['spot'], true); await tick(150); out.oneHidden = edges();
S().setHidden(['spot'], false); button.click(); await tick(150);
out.off = { on: button.classList.contains('on'), none: edges(), stored: localStorage.getItem('quick-animator.showMasks') };
S().select(['spot']); await tick(150); out.offButInHand = edges();
S().select([]); button.click(); await tick(150); out.onAgain = { edges: edges(), stored: localStorage.getItem('quick-animator.showMasks') };
return out`,

  // What is selected drags where a mask hides it; what is not selected is not picked there.
  PICK2: `${base}
const out = {};
const g = geom();
await click(g, { x: -460, y: -150 }); out.unselected = S().selection;
S().select(['bar1']); await tick(150);
await drag(g, { x: -460, y: -150 }, { x: -460, y: -50 });
out.dragged = { selection: S().selection, y: obj('bar1').attrs.y, x: obj('bar1').attrs.x, err: S().error };
return out`,

  // An empty list is no mask; the last name let out leaves none; the pane's field emptied releases.
  NONE1: `${base}
const out = {};
await setSource(S().source.replace("masks: 'below except backdrop'", "masks: ''")); await tick(200);
out.empty = { masks: S().model.masks.length, warnings: S().model.warnings.length };
await setSource(S().source.replace("masks: ''", "masks: 'title'")); await tick(200);
ops.setMasked('spot', ['title'], false); await tick(200);
out.lastOut = { scope: obj('spot').attrs.masks, isMask: S().model.masks.map(k => k.name + ' -> ' + k.targets.join(' ')), warnings: S().model.warnings.length };
ops.setMasked('spot', ['logo'], true); await tick(200);
out.backIn = obj('spot').attrs.masks;
await setSource(S().source.replace("masks: 'logo'", "masks: 'title'")); await tick(200);
ops.deleteObjects(['title'], true); await tick(300);
out.deletedLast = { scope: obj('spot').attrs.masks, isMask: S().model.masks.length, err: S().error };
S().select(['spot']); await tick(250);
const rowOfKey = (name) => [...document.querySelectorAll('.now-values tr')].find(tr => tr.querySelector('td.k')?.textContent.trim() === name);
const field = rowOfKey('masks').querySelector('input, textarea'); field.focus();
const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), 'value').set; setter.call(field, ''); field.dispatchEvent(new Event('input', { bubbles: true })); field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); field.blur(); await tick(300);
out.cleared = { decl: decl('spot'), masks: S().model.masks.length, sections: [...document.querySelectorAll('.now-values tr.now-section')].map(t => t.textContent.trim()) };
return out`,

  // A class's menu, and the Selected pane's word.
  CLASS1: `${base}${DOM}
const out = {};
S().setObjectsView('type'); await tick(250);
const row = classRow('bar');
row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: row.getBoundingClientRect().left + 60, clientY: row.getBoundingClientRect().top + 8, button: 2 })); await tick(150);
const mask = S().contextMenu.items.find(i => i.label === 'Mask');
out.menu = { items: S().contextMenu.items.map(i => i.label), mask: mask?.children.map(c => c.label + (c.children ? ' > ' + c.children.map(k => k.label + (k.keyword ?? '')).join(',') : '')) };
mask.children.find(c => c.label === 'Masked by').children[0].run(); S().closeMenu(); await tick(250);
out.letOut = obj('spot').attrs.masks;
row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: row.getBoundingClientRect().left + 60, clientY: row.getBoundingClientRect().top + 8, button: 2 })); await tick(150);
S().contextMenu.items.find(i => i.label === 'Mask').children.find(c => c.label === 'Add mask').run(); S().closeMenu(); await tick(300);
out.added = { selection: S().selection, decl: decl(S().selection[0]), targets: S().model.masks.find(k => k.name === S().selection[0])?.targets };
S().select(['bar1']); await tick(250);
out.sections = [...document.querySelectorAll('.now-values tr.now-section')].map(t => t.textContent.trim());
return out`,
}
