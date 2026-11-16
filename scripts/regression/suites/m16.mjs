// The first look at recording (D401 to D406): what is in hand stays in view while a recording runs, though its life goes by, and a life is widened only as far as its animations go; a recording ends in a review, where what it wrote is kept or deleted; what it writes comes folded, its values in rows, after an undo, a redo, and a cut too; a path shows by Show Paths and the Path tool alone, the selected thing's in the selection's color, and only the Path tool has points in hand; a lit control has one tooltip. What depends on how fast the test's own hand moved is told as whether it holds, not as numbers.
const NL = String.fromCharCode(10)
const J = (lines) => JSON.stringify(lines.join(NL))
const RECT = (name, x, y, until) => [`${name} = Rect({`, `  x: ${x},`, `  y: ${y},`, '  width: 120,', '  height: 80,', ...(until === null ? [] : [`  until: ${until},`]), '})', '']
const THREE = [...RECT('a', -400, 0, 2), ...RECT('c', 0, -300, 3), ...RECT('b', 300, 250, 6)]
const TWO = [...RECT('a', -400, 0, 2), ...RECT('b', 300, 250, 6)]
const LAST = RECT('d', -200, 0, 2)
const PATHS = [...RECT('p', -300, 0, null), ...RECT('q', -300, 250, null), 'p.path({', '  shape: [', '    [0, 0],', '    [300, 100],', '    [600, 0],', '  ],', '  at: 0,', '  duration: 2,', '})', '', 'q.path({', '  shape: [', '    [0, 0],', '    [400, 0],', '  ],', '  at: 1,', '  duration: 2,', '})', '']

const HELP = `
const r2 = (v) => Math.round(v * 100) / 100;
// Every check begins the same: no recording and no review, the Preview view fitted on an empty scene, Select in hand, nothing selected, no snapping, time at its own rate.
const begin = async (source, time = 0) => { if (S().recording) { S().toggleRecording(); await tick(60) } if (S().recordReview) ops.settleRecording([]); if (S().recordWait) S().toggleRecordWait(); S().setRate(100); S().setPlaying(false); S().setPreviewView('preview'); S().setTool('select'); S().setTimelineTool('select'); S().setTransformMode('all'); S().setPick('object'); S().select([]); S().setPreviewSnap({ on: false, edges: false }); if (S().collide) S().setCollide(false); S().setNotice(null); await setSource(''); [...document.querySelectorAll('.preview-tools button')].find((b) => b.textContent.trim() === 'Fit')?.click(); await tick(150); await setSource(source); S().select([]); S().setTime(time); await tick(250) };
const host = () => document.querySelector('.preview');
const at = (wx, wy) => { const b = host().getBoundingClientRect(); const p = QA.getViewport().toPane(wx, wy); return { x: b.left + p.x, y: b.top + p.y } };
const shown = (name) => !!QA.getRenderer().frameOf(name);
const exists = (name) => smp.existsAt(S().model, obj(name), S().time);
const acts = (name) => obj(name).actions.map((a) => a.verb);
// Wait for the playhead of a recording to come to a time.
const until = async (t) => { while (S().time < t && S().recording) await tick(16) };
// A recorded drag of a thing from where it shows, along a bent way, for about so many seconds: whether it could be grabbed, and whether it showed all the way.
const record = async (name, seconds, dx, dy) => { await tick(40); const f = QA.getRenderer().frameOf(name); if (!f) return { grabbed: false }; const from = at(f.x, f.y); pe(host(), 'pointerdown', from.x, from.y); const steps = Math.max(4, Math.round(seconds * 40)); let seen = true; for (let i = 1; i <= steps; i++) { const k = i / steps; const p = at(f.x + dx * k, f.y + dy * Math.sin(k * 4)); pe(host(), 'pointermove', p.x, p.y); await tick(24); if (!shown(name)) seen = false } const last = at(f.x + dx, f.y + dy * Math.sin(4)); pe(host(), 'pointerup', last.x, last.y); await tick(80); return { grabbed: true, seen, selection: S().selection.join(' '), actionsSelected: S().selectedActions.length } };
const stop = async () => { if (S().recording) S().toggleRecording(); await tick(300) };
const review = () => (S().recordReview ?? []).map((c) => c.object + ' ' + c.verb);
const dialog = () => document.querySelector('.record-dialog');
const undo = async () => { key('keydown', 'KeyZ', { ctrlKey: true }); await tick(400) };
const redo = async () => { key('keydown', 'KeyY', { ctrlKey: true }); await tick(400) };
// A life ends on the frame its last recorded animation ends on.
const livesTo = (name) => { const o = obj(name); const last = Math.max(...o.actions.map((a) => a.end)); return o.until !== null && Math.abs(o.until - last) < 2e-4 };
`

