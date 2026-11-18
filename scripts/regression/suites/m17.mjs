// The second look at recording (D407 to D412): the time beside the player; Ctrl and a click taking one thing in or out of the selection and nothing else; a box in the timeline from empty space, which takes clips alone again (D413, whose own checks are suite m18); the review turned off; the Path tool's Create and Edit, with a box for the points; and a recording taking everything done, what a drag pushes, typed values, sliders, paint, the arrow keys, a Shape's resize, the pencil, and the wheel on the camera.
const NL = String.fromCharCode(10)
const J = (lines) => JSON.stringify(lines.join(NL))
const RECT = (name, x, y, until, more = []) => [`${name} = Rect({`, `  x: ${x},`, `  y: ${y},`, '  width: 120,', '  height: 120,', ...more, ...(until === null ? [] : [`  until: ${until},`]), '})', '']
const MOVE = (name, x, at) => [`${name}.move({`, `  x: ${x},`, `  at: ${at},`, '  duration: 0.5,', '})', '']
const FADE = (name, at) => [`${name}.fade({`, '  opacity: 0.5,', `  at: ${at},`, '  duration: 0.5,', '})', '']
// Two things with lives that leave room beside their clips, each with animations.
const CLIPS = [...RECT('a', -400, 0, 2), ...RECT('b', 300, 250, 3), ...MOVE('a', -300, 0.2), ...MOVE('b', 400, 0.3), ...FADE('b', 1.2)]
// One thing with a path, one without.
const PATHS = [...RECT('p', -300, 0, null), ...RECT('q', -300, 300, null), 'p.path({', '  shape: [', '    [0, 0],', '    [300, 100],', '    [600, 0],', '  ],', '  at: 0,', '  duration: 2,', '})', '']
// A thing to drag, one in its way, one out of it, and one in its way whose life is short.
const PUSH = [...RECT('a', -500, 0, null), ...RECT('b', -200, 0, 6, ["  fill: '#f59e0b',"]), ...RECT('c', 300, 300, 6), ...RECT('d', 150, 0, 0.5)]
const TAKES = [...RECT('a', -500, 0, null), 's = Shape({', '  x: 200,', '  y: 100,', '  points: [', '    [-100, -60],', '    [100, -60],', '    [100, 60],', '    [-100, 60],', '  ],', "  fill: '#10b981',", '})', '']
const CAM = [...RECT('a', -500, 0, null), 'cam = Camera({', '  x: 0,', '  y: 0,', '  zoom: 1,', '})', '']

const HELP = `
const r2 = (v) => Math.round(v * 100) / 100;
// Every check begins the same: no recording and no review, the Preview view fitted on an empty scene, Select in hand, nothing selected, no snapping, nothing colliding, time at its own rate.
const begin = async (source, time = 0) => { if (S().recording) { S().toggleRecording(); await tick(60) } if (S().recordReview) ops.settleRecording([]); if (S().recordWait) S().toggleRecordWait(); if (S().prefs.recordReview === false) S().setPrefs({ recordReview: true }); S().setRate(100); S().setPlaying(false); S().setPreviewView('preview'); S().setTool('select'); S().setTimelineTool('select'); S().setTransformMode('all'); S().setPick('object'); S().select([]); S().setPreviewSnap({ on: false, edges: false }); S().setCollide(false); S().setPush(false); S().setNotice(null); await setSource(''); [...document.querySelectorAll('.preview-tools button')].find((b) => b.textContent.trim() === 'Fit')?.click(); await tick(150); await setSource(source); S().select([]); S().setTime(time); await tick(250) };
const host = () => document.querySelector('.preview');
const at = (wx, wy) => { const b = host().getBoundingClientRect(); const p = QA.getViewport().toPane(wx, wy); return { x: b.left + p.x, y: b.top + p.y } };
const acts = (name) => obj(name).actions.map((a) => a.verb);
const sel = () => ({ things: [...S().selection], anims: S().selectedActions.map((a) => a.object + ':' + a.index) });
const until = async (t) => { while (S().time < t && S().recording) await tick(16) };
const stop = async () => { if (S().recording) S().toggleRecording(); await tick(300) };
const review = () => (S().recordReview ?? []).map((c) => c.object + ' ' + c.verb);
const press = async (el, x, y, extra = {}) => { pe(el, 'pointerdown', x, y, extra); pe(el, 'pointerup', x, y, extra); me(el, 'click', x, y, extra); await tick(100) };
const sweep = async (el, x0, y0, x1, y1, extra = {}, steps = 6, wait = 16) => { pe(el, 'pointerdown', x0, y0, extra); for (let i = 1; i <= steps; i++) { pe(el, 'pointermove', x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, extra); await tick(wait) } pe(el, 'pointerup', x1, y1, extra); await tick(100) };
const box = (q) => { const r = document.querySelector(q).getBoundingClientRect(); return { l: r.left, r: r.right, t: r.top, b: r.bottom, cx: r.left + r.width / 2, cy: r.top + r.height / 2 } };
const deleteAll = async () => { [...document.querySelectorAll('.record-dialog .dialog-actions button')].find((b) => b.textContent.trim() === 'Delete all')?.click(); await tick(400) };
`

