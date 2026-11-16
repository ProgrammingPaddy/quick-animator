// Paths as moves, and the fixes that came with them (D387 to D395): a path begins where its object is, and does not turn with it; its own angle turns it, which Move path sets by the handle over its box; an object a path places is dragged as one a move places, and no press moves the playhead; the Path tool's points, the first of them where the object is; which paths show; a cut path going as the whole did, with nothing refused; Close line filling; a color's opacity in its picker; the bucket's cursor.
const NL = String.fromCharCode(10)
const BOX = (name, x, y, more = []) => [name + ' = Rect({', '  x: ' + x + ',', '  y: ' + y + ',', '  width: 80,', '  height: 50,', ...more, '})', '']
const SHAPE = ['    [0, 0],', '    [200, 100],', '    [400, 0],']
const PATH = (name, more = [], shape = SHAPE) => [name + '.path({', '  shape: [', ...shape, '  ],', '  at: 1,', '  duration: 2,', "  ease: 'linear',", ...more, '})', '']
// Written the way a path was before: its points where they lie in the scene.
const OLD = ['    [-300, 0],', '    [0, 200],']
const LONG = ['    [0, 0],', '    [200, 150],', '    [400, -50],', '    [600, 100],']
const EASED = (name, more = [], shape = LONG) => [name + '.path({', '  shape: [', ...shape, '  ],', '  at: 1,', '  duration: 2,', ...more, '})', '']
const CURVES = (name, more = []) => [name + '.path({', "  shape: 'M 0 0 C 100 200 300 200 400 0 C 450 -100 550 -100 600 50',", '  at: 1,', '  duration: 2,', ...more, '})', '']
const FORMULA = (name, more = []) => [name + '.path({', '  shape: (p) => [p * 500, Math.sin(p * 2 * Math.PI) * 150],', '  at: 1,', '  duration: 2,', ...more, '})', '']
const CIRCLE = ['m = Circle({', '  x: 100,', '  y: 0,', '  radius: 20,', '})', '']
const TURN = (name) => [name + '.rotate({', '  rotation: 120,', '  at: 0,', '  duration: 4,', "  ease: 'linear',", '})', '']
const GROUP = (name, members, more = []) => [name + ' = Group({', "  members: '" + members + "',", ...more, '})', '']
const MOVE = (name) => [name + '.move({', '  x: -300,', '  at: 0,', '  duration: 1,', "  ease: 'linear',", '})', '']
const SECOND = (name) => [name + '.path({', '  shape: [', '    [0, 0],', '    [0, -200],', '  ],', '  at: 3,', '  duration: 1,', "  ease: 'linear',", '})', '']
const J = (lines) => JSON.stringify(lines.join(NL))

