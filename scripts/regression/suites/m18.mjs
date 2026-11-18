// Before 3D (D413, D414): the preference that lets a drag inside a clip in the timeline draw the selection box, its title still moving it, for an object's clip and a class's; and the Path tool's Create beginning a new path where it went on with the one in hand, a path's last point taking it up again.
const NL = String.fromCharCode(10)
const J = (lines) => JSON.stringify(lines.join(NL))
const RECT = (name, x, y, until, more = []) => [`${name} = Rect({`, `  x: ${x},`, `  y: ${y},`, '  width: 120,', '  height: 120,', ...more, ...(until === null ? [] : [`  until: ${until},`]), '})', '']
const MOVE = (name, x, at) => [`${name}.move({`, `  x: ${x},`, `  at: ${at},`, '  duration: 0.5,', '})', '']
const FADE = (name, at) => [`${name}.fade({`, '  opacity: 0.5,', `  at: ${at},`, '  duration: 0.5,', '})', '']
// Two things with lives that leave room beside their clips, each with animations.
const CLIPS = [...RECT('a', -400, 0, 2), ...RECT('b', 300, 250, 3), ...MOVE('a', -300, 0.2), ...MOVE('b', 400, 0.3), ...FADE('b', 1.2)]
// Two things of one class, the class with two animations and room between them.
const CLASSED = [...RECT('a', -400, 0, 3, ["  class: 'bars',"]), ...RECT('b', 300, 250, 3, ["  class: 'bars',"]), "all('bars').fade({", '  opacity: 0.5,', '  at: 0.5,', '  duration: 0.5,', '})', '', "all('bars').move({", '  y: 200,', '  at: 2,', '  duration: 0.5,', '})', '']
// One thing with a path, one without.
const PATHS = [...RECT('p', -300, 0, null), ...RECT('q', -300, 300, null), 'p.path({', '  shape: [', '    [0, 0],', '    [300, 100],', '    [600, 0],', '  ],', '  at: 0,', '  duration: 2,', '})', '']

const HELP = `
const r2 = (v) => Math.round(v * 100) / 100;
// Every check begins the same: no recording and no review, the Preview view fitted on an empty scene, Select in hand, nothing selected, no snapping, nothing colliding, and a drag inside a clip moving it.
const begin = async (source, time = 0) => { if (S().recording) { S().toggleRecording(); await tick(60) } if (S().recordReview) ops.settleRecording([]); if (S().prefs.clipBox) S().setPrefs({ clipBox: false }); S().setRate(100); S().setPlaying(false); S().setPreviewView('preview'); S().setTool('select'); S().setTimelineTool('select'); S().setTransformMode('all'); S().setPick('object'); S().select([]); S().setPreviewSnap({ on: false, edges: false }); S().setCollide(false); S().setPush(false); S().setNotice(null); await setSource(''); [...document.querySelectorAll('.preview-tools button')].find((b) => b.textContent.trim() === 'Fit')?.click(); await tick(150); await setSource(source); S().select([]); S().setTime(time); await tick(250) };
const host = () => document.querySelector('.preview');
const at = (wx, wy) => { const b = host().getBoundingClientRect(); const p = QA.getViewport().toPane(wx, wy); return { x: b.left + p.x, y: b.top + p.y } };
const acts = (name) => obj(name).actions.map((a) => a.verb);
const sel = () => ({ things: [...S().selection], anims: S().selectedActions.map((a) => a.object + ':' + a.index) });
const press = async (el, x, y, extra = {}) => { pe(el, 'pointerdown', x, y, extra); pe(el, 'pointerup', x, y, extra); me(el, 'click', x, y, extra); await tick(100) };
const sweep = async (el, x0, y0, x1, y1, extra = {}, steps = 6, wait = 16) => { pe(el, 'pointerdown', x0, y0, extra); for (let i = 1; i <= steps; i++) { pe(el, 'pointermove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, extra); await tick(wait) } pe(el, 'pointerup', x1, y1, extra); await tick(100) };
const box = (q) => { const r = document.querySelector(q).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 } };
// What is under a place on the screen, which is what a real press would land on.
const under = (x, y) => document.elementFromPoint(x, y);
const undo = async () => { key('keydown', 'KeyZ', { ctrlKey: true }); await tick(300) };
`

