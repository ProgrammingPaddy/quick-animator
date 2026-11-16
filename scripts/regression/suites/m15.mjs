// Whole frames and recording (D396 to D399, D404): playback shows whole frames, so an animation one frame long is seen as one frame; a frame back and a frame forward in the player; the rate; Ease.curve, the pace of a recorded gesture; and Record, which writes what is dragged in the preview as it was done, each gesture one clip, the thing staying selected, and ends in a review, which each check here settles by keeping everything. What depends on how fast the test's own hand moved is told as whether it holds, not as numbers. What is in hand, the review itself, and what the code pane does with what is written are in m16.
const NL = String.fromCharCode(10)
const J = (lines) => JSON.stringify(lines.join(NL))
const BOX = ['b = Rect({', '  x: 0,', '  y: 0,', '  width: 200,', '  height: 120,', '  until: 9,', '})', '']
const ONE = ['b = Rect({', '  x: -300,', '  y: 0,', '  width: 80,', '  height: 50,', '  until: 6,', '})', '', 'b.move({', '  x: 300,', '  at: 1,', '  duration: frames(1),', '})', '']
const NONE = ['b = Rect({', '  x: -300,', '  y: 0,', '  width: 80,', '  height: 50,', '  until: 6,', '})', '', 'b.move({', '  x: 300,', '  at: 1,', '  duration: 0,', '})', '']
const CURVED = ['b = Rect({', '  x: 0,', '  y: 0,', '  width: 80,', '  height: 50,', '  until: 6,', '})', '', 'b.move({', '  x: 400,', '  at: 1,', '  duration: 2,', '  ease: Ease.curve([0, 0.5, 0.25, 1]),', '})', '', 'b.rotate({', '  rotation: 90,', '  at: 1,', '  duration: 2,', '  ease: Ease.curve([0, 1, 0]),', '})', '']

const HELP = `
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const rp = (p) => [Math.round(p.x), Math.round(p.y)];
// Every check begins the same: the Preview view fitted on an empty scene, Select in hand, nothing selected, no snapping, no recording, time at its own rate.
const begin = async (source, time = 0) => { if (S().recording) { S().toggleRecording(); await tick(60) } if (S().recordReview) ops.settleRecording([]); if (S().recordWait) S().toggleRecordWait(); S().setRate(100); S().setPlaying(false); S().setPreviewView('preview'); S().setTool('select'); S().setTimelineTool('select'); S().setTransformMode('all'); S().setPick('object'); S().select([]); S().setPreviewSnap({ on: false, edges: false }); if (S().collide) S().setCollide(false); S().setNotice(null); await setSource(''); [...document.querySelectorAll('.preview-tools button')].find((b) => b.textContent.trim() === 'Fit')?.click(); await tick(150); await setSource(source); S().select([]); S().setTime(time); await tick(250) };
const host = () => document.querySelector('.preview');
const at = (wx, wy) => { const b = host().getBoundingClientRect(); const p = QA.getViewport().toPane(wx, wy); return { x: b.left + p.x, y: b.top + p.y } };
const press = async (x, y) => { const p = at(x, y); pe(host(), 'pointerdown', p.x, p.y); await tick(30); pe(host(), 'pointerup', p.x, p.y); await tick(250) };
// A drag held: down at the first place, then through the rest, a pause between each; let go apart.
const sweep = async (points, pause = 24) => { const first = at(points[0][0], points[0][1]); pe(host(), 'pointerdown', first.x, first.y); for (const [x, y] of points.slice(1)) { const p = at(x, y); pe(host(), 'pointermove', p.x, p.y); await tick(pause) } };
const release = async (x, y) => { const p = at(x, y); pe(host(), 'pointerup', p.x, p.y); await tick(300) };
const pos = (name, t) => rp(smp.positionAt(S().model, obj(name), t));
const val = (name, attr, t) => r1(Number(smp.valueAt(S().model, obj(name), attr, t)));
const verbs = (name) => obj(name).actions.map((a) => a.verb);
// An animation as written, the values of a recorded ease told as how it is written and not one by one.
const stmts = (name) => obj(name).actions.map((a) => S().source.slice(a.stmt.range.from, a.stmt.range.to).replace(/\\s+/g, ' ').replace(/Ease\\.curve\\(\\[[^\\]]*\\]\\)/, 'Ease.curve([...])').replace(/at: [0-9.]+, duration: [0-9.]+,/, 'at: ..., duration: ...,'));
const undo = async () => { key('keydown', 'KeyZ', { ctrlKey: true }); await tick(400) };
// The review a recording ends in (D404): what it lists, and keeping all of it, which every check does before it goes on.
const review = () => (S().recordReview ?? []).map((c) => c.object + ' ' + c.verb);
const keep = async () => { if (S().recordReview) ops.settleRecording([]); await tick(150) };
`