const MODEL = {
  asWritten: [...BOX('b', -300, 0, ['  until: 6,']), ...PATH('b', [], OLD)],
  moved: [...BOX('b', 100, 100, ['  until: 6,']), ...PATH('b', [], OLD)],
  turned: [...BOX('b', 100, 100, ['  rotation: 90,', '  until: 6,']), ...PATH('b', [], OLD)],
  afterMove: [...BOX('b', -300, 0, ['  until: 6,']), ...PATH('b', [], OLD), 'b.move({', '  x: 400,', '  at: 0,', '  duration: 0.5,', '})', ''],
  offset: [...BOX('b', -300, 0, ['  until: 6,']), ...PATH('b', ['  offset: [50, 0],'], OLD)],
  relative: [...BOX('b', 100, 100, ['  until: 6,']), ...PATH('b', ['  relative: true,'], OLD)],
  facing: [...BOX('b', 100, 100, ['  rotation: 90,', '  until: 6,']), ...PATH('b', ['  orient: true,'], OLD)],
  formula: ['b = Circle({', '  x: 500,', '  y: 0,', '  radius: 20,', '})', '', 'b.path({', '  shape: (p) => [Math.cos(p * 2 * Math.PI) * 200, Math.sin(p * 2 * Math.PI) * 200],', '  at: 1,', '  duration: 2,', "  ease: 'linear',", '})', ''],
  afterFacing: [...BOX('b', -300, -50), ...PATH('b', ['  orient: true,'], LONG), ...SECOND('b')],
  turnedBefore: [...BOX('b', -300, -50), 'b.rotate({', '  rotation: 90,', '  at: 0,', '  duration: 0.5,', '})', '', ...PATH('b', [], LONG)],
  turnedDuring: [...BOX('b', -300, 0, ['  rotation: 90,']), ...PATH('b'), 'b.to({', '  rotation: 180,', '  at: 1,', '  duration: 2,', '})', ''],
  angle: [...BOX('b', -300, 0), ...PATH('b', ['  angle: 90,'])],
  angleOffset: [...BOX('b', -300, 0), ...PATH('b', ['  angle: 90,', '  offset: [50, 0],'])],
  relativeAngle: [...BOX('b', -300, 0), ...PATH('b', ['  relative: true,', '  angle: 90,'])],
  facingAngle: [...BOX('b', -300, 0), ...PATH('b', ['  orient: true,', '  angle: 90,'])],
  spin: [...BOX('b', -300, 0), ...PATH('b'), 'b.rotate({', '  rotation: 720,', '  at: 0.5,', '  duration: 3,', "  ease: 'linear',", '})', ''],
}
const CUTS = {
  points: [...BOX('a', -300, -50), ...EASED('a')],
  facing: [...BOX('a', -300, -50), ...EASED('a', ['  orient: true,'])],
  turnedObject: [...BOX('a', -300, -50, ['  rotation: 30,']), ...EASED('a', ['  orient: true,'])],
  smoothFacing: [...BOX('a', -300, -50), ...EASED('a', ['  smooth: true,', '  orient: true,'])],
  curvesFacing: [...BOX('a', -300, -50, ['  rotation: -45,']), ...CURVES('a', ['  orient: true,'])],
  pointsWhileTurning: [...BOX('a', -300, -50), ...EASED('a'), ...TURN('a')],
  curvesWhileTurning: [...BOX('a', -300, -50), ...CURVES('a'), ...TURN('a')],
  formula: [...BOX('a', -300, -50, ['  rotation: 20,']), ...FORMULA('a')],
  formulaFacing: [...BOX('a', -300, -50, ['  rotation: 20,']), ...FORMULA('a', ['  orient: true,'])],
  formulaWhileTurning: [...BOX('a', -300, -50), ...FORMULA('a'), ...TURN('a')],
  relative: [...BOX('a', -300, -50), ...EASED('a', ['  relative: true,'])],
  relativeFacing: [...BOX('a', -300, -50), ...EASED('a', ['  relative: true,', '  orient: true,'])],
  offset: [...BOX('a', -300, -50), ...EASED('a', ['  offset: [40, 20],'])],
  relativeOffset: [...BOX('a', -300, -50), ...EASED('a', ['  relative: true,', '  offset: [40, 20],'])],
  formulaOffset: [...BOX('a', -300, -50), ...FORMULA('a', ['  offset: [40, 20],'])],
  relativeFormula: [...BOX('a', -300, -50), ...FORMULA('a', ['  relative: true,'])],
  relativeFormulaOffset: [...BOX('a', -300, -50), ...FORMULA('a', ['  relative: true,', '  offset: [40, 20],'])],
  angled: [...BOX('a', -300, -50), ...EASED('a', ['  angle: 30,', '  orient: true,'])],
  angledFormula: [...BOX('a', -300, -50), ...FORMULA('a', ['  angle: -40,'])],
}
const BARS = [...BOX('a', -300, -50, ["  class: 'bars',"]), ...BOX('b', -300, 150, ["  class: 'bars',"])]
const CLASSCUTS = {
  relativePath: [...BARS, "all('bars').path({", '  shape: [', ...SHAPE, '  ],', '  at: 1,', '  duration: 2,', '  relative: true,', '})', ''],
  path: [...BARS, "all('bars').path({", '  shape: [', ...SHAPE, '  ],', '  at: 1,', '  duration: 2,', '})', ''],
  relativeMove: [...BARS, "all('bars').move({", '  x: 300,', '  at: 1,', '  duration: 2,', '  relative: true,', '})', ''],
}
const SHOWN = [...BOX('a', -400, -200), ...PATH('a', [], ['    [0, 0],', '    [300, 0],']), ...BOX('b', -400, 200), 'b.path({', '  shape: [', '    [0, 0],', '    [300, 0],', '  ],', '  at: 2,', '  duration: 2,', '})', '', 'b.path({', '  shape: [', '    [0, 0],', '    [0, -150],', '  ],', '  at: 5,', '  duration: 1,', '})', '']
const LINE = ['l = Shape({', '  x: 0,', '  y: 0,', "  curves: 'M -200 -100 L 200 -100 L 0 150',", "  fill: 'none',", "  stroke: '#ffffff',", '  strokeWidth: 4,', '})', '']
const POINTSLINE = ['p = Shape({', '  x: 0,', '  y: 0,', '  points: [', '    [-200, -100],', '    [200, -100],', '    [0, 150],', '  ],', '  closed: false,', "  fill: 'none',", "  stroke: '#ffffff',", '  strokeWidth: 4,', '})', '']
const TWOPOINTS = ['t = Shape({', '  x: 0,', '  y: 0,', "  curves: 'M -200 0 L 200 0',", "  fill: 'none',", "  stroke: '#ffffff',", '  strokeWidth: 4,', '})', '']
const SOLID = ['s = Shape({', '  x: 0,', '  y: 0,', "  curves: 'M -200 -100 L 200 -100 L 0 150 Z',", "  fill: '#ff8800',", '})', '']