export default {
  // The inside of an object's clip, by the preference (D413). Off, a drag there moves the clip. On, a click selects the clip and a drag draws the box: it takes the clip's animations it touches, the clip when it touches none, keeps the animations when it passes the clip's edge and touches no other clip, and takes clips alone once it reaches another; Ctrl adds what it takes; the title still moves the clip and an animation still drags; the box from empty space takes clips alone either way; a collapsed clip gives itself; the razor draws no box and moves nothing; and the choice is kept.
  BOX1: `${HELP}
const out = {};
await begin(${J(CLIPS)}, 0);
const rowsEl = document.querySelector('.tl-rows');
document.querySelector('.oclip[data-object="a"]').scrollIntoView({ block: 'nearest' }); await tick(150);
const before = src();
const a = box('.oclip[data-object="a"]');
const b = box('.oclip[data-object="b"]');
const mv = box('.oclip[data-object="a"] .clip[data-pick="a:0"]');
const spot = { x: mv.r + 40, y: mv.cy };
out.spot = under(spot.x, spot.y)?.className ?? null;
await sweep(under(spot.x, spot.y), spot.x, spot.y, spot.x + 40, spot.y);
out.offMoves = { ...sel(), moved: src() !== before };
await undo();
out.offUndone = src() === before;
S().setPrefs({ clipBox: true }); S().select([]); await tick(100);
await press(under(spot.x, spot.y), spot.x, spot.y);
out.onClick = sel();
S().select([]); await tick(60);
await sweep(under(spot.x, spot.y), spot.x, spot.y, mv.r - 10, mv.cy - 4);
out.onBoxInside = { ...sel(), unchanged: src() === before };
S().select([]); await tick(60);
await sweep(under(spot.x, spot.y), spot.x, spot.y, spot.x + 30, spot.y + 3);
out.onBoxNone = sel();
S().select([]); await tick(60);
await sweep(under(spot.x, spot.y), spot.x, spot.y, mv.r - 10, a.b + 10);
out.onBoxPastEdge = sel();
S().select([]); await tick(60);
await sweep(under(spot.x, spot.y), spot.x, spot.y, mv.r - 10, b.cy);
out.onBoxOverBoth = { ...sel(), unchanged: src() === before };
S().select(['b']); await tick(60);
await sweep(under(spot.x, spot.y), spot.x, spot.y, mv.r - 10, mv.cy - 4, { ctrlKey: true });
out.onCtrlBox = sel();
S().select(['b']); await tick(60);
await press(under(spot.x, spot.y), spot.x, spot.y, { ctrlKey: true });
out.onCtrlClick = sel();
S().select(['a', 'b']); await tick(60);
await press(under(spot.x, spot.y), spot.x, spot.y);
out.onClickAmong = sel();
S().select([]); await tick(60);
const title = box('.oclip[data-object="a"] .oclip-title');
await sweep(under(title.l + 70, title.cy), title.l + 70, title.cy, title.l + 110, title.cy);
out.onTitleMoves = { ...sel(), moved: src() !== before };
await undo();
S().select([]); await tick(60);
const m2 = box('.oclip[data-object="a"] .clip[data-pick="a:0"]');
await sweep(under(m2.cx, m2.cy), m2.cx, m2.cy, m2.cx + 30, m2.cy);
out.onAnimationDrags = { ...sel(), moved: src() !== before };
await undo();
out.onUndone = src() === before;
S().select([]); await tick(60);
await sweep(rowsEl, a.r + 60, mv.cy + 4, mv.r - 10, mv.cy - 4);
out.onBoxFromOutside = sel();
S().toggleCollapsed('timeline', 'a'); S().select([]); await tick(200);
const folded = box('.oclip[data-object="a"]');
await sweep(under(folded.l + 150, folded.b - 3), folded.l + 150, folded.b - 3, folded.l + 60, folded.b - 1);
out.onCollapsed = { ...sel(), unchanged: src() === before };
S().toggleCollapsed('timeline', 'a'); await tick(200);
S().setTimelineTool('razor'); S().select([]); await tick(100);
await sweep(under(spot.x, spot.y), spot.x, spot.y, spot.x + 50, spot.y + 6);
out.onRazor = { ...sel(), unchanged: src() === before };
S().setTimelineTool('select');
out.kept = JSON.parse(localStorage.getItem('quick-animator.prefs')).clipBox;
S().setPrefs({ clipBox: false }); S().select([]);
out.error = S().error;
return out`,

  // A class's clip goes by the same preference (D413): on, a click selects the class, a box takes the class's animations it touches, selected through a member as a click selects one, the class when it touches none, and the clips of the things it reaches; its title still moves the class; off, a drag inside moves the class.
  BOX2: `${HELP}
const out = {};
await begin(${J(CLASSED)}, 0);
document.querySelector('.oclip.class').scrollIntoView({ block: 'center' }); await tick(250);
const before = src();
const cls = box('.oclip.class[data-class="bars"]');
const parts = [...document.querySelectorAll('.oclip.class[data-class="bars"] .oclip-body .clip')].map((el) => { const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, cy: r.top + r.height / 2, pick: el.dataset.pick ?? null } });
out.picks = parts.map((p) => p.pick);
const spot = { x: (parts[0].r + parts[1].l) / 2, y: parts[0].cy };
out.spot = under(spot.x, spot.y)?.className ?? null;
S().setPrefs({ clipBox: true }); await tick(100);
await press(under(spot.x, spot.y), spot.x, spot.y);
out.onClick = sel();
await sweep(under(spot.x, spot.y), spot.x, spot.y, parts[0].l + 6, spot.y + 3);
out.onBoxOne = { ...sel(), unchanged: src() === before };
me(under(spot.x, spot.y), 'click', parts[0].l + 6, spot.y + 3); await tick(100);
out.onBoxOneAfterClick = sel();
await sweep(under(spot.x, spot.y), spot.x, spot.y, parts[1].r - 6, spot.y - 3, { ctrlKey: true });
out.onCtrlBoxOther = sel();
S().select([]); await tick(60);
await sweep(under(spot.x, spot.y), spot.x, spot.y, spot.x + 12, spot.y + 3);
out.onBoxNone = sel();
const thing = box('.oclip[data-object="b"]');
await sweep(under(spot.x, spot.y), spot.x, spot.y, thing.l + 30, thing.cy);
out.onBoxToThings = { ...sel(), unchanged: src() === before };
S().select([]); await tick(60);
await sweep(under(cls.l + 90, cls.t + 7), cls.l + 90, cls.t + 7, cls.l + 130, cls.t + 7);
out.onTitleMoves = { ...sel(), moved: src() !== before };
await undo();
S().setPrefs({ clipBox: false }); S().select([]); await tick(100);
await sweep(under(spot.x, spot.y), spot.x, spot.y, spot.x + 40, spot.y);
out.offMoves = { ...sel(), moved: src() !== before };
await undo();
out.undone = src() === before;
S().select([]);
out.error = S().error;
return out`,

  // Create begins a new path (D414). Picked up with a thing that has a path the tool opens in Edit; in Create the hint says a click begins a new path, and it does, the path that was there left as it was; the clicks after go on with the path being drawn; the playhead moved, a click begins another there; a path selected again is not gone on with until its last point is clicked, which takes it up; a path with only its first point is always gone on with, and the tool opens in Create for it; a press on a thing that has a path picks that path and makes nothing; and all of it undone leaves the file as it was.
  CREATE1: `${HELP}
const out = {};
await begin(${J(PATHS)}, 0);
const before = src();
const hint = () => document.querySelector('.preview-hud .hint')?.textContent ?? null;
const paths = (name) => obj(name).actions.filter((x) => x.verb === 'path').map((x) => r2(x.start));
const points = (name, i) => smp.travelFrame(S().model, obj(name), obj(name).actions[i])?.anchors.length ?? 0;
const tap = async (wx, wy) => { const p = at(wx, wy); await press(host(), p.x, p.y) };
S().select(['p']); await tick(100);
S().setTool('path'); await tick(250);
out.opens = { ...sel(), mode: S().pathMode };
S().setPathMode('create'); await tick(150);
out.createHint = hint();
await tap(500, -300);
out.begins = { ...sel(), paths: paths('p'), old: points('p', 0), made: points('p', 1), hint: hint() };
await tap(300, -350);
out.goesOn = { paths: paths('p').length, made: points('p', 1) };
S().setTime(1); await tick(200);
out.movedHint = hint();
await tap(0, -350);
out.another = { ...sel(), paths: paths('p'), made: points('p', 2), first: points('p', 1) };
S().setTime(0); S().selectAction('p', 0); await tick(250);
out.againHint = hint();
const frame = smp.travelFrame(S().model, obj('p'), obj('p').actions[0]);
const end = frame.anchors[frame.anchors.length - 1];
await tap(end.x, end.y);
out.takenUp = { ...sel(), picked: [...S().pathPoints], hint: hint(), paths: paths('p').length };
await tap(500, 200);
out.wentOn = { paths: paths('p').length, old: points('p', 0) };
await tap(-340, 40);
out.onThing = { ...sel(), paths: paths('p').length };
S().setTool('select'); S().select(['q']); await tick(100);
ops.addAction('q', 'path', 0); await tick(300);
S().setTool('path'); await tick(250);
out.begunOpens = { ...sel(), mode: S().pathMode, points: points('q', 0), hint: hint() };
await tap(-100, 420);
out.begunGoesOn = { paths: paths('q').length, points: points('q', 0) };
S().setTool('select'); S().select([]);
for (let i = 0; i < 12 && src() !== before; i++) await undo();
out.undone = src() === before;
out.error = S().error;
return out`,
  // What one press makes in Create is one undo step (2026-11-17): the new path, the point pressed, and the line drawn on from it, for a click on empty space, a line drawn slowly from there, a line drawn from a thing with no path, and that thing pressed alone; each later click is a step of its own, the last undo taking the path away whole.
  CREATE2: `${HELP}
const out = {};
await begin(${J(PATHS)}, 0);
const before = src();
const paths = (name) => obj(name).actions.filter((x) => x.verb === 'path').length;
const points = (name, i) => { const a = obj(name).actions[i]; return a && a.verb === 'path' ? (smp.travelFrame(S().model, obj(name), a)?.anchors.length ?? 0) : 0 };
const tap = async (wx, wy) => { const p = at(wx, wy); await press(host(), p.x, p.y) };
// A drag that lasts longer than the pause that would split two edits into two steps.
const draw = async (ax, ay, bx, by) => { const p = at(ax, ay); const q = at(bx, by); await sweep(host(), p.x, p.y, q.x, q.y, {}, 12, 70) };
const create = async (name) => { S().setTool('select'); S().select(name ? [name] : []); await tick(100); S().setTool('path'); await tick(200); S().setPathMode('create'); await tick(150) };
await create('p');
await tap(500, -300);
out.click = { paths: paths('p'), points: points('p', 1) };
await undo();
out.click.undone = src() === before;
out.click.sel = sel();
await create('p');
await draw(450, -350, 0, -300);
out.drawn = { paths: paths('p'), points: points('p', 1) };
await undo();
out.drawn.undone = src() === before;
await create(null);
await draw(-300, 300, 200, 420);
out.fromThing = { paths: paths('q'), points: points('q', 0), ...sel() };
await undo();
out.fromThing.undone = src() === before;
await create(null);
await tap(-300, 300);
out.pressed = { paths: paths('q'), points: points('q', 0) };
await undo();
out.pressed.undone = src() === before;
await create('p');
await tap(500, -300); await tick(700);
await tap(300, -350); await tick(700);
await tap(0, -350); await tick(700);
out.clicks = [points('p', 1)];
await undo(); out.clicks.push(points('p', 1));
await undo(); out.clicks.push(points('p', 1));
await undo(); out.clicks.push(src() === before);
S().setTool('select'); S().select([]);
out.error = S().error;
return out`,
}
