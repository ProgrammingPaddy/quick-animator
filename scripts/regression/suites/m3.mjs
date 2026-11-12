import { readFileSync } from 'node:fs'
const BASE = readFileSync(new URL('./scene-base.js', import.meta.url), 'utf8')
const base = `await setSource(${JSON.stringify(BASE)}); S().select([]); S().setTime(0); S().setTool('select'); S().setHidden(S().hidden, false); S().setObjectsView('layers'); S().setAllCollapsed('objects', null); await tick(200);`
const STRIP = ['strip = Rect({', '  x: -300,', '  y: -150,', '  width: 200,', '  height: 300,', "  masks: 'bar',", '  inverted: true,', '})', '', 'badge = Rect({'].join('\n')
export default {
  // No complaint from the graphics while every kind of pass runs: a mask, two joined, one inverted, the edge.
  GL1: `${base}
const said = []; const keep = { error: console.error, warn: console.warn };
console.error = (...a) => { said.push('E ' + a.map(String).join(' ').slice(0, 300)); keep.error(...a) };
console.warn = (...a) => { said.push('W ' + a.map(String).join(' ').slice(0, 300)); keep.warn(...a) };
const gl = document.querySelector('.preview canvas').getContext('webgl2');
const errs = [];
const paint = async () => { st.setState({}); errs.push(gl.getError()); await tick(60) };
await paint();
await setSource(S().source.replace("badge = Rect({", ${JSON.stringify(STRIP)})); await paint();
S().select(['spot']); await paint(); S().select(['strip']); await paint(); S().select([]); await paint();
S().setTime(1); await paint();
const sets = S().model.masks.map(k => k.name + (k.inverted ? '!' : '') + ' -> ' + k.targets.join(' '));
console.error = keep.error; console.warn = keep.warn;
return { said, errs, lost: gl.isContextLost(), sets }`,

  // A mask made of several objects in the pane: its members sit under it, and its own row folds them.
  GROUP1: `${base}
const merged = ops.useAsMask(['logo', 'badge']); await tick(250);
const layerRows = () => [...document.querySelectorAll('.object-list li[data-layer]')].map(li => li.dataset.layer + (li.querySelector(':scope > .member-list') ? '[' + [...li.querySelectorAll(':scope > .member-list > li .name')].map(n => n.textContent).join(' ') + ']' : ''));
const out = { rows: layerRows(), lanes: [...document.querySelectorAll('.tl-row.lane')].map(l => l.dataset.lane + ':' + [...l.querySelectorAll('.oclip')].map(c => c.dataset.object ?? 'class').join(',')), selection: S().selection };
// The group in hand: a click on a member's picture picks through to the group, and drags it.
const g = geom(); await drag(g, { x: 0, y: -350 }, { x: 100, y: -350 });
out.dragged = { selection: S().selection, group: decl(merged), logo: obj('logo').attrs.x };
// A member selected from the pane is the mask in hand too.
S().select(['logo']); await tick(200);
out.memberHeld = { ticks: document.querySelectorAll('.object-list .mask-tick').length, edge: QA.getRenderer().maskEdgeCount() };
return out`,
}
