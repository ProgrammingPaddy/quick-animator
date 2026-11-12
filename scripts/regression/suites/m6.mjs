// Masks in the code pane: the completions and the ghost defaults.
import { readFileSync } from 'node:fs'

const BASE = readFileSync(new URL('./scene-base.js', import.meta.url), 'utf8')
const base = `await setSource(${JSON.stringify(BASE)}); S().select([]); S().setTime(0); S().setTool('select'); S().setHidden(S().hidden, false); await tick(200);`
const AC = `
const acUrl = performance.getEntriesByType('resource').map(e => e.name).find(n => /@codemirror_autocomplete/.test(n));
const ac = await import(acUrl);
const ed = QA.getEditor();
// Put the cursor at the end of some text that is in the file, type more, and ask what completes.
const typeAt = async (after, typed) => { const at = ed.state.doc.toString().indexOf(after); if (at < 0) throw new Error('not in the file: ' + after); const pos = at + after.length; ed.focus(); ed.dispatch({ changes: { from: pos, to: pos, insert: typed }, selection: { anchor: pos + typed.length } }); await tick(150); ac.startCompletion(ed); for (let i = 0; i < 20 && ac.completionStatus(ed.state) !== 'active'; i++) await tick(50); return ac.currentCompletions(ed.state).map(c => c.label) };
const accept = async (label) => { const list = ac.currentCompletions(ed.state); const i = list.findIndex(c => c.label === label); if (i < 0) return false; await tick(400); ed.dispatch({ effects: ac.setSelectedCompletion(i) }); await tick(150); const ok = ac.acceptCompletion(ed); await tick(250); return ok };
`

export default {
  CODE1: `${base}${AC}
const out = {};
// A statement start: Mask is among what a new object can be, and expands to a Rect that masks.
const end = S().source.trimEnd().slice(-12);
out.statement = (await typeAt(end, '\\n\\nMas')).filter(l => /^(Mask|Rect|Circle)$/.test(l));
out.acceptedMask = await accept('Mask'); ac.closeCompletion(ed); await tick(300);
out.afterMask = { tail: S().source.trimEnd().split('\\n').slice(-9).join('|'), masks: S().model?.masks.map(k => k.name + ' -> ' + k.targets.length) ?? null, err: S().error };
${base}
// Inside a block: masks is offered, and starts as every layer beneath.
out.attr = (await typeAt("fill: '#10b981',", '\\n  mas')).filter(l => /^(masks|inverted)$/.test(l));
out.acceptedAttr = await accept('masks'); ac.closeCompletion(ed); await tick(300);
out.afterAttr = { badge: decl('badge'), masks: S().model?.masks.map(k => k.name) ?? null, err: S().error };
${base}
// Inside the list: the words and the names.
const inList = await typeAt("masks: 'below except backdrop", ' ');
out.inList = { words: inList.filter(l => ['below', 'above', 'except', 'none'].includes(l)), names: inList.filter(l => ['title', 'bar1', 'logo', 'badge', 'bar'].includes(l)) };
ac.closeCompletion(ed);
const typed = await typeAt("masks: 'below except backdrop ", 'ti'); out.narrowed = typed.slice(0, 3);
out.acceptedName = await accept('title'); ac.closeCompletion(ed); await tick(300);
out.afterName = { scope: obj('spot')?.attrs.masks ?? null, targets: S().model?.masks[0]?.targets ?? null, err: S().error };
// After name = : the class expands without a name.
${base}
out.afterEquals = (await typeAt(end, '\\n\\nwipe = Ma')).filter(l => /^(Mask)$/.test(l));
out.acceptedAfterEquals = await accept('Mask'); ac.closeCompletion(ed); await tick(300);
out.afterEqualsCode = { tail: S().source.trimEnd().split('\\n').slice(-9).join('|'), masks: S().model?.masks.map(k => k.name) ?? null, err: S().error };
return out`,

  // The ghost lines: masks among every object's defaults, empty; inverted on a mask alone.
  GHOST1: `${base}
if (!S().showDefaults) S().toggleDefaults(); await tick(400);
// The editor draws only what is in view: scroll through the file and gather every block once, by where it stands.
const ed = QA.getEditor(); const sc = ed.scrollDOM; const seen = new Map();
for (let y = 0; ; y += Math.max(100, sc.clientHeight - 100)) { sc.scrollTop = y; await tick(150); for (const b of document.querySelectorAll('.cm-ghost-lines')) seen.set(ed.posAtDOM(b), [...b.querySelectorAll('.cm-ghost-line')].map(l => l.textContent.trim())); if (y >= sc.scrollHeight - sc.clientHeight) break }
sc.scrollTop = 0; await tick(150);
const blocks = [...seen.values()];
const withMasks = blocks.filter(b => b.some(l => l.startsWith('masks:'))).length;
const withInverted = blocks.filter(b => b.some(l => l.startsWith('inverted:'))).length;
const sample = blocks.find(b => b.some(l => l.startsWith('masks:')))?.filter(l => /^(masks|inverted)/.test(l));
const out = { blocks: blocks.length, withMasks, withInverted, sample, objects: S().model.objects.length, masks: S().model.masks.length };
// A ghost default written in is still no mask.
const line = [...document.querySelectorAll('.cm-ghost-line')].find(l => l.textContent.trim().startsWith('masks:'));
line.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); line.click(); await tick(400);
out.afterClick = { written: /masks: ''/.test(S().source), masks: S().model?.masks.length ?? null, err: S().error };
return out`,
}