export default {
  // Whole frames (D396): playing across an animation one frame long, every time shown is on a frame and nothing is drawn between its two states; one of no length is instant at its time; the buttons either side of Play step a frame and stop the playhead; the player's buttons; at half the rate time runs about half as fast.
  FRAMES1: `${HELP}
const out = {};
await begin(${J(ONE)}, 0.9);
const fps = S().settings.fps;
const seen = [];
const stop = st.subscribe((s, p) => { if (s.time !== p.time) seen.push([s.time, Math.round(Number(smp.valueAt(s.model, s.model.objects[0], 'x', s.time)))]) });
S().setPlaying(true); await tick(600); S().setPlaying(false); stop();
out.oneFrame = { played: seen.length > 5, onFrames: seen.every(([t]) => Math.abs(t * fps - Math.round(t * fps)) < 1e-6), between: seen.filter(([, x]) => x !== -300 && x !== 300).length, firstAfter: Math.round((seen.find(([, x]) => x === 300)?.[0] ?? 0) * 10000) / 10000 };
await setSource(${J(NONE)}); await tick(250);
out.noLength = [59, 60, 61].map((f) => Math.round(Number(smp.valueAt(S().model, obj('b'), 'x', f / fps))));
S().setTime(2); await tick(50);
const buttons = [...document.querySelectorAll('.transport .transport-button')];
const named = (label) => buttons.find((b) => b.getAttribute('aria-label') === label);
named('Forward a frame').click(); named('Forward a frame').click(); await tick(50);
const forward = Math.round(S().time * fps);
named('Back a frame').click(); await tick(50);
out.steps = { forward, back: Math.round(S().time * fps), playing: S().playing };
out.player = buttons.map((b) => b.getAttribute('aria-label')).filter(Boolean);
out.rateField = document.querySelector('.transport .transport-tools .num-field')?.title ?? null;
S().setTime(0); S().setRate(50); await tick(50);
S().setPlaying(true); await tick(1000); S().setPlaying(false);
out.halfRate = S().time > 0.3 && S().time < 0.7;
S().setRate(100);
out.error = S().error;
return out`,

  // Ease.curve (D399): a curve by its values at evenly spaced moments, straight between them, taken as they are; one that ends short of the whole leaves the value there. And how a recording is fitted: one take a frame, a frame passed over filled in; how far along a line each place lies, never going back, a hand held still staying put; the fewest values that stay near; several values at once laid on the line to where they ended, or to the farthest when they came back; the ease as code.
  CURVE1: `${HELP}
const out = {};
const rec = await import('/src/model/record.ts');
await begin(${J(CURVED)}, 0);
out.curve = { x: [1, 1.5, 5 / 3, 2, 7 / 3, 3, 4].map((t) => val('b', 'x', t)), rotation: [1, 2, 3, 4].map((t) => val('b', 'rotation', t)), error: S().error, warnings: S().model.warnings.map((w) => w.message) };
out.perFrame = rec.perFrame([{ time: 1, values: { x: 0 } }, { time: 1 + 1 / 60, values: { x: 10 } }, { time: 1 + 4 / 60, values: { x: 40, y: 6 } }], 60);
const line = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
out.along = rec.sharesAlong([{ x: 0, y: 1 }, { x: 50, y: -2 }, { x: 51, y: 1 }, { x: 49, y: 0 }, { x: 100, y: 3 }, { x: 98, y: 60 }, { x: 100, y: 100 }], line).map(r2);
out.thinned = [rec.thinned([0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1], 0.01), rec.thinned([0, 0.3, 0.6, 0.6, 0.6, 0.8, 1], 0.01).length, rec.thinned([0, 0.3, 0.6, 0.6, 0.6, 0.8, 1], 0.2)].map((v) => (Array.isArray(v) ? v.map(r2) : v));
const toward = rec.sharesToward([{ w: 100, h: 50 }, { w: 150, h: 60 }, { w: 200, h: 100 }, { w: 300, h: 150 }], ['w', 'h']);
const back = rec.sharesToward([{ r: 0 }, { r: -30 }, { r: -60 }, { r: -20 }, { r: 0 }], ['r']);
out.toward = { shares: toward.shares.map(r2), to: toward.to, back: back.shares.map(r2), backTo: back.to };
out.code = [rec.curveCode([0, 1]), rec.curveCode([0, 0.25, 1]), rec.curveCode([0, 1.04, 0])];
return out`,

  // Record (D397): the playhead runs; a box dragged along an arc, with a pause, is one animation that reaches the playhead while it is dragged, and one path when it is let go, beginning at the box, its pace an ease by its values; the box is where the pointer was at each moment, and still through the pause; Record again stops, and the playhead goes back; one undo takes the gesture out.
  RECORD1: `${HELP}
const out = {};
const SCENE = ${J(['b = Rect({', '  x: -400,', '  y: 0,', '  width: 120,', '  height: 80,', '  until: 8,', '})', ''])};
await begin(SCENE, 1);
S().toggleRecording(); await tick(120);
out.started = { recording: S().recording, playing: S().playing, lit: !!document.querySelector('.transport-button.record.on') };
const route = (k) => ({ x: -400 + 600 * k, y: Math.sin(k * Math.PI) * 250 });
const from = at(-400, 0);
pe(host(), 'pointerdown', from.x, from.y);
const seen = [];
for (let i = 1; i <= 20; i++) { const w = route(i / 40); const p = at(w.x, w.y); pe(host(), 'pointermove', p.x, p.y); await tick(16); seen.push([S().time, w.x, w.y]) }
const pauseFrom = S().time;
await tick(400);
const pauseTo = S().time;
seen.push([S().time, route(0.5).x, route(0.5).y]);
for (let i = 21; i <= 40; i++) { const w = route(i / 40); const p = at(w.x, w.y); pe(host(), 'pointermove', p.x, p.y); await tick(16); seen.push([S().time, w.x, w.y]) }
out.during = { verbs: verbs('b'), reachesPlayhead: Math.abs(obj('b').actions[0].end - S().time) < 2 / S().settings.fps, running: S().time > 1 };
const end = at(route(1).x, route(1).y);
pe(host(), 'pointerup', end.x, end.y); await tick(300);
S().toggleRecording(); await tick(300);
out.stopped = { recording: S().recording, playing: S().playing, time: S().time, lit: !!document.querySelector('.transport-button.record.on'), review: review(), dialog: !!document.querySelector('.record-dialog') };
const a = obj('b').actions;
const text = a[0] ? S().source.slice(a[0].stmt.range.from, a[0].stmt.range.to).replace(/\\s+/g, ' ') : '';
out.written = { verbs: verbs('b'), beginsAtBox: /shape: (\` M 0 0 |\\[ \\[0, 0\\])/.test(text), pace: /ease: Ease\\.curve\\(\\[ ?0, /.test(text), selected: S().selectedActions.map((r) => r.object + ':' + r.index), selection: S().selection, startsAfter: a[0] ? a[0].start >= 1 : null };
let worst = 0;
for (const [t, x, y] of seen) { if (!a[0] || t < a[0].start || t > a[0].end) continue; const p = smp.positionAt(S().model, obj('b'), t); worst = Math.max(worst, Math.hypot(p.x - x, p.y - y)) }
out.follows = { within4: worst <= 4, ends: a[0] ? pos('b', a[0].end + 0.5) : null, paused: pauseTo - pauseFrom > 0.2, stillInPause: a[0] ? Math.abs(smp.positionAt(S().model, obj('b'), pauseFrom + 0.05).x - smp.positionAt(S().model, obj('b'), pauseTo - 0.05).x) < 4 : null };
out.life = obj('b').until;
await keep();
await undo();
out.undone = S().source === SCENE;
out.error = S().error;
return out`,

  // What else is recorded (D397): a turn by the handle is one rotate to where it ended; a corner dragged out one resize; a turn there and back goes to the farthest it went and ends where it began. A recording that waits holds the playhead until the first drag, then runs; Space stops it, the playhead going back. Stopped with the drag still held, what was dragged so far is written and the rest writes nothing. At half the rate the same hand takes about half the scene's time. Two things dragged as one are made a group, and the path is the group's. A recorded clip cut by the razor goes as it did. A Shape's resize is not recorded, and says so.
  RECORD2: `${HELP}
const out = {};
const BOXED = ${J(BOX)};
const zoom = () => QA.getViewport().zoom;
await begin(BOXED, 1);
await press(0, 0);
S().toggleRecording(); await tick(100);
const reach = 60 + 24 / zoom();
const arc = (from, to, n) => Array.from({ length: n + 1 }, (_, i) => { const a = from + (to - from) * (i / n); return [Math.cos(a) * reach, Math.sin(a) * reach] });
const quarter = arc(Math.PI / 2, 0, 16);
await sweep(quarter); await release(quarter[16][0], quarter[16][1]);
S().toggleRecording(); await tick(300);
out.turn = { stmts: stmts('b'), ends: val('b', 'rotation', 8) };
await begin(BOXED, 1);
await press(0, 0);
S().toggleRecording(); await tick(100);
const grow = Array.from({ length: 13 }, (_, i) => [100 + i * 8, 60 + i * 5]);
await sweep(grow); await release(grow[12][0], grow[12][1]);
S().toggleRecording(); await tick(300);
out.resize = { stmts: stmts('b'), size: [val('b', 'width', 8), val('b', 'height', 8)] };
await begin(BOXED, 1);
await press(0, 0);
S().toggleRecording(); await tick(100);
const there = arc(Math.PI / 2, Math.PI / 6, 9);
const wag = [...there, ...there.slice(0, 9).reverse()];
await sweep(wag); await release(wag[wag.length - 1][0], wag[wag.length - 1][1]);
S().toggleRecording(); await tick(300);
const w = obj('b').actions[0];
out.thereAndBack = { stmts: stmts('b'), farInTheMiddle: w ? val('b', 'rotation', (w.start + w.end) / 2) < -40 : null, ends: val('b', 'rotation', 8) };
await begin(BOXED, 2);
S().toggleRecordWait(); await tick(50);
S().toggleRecording(); await tick(400);
out.waiting = { recording: S().recording, armed: S().armed, playing: S().playing, time: S().time };
await sweep([[0, 0], [60, 30], [120, 60], [180, 60], [240, 30], [300, 0]]);
out.running = { armed: S().armed, playing: S().playing, moved: S().time > 2 };
await release(300, 0);
key('keydown', ' ', { code: 'Space' }); await tick(300);
out.space = { recording: S().recording, playing: S().playing, time: S().time, verbs: verbs('b') };
S().toggleRecordWait(); await tick(50);
await begin(BOXED, 1);
S().toggleRecording(); await tick(100);
await sweep([[0, 0], [80, 20], [160, 40], [240, 60]]);
S().toggleRecording(); await tick(250);
const held = { verbs: verbs('b'), ends: pos('b', 8) };
const more = at(600, 300); pe(host(), 'pointermove', more.x, more.y); await tick(100);
await release(600, 300);
out.stoppedHeld = { ...held, after: pos('b', 8), actions: obj('b').actions.length };
await begin(BOXED, 1);
S().setRate(50);
S().toggleRecording(); await tick(100);
const t0 = performance.now();
await sweep([[0, 0], [60, 30], [120, 60], [180, 60], [240, 30], [300, 0], [360, -30], [420, -60]], 60);
const real = (performance.now() - t0) / 1000;
await release(420, -60);
S().toggleRecording(); S().setRate(100); await tick(300);
const slow = obj('b').actions[0];
out.halfRate = slow ? (slow.end - slow.start) / real > 0.3 && (slow.end - slow.start) / real < 0.7 : null;
await begin(${J([...BOX, 'c = Circle({', '  x: 400,', '  y: 200,', '  radius: 50,', '  until: 9,', '})', ''])}, 1);
S().select(['b', 'c']); await tick(200);
S().toggleRecording(); await tick(100);
await sweep([[0, 0], [-60, -30], [-120, -60], [-180, -90]]); await release(-180, -90);
S().toggleRecording(); await tick(300);
out.group = S().model.objects.map((o) => o.name + ':' + o.className + ' ' + o.actions.map((x) => x.verb).join(','));
await begin(BOXED, 1);
S().toggleRecording(); await tick(100);
await sweep([[0, 0], [100, 80], [220, 120], [340, 60], [420, -40], [520, -60]], 40); await release(520, -60);
S().toggleRecording(); await tick(300);
const whole = obj('b').actions[0];
if (whole) {
  const course = () => { const o = obj('b'); const m = S().model; const rows = []; for (let t = whole.start; t <= whole.end + 0.2; t += 1 / 60) { const p = smp.positionAt(m, o, t); rows.push([p.x, p.y]) } return rows };
  const before = course();
  const cut = ops.sliceAction('b', 0, Math.round(((whole.start + whole.end) / 2) * 60) / 60); await tick(300);
  const after = course();
  let worst = 0;
  for (let i = 0; i < before.length; i++) worst = Math.max(worst, Math.hypot(before[i][0] - after[i][0], before[i][1] - after[i][1]));
  out.cut = { cut, same: worst < 0.5, pieces: verbs('b'), notice: S().notice };
}
await begin(${J(['s = Shape({', '  x: 0,', '  y: 0,', '  points: Shape.rect(200, 120),', "  fill: '#4f8cff',", '  until: 9,', '})', ''])}, 1);
await press(0, 0);
S().toggleRecording(); await tick(100);
await sweep([[100, 60], [120, 70], [140, 80]]); await release(140, 80);
out.shape = { notice: S().notice, actions: obj('s').actions.length };
S().toggleRecording(); await tick(200);
S().setNotice(null); S().select([]);
await keep();
out.error = S().error;
return out`,
}
