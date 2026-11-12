// Groups, selection, and time (the owner, 2026-11-11), in the real window.
const SCENE = [
  'backdrop = Rect({',
  '  width: 1920,',
  '  height: 1080,',
  "  fill: '#24324a',",
  '})',
  '',
  'title = Text({',
  "  text: 'Quick Animator',",
  '  fontSize: 120,',
  '  y: 120,',
  '  until: 2,',
  '})',
  '',
  'bar1 = Rect({',
  '  x: -300,',
  '  y: -150,',
  '  width: 400,',
  '  height: 80,',
  "  fill: '#f59e0b',",
  "  class: 'bar',",
  '  until: 2,',
  '})',
  '',
  'bar2 = Rect({',
  '  x: 300,',
  '  y: -150,',
  '  width: 400,',
  '  height: 80,',
  "  fill: '#4f8cff',",
  "  class: 'bar',",
  '  at: 1,',
  '  until: 3,',
  '})',
  '',
  'badge = Rect({',
  '  x: 700,',
  '  y: 400,',
  '  width: 200,',
  '  height: 100,',
  "  fill: '#10b981',",
  '  until: 4,',
  '})',
  '',
  'cards = Group({',
  "  members: 'bar1 bar2',",
  '})',
  '',
  'bar1.move({',
  '  x: -200,',
  '  at: 0.5,',
  '  duration: 0.5,',
  '})',
  '',
  'cards.move({',
  '  x: 100,',
  '  at: 0.5,',
  '  duration: 1,',
  '})',
  '',
  "fadeBars = all('bar').fade({",
  '  opacity: 0.5,',
  '  at: 1,',
  '  duration: 0.5,',
  '})',
  '',
].join('\n')

const base = `await setSource(${JSON.stringify(SCENE)}); S().select([]); S().setTime(0); S().setTool('select'); S().setHidden(S().hidden, false); S().setAllCollapsed('objects', null); S().setAllCollapsed('timeline', null); st.setState({ snap: false }); await tick(250);`
const DOM = `
const rowOf = (name) => [...document.querySelectorAll('.object-list li.object')].find(li => li.querySelector(':scope > .object-row .name')?.textContent === name);
const clip = (name) => document.querySelector('.oclip[data-object="' + name + '"]');
const classClip = (name) => document.querySelector('.oclip.class[data-class="' + name + '"]');
const paneSelected = () => [...document.querySelectorAll('.object-list li.object.selected')].map(li => li.querySelector(':scope > .object-row .name').textContent);
const clipsSelected = () => [...document.querySelectorAll('.oclip.selected')].map(c => c.dataset.object ?? ('class ' + c.dataset.class));
const life = (name) => { const o = obj(name); return [o.at, o.until] };
const lives = (...names) => Object.fromEntries(names.map(n => [n, life(n)]));
const starts = (name) => obj(name).actions.filter(a => !a.classAction).map(a => a.start);
const pps = () => { const c = clip('badge'); return c.getBoundingClientRect().width / (Number(c.dataset.end) - Number(c.dataset.start)) };
// A drag of a clip's body, on the window as the app listens for it; of an edge, on the edge itself.
const dragBody = async (el, seconds, at = 0.3) => { const r = el.getBoundingClientRect(); const x = r.left + Math.min(r.width - 4, Math.max(40, r.width * at)); const y = r.top + 7; const k = pps(); pe(el.querySelector('.oclip-title') ?? el, 'pointerdown', x, y); for (let i = 1; i <= 6; i++) { window.dispatchEvent(new PointerEvent('pointermove', { clientX: x + seconds * k * i / 6, clientY: y, pointerId: 1, bubbles: true })); await tick(20) } window.dispatchEvent(new PointerEvent('pointerup', { clientX: x + seconds * k, clientY: y, pointerId: 1, bubbles: true })); await tick(250) };
const dragEdge = async (el, side, seconds) => { const edge = el.querySelector(':scope > .oclip-edge.' + side); const r = edge.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + 8; const k = pps(); pe(edge, 'pointerdown', x, y); for (let i = 1; i <= 6; i++) { pe(edge, 'pointermove', x + seconds * k * i / 6, y); await tick(20) } pe(edge, 'pointerup', x + seconds * k, y); await tick(250) };
const tap = async (el) => { const r = el.getBoundingClientRect(); const x = r.left + Math.min(r.width - 4, 40); const y = r.top + 7; pe(el.querySelector('.oclip-title') ?? el, 'pointerdown', x, y); window.dispatchEvent(new PointerEvent('pointerup', { clientX: x, clientY: y, pointerId: 1, bubbles: true })); await tick(200) };
`