export default {
  // The timeline's selection (D407 to D409): the time stands after Loop; Ctrl and a click on an animation leaves a clip selected for itself selected, and taken out again leaves its own clip selected; Ctrl and a click on a clip leaves the animations selected; a box from empty space takes the clips it touches and never an animation (D413), over one clip or several, and with Ctrl adds them to what was selected, the animations selected staying.
  SELECT1: `${HELP}
const out = {};
await begin(${J(CLIPS)}, 0);
const rowsEl = document.querySelector('.tl-rows');
out.timeAfter = document.querySelector('.transport .time')?.previousElementSibling?.getAttribute('aria-label') ?? null;
out.timeBefore = document.querySelector('.transport .time')?.nextElementSibling?.getAttribute('aria-label') ?? null;
const title = document.querySelector('.oclip[data-object="a"] .oclip-title');
const tr = title.getBoundingClientRect();
const anim = () => { const r = document.querySelector('.oclip[data-object="b"] .clip[data-pick="b:0"]').getBoundingClientRect(); return { el: document.querySelector('.oclip[data-object="b"] .clip[data-pick="b:0"]'), x: r.left + r.width / 2, y: r.top + r.height / 2 } };
await press(title, tr.left + 60, tr.top + 6);
out.clip = sel();
let m = anim(); await press(m.el, m.x, m.y, { ctrlKey: true });
out.ctrlAnimation = sel();
m = anim(); await press(m.el, m.x, m.y, { ctrlKey: true });
out.ctrlAnimationAgain = sel();
m = anim(); await press(m.el, m.x, m.y);
out.animation = sel();
await press(title, tr.left + 60, tr.top + 6, { ctrlKey: true });
out.ctrlClip = sel();
await press(title, tr.left + 60, tr.top + 6, { ctrlKey: true });
out.ctrlClipAgain = sel();
key('keydown', 'KeyZ', { ctrlKey: true }); await tick(300);
out.undone = sel();
S().select([]); await tick(100);
const a = box('.oclip[data-object="a"]');
const mv = box('.oclip[data-object="a"] .clip[data-pick="a:0"]');
await sweep(rowsEl, a.r + 60, mv.cy + 4, mv.r - 10, mv.cy - 4);
out.boxOverAnimation = sel();
S().select([]); await tick(100);
await sweep(rowsEl, a.r + 60, a.t + 4, a.r - 10, a.t + 10);
out.boxOnClip = sel();
S().select([]); await tick(100);
const b = box('.oclip[data-object="b"]');
await sweep(rowsEl, b.r + 40, Math.min(a.t, b.t) + 4, Math.min(a.r, b.r) - 20, Math.max(a.b, b.b) - 4);
out.boxOverBoth = sel();
S().select(['b']); await tick(100);
await sweep(rowsEl, a.r + 60, mv.cy + 4, mv.r - 10, mv.cy - 4, { ctrlKey: true });
out.boxAdds = sel();
S().selectWith(['b'], [{ object: 'b', index: 0 }]); await tick(100);
await sweep(rowsEl, a.r + 60, mv.cy + 4, mv.r - 10, mv.cy - 4, { ctrlKey: true });
out.boxKeepsAnimations = sel();
S().toggleCollapsed('timeline', 'a'); S().select([]); await tick(200);
const folded = box('.oclip[data-object="a"]');
await sweep(rowsEl, folded.r + 60, folded.cy + 2, folded.l + 20, folded.cy - 2);
out.boxCollapsed = sel();
S().toggleCollapsed('timeline', 'a'); S().select([]);
out.error = S().error;
return out`,

  // The Path tool's modes (D411): picked up with a thing selected it opens in Edit and shows the thing's path with its points, selecting nothing; a box there picks the path and the points it holds and changes nothing, Ctrl adding; a click on empty space lets everything go; with no path the tool opens in Create; in Edit a press on a thing with no path picks the thing and makes nothing; in Create it starts the path and draws; and in Create a click on empty space begins a new path for the thing selected, the path it had left as it was (D414, whose own checks are suite m18).
  PATHTOOL1: `${HELP}
const out = {};
await begin(${J(PATHS)}, 0);
const state = () => ({ ...sel(), mode: S().pathMode, points: [...S().pathPoints].sort(), handles: QA.getRenderer().pathLine.group.visible });
S().select(['p']); await tick(100);
S().setTool('path'); await tick(250);
out.pickedUp = state();
const before = src();
const p0 = at(-300, 0);
await sweep(host(), p0.x - 60, p0.y - 160, at(320, 0).x, at(0, 60).y);
out.boxed = state();
await sweep(host(), at(250, 0).x, at(0, 60).y, at(700, 0).x, at(0, -160).y, { ctrlKey: true });
out.boxedMore = state();
out.unchanged = src() === before;
await press(host(), at(600, 420).x, at(600, 420).y);
out.letGo = state();
S().setTool('select'); S().select(['q']); await tick(100);
S().setTool('path'); await tick(200);
out.noPath = state();
S().setPathMode('edit'); S().select([]); await tick(100);
await press(host(), at(-300, 300).x, at(-300, 300).y);
out.editOnThing = { ...state(), q: acts('q') };
S().setPathMode('create'); await tick(100);
await sweep(host(), at(-300, 300).x, at(-300, 300).y, at(-100, 380).x, at(-100, 380).y);
out.createOnThing = { ...state(), q: acts('q') };
S().setTool('select'); S().select(['p']); await tick(100);
S().setTool('path'); S().setPathMode('create'); await tick(250);
const count = () => (src().match(/\\[-?\\d+, -?\\d+\\],/g) ?? []).length;
const had = count();
await press(host(), at(500, -300).x, at(500, -300).y);
out.createBegins = { ...state(), p: acts('p'), added: count() - had };
S().setTool('select'); S().select([]);
out.error = S().error;
return out`,

  // What a recorded drag pushes (D412): with Collide and Push on, the thing dragged and the thing it pushes each get a path, the pushed one's inside the other's span, from where it was first moved to where it was last, so it rests before and after; a thing out of the way gets nothing, and a thing whose life has ended is met no more and keeps its life; both are in the review, and deleting all leaves the scene as it was.
  PUSH1: `${HELP}
const out = {};
await begin(${J(PUSH)}, 0);
const before = src();
S().setCollide(true); S().setPush(true);
S().toggleRecording(); await until(0.8);
const from = at(-500, 0); pe(host(), 'pointerdown', from.x, from.y);
let together = true;
for (let i = 1; i <= 50; i++) { const p = at(-500 + 9 * i, 0); pe(host(), 'pointermove', p.x, p.y); await tick(20); if (i === 40) { const fa = QA.getRenderer().frameOf('a'); const fb = QA.getRenderer().frameOf('b'); together = !!fa && !!fb && Math.abs(fb.x - fa.x - 120) < 3 } }
await tick(400);
const last = at(-50, 0); pe(host(), 'pointerup', last.x, last.y); await tick(200);
const pa = obj('a').actions[0]; const pb = obj('b').actions[0];
out.verbs = { a: acts('a'), b: acts('b'), c: acts('c'), d: acts('d') };
out.pushedAlong = together;
out.inside = !!pa && !!pb && pb.start > pa.start + 0.05 && pb.end < pa.end - 0.2;
const bx = (t) => Math.round(smp.positionAt(S().model, obj('b'), t).x);
out.rests = !!pb && bx(pb.start) === -200 && bx(pb.end + 1) === bx(pb.end) && bx(pb.end) > -200;
out.lives = { b: obj('b').until, d: obj('d').until };
await stop();
out.review = review();
await deleteAll();
out.asBefore = src().trimEnd() === before.trimEnd();
S().setCollide(false); S().setPush(false);
out.error = S().error;
return out`,

  // Everything else a recording takes (D412), done in the window: a value typed in the Selected pane is a change of no length; its slider dragged is one fade on a curve; a click of Paint is a change of no length; a run of the arrow keys is one path; a Shape's resize is a morph, its points left as written; a line drawn with the pencil begins where its stroke began and is written on. All of it is in the review, and deleting all leaves the scene as it was, the line gone too.
  TAKES1: `${HELP}
const out = {};
await begin(${J(TAKES)}, 0);
const before = src();
const setNative = (el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })) };
const row = (name) => [...document.querySelectorAll('.now-values tr')].find((tr) => tr.querySelector('td')?.textContent.trim() === name) ?? [...document.querySelectorAll('.now-values tr')].find((tr) => tr.textContent.trim().startsWith(name));
const lengths = (name) => obj(name).actions.map((x) => x.verb + (x.end - x.start < 1e-6 ? ' at once' : ' over time'));
S().select(['a']); await tick(300);
S().toggleRecording(); await until(0.2);
const field = row('rotation')?.querySelector('input.now-input');
if (field) { field.focus(); setNative(field, '45'); field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await tick(200) }
out.typed = { a: lengths('a'), written: /rotation/.test(decl('a')), was: smp.valueAt(S().model, obj('a'), 'rotation', 0.1), is: smp.valueAt(S().model, obj('a'), 'rotation', 5) };
await until(0.6);
const slider = () => row('opacity')?.querySelector('input[type="range"]');
if (slider()) { slider().dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })); for (let i = 1; i <= 20; i++) { const el = slider(); if (el) setNative(el, (1 - i * 0.04).toFixed(2)); await tick(25) } window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 })); await tick(200) }
const fade = obj('a').actions.find((x) => x.verb === 'fade');
out.slider = { a: lengths('a'), onACurve: /a\\.fade\\(\\{[^}]*ease: Ease\\.curve/.test(src()), ends: fade ? r2(smp.valueAt(S().model, obj('a'), 'opacity', fade.end + 1)) : null, written: /opacity/.test(decl('a')) };
await until(S().time + 0.2);
S().setTool('paint'); await tick(150);
const pa = at(-500, 0); pe(host(), 'pointerdown', pa.x, pa.y); pe(host(), 'pointerup', pa.x, pa.y); await tick(200);
S().setTool('select'); await tick(100);
const paint = obj('a').actions.find((x) => 'fill' in x.changes);
out.paint = { a: lengths('a'), changes: paint ? smp.valueAt(S().model, obj('a'), 'fill', paint.start - 0.1) !== smp.valueAt(S().model, obj('a'), 'fill', paint.start + 0.1) : null };
await until(S().time + 0.2);
S().setActivePane('preview');
for (let i = 0; i < 12; i++) { key('keydown', 'ArrowRight'); await tick(30) }
await tick(700);
out.arrows = { a: lengths('a'), went: Math.round(smp.positionAt(S().model, obj('a'), 30).x) };
S().select(['s']); await tick(200);
const f = QA.getRenderer().frameOf('s');
const corner = at(f.x + f.width / 2, f.y + f.height / 2);
pe(host(), 'pointerdown', corner.x, corner.y);
for (let i = 1; i <= 20; i++) { pe(host(), 'pointermove', corner.x + 4 * i, corner.y - 3 * i); await tick(25) }
pe(host(), 'pointerup', corner.x + 80, corner.y - 60); await tick(200);
out.shape = { s: lengths('s'), pointsAsWritten: decl('s').includes('[100, 60]'), wider: QA.getRenderer().frameOf('s').width > f.width + 50 };
S().setTool('pencil'); await tick(100);
const names = S().model.objects.map((o) => o.name);
const began = S().time;
const d0 = at(-300, -300); pe(host(), 'pointerdown', d0.x, d0.y);
for (let i = 1; i <= 24; i++) { const p = at(-300 + 20 * i, -300 + 60 * Math.sin(i / 4)); pe(host(), 'pointermove', p.x, p.y); await tick(25) }
const d1 = at(180, -300 + 60 * Math.sin(6)); pe(host(), 'pointerup', d1.x, d1.y); await tick(300);
const line = S().model.objects.find((o) => !names.includes(o.name));
out.pencil = line ? { kind: line.className, begins: Math.abs(line.at - began) < 0.05, acts: lengths(line.name), drawn: Object.keys(line.actions[0]?.changes ?? {}), half: r2(smp.valueAt(S().model, line, 'drawn', (line.actions[0].start + line.actions[0].end) / 2)) > 0.2 } : null;
S().setTool('select');
await stop();
out.review = review();
await deleteAll();
out.asBefore = src().trimEnd() === before.trimEnd();
out.things = S().model.objects.map((o) => o.name);
out.error = S().error;
return out`,

  // The wheel on the camera while a recording runs (D412): in the Camera view a run of ticks is one animation of the camera, its zoom and where it looks, on a curve, the camera's declaration left as written.
  WHEEL1: `${HELP}
const out = {};
await begin(${J(CAM)}, 0);
S().setPreviewView('camera'); S().select(['cam']); await tick(400);
S().toggleRecording(); await until(0.3);
const panel = document.querySelector('.preview-camera');
const pb = panel.getBoundingClientRect();
for (let i = 0; i < 10; i++) { panel.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -60, clientX: pb.left + pb.width * 0.7, clientY: pb.top + pb.height * 0.4 })); await tick(40) }
await tick(700);
const made = obj('cam').actions[0];
out.camera = { acts: acts('cam'), changes: made ? Object.keys(made.changes).sort() : [], overTime: !!made && made.end - made.start > 0.1, closer: r2(smp.valueAt(S().model, obj('cam'), 'zoom', 20)) > 1.5, asWritten: /zoom: 1,/.test(decl('cam')), onACurve: /cam\\.to\\(\\{[^}]*ease: Ease\\.curve/.test(src()) };
for (let i = 0; i < 6; i++) { panel.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 60, clientX: pb.left + pb.width * 0.5, clientY: pb.top + pb.height * 0.5 })); await tick(40) }
await tick(700);
const second = obj('cam').actions[1];
out.atTheMiddle = { acts: acts('cam'), changes: second ? Object.keys(second.changes).sort() : [] };
S().setPreviewView('preview');
await stop();
out.review = review();
if (S().recordReview) ops.settleRecording([]);
out.error = S().error;
return out`,

  // The review turned off (D410): a recording that stops keeps what it wrote and shows no dialog; turned on again, it shows it.
  REVIEW2: `${HELP}
const out = {};
await begin(${J(PUSH)}, 0);
const record = async () => { S().toggleRecording(); await until(S().time + 0.15); const from = at(-500, 300); const f = QA.getRenderer().frameOf('c'); const c = at(f.x, f.y); pe(host(), 'pointerdown', c.x, c.y); for (let i = 1; i <= 12; i++) { pe(host(), 'pointermove', c.x + 8 * i, c.y + 4 * i); await tick(20) } pe(host(), 'pointerup', c.x + 96, c.y + 48); await tick(150); await stop() };
S().setPrefs({ recordReview: false }); await tick(50);
await record();
out.off = { dialog: !!document.querySelector('.record-dialog'), review: S().recordReview === null, c: acts('c') };
S().setPrefs({ recordReview: true }); await tick(50);
await record();
out.on = { dialog: !!document.querySelector('.record-dialog'), review: review(), c: acts('c') };
if (S().recordReview) ops.settleRecording([]);
out.error = S().error;
return out`,
}
