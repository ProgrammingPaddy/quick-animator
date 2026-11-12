// A group or a class whose members all move in time goes with them (D354), in the real window.
import { SCENE } from './m8.mjs'

// The same scene with a larger group and a larger class around the bars: neither is whole when only the bars move.
const SCENE2 =
  SCENE.split("class: 'bar',").join("class: 'bar wide',").replace("  fill: '#10b981',\n  until: 4,", "  fill: '#10b981',\n  class: 'wide',\n  until: 4,") +
  ['everything = Group({', "  members: 'cards badge',", '})', '', 'everything.move({', '  y: 50,', '  at: 0.25,', '  duration: 0.5,', '})', '', "fadeWide = all('wide').fade({", '  opacity: 0.8,', '  at: 0.2,', '  duration: 0.3,', '})', ''].join('\n')

const reset = (scene) => `await setSource(${JSON.stringify(scene)}); S().select([]); S().setTime(0); S().setTool('select'); S().setHidden(S().hidden, false); S().setAllCollapsed('objects', null); S().setAllCollapsed('timeline', null); st.setState({ snap: false }); await tick(250);`
const base = reset(SCENE)
const base2 = reset(SCENE2)
const DOM = `
const clip = (name) => document.querySelector('.oclip[data-object="' + name + '"]');
const classClip = (name) => document.querySelector('.oclip.class[data-class="' + name + '"]');
const life = (name) => { const o = obj(name); return [o.at, o.until] };
const lives = (...names) => Object.fromEntries(names.map(n => [n, life(n)]));
const starts = (name) => obj(name).actions.filter(a => !a.classAction).map(a => a.start);
const classAt = (name) => S().model.classActions.filter(c => c.className === name).map(c => Math.min(...c.members.map(a => a.start)));
const all = () => ({ lives: lives('bar1', 'bar2', 'badge'), bar1Move: starts('bar1'), cards: starts('cards'), bar: classAt('bar'), err: S().error });
const all2 = () => ({ ...all(), everything: starts('everything'), wide: classAt('wide') });
const pps = () => { const c = clip('badge'); return c.getBoundingClientRect().width / (Number(c.dataset.end) - Number(c.dataset.start)) };
const dragBody = async (el, seconds, at = 0.3) => { const r = el.getBoundingClientRect(); const x = r.left + Math.min(r.width - 4, Math.max(40, r.width * at)); const y = r.top + 7; const k = pps(); pe(el.querySelector('.oclip-title') ?? el, 'pointerdown', x, y); for (let i = 1; i <= 6; i++) { window.dispatchEvent(new PointerEvent('pointermove', { clientX: x + seconds * k * i / 6, clientY: y, pointerId: 1, bubbles: true })); await tick(20) } window.dispatchEvent(new PointerEvent('pointerup', { clientX: x + seconds * k, clientY: y, pointerId: 1, bubbles: true })); await tick(250) };
const undo = async () => { const cm = await import(performance.getEntriesByType('resource').map(e => e.name).find(n => n.includes('@codemirror_commands'))); cm.undo(QA.getEditor()); await tick(300) };
`

export default {
  // A class's clip, dragged: a group made of exactly its members goes too, by its own animation.
  CROSS1: `${base}${DOM}
const out = { before: all() };
await dragBody(classClip('bar'), 1);
out.moved = all();
await undo();
out.undone = all();
return out`,

  // A group's clip, dragged: a class made of exactly its members goes too.
  CROSS2: `${base}${DOM}
const out = { before: all() };
await dragBody(clip('cards'), 1);
out.moved = all();
await undo();
out.undone = all();
return out`,

  // All the members selected as themselves and moved: their group and their class go with them. Then one of the two alone: neither goes.
  CROSS3: `${base}${DOM}
const out = {};
S().select(['bar1', 'bar2']); await tick(200);
await dragBody(clip('bar1'), 1);
out.together = { ...all(), selection: S().selection };
await undo();
out.undone = all();
S().select([]); await tick(150);
await dragBody(clip('bar1'), 1);
out.oneAlone = all();
return out`,

  // A larger group and a larger class stay when only a part of them moves, and go when all of them does.
  CROSS4: `${base2}${DOM}
const out = { before: all2() };
await dragBody(classClip('bar'), 1);
out.barsMoved = all2();
S().select(['bar1', 'bar2', 'badge']); await tick(150);
ops.nudgeObjectsInTime(['bar1', 'bar2', 'badge'], 30); await tick(300);
out.allNudged = all2();
S().select(['everything']); await tick(200);
await dragBody(clip('everything'), 1);
out.groupDragged = { ...all2(), selection: S().selection };
await dragBody(classClip('wide'), -1);
out.wideDragged = all2();
return out`,

  // The arrows on a selected group: a class of the same members goes too. With snapping on, nothing snaps to what moves with it.
  CROSS5: `${base}${DOM}
const out = {};
S().select(['cards']); await tick(150);
ops.nudgeObjectsInTime(['cards'], 60); await tick(300);
out.nudged = all();
await undo();
out.undone = all();
st.setState({ snap: true }); await tick(100);
await dragBody(clip('cards'), 0.52);
out.snapOn = { ...all(), line: !!document.querySelector('.tl-snap-line') };
st.setState({ snap: false });
return out`,
}
