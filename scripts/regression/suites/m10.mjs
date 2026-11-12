// A drag's place is one thing (D356): where its change is written is decided for x and y together, and only what changed is written.
const NL = String.fromCharCode(10)
const DECL = ['b = Rect({', '  x: -300,', '  y: 0,', '  width: 100,', '  height: 60,', '  until: 6,', '})', ''].join(NL)
// An animation on one axis alone: b rises, and nothing moves it sideways.
const RISE = DECL + ['', 'b.move({', '  y: 100,', '  at: 0,', '  duration: 1,', '})', ''].join(NL)

const HELP = `
const acts = () => obj('b').actions.map(a => [a.verb, a.start, a.end, Object.fromEntries(Object.entries(a.changes).map(([k, v]) => [k, typeof v === 'number' ? Math.round(v) : 'fn']))]);
const state = () => ({ declX: obj('b').attrs.x, declY: obj('b').attrs.y, acts: acts(), shown: (() => { const p = smp.positionAt(S().model, obj('b'), S().time); return [Math.round(p.x), Math.round(p.y)] })(), err: S().error });
// A drag through the given places in the scene, from where b shows, one pointer event for each.
const through = async (points) => { const g = geom(); const f = QA.getRenderer().frameOf('b'); pe(g.el, 'pointerdown', g.sx(f.x), g.sy(f.y)); for (const p of points) { pe(g.el, 'pointermove', g.sx(p[0]), g.sy(p[1])); await tick(40) } const last = points[points.length - 1]; pe(g.el, 'pointerup', g.sx(last[0]), g.sy(last[1])); await tick(250) };
const start = async (source, time) => { await setSource(source); S().select([]); S().setTool('select'); S().setTransformMode('move'); if (S().collide) S().setCollide(false); S().setTime(time); await tick(250) };
`

export default {
  // After the animation's end: a drag that first moves sideways alone, then both ways, is one new animation carrying both, and the declaration is untouched. Straight sideways, it carries x alone.
  PLACE1: `${HELP}
const out = {};
await start(${JSON.stringify(RISE)}, 2);
await through([[-280, 100], [-200, 160], [-100, 200]]);
out.sidewaysFirst = state();
await start(${JSON.stringify(RISE)}, 2);
await through([[-200, 160], [-100, 200]]);
out.bothFromTheStart = state();
await start(${JSON.stringify(RISE)}, 2);
await through([[-280, 100], [-200, 100], [-100, 100]]);
out.sidewaysOnly = { ...state(), yLineInNew: /y: /.test(S().source.slice(S().source.lastIndexOf('b.move('))) };
return out`,

  // In the middle of it: the piece from its start takes the place, x at first and y when it moves; the animation it was cut from is untouched.
  PLACE2: `${HELP}
const out = {};
await start(${JSON.stringify(RISE)}, 0.5);
const y0 = QA.getRenderer().frameOf('b').y;
await through([[-280, y0], [-200, y0 + 40], [-100, y0 + 80]]);
out.sidewaysFirst = { ...state(), target: [-100, Math.round(y0 + 80)] };
await start(${JSON.stringify(RISE)}, 0.5);
await through([[-280, y0], [-200, y0], [-100, y0]]);
out.sidewaysOnly = state();
return out`,

  // With no animation the declaration takes the drag, a line for each axis that moved and no more; and where the first axis has no animation but the place has a key here, the key takes it.
  PLACE3: `${HELP}
const out = {};
await start(${JSON.stringify(DECL)}, 1);
await through([[-280, 0], [-200, 0], [-100, 0]]);
out.bare = { ...state(), yLine: /y: /.test(decl('b')) };
await start(${JSON.stringify(RISE)}, 1);
await through([[-280, 100], [-200, 160], [-100, 200]]);
out.atTheEnd = state();
return out`,
}