const HELP = `
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const rp = (p) => [Math.round(p.x), Math.round(p.y)];
// Every check begins the same: the Preview view fitted on an empty scene, Select in hand, nothing selected, no snapping, no notice.
const begin = async (source, time = 0) => { S().setPreviewView('preview'); S().setTool('select'); S().setTimelineTool('select'); S().setTransformMode('all'); S().setPick('object'); S().setPathMode('create'); S().select([]); S().setPreviewSnap({ on: false, edges: false }); if (S().collide) S().setCollide(false); S().setNotice(null); await setSource(''); [...document.querySelectorAll('.preview-tools button')].find((b) => b.textContent.trim() === 'Fit')?.click(); await tick(150); await setSource(source); S().select([]); S().setTime(time); await tick(250) };
const host = () => document.querySelector('.preview');
const at = (wx, wy) => { const b = host().getBoundingClientRect(); const p = QA.getViewport().toPane(wx, wy); return { x: b.left + p.x, y: b.top + p.y } };
const press = async (p, extra = {}) => { pe(host(), 'pointerdown', p.x, p.y, extra); await tick(40); pe(host(), 'pointerup', p.x, p.y, extra); await tick(220) };
const pull = async (from, to, extra = {}) => { pe(host(), 'pointerdown', from.x, from.y, extra); for (let i = 1; i <= 6; i++) { pe(host(), 'pointermove', from.x + ((to.x - from.x) * i) / 6, from.y + ((to.y - from.y) * i) / 6, extra); await tick(30) } pe(host(), 'pointerup', to.x, to.y, extra); await tick(300) };
const pos = (name, t) => rp(smp.positionAt(S().model, obj(name), t));
const shown = (name, t) => rp(smp.worldPose(S().model, obj(name), t));
const turn = (name, t) => r1(Number(smp.valueAt(S().model, obj(name), 'rotation', t)));
const acts = (name) => obj(name).actions.map((a) => [a.verb, a.start, a.end]);
const stmt = (name, k) => { const a = obj(name).actions[k]; return a && a.stmt ? S().source.slice(a.stmt.range.from, a.stmt.range.to).replace(/\\s+/g, ' ') : null };
const flat = (name) => (decl(name) ?? '').replace(/\\s+/g, ' ');
const paths = (name) => obj(name).actions.filter((a) => a.verb === 'path');
const frame = (name, k = 0) => smp.travelFrame(S().model, obj(name), paths(name)[k]);
const anchors = (name, k = 0) => frame(name, k).anchors.map(rp);
const dragBy = async (name, t, dx, dy) => { const w = shown(name, t); await pull(at(w[0], w[1]), at(w[0] + dx, w[1] + dy)); return { lands: shown(name, t), wanted: [w[0] + dx, w[1] + dy], time: S().time } };
const undo = async () => { key('keydown', 'KeyZ', { ctrlKey: true }); await tick(400) };
// How an object goes over the scene's first four seconds, and the most two such goings differ by.
const course = (name) => { const o = obj(name); const m = S().model; const out = []; for (let t = 0; t <= 4.0001; t += 0.05) { const p = smp.positionAt(m, o, t); out.push([p.x, p.y, Number(smp.valueAt(m, o, 'rotation', t))]) } return out };
const worst = (a, b) => { let place = 0; let turned = 0; for (let i = 0; i < a.length; i++) { place = Math.max(place, Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1])); turned = Math.max(turned, Math.abs(a[i][2] - b[i][2])) } return { place: r2(place), turn: r2(turned) } };
const cutAt = async (name, source, time) => { await setSource(source); S().setNotice(null); await tick(250); if (S().error) return { error: S().error }; const before = course(name); const index = obj(name).actions.findIndex((x) => x.verb === 'path' || !!x.classAction); const cut = ops.sliceAction(name, index, time); await tick(300); const pieces = obj(name).actions.filter((x) => x.verb === 'path' || !!x.classAction); const second = pieces[1]; const text = second ? (second.stmt ? S().source.slice(second.stmt.range.from, second.stmt.range.to) : S().source.slice(S().source.lastIndexOf('all('))).replace(/\\s+/g, ' ') : null; return { cut, notice: S().notice, pieces: pieces.map((p) => [p.start, p.end]), ...(cut ? worst(before, course(name)) : {}), second: text } };
// The menus: the first level's words, a flyout's buttons, and putting one away.
const top = () => [...document.querySelectorAll('.context-menu:not(.submenu) > .menu-item-wrap > button')];
const word = (b) => b.textContent.replace('▸', '').replace(/\\s+/g, ' ').trim();
const menuAt = async (p) => { host().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, button: 2 })); await tick(200); return top().map(word) };
const sub = async (label) => { const b = top().find((x) => word(x).startsWith(label)); if (!b) return null; b.parentElement.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await tick(200); return [...document.querySelectorAll('.context-menu.submenu button')] };
const shut = async () => { if (document.querySelector('.context-menu')) { S().closeMenu(); await tick(150) } };
const lines = () => QA.getRenderer().pathLineCount();
const showPaths = async (on) => { if (S().showPaths !== on) S().toggleShowPaths(); await tick(150) };
`