export default {
  // Selecting a group's members selects them, not the group; a group selected shows what it carries as selected.
  SEL1: `${base}${DOM}
const out = { err: S().error };
S().setObjectsView('type'); await tick(200);
S().select(['bar1', 'bar2']); await tick(250);
out.members = { selection: S().selection, pane: paneSelected(), clips: clipsSelected(), head: document.querySelector('.now-head')?.textContent.replace(/\\s+/g, ' ').trim(), prospective: !!document.querySelector('.object-list li.prospective') };
S().select(['cards']); await tick(250);
out.group = { selection: S().selection, pane: paneSelected(), clips: clipsSelected() };
S().setObjectsView('layers'); await tick(200);
out.groupInLayers = paneSelected();
S().select(['bar1', 'title']); await tick(250);
out.loose = { selection: S().selection, prospective: document.querySelector('.object-list li.prospective')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, head: document.querySelector('.now-head')?.textContent.replace(/\\s+/g, ' ').trim() };
S().select(['cards', 'bar1']); await tick(150);
out.groupAndMember = S().selection;
// Making a group of things that already are one makes no second one.
S().select(['bar1', 'bar2']); await tick(150);
const made = ops.createGroup(['bar1', 'bar2']); await tick(250);
out.made = { name: made, groups: S().model.objects.filter(o => o.className === 'Group').map(o => o.name), selection: S().selection };
// The preview: all of a group's members picked by a box stay themselves.
S().select([]); S().setHidden(['backdrop'], true); S().setTime(1.5); await tick(200); const g = geom(); await drag(g, { x: -1100, y: -60 }, { x: 560, y: -240 }); await tick(200); S().setHidden(S().hidden, false);
out.marquee = [...S().selection].sort();
return out`,

  // A copy of a group is a copy of its objects.
  COPY1: `${base}${DOM}
const out = {};
S().select(['cards']); await tick(150);
out.copied = ops.copySelection(); out.clip = S().clipboard.items.map(i => i.name + (i.carried ? '*' : ''));
ops.pasteClipboard(); await tick(350);
const groups = () => Object.fromEntries(S().model.objects.filter(o => o.className === 'Group').map(o => [o.name, S().model.groups.get(o.name)]));
out.pasted = { err: S().error, groups: groups(), selection: S().selection, objects: S().model.objects.map(o => o.name), actions: S().model.objects.filter(o => /2$/.test(o.name) && o.name !== 'bar2').map(o => o.name + ':' + o.actions.filter(a => !a.classAction).map(a => a.verb).join(',')), classBar: S().model.classes.get('bar') };
${base}
const dup = ops.duplicateObjects(['cards']); await tick(350);
out.duplicated = { names: dup, groups: groups(), selection: S().selection };
${base}
S().select(['cards']); await tick(150);
ops.cutSelection(); await tick(350);
out.cut = { err: S().error, objects: S().model.objects.map(o => o.name) };
ops.pasteClipboard(); await tick(350);
out.cutPasted = { err: S().error, objects: S().model.objects.map(o => o.name), groups: groups() };
return out`,

  // Several selected clips: an edge of one moves that edge of all.
  EDGE1: `${base}${DOM}
const out = { pps: Math.round(pps()), before: lives('title', 'bar1', 'bar2', 'badge') };
S().select(['title', 'bar1']); await tick(200);
await dragEdge(clip('bar1'), 'right', 1);
out.endTogether = { lives: lives('title', 'bar1', 'bar2', 'badge'), selection: S().selection };
await dragEdge(clip('title'), 'left', 0.5);
out.startTogether = { lives: lives('title', 'bar1', 'bar2', 'badge'), bar1Move: starts('bar1') };
// One alone, as ever.
S().select([]); await dragEdge(clip('badge'), 'right', -1);
out.alone = { lives: lives('title', 'bar1', 'badge'), selection: S().selection };
// One undo step for a drag of several.
QA.getEditor(); const cm = await import(performance.getEntriesByType('resource').map(e => e.name).find(n => /@codemirror_commands/.test(n)));
S().select(['title', 'bar1']); await tick(150); await dragEdge(clip('bar1'), 'right', 1); const after = lives('title', 'bar1');
cm.undo(QA.getEditor()); await tick(300);
out.undo = { after, undone: lives('title', 'bar1') };
return out`,

  // A group's clip moves and trims everything it carries; a clip it carries drags it too.
  GROUP1: `${base}${DOM}
const out = { before: { lives: lives('bar1', 'bar2', 'title'), group: starts('cards'), bar1Move: starts('bar1'), span: [clip('cards').dataset.start, clip('cards').dataset.end], edges: clip('cards').querySelectorAll(':scope > .oclip-edge').length } };
await dragBody(clip('cards'), 1);
out.moved = { lives: lives('bar1', 'bar2', 'title'), group: starts('cards'), bar1Move: starts('bar1'), fade: S().model.classActions[0].members.map(a => a.start), selection: S().selection, err: S().error };
await dragEdge(clip('cards'), 'left', 0.5);
out.trimStart = lives('bar1', 'bar2');
await dragEdge(clip('cards'), 'right', -0.5);
out.trimEnd = lives('bar1', 'bar2');
// With the group selected, a member's clip drags them all, and a click on it selects it alone.
S().select(['cards']); await tick(200);
await dragBody(clip('bar2'), -1);
out.byMember = { lives: lives('bar1', 'bar2'), group: starts('cards'), selection: S().selection };
await tap(clip('bar2'));
out.tapMember = S().selection;
// The arrows move a selected group the same way.
S().select(['cards']); await tick(150);
ops.nudgeObjectsInTime(['cards'], 60); await tick(250);
out.nudged = { lives: lives('bar1', 'bar2'), group: starts('cards') };
// Not before the start of time: the earliest stops, and the rest with it.
await dragBody(clip('cards'), -5);
out.clamped = { lives: lives('bar1', 'bar2'), group: starts('cards') };
return out`,

  // A class's clip does the same for its members and its animations.
  CLASS1: `${base}${DOM}
const c = classClip('bar');
const out = { there: !!c, edges: c?.querySelectorAll(':scope > .oclip-edge').length, before: { lives: lives('bar1', 'bar2'), fade: S().model.classActions[0].members.map(a => a.start) } };
await dragBody(classClip('bar'), 1);
out.moved = { lives: lives('bar1', 'bar2'), fade: S().model.classActions[0].members.map(a => a.start), bar1Move: starts('bar1'), group: starts('cards'), selection: [...S().selection].sort(), clips: clipsSelected(), err: S().error };
await dragEdge(classClip('bar'), 'right', 1);
out.trimEnd = lives('bar1', 'bar2');
await dragEdge(classClip('bar'), 'left', 0.5);
out.trimStart = lives('bar1', 'bar2');
return out`,

  // One object alone moves and trims as it did.
  ALONE1: `${base}${DOM}
const out = {};
await dragBody(clip('bar1'), 1);
out.moved = { life: life('bar1'), move: starts('bar1'), others: lives('bar2', 'title'), group: starts('cards'), selection: S().selection };
await dragEdge(clip('bar1'), 'left', 0.5);
out.trimStart = { life: life('bar1'), move: starts('bar1') };
await dragBody(clip('badge'), 0.5);
out.badge = life('badge');
// Several selected, a body dragged: all of them, as before.
S().select(['title', 'badge']); await tick(150);
await dragBody(clip('title'), 1);
out.together = lives('title', 'badge', 'bar2');
await tap(clip('badge'));
out.tapOne = S().selection;
return out`,
}

export { SCENE }