export default {
  // What is in hand (D403): a thing dragged past the end of its life, in the middle of the project, shows all the way; let go, it still shows and is dragged again, each gesture its own animation, the thing selected and no animation; its life reaches as far as its animations and no further. A thing not in hand goes when its life ends. Let go of, the thing goes too, and picking it again does not bring it back. Past the project's end, the last thing shows through two gestures, and each is an animation of its own. A recording stopped keeps nothing in view.
  LIFE1: `${HELP}
const out = {};
await begin(${J(THREE)}, 1);
S().toggleRecording(); await until(1.2);
out.first = await record('a', 1.1, 300, 150);
await tick(300);
out.letGo = { shown: shown('a'), exists: exists('a'), pastItsLife: S().time > obj('a').until };
out.second = await record('a', 0.4, -150, 100);
out.written = { actions: acts('a'), livesToItsLast: livesTo('a'), lifeWidened: obj('a').until > 2 };
await until(3.7);
out.others ={ c: { shown: shown('c'), until: obj('c').until }, b: { shown: shown('b'), until: obj('b').until } };
S().select(['c']); await tick(150);
out.pickedGone = { c: shown('c'), a: shown('a') };
S().select(['a']); await tick(150);
out.pickedAgain = shown('a');
await stop();
out.stopped = { review: review(), time: S().time };
ops.settleRecording([]); await tick(150);
S().setTime(obj('a').until + 0.5); S().select(['a']); await tick(200);
out.afterwards = shown('a');
await begin(${J(LAST)}, 1.8);
S().toggleRecording(); await until(2.5);
out.pastEnd = { shownBefore: shown('d'), first: await record('d', 0.3, 200, 80) };
await tick(400);
out.pastEnd.second = await record('d', 0.3, 150, -60);
await stop();
out.pastEnd.actions = acts('d');
out.pastEnd.livesToItsLast = livesTo('d');
out.pastEnd.review = review();
ops.settleRecording([]); await tick(150);
out.error = S().error;
return out`,

  // The review (D404): three gestures on two things are listed by thing, in the order of time, with what each is; one unticked, Keep says how many, keeps those, and takes the other's life back with it, in one undo step; Delete all leaves the scene as it was before the recording; a group made for a gesture goes again with it; Escape keeps everything; a recording that wrote nothing has no review.
  REVIEW1: `${HELP}
const out = {};
const SCENE = ${J(TWO)};
await begin(SCENE, 1);
S().toggleRecording(); await until(1.2);
await record('a', 0.8, 300, 150); await tick(200);
await record('a', 0.4, -150, 100); await tick(200);
await record('b', 0.5, -250, -120); await tick(200);
await stop();
out.listed = { review: review(), shown: !!dialog(), things: [...dialog().querySelectorAll('.record-thing')].map((l) => l.textContent.trim()), clips: [...dialog().querySelectorAll('.record-clip .record-what')].map((l) => l.textContent.trim()), keep: dialog().querySelector('.dialog-actions .primary').textContent.trim(), playheadBack: S().time === 1 };
const before = S().source;
const lifeBefore = obj('a').until;
dialog().querySelectorAll('.record-clip input')[1].click(); await tick(100);
out.unticked = { keep: dialog().querySelector('.dialog-actions .primary').textContent.trim(), things: [...dialog().querySelectorAll('.record-thing input')].map((i) => (i.indeterminate ? 'some' : i.checked ? 'all' : 'none')) };
dialog().querySelector('.dialog-actions .primary').click(); await tick(300);
out.kept = { a: acts('a'), b: acts('b'), lifeBack: obj('a').until < lifeBefore, livesToItsLast: livesTo('a'), closed: !dialog() && !S().recordReview };
await undo();
out.undone = S().source === before;
await begin(SCENE, 1);
S().toggleRecording(); await until(1.2);
await record('a', 0.5, 300, 150); await tick(200);
await record('b', 0.4, -250, -120); await tick(200);
await stop();
[...dialog().querySelectorAll('.dialog-actions button')].find((b) => b.textContent.trim() === 'Delete all').click(); await tick(300);
out.deleteAll = { asBefore: S().source.trimEnd() === SCENE.trimEnd(), closed: !dialog() };
await undo();
out.deleteUndone = { a: acts('a'), b: acts('b') };
await begin(SCENE, 1);
S().select(['a', 'b']); await tick(200);
S().toggleRecording(); await until(1.2);
await record('a', 0.5, 200, 120); await tick(200);
await stop();
out.group = { made: S().model.objects.filter((o) => o.className === 'Group').length, review: review() };
[...dialog().querySelectorAll('.dialog-actions button')].find((b) => b.textContent.trim() === 'Delete all').click(); await tick(300);
out.groupGone = { groups: S().model.objects.filter((o) => o.className === 'Group').length, asBefore: S().source.trimEnd() === SCENE.trimEnd() };
await begin(SCENE, 1);
S().toggleRecording(); await until(1.2);
await record('b', 0.4, -250, -120); await tick(200);
await stop();
key('keydown', 'Escape'); await tick(300);
out.escape = { closed: !dialog() && !S().recordReview, b: acts('b') };
await begin(SCENE, 1);
S().toggleRecording(); await tick(300);
await stop();
out.nothing = { review: S().recordReview, shown: !!dialog() };
out.error = S().error;
return out`,

  // What a recording writes (D401, D402): the thing stays selected, no animation; the values of its ease stand in rows of five at most, a step further in than the block, the bracket closing level with it; its shape and its ease come folded, and are folded again after an undo and a redo, and in both pieces of a cut; a line of the code wraps under itself; and a shown path's line is one mesh, its points read once.
  CODE1: `${HELP}
const out = {};
await begin(${J(TWO)}, 1);
S().toggleRecording(); await until(1.2);
out.drag = await record('b', 1.5, -500, -200);
await stop();
ops.settleRecording([]); await tick(150);
const text = () => { const a = obj('b').actions[0]; return S().source.slice(a.stmt.range.from, a.stmt.range.to).split(String.fromCharCode(10)) };
const lines = text();
const open = lines.findIndex((l) => /^  ease: Ease\\.curve\\(\\[$/.test(l));
const close = lines.findIndex((l, i) => i > open && /^  \\]\\),$/.test(l));
const valueRows = open >= 0 && close > open ? lines.slice(open + 1, close) : [];
out.rows = { opens: open >= 0, closes: close > open, some: valueRows.length > 1, indented: valueRows.every((l) => /^    [-0-9]/.test(l)), fiveAtMost: valueRows.every((l) => l.split(',').filter((v) => v.trim() !== '').length <= 5), firstIsNothing: /^    0, /.test(valueRows[0] ?? ''), lastIsAll: /(^|, )1,$/.test((valueRows[valueRows.length - 1] ?? '').trim()) };
const lang = await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('@codemirror_language')));
const ed = QA.getEditor();
const folds = () => { const state = ed.state; const folded = lang.foldedRanges(state); let open = 0; let shut = 0; for (let n = 1; n <= state.doc.lines; n++) { const line = state.doc.line(n); if (!/^\\s*(shape|points|curves|to):\\s*(\\[|\`)/.test(line.text) && !/Ease\\.curve\\(\\[/.test(line.text)) continue; let covered = false; folded.between(line.from, line.to + 1, () => { covered = true }); if (covered) shut++; else open++ } return { open, shut } };
out.folded = folds();
await undo();
out.afterUndo = { ...folds(), actions: acts('b').length };
await redo();
out.afterRedo = folds();
const whole = obj('b').actions[0];
out.cut = ops.sliceAction('b', 0, Math.round(((whole.start + whole.end) / 2) * 60) / 60); await tick(300);
out.afterCut = { ...folds(), pieces: acts('b') };
out.wraps = /text-indent/.test(document.querySelector('.code .cm-line')?.getAttribute('style') ?? '');
if (!S().showPaths) S().toggleShowPaths();
S().setTime(obj('b').actions[0].start + 0.1); await tick(200);
const r = QA.getRenderer();
const line = r.otherLines.find((l) => l.group.visible);
const shape = () => smp.pathShape(S().model, obj('b').actions[0], 0).points;
out.cost = { lines: r.pathLineCount(), meshes: line ? line.group.children.filter((c) => c.isMesh).length : null, pieces: line ? line.count() > 3 : null, readOnce: shape() === shape() };
out.error = S().error;
return out`,

  // Which paths show, and to whom they answer (D405): with Select, a selected path does not show by being selected; Show Paths shows the paths running, the selected thing's in the selection's color and none so with nothing selected, and no path has handles; the Path tool shows the selected path with its handles. The points picked are the tool's that shows them: another tool has none, and Delete with Select takes the selected animation, not a point of it.
  PATHS1: `${HELP}
const out = {};
await begin(${J(PATHS)}, 1.5);
const r = QA.getRenderer();
const see = async () => { await tick(160); return { lines: r.pathLineCount(), inHand: r.heldPathCount(), handles: r.pathLine.group.visible } };
if (S().showPaths) S().toggleShowPaths();
S().selectAction('p', 0);
out.selectedOff = await see();
S().toggleShowPaths();
out.selectedOn = await see();
S().select(['q']);
out.otherPicked = await see();
S().select([]);
out.nonePicked = await see();
S().setTime(2.5);
S().selectAction('p', 0);
out.selectedNotRunning = await see();
S().setTool('path'); S().setPathMode('create');
out.pathTool = await see();
S().setPathPoints([1]); await tick(100);
S().setTool('select'); await tick(150);
out.backToSelect = { ...(await see()), points: S().pathPoints.length };
key('keydown', 'Delete'); await tick(300);
out.deleted = { p: acts('p'), q: acts('q') };
out.error = S().error;
return out`,

  // One tooltip (D406): what each lit control says, in the player, the preview's header, and the code pane; and that it says the same whether it is on or off.
  TIPS1: `${HELP}
const out = {};
await begin(${J(TWO)}, 0);
const tips = () => ({ player: [...document.querySelectorAll('.transport [aria-pressed]')].map((b) => b.title), rate: document.querySelector('.transport .transport-tools .num-field')?.title ?? null, header: [...document.querySelectorAll('.preview-options [aria-pressed][title]')].filter((b) => !b.closest('.preview-modes, .preview-views')).map((b) => b.textContent.trim() + ': ' + b.title), code: document.querySelector('.code-tools button')?.title ?? null });
out.tips = tips();
const before = JSON.stringify(out.tips);
S().toggleLoop(); S().toggleSnap(); S().toggleFrameSnap(); S().toggleRecordWait(); S().toggleShowPaths(); S().toggleShowMasks(); S().toggleShowCameras(); S().toggleDefaults(); S().setPreviewSnap({ edges: !S().previewSnap.edges }); await tick(200);
out.sameWhenToggled = JSON.stringify(tips()) === before;
S().toggleLoop(); S().toggleSnap(); S().toggleFrameSnap(); S().toggleRecordWait(); S().toggleShowPaths(); S().toggleShowMasks(); S().toggleShowCameras(); S().toggleDefaults(); S().setPreviewSnap({ edges: false }); await tick(100);
out.error = S().error;
return out`,
}