export default {
  // The model (D387, D394): a path written with scene points goes as it did while its object is where the first point is; put elsewhere the object does not jump, and the path goes with it; an object turned, by its declaration, before the path, or during it, leaves the path lying as it is written; the path's own angle turns it about where it begins, its offset not turned, a relative one about where its amounts are counted from; after a move it begins where the move left the object; an offset moves the shape away; with orient the object faces the way along the shape as it lies, added to how it was turned; a formula is taken from its own first point; a path after one that faced its object lies the same way; an object spins on its path by a rotate begun before it.
  MODEL1: `${HELP}
const out = {};
const scenes = ${JSON.stringify(Object.fromEntries(Object.entries(MODEL).map(([k, v]) => [k, v.join(NL)])))};
await begin('');
const see = async (key, times) => { await setSource(scenes[key]); await tick(200); return { at: times.map((t) => pos('b', t)), error: S().error } };
out.asWritten = await see('asWritten', [0, 1, 2, 3, 5]);
out.moved = await see('moved', [0, 1, 2, 3]);
out.turned = await see('turned', [1, 3]);
out.afterMove = await see('afterMove', [1, 3]);
out.offset = await see('offset', [0.99, 1, 3]);
out.relative = await see('relative', [1, 3]);
out.formula = await see('formula', [0, 1, 1.5, 2]);
await setSource(scenes.facing); await tick(200);
out.facing = [turn('b', 0.5), turn('b', 2), turn('b', 4)];
await setSource(scenes.afterFacing); await tick(200);
out.afterFacing = { went: [pos('b', 4)[0] - pos('b', 3)[0], pos('b', 4)[1] - pos('b', 3)[1]], faces: [turn('b', 2.9), turn('b', 3.5)] };
out.turnedBefore = await see('turnedBefore', [1, 3]);
out.turnedDuring = { ...(await see('turnedDuring', [1, 3])), anchors: anchors('b') };
out.angle = await see('angle', [1, 2, 3]);
out.angleOffset = await see('angleOffset', [0.9, 1, 3]);
out.relativeAngle = await see('relativeAngle', [1, 2, 3]);
await setSource(scenes.facingAngle); await tick(200);
out.facingAngle = [turn('b', 0.5), turn('b', 1.5), turn('b', 2.5)];
out.spin = { ...(await see('spin', [1, 2, 3])), turns: [turn('b', 1), turn('b', 2), turn('b', 3)] };
out.warnings = S().model.warnings.map((w) => w.message);
return out`,

  // A press never moves the playhead (D388): a click on an object in the middle of its path selects it; so does one on the last frame of an object removed as its path ends; Edit path, from the object's menu, selects the path and leaves the playhead. A drag is written as over a move: at the first frame the declaration, the path unchanged and going along; in the middle a move from the path's start to the playhead; at the end the last point; after it a new move.
  DRAG1: `${HELP}
const out = {};
const SCENE = ${J([...BOX('b', -300, 0, ['  until: 6,']), ...PATH('b')])};
await begin(SCENE, 2);
const here = shown('b', 2);
await press(at(here[0], here[1]));
out.click = { selection: S().selection, actions: S().selectedActions.length, time: S().time, same: S().source === SCENE };
await begin(SCENE.replace('until: 6', 'until: 3'), 3 - 1 / 60);
const last = shown('b', 3 - 1 / 60);
await press(at(last[0], last[1]));
out.lastFrame = { selection: S().selection, time: r2(S().time), exists: smp.existsAt(S().model, obj('b'), S().time) };
await begin(SCENE, 2.5);
const there = shown('b', 2.5);
out.menu = await menuAt(at(there[0], there[1]));
const items = await sub('Path');
out.pathItems = items ? items.map(word) : null;
items?.find((b) => word(b) === 'Edit path')?.click(); await tick(250);
out.editPath = { time: S().time, selected: S().selectedActions.map((r) => r.object + ':' + r.index), tool: S().tool };
await shut();
await begin(SCENE, 1);
out.atFirstFrame = { ...(await dragBy('b', 1, 100, 100)), decl: flat('b'), path: stmt('b', 0), ends: pos('b', 3) };
await begin(SCENE, 2);
out.inTheMiddle = { ...(await dragBy('b', 2, 100, 50)), actions: acts('b'), ends: pos('b', 3), path: stmt('b', 0) };
await undo();
out.undone = S().source === SCENE;
await begin(SCENE, 3);
out.atTheEnd = { ...(await dragBy('b', 3, 50, 80)), actions: acts('b'), path: stmt('b', 0) };
await begin(SCENE, 4);
out.after = { ...(await dragBy('b', 4, -100, -100)), actions: acts('b'), at3: pos('b', 3) };
out.error = S().error;
return out`,

  // A path among other animations (D388): after a move, a drag at the path's first frame writes the move's end, and the path goes along; in the middle a piece; at the end the last point; after it a new move from the path's end, not from the move's. Two paths one after the other: the second begins where the first ends, and a drag at its first frame moves the first's last point, the declaration untouched. A relative move over a path: a drag in the middle lands.
  DRAG2: `${HELP}
const out = {};
const MOVED = ${J([...BOX('a', -500, 0), ...MOVE('a'), ...PATH('a')])};
await begin(MOVED, 1);
out.atFirstFrame = { ...(await dragBy('a', 1, 50, 40)), move: stmt('a', 0), path: stmt('a', 1), decl: flat('a'), ends: pos('a', 3), actions: acts('a') };
await begin(MOVED, 2);
out.inTheMiddle = { ...(await dragBy('a', 2, 50, 40)), actions: acts('a'), ends: pos('a', 3), move: stmt('a', 0) };
await begin(MOVED, 3);
out.atTheEnd = { ...(await dragBy('a', 3, 50, 40)), actions: acts('a'), path: stmt('a', 1), move: stmt('a', 0) };
await begin(MOVED, 4);
out.after = { ...(await dragBy('a', 4, 50, 40)), actions: acts('a'), at3: pos('a', 3) };
const CHAIN = ${J([...BOX('c', -400, 0), ...PATH('c'), ...SECOND('c')])};
await begin(CHAIN, 3);
out.chainBefore = [pos('c', 3), pos('c', 4)];
out.chain = { ...(await dragBy('c', 3, 60, 40)), first: stmt('c', 0), second: stmt('c', 1), decl: flat('c'), at1: pos('c', 1), at4: pos('c', 4), actions: acts('c') };
const OVER = ${J([...BOX('d', -300, 0), ...PATH('d'), 'd.move({', '  y: 100,', '  at: 1,', '  duration: 2,', "  ease: 'linear',", '  relative: true,', '})', ''])};
await begin(OVER, 2);
out.withRelative = { ...(await dragBy('d', 2, 70, -30)), actions: acts('d') };
out.error = S().error;
return out`,

  // In a group that is moved, turned, and scaled (D388): the object lands where it is put at the path's first frame, in its middle, and at its end.
  DRAG3: `${HELP}
const out = {};
const GROUPED = ${J([...BOX('b', -200, -50), ...PATH('b'), ...GROUP('g', 'b', ['  x: 120,', '  y: 60,', '  rotation: 30,', '  scale: 1.5,'])])};
await begin(GROUPED, 1);
out.first = { ...(await dragBy('b', 1, 60, -40)), decl: flat('b'), path: stmt('b', 0) };
await begin(GROUPED, 2);
out.middle = { ...(await dragBy('b', 2, 60, -40)), actions: acts('b') };
await begin(GROUPED, 3);
out.end = { ...(await dragBy('b', 3, 60, -40)), path: stmt('b', 0), actions: acts('b').length };
out.error = S().error;
return out`,

  // The Path tool (D387, D388): a path drawn for an object begins with nothing away from it, the rest amounts from there, and lies where it was clicked for a turned object too. The first point dragged puts the object there and is written anew, the other points staying where they are; another point moves alone; Move path carries the path by its object, the shape as written.
  TOOL1: `${HELP}
const out = {};
const B = (more) => ['b = Rect({', '  x: 200,', '  y: 100,', '  width: 100,', '  height: 60,', ...more, '})', ''].join(String.fromCharCode(10));
await begin(B([]), 0);
S().select(['b']); S().setTool('path'); S().setPathMode('create'); await tick(300);
await press(at(500, 300));
await press(at(700, 0));
out.drawn = { path: stmt('b', 0), anchors: anchors('b'), ends: pos('b', 1) };
await begin(B(['  rotation: 90,']), 0);
S().select(['b']); S().setTool('path'); S().setPathMode('create'); await tick(300);
await press(at(500, 300));
out.drawnTurned = { path: stmt('b', 0), anchors: anchors('b'), ends: pos('b', 1) };
const WITH = B([]) + ['', 'b.path({', '  shape: [', '    [0, 0],', '    [300, 200],', '    [500, -100],', '  ],', '  at: 0,', '  duration: 2,', '})', ''].join(String.fromCharCode(10));
await begin(WITH, 0);
S().setTool('path'); S().setPathMode('create'); S().selectAction('b', 0); await tick(300);
out.before = anchors('b');
await pull(at(200, 100), at(100, 0));
out.firstDragged = { decl: flat('b'), path: stmt('b', 0), anchors: anchors('b') };
const second = anchors('b')[1];
await pull(at(second[0], second[1]), at(second[0] + 50, second[1] + 50));
out.secondDragged = { path: stmt('b', 0), anchors: anchors('b'), decl: flat('b') };
S().setTool('path'); S().setPathMode('move'); await tick(250);
const third = anchors('b')[2];
await pull(at(third[0], third[1]), at(third[0] + 100, third[1] + 100));
out.carried = { decl: flat('b'), path: stmt('b', 0), anchors: anchors('b') };
S().setTool('select'); S().setPathMode('create'); S().select([]);
out.error = S().error;
return out`,

  // The first point is where the object is, whatever carries it (D387): in a group that is moved, turned, and scaled it lands under the pointer and the next point stays put; with an offset the offset stays; a group's own path moves the group. Move path on a path from a formula moves the object and writes no offset; on a relative one, its offset as before (D223).
  TOOL2: `${HELP}
const out = {};
const GROUPED = ${J([...BOX('a', -300, -100), ...PATH('a'), ...GROUP('g', 'a', ['  x: 120,', '  y: 60,', '  rotation: 30,', '  scale: 1.5,'])])};
await begin(GROUPED, 0);
S().setTool('path'); S().setPathMode('create'); S().selectAction('a', 0); await tick(300);
const g0 = anchors('a');
await pull(at(g0[0][0], g0[0][1]), at(g0[0][0] + 90, g0[0][1] - 70));
const g1 = anchors('a');
out.inGroup = { first: g1[0], wanted: [g0[0][0] + 90, g0[0][1] - 70], legBefore: [g0[1][0] - g0[0][0], g0[1][1] - g0[0][1]], legAfter: [g1[1][0] - g1[0][0], g1[1][1] - g1[0][1]], path: stmt('a', 0) };
await pull(at(g1[1][0], g1[1][1]), at(g1[1][0] + 40, g1[1][1] + 40));
out.inGroupSecond = { got: anchors('a')[1], wanted: [g1[1][0] + 40, g1[1][1] + 40], first: anchors('a')[0] };
const OFFSET = ${J([...BOX('b', -300, 0), ...PATH('b', ['  offset: [50, 30],'])])};
await begin(OFFSET, 0);
S().setTool('path'); S().setPathMode('create'); S().selectAction('b', 0); await tick(300);
const o0 = anchors('b');
await pull(at(o0[0][0], o0[0][1]), at(o0[0][0] + 60, o0[0][1] + 60));
out.offset = { before: o0[0], first: anchors('b')[0], decl: flat('b'), keeps: stmt('b', 0).includes('offset: [50, 30]') };
const OWN = ${J([...BOX('h1', -300, 100), ...BOX('h2', -200, -100), ...GROUP('k', 'h1 h2'), ...PATH('k')])};
await begin(OWN, 0);
S().setTool('path'); S().setPathMode('create'); S().selectAction('k', 0); await tick(300);
const k0 = anchors('k');
await pull(at(k0[0][0], k0[0][1]), at(k0[0][0] + 50, k0[0][1] + 80));
out.groupPath = { before: k0[0], first: anchors('k')[0], decl: flat('k'), path: stmt('k', 0) };
const ROUND = ${J([...CIRCLE, 'm.path({', '  shape: (p) => [Math.cos(p * 2 * Math.PI) * 150, Math.sin(p * 2 * Math.PI) * 150],', '  at: 1,', '  duration: 2,', "  ease: 'linear',", '})', ''])};
await begin(ROUND, 0);
S().selectAction('m', 0); S().setTool('path'); S().setPathMode('move'); await tick(300);
const c0 = frame('m').curve;
const quarter = c0[Math.floor(c0.length / 4)];
await pull(at(quarter.x, quarter.y), at(quarter.x + 80, quarter.y + 50));
out.formulaMoved = { decl: flat('m'), offset: stmt('m', 0).includes('offset'), starts: rp(frame('m').curve[0]), was: rp(c0[0]) };
const WAVE = ${J([...CIRCLE, 'm.path({', '  shape: (p) => [p * 300, Math.sin(p * 2 * Math.PI) * 100],', '  at: 1,', '  duration: 2,', "  ease: 'linear',", '  relative: true,', '})', ''])};
await begin(WAVE, 0);
S().selectAction('m', 0); S().setTool('path'); S().setPathMode('move'); await tick(300);
const w0 = frame('m').curve;
const half = w0[Math.floor(w0.length / 2)];
await pull(at(half.x, half.y), at(half.x + 40, half.y + 30));
out.relativeMoved = { decl: flat('m'), path: stmt('m', 0) };
S().setTool('select'); S().setPathMode('create'); S().select([]);
out.error = S().error;
return out`,

  // Move path turns a path (D394): the path in hand wears a box with Move path and not with Edit; its handle dragged a quarter round the point the path begins at writes the angle, in one undo step; with Snap on, by the angle step; the line still carries the path, the angle kept; a path from a formula turns the same way.
  TURN1: `${HELP}
const out = {};
const SCENE = ${J([...BOX('b', -300, 0), ...PATH('b')])};
await begin(SCENE, 0);
S().selectAction('b', 0); S().setTool('path'); S().setPathMode('create'); await tick(300);
out.inEdit = QA.getRenderer().pathTurnHandleAt();
S().setPathMode('move'); await tick(300);
const grip = QA.getRenderer().pathTurnHandleAt();
out.grip = grip ? rp(grip) : null;
const pivot = anchors('b')[0];
const round = async (g, degrees, steps = 10) => { const rel = { x: g.x - pivot[0], y: g.y - pivot[1] }; const from = at(g.x, g.y); pe(host(), 'pointerdown', from.x, from.y); let last = from; for (let i = 1; i <= steps; i++) { const a = (degrees * Math.PI / 180) * (i / steps); last = at(pivot[0] + rel.x * Math.cos(a) - rel.y * Math.sin(a), pivot[1] + rel.x * Math.sin(a) + rel.y * Math.cos(a)); pe(host(), 'pointermove', last.x, last.y); await tick(30) } pe(host(), 'pointerup', last.x, last.y); await tick(320) };
await round(grip, 90);
out.turned = { path: stmt('b', 0), anchors: anchors('b'), ends: pos('b', 3), grip: rp(QA.getRenderer().pathTurnHandleAt()) };
await undo();
out.undone = S().source === SCENE;
S().setPreviewSnap({ on: true, angle: 15 }); await tick(200);
await round(QA.getRenderer().pathTurnHandleAt(), 37);
out.snapped = stmt('b', 0);
S().setPreviewSnap({ on: false }); await tick(100);
const line = frame('b').curve; const mid = line[Math.floor(line.length / 2)];
await pull(at(mid.x, mid.y), at(mid.x + 100, mid.y + 50));
out.carried = { decl: flat('b'), path: stmt('b', 0) };
const ROUND = ${J([...CIRCLE, 'm.path({', '  shape: (p) => [p * 400, Math.sin(p * Math.PI) * 100],', '  at: 1,', '  duration: 2,', '})', ''])};
await begin(ROUND, 0);
S().selectAction('m', 0); S().setTool('path'); S().setPathMode('move'); await tick(300);
const g2 = QA.getRenderer().pathTurnHandleAt();
const p2 = anchors('m')[0] ?? rp(frame('m').curve[0]);
const rel2 = { x: g2.x - p2[0], y: g2.y - p2[1] };
await pull(at(g2.x, g2.y), at(p2[0] - rel2.x, p2[1] - rel2.y));
out.formula = { path: stmt('m', 0), ends: pos('m', 3) };
S().setTool('select'); S().setPathMode('create'); S().select([]);
out.error = S().error;
return out`,

  // Which paths show (D389): with Show Paths, every path running at the playhead, with nothing selected, of what is there and not hidden; without, none, an object selected or not, and a selected path always. The Path tool shows nothing with nothing selected, the running ones with Show Paths, and for a selected object one line, the path in force: the first to come, the one running, the last to have ended; a press on a line shown picks it, and one where no line shows picks nothing.
  SHOW1: `${HELP}
const out = {};
const SCENE = ${J(SHOWN)};
await begin(SCENE, 0);
const count = async (t) => { S().setTime(t); await tick(140); return lines() };
const through = async () => [await count(0), await count(1.5), await count(2.5), await count(3.5), await count(4.5), await count(5.5), await count(7)];
await showPaths(true);
out.title = document.querySelector('.preview-options button[aria-pressed][title*="path"]')?.title ?? null;
out.shown = await through();
await showPaths(false);
out.off = await through();
S().select(['a']); await tick(150);
out.offObject = await through();
S().selectAction('a', 0); await tick(150);
out.offPathSelected = await through();
await showPaths(true);
S().select(['a']); await tick(150);
const inHand = async (t) => { S().setTime(t); await tick(140); return [lines(), QA.getRenderer().heldPathCount()] };
out.shownInHand = [await inHand(0), await inHand(1.5), await inHand(3.5), await inHand(5.5)];
S().select([]); await tick(150);
out.shownNoneInHand = [await inHand(1.5), await inHand(5.5)];
await showPaths(false);
S().setTool('path'); S().setPathMode('move'); await tick(200);
out.toolNothing = await through();
await showPaths(true);
out.toolNothingShown = await through();
await showPaths(false);
S().select(['b']); await tick(150);
out.toolObject = await through();
const first = () => at(-250, 200);
const second = () => at(-100, 70);
const which = async (t) => { const got = []; for (const p of [first, second]) { S().select(['b']); S().setTime(t); await tick(200); await press(p()); got.push(S().selectedActions.map((r) => r.object + ':' + r.index).join(',')) } return got };
out.inForce = { before: await which(0), running: await which(3), between: await which(4.5), second: await which(5.5), after: await which(7) };
// The tool's press on the object picks the same path.
const onObject = async (t) => { S().select([]); S().setTime(t); await tick(200); const w = shown('b', t); await press(at(w[0], w[1])); return S().selectedActions.map((r) => r.object + ':' + r.index).join(',') };
out.pressed = [await onObject(0), await onObject(3), await onObject(4.5), await onObject(5.5)];
out.unchanged = S().source === SCENE;
S().setTool('select'); S().select([]); await showPaths(true);
S().setHidden(['a'], true); await tick(150);
out.hiddenObject = await count(1.5);
S().setHidden(['a'], false); await tick(150);
await setSource(SCENE.replace('  height: 50,' + String.fromCharCode(10) + '})' + String.fromCharCode(10) + String.fromCharCode(10) + 'a.path', '  height: 50,' + String.fromCharCode(10) + '  until: 1.5,' + String.fromCharCode(10) + '})' + String.fromCharCode(10) + String.fromCharCode(10) + 'a.path')); await tick(200);
out.gone = { until: obj('a').until ?? null, there: await count(1.2), gone: await count(1.8) };
S().setPathMode('create'); S().setTool('select'); S().select([]);
out.error = S().error;
return out`,

  // A cut path goes as the whole did (D393, D395): points, with the object facing along it, on a turned object, smooth, as curves; with an animation turning the object while the path runs, which no longer bears on the path; a path from a formula, which keeps its line; a relative path, and one that faces along its shape, whose two pieces face as the whole did; a path with an angle of its own, which both pieces keep. Nothing is refused.
  CUT1: `${HELP}
const out = {};
const scenes = ${JSON.stringify(Object.fromEntries(Object.entries(CUTS).map(([k, v]) => [k, v.join(NL)])))};
await begin('');
for (const key of ['points', 'facing', 'turnedObject', 'smoothFacing', 'curvesFacing', 'pointsWhileTurning', 'curvesWhileTurning', 'formula', 'formulaFacing', 'formulaWhileTurning', 'relative', 'relativeFacing', 'angled', 'angledFormula']) out[key] = await cutAt('a', scenes[key], 2.2);
S().setNotice(null);
return out`,

  // The second piece and the offset (D393): a path with an offset, relative or not, written out or from a formula, goes on from where the first piece left the object; a relative path from a formula, and a class's path, add only what comes after the cut, where they added the line's place at the cut a second time; a class's relative move is cut as it was.
  CUT2: `${HELP}
const out = {};
const scenes = ${JSON.stringify(Object.fromEntries(Object.entries(CUTS).map(([k, v]) => [k, v.join(NL)])))};
const classes = ${JSON.stringify(Object.fromEntries(Object.entries(CLASSCUTS).map(([k, v]) => [k, v.join(NL)])))};
await begin('');
for (const key of ['offset', 'relativeOffset', 'formulaOffset', 'relativeFormula', 'relativeFormulaOffset']) out[key] = await cutAt('a', scenes[key], 2.2);
for (const key of ['relativePath', 'path', 'relativeMove']) out['class ' + key] = await cutAt('a', classes[key], 2.2);
S().setNotice(null);
return out`,

  // Close line (D390): a line closed is a polygon in the tool's fill, with its opacity, its own outline kept, in one undo step; with the fill solid no opacity is written; Open line takes the close out and keeps the fill; a points line the same; a line of two points closes with nothing to fill. The menus offer it on a line, and not on what is filled.
  CLOSE1: `${HELP}
const out = {};
const LINE = ${J(LINE)};
S().setShapeStyle({ fill: '#ff8800', filled: true, stroke: '#00ffcc', strokeWidth: 5, fillOpacity: 0.6, strokeOpacity: 1 });
await begin(LINE, 0);
S().setTool('shape'); S().setShapeMode('edit'); S().select(['l']); await tick(300);
await menuAt(at(100, 0));
const items = await sub('Shape');
out.shapeItems = items ? items.map(word) : null;
items?.find((b) => word(b) === 'Close line')?.click(); await tick(300);
out.closed = { decl: flat('l'), closed: ops.isShapeClosed('l') };
await shut();
await undo();
out.undone = S().source === LINE;
S().setShapeStyle({ fillOpacity: 1 });
ops.setShapeClosed('l', true); await tick(250);
out.closedSolid = flat('l');
await menuAt(at(0, 0));
const after = await sub('Shape');
out.filledItems = after ? after.map(word) : null;
await shut();
ops.setShapeClosed('l', false); await tick(250);
out.opened = flat('l');
await setSource(${J(POINTSLINE)}); await tick(200);
ops.setShapeClosed('p', true); await tick(250);
out.pointsClosed = flat('p');
await setSource(${J(TWOPOINTS)}); await tick(200);
ops.setShapeClosed('t', true); await tick(250);
out.twoPoints = flat('t');
S().setTool('select'); S().setShapeMode('create'); S().select([]);
S().setShapeStyle({ fill: '#4f8cff', filled: true, stroke: '#ffffff', strokeWidth: 3, fillOpacity: 1, strokeOpacity: 1 });
out.error = S().error;
return out`,

  // A color's opacity is in its picker (D391): the Shape tool's bar has the two colors and the width; each picker has an opacity bar and a percent, which set the tool's style; the color's box shows as see-through as it is; a shape drawn then starts with those; in Edit the picker writes the selected shape's own, to hundredths, and solid writes none. The pencil's line color has it too, the bucket's color has not. A share of one is written as it is given, where it was rounded to a whole number.
  COLOR1: `${HELP}
const out = {};
await begin('', 0);
S().setTool('shape'); S().setShapeMode('create'); await tick(250);
S().setShapeStyle({ fill: '#ff8800', filled: true, stroke: '#00ffcc', strokeWidth: 5, fillOpacity: 1, strokeOpacity: 1 }); await tick(150);
const bar = () => document.querySelector('.paint-bar[aria-label="Shape style"]');
const well = (title) => [...bar().querySelectorAll('.color-swatch')].find((b) => b.title === title);
out.bar = { fields: [...bar().querySelectorAll('.num-field')].map((f) => f.title), wells: [...bar().querySelectorAll('.color-swatch')].map((b) => b.title) };
const open = async (title) => { well(title).click(); await tick(200); return document.querySelector('.color-picker') };
const away = async () => { document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); await tick(200) };
const slide = async (pop, share) => { const strip = pop.querySelector('.color-opacity'); const r = strip.getBoundingClientRect(); const x = r.left + r.width * share; pe(strip, 'pointerdown', x, r.top + 6); await tick(60); pe(strip, 'pointerup', x, r.top + 6); await tick(220) };
let pop = await open('Fill');
out.picker = { opacity: !!pop.querySelector('.color-opacity'), percent: pop.querySelector('.num-field')?.title ?? null };
await slide(pop, 0.4);
out.fillSlid = { style: S().shapeStyle.fillOpacity, percent: pop.querySelector('.num-field input').value, box: getComputedStyle(well('Fill')).backgroundImage.slice(0, 66) };
const input = pop.querySelector('.num-field input');
Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '25'); input.dispatchEvent(new Event('input', { bubbles: true })); await tick(200);
out.fillTyped = S().shapeStyle.fillOpacity;
await away();
out.pickerClosed = !document.querySelector('.color-picker');
pop = await open('Outline');
await slide(pop, 0.5);
out.outlineSlid = S().shapeStyle.strokeOpacity;
await away();
await press(at(-200, -100)); await press(at(200, -100)); await press(at(0, 150)); await press(at(-200, -100));
const made = S().model.objects[0]?.name;
out.drawn = made ? flat(made) : null;
S().setShapeMode('edit'); S().select([made]); await tick(300);
pop = await open('Fill');
await slide(pop, 0.8);
out.edited = { decl: flat(made), style: S().shapeStyle.fillOpacity };
await slide(pop, 1.2);
out.editedSolid = flat(made);
await away();
S().setTool('pencil'); await tick(250);
document.querySelector('.paint-bar[aria-label="Pencil"] .color-swatch').click(); await tick(200);
out.pencilHasOpacity = !!document.querySelector('.color-picker .color-opacity');
await away();
S().setTool('paint'); await tick(250);
document.querySelector('.paint-bar[aria-label="Paint"] .color-swatch').click(); await tick(200);
out.paintHasOpacity = !!document.querySelector('.color-picker .color-opacity');
await away();
// The bucket's cursor (D392): its point at the end of the pour, at the lower left.
const cursor = getComputedStyle(host()).cursor;
out.cursor = { hot: (cursor.match(/\\)\\s*(\\d+)\\s+(\\d+)/) || []).slice(1).map(Number), pours: cursor.includes('M5 10C3.2 13') };
S().setTool('select'); S().setShapeMode('create'); S().select([]);
S().setShapeStyle({ fill: '#4f8cff', filled: true, stroke: '#ffffff', strokeWidth: 3, fillOpacity: 1, strokeOpacity: 1 });
await setSource(${J(SOLID)}); await tick(200);
ops.setObjectProp('s', 'fillOpacity', 0.8); await tick(200);
ops.setObjectProp('s', 'strokeOpacity', 0.35); await tick(200);
out.shares = flat('s');
out.error = S().error;
return out`,
}
