// The camera's first look (D365 to D372): every tool at work in the Camera view, the wheel and the middle button on the camera there, a camera from the menus, cuts from one camera to another, the razor on a camera's clip, Fit by the camera, and the preview's options in the pane's header.
const NL = String.fromCharCode(10)
// A camera moved, zoomed, and rolled, so nothing in the Camera view is where the scene has it.
const WIDE = ['', 'wide = Camera({', '  x: 200,', '  y: 100,', '  zoom: 1.5,', '  rotation: 12,', '})', '']
const WORK = ['box = Rect({', '  x: -100,', '  y: 100,', '  width: 240,', '  height: 140,', "  fill: '#4f8cff',", '})', '', 'dot = Circle({', '  x: 500,', '  y: -50,', '  radius: 80,', "  fill: '#f59e0b',", '})', '', 'title = Text({', "  text: 'Chapter one',", '  x: 200,', '  y: 300,', '  fontSize: 72,', '})', '', 'badge = Rect({', '  x: 500,', '  y: 250,', '  width: 120,', '  height: 60,', "  fill: '#ff0000',", '  attached: true,', '})', ...WIDE].join(NL)
const PLAIN = ['box = Rect({', '  x: -100,', '  y: 100,', '  width: 240,', '  height: 140,', "  fill: '#4f8cff',", '})', '', 'dot = Circle({', '  x: 500,', '  y: -50,', '  radius: 80,', "  fill: '#f59e0b',", '})', ...WIDE].join(NL)
const NOCAM = ['box = Rect({', '  x: -100,', '  y: 100,', '  width: 240,', '  height: 140,', "  fill: '#4f8cff',", '})', ''].join(NL)
// A camera for the whole scene that travels, and shots over it.
const BASE = ['backdrop = Rect({', '  width: 1920,', '  height: 1080,', "  fill: '#203040',", '  until: 10,', '})', '', 'wide = Camera({', '  x: 0,', '  y: 0,', '  zoom: 1,', '})', '', 'wide.move({', '  x: 600,', '  at: 0,', '  duration: 4,', "  ease: 'linear',", '})', '']
const SHOTS = [...BASE, 'close = Camera({', '  x: -300,', '  y: 100,', '  zoom: 4,', '  at: 2,', '  until: 4,', '})', '', 'close.to({', '  zoom: 2,', '  at: 2,', '  duration: 2,', "  ease: 'linear',", '})', ''].join(NL)
const LATER = [...BASE, 'shotA = Camera({', '  x: -300,', '  y: 100,', '  zoom: 2,', '  at: 6,', '  until: 8,', '})', ''].join(NL)
const RAZOR = [...BASE, 'shot = Camera({', '  x: 0,', '  y: 0,', '  zoom: 1,', '  at: 2,', '  until: 8,', '})', '', 'shot.move({', '  x: 400,', '  at: 3,', '  duration: 2,', "  ease: 'linear',", '})', '', 'shot.to({', '  zoom: 2,', '  at: 6,', '  duration: 1,', "  ease: 'linear',", '})', ''].join(NL)
const FAR = ['box = Rect({', '  x: 2400,', '  y: 900,', '  width: 240,', '  height: 140,', "  fill: '#4f8cff',", '  until: 8,', '})', '', 'far = Camera({', '  x: 2400,', '  y: 900,', '  zoom: 2,', '})', '', 'near = Camera({', '  x: 0,', '  y: 0,', '  zoom: 1,', '  at: 4,', '})', ''].join(NL)

const HELP = `
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const who = (ts) => ts.map((t) => smp.cameraAt(S().model, t)?.name ?? null);
const view = (t) => { const v = smp.viewAt(S().model, t); return [r1(v.x), r1(v.y), r2(v.zoom), r1(v.rotation)] };
const start = async (source, shown, tool) => { await setSource(source); S().setPreviewView(shown); S().setPreviewSplit(0.5); S().setTool(tool); S().setTimelineTool('select'); S().select([]); S().setTransformMode('all'); S().setAnchor('center'); if (S().collide) S().setCollide(false); S().setTime(0); await tick(500) };
// The Camera view: its picture on the screen, and where a place in the scene shows in it, through the camera.
const cam = () => { const el = document.querySelector('.preview'); const panel = document.querySelector('.preview-camera'); const r = document.querySelector('.preview-camera canvas').getBoundingClientRect(); const k = r.width / 1920; const at = (wx, wy, t = S().time) => { const v = smp.viewAt(S().model, t); const a = (v.rotation * Math.PI) / 180; const dx = (wx - v.x) * v.zoom; const dy = (wy - v.y) * v.zoom; return { x: r.left + r.width / 2 + (Math.cos(a) * dx + Math.sin(a) * dy) * k, y: r.top + r.height / 2 - (-Math.sin(a) * dx + Math.cos(a) * dy) * k } }; return { el, panel, r, k, at, cx: r.left + r.width / 2, cy: r.top + r.height / 2 } };
const press = async (c, p, extra = {}) => { pe(c.panel, 'pointerdown', p.x, p.y, extra); await tick(40); pe(c.el, 'pointerup', p.x, p.y, extra); await tick(220) };
const pull = async (c, from, to, extra = {}) => { pe(c.panel, 'pointerdown', from.x, from.y, extra); for (let i = 1; i <= 6; i++) { pe(c.el, 'pointermove', from.x + ((to.x - from.x) * i) / 6, from.y + ((to.y - from.y) * i) / 6, extra); await tick(30) } pe(c.el, 'pointerup', to.x, to.y, extra); await tick(280) };
const frame = (n) => { const f = QA.getRenderer().frameOf(n); return f ? { x: r1(f.x), y: r1(f.y), w: r1(f.width), h: r1(f.height), rot: r1(f.rotation) } : null };
const lines = (name, keys) => (decl(name) ?? '').split('\\n').map((l) => l.trim()).filter((l) => keys.some((k) => l.startsWith(k + ':')));
const acts = (name) => obj(name).actions.map((a) => [a.verb, a.start, a.end, Object.fromEntries(Object.entries(a.changes).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : 'fn']))]);
const stmts = (name, verb) => obj(name).actions.filter((a) => a.verb === verb && a.stmt).map((a) => S().source.slice(a.stmt.range.from, a.stmt.range.to).replace(/\\s+/g, ' '));
const cams = () => smp.camerasOf(S().model).map((c) => [c.name, c.at, c.until, ...view2(c)]);
const view2 = (c) => { const v = smp.viewOf(S().model, c, Math.max(c.at, 0)); return [r1(v.x), r1(v.y), r2(v.zoom)] };
const last = () => S().model.objects[S().model.objects.length - 1];
const wheel = async (x, y, deltaY, extra = {}) => { document.querySelector('.preview-camera canvas').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: x, clientY: y, deltaY, ...extra })); await tick(60) };
const undo = async () => { key('keydown', 'KeyZ', { ctrlKey: true }); await tick(400) };
// The menus: the first level's words, a flyout's buttons, and putting one away.
const top = () => [...document.querySelectorAll('.context-menu:not(.submenu) > .menu-item-wrap > button')];
const menuAt = async (el, x, y) => { el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 })); await tick(200); return top().map((b) => b.textContent.replace('▸', '').replace(/\\s+/g, ' ').trim()) };
const sub = async (label) => { const b = top().find((x) => x.textContent.trim().startsWith(label)); if (!b) return null; b.parentElement.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await tick(200); return [...document.querySelectorAll('.context-menu.submenu button')] };
const words = (buttons) => buttons?.map((b) => b.textContent.trim()) ?? null;
const shut = async () => { if (document.querySelector('.context-menu')) { S().closeMenu(); await tick(150) } };
// The timeline's Cameras section: its track, a clip, and the place on the screen of a time.
const track = (lane = 'cameras') => document.querySelector('.tl-row.lane[data-lane="' + lane + '"] .tl-track');
const clipOf = (name) => document.querySelector('.tl-row.lane[data-lane="cameras"] .oclip[data-object="' + name + '"]');
const timeX = (name) => { const clip = clipOf(name); const cr = clip.getBoundingClientRect(); const per = cr.width / (Number(clip.dataset.end) - Number(clip.dataset.start)); return (t) => cr.left + (t - Number(clip.dataset.start)) * per };
`

export default {
  // Select in the Camera view, through a camera moved, zoomed, and rolled: a click picks; a drag lands under the pointer; a corner resizes from where the view draws it; Rotate mode turns; a box from empty space takes what it touches; past the picture's edge nothing is picked; the Object tool places where it is clicked; a thing held on the screen lands under the pointer; Shift makes the drag an animation, the look-ahead holding.
  WORK1: `${HELP}
const out = {};
await start(${JSON.stringify(WORK)}, 'both', 'select');
const c = cam();
await press(c, c.at(-100, 100));
out.clicked = S().selection;
await pull(c, c.at(-100, 100), c.at(-150, -100));
out.dragged = lines('box', ['x', 'y']);
const f = QA.getRenderer().frameOf('box');
await pull(c, c.at(f.x + f.width / 2, f.y + f.height / 2), c.at(f.x + f.width, f.y + f.height));
out.resized = lines('box', ['x', 'y', 'width', 'height']);
S().setTransformMode('rotate'); await tick(200);
await pull(c, c.at(-150 + 60, -100), c.at(-150, -100 + 60));
out.turned = lines('box', ['rotation']);
S().setTransformMode('all'); S().select([]); await tick(200);
await pull(c, c.at(380, -180), c.at(620, 80));
out.boxed = S().selection;
// Above the picture, in the Camera view's own margin: a click there picks nothing and lets go.
const pr = c.panel.getBoundingClientRect();
out.margin = Math.round(c.r.top - pr.top) > 8;
await press(c, { x: c.cx, y: pr.top + 4 });
out.pastTheEdge = S().selection;
S().setTool('object'); S().setAddKind('Rect'); await tick(200);
await press(c, c.at(-300, 250));
S().setTool('select'); await tick(200);
out.placed = { name: last().name, kind: last().className, at: lines(last().name, ['x', 'y']) };
S().select([]); await tick(150);
const b0 = QA.getRenderer().frameOf('badge');
await pull(c, c.at(b0.x, b0.y), c.at(b0.x - 200, b0.y - 100));
const b1 = QA.getRenderer().frameOf('badge');
out.held = { landed: [Math.round(b1.x - b0.x), Math.round(b1.y - b0.y)], written: lines('badge', ['x', 'y']) };
S().select([]); await tick(150);
pe(c.el, 'pointermove', c.at(500, -50).x, c.at(500, -50).y);
key('keydown', 'Shift', { shiftKey: true }); await tick(150);
out.lookAhead = S().time;
await pull(c, c.at(500, -50, 0), c.at(300, -50, 0), { shiftKey: true });
key('keyup', 'Shift'); await tick(300);
out.animated = { acts: acts('dot'), time: S().time };
out.error = S().error;
return out`,

  // Drawing and typing there: the Pencil's line, the Shape tool's corners, the Path tool starting a path, adding to it, dragging a point, and putting one in on the line, and a Text's editor over the Text where the Camera view shows it, at the size it shows.
  WORK2: `${HELP}
const out = {};
await start(${JSON.stringify(WORK)}, 'both', 'pencil');
const c = cam();
await pull(c, c.at(0, -100), c.at(300, -100));
S().setTool('select'); await tick(250);
out.pencil = { name: last().name, kind: last().className, frame: frame(last().name) };
S().setTool('shape'); S().setShapeMode('create'); S().select([]); await tick(200);
for (const p of [[-300, 300], [-200, 300], [-250, 400], [-300, 300]]) await press(c, c.at(p[0], p[1]));
S().setTool('select'); await tick(250);
out.shape = { name: last().name, kind: last().className, frame: frame(last().name) };
S().select(['box']); S().setTool('path'); S().setPathMode('edit'); await tick(250);
await press(c, c.at(150, -220));
out.pathStarted = { path: stmts('box', 'path'), selected: S().selectedActions };
await press(c, c.at(-300, -150));
await pull(c, c.at(150, -220), c.at(150, -160));
await press(c, c.at(25, -30));
out.pathEdited = stmts('box', 'path');
S().setTool('select'); S().select([]); await tick(200);
const t = c.at(200, 300);
c.panel.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: t.x, clientY: t.y }));
await tick(300);
const editor = document.querySelector('.preview-text-edit');
const er = editor?.getBoundingClientRect();
out.text = editor ? { offMiddle: [Math.round(er.left + er.width / 2 - t.x), Math.round(er.top + er.height / 2 - t.y)], sizeAsShown: Math.abs(parseFloat(editor.style.fontSize) - 72 * 1.5 * c.k) < 0.05, selected: S().selection } : null;
editor?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
await tick(200);
out.error = S().error;
return out`,

  // The camera by the wheel and the middle button, with Select in hand and something selected (D369): the wheel zooms the camera, the place under the pointer staying under it; a run of ticks is one undo step; Shift and the wheel leave the camera; the middle button drags it, the picture following the pointer; the selection stays through all of it. In a scene with no camera the wheel makes one, in the same undo step.
  WHEEL1: `${HELP}
const out = {};
await start(${JSON.stringify(PLAIN)}, 'both', 'select');
S().select(['dot']); await tick(150);
const c = cam();
const before = smp.viewAt(S().model, 0);
// 100 px right of the picture's middle and 40 below: the place of the scene there.
const under = (v) => { const a = (v.rotation * Math.PI) / 180; const px = 100 / c.k / v.zoom; const py = -40 / c.k / v.zoom; return { x: v.x + Math.cos(a) * px - Math.sin(a) * py, y: v.y + Math.sin(a) * px + Math.cos(a) * py } };
const was = under(before);
const source0 = S().source;
await wheel(c.cx + 100, c.cy + 40, -Math.log(2) / 0.003);
await wheel(c.cx + 100, c.cy + 40, -Math.log(2) / 0.003);
await tick(700);
const after = smp.viewAt(S().model, 0);
const is = under(after);
out.wheel = { zoom: r2(after.zoom), stillUnder: Math.hypot(is.x - was.x, is.y - was.y) < 2, written: lines('wide', ['x', 'y', 'zoom', 'rotation']), selection: S().selection, tool: S().tool };
await undo();
out.oneUndoForTheRun = S().source === source0;
await wheel(c.cx, c.cy, -300, { shiftKey: true });
await tick(500);
out.shiftLeavesIt = S().source === source0;
// The middle button, 60 px to the right: the camera goes the other way along its own roll.
pe(c.panel, 'pointerdown', c.cx, c.cy, { button: 1, buttons: 4 });
for (let i = 1; i <= 6; i++) { pe(c.el, 'pointermove', c.cx + i * 10, c.cy, { button: 1, buttons: 4 }); await tick(30) }
pe(c.el, 'pointerup', c.cx + 60, c.cy, { button: 1, buttons: 0 });
await tick(300);
const moved = smp.viewAt(S().model, 0);
const a = (before.rotation * Math.PI) / 180;
const want = { x: before.x - (Math.cos(a) * 60) / c.k / before.zoom, y: before.y - (Math.sin(a) * 60) / c.k / before.zoom };
out.middle = { asWanted: Math.hypot(moved.x - want.x, moved.y - want.y) < 1.5, zoom: r2(moved.zoom), selection: S().selection };
await start(${JSON.stringify(NOCAM)}, 'both', 'select');
const c2 = cam();
const source1 = S().source;
await wheel(c2.cx, c2.cy, -Math.log(2) / 0.0015);
await tick(700);
out.made = { camera: decl('camera'), selection: S().selection };
await undo();
out.madeUndone = S().source === source1;
out.error = S().error;
return out`,

  // A camera from the menus (D365). The timeline's Cameras section has Add camera in one click, with the time under the pointer, and Cut to; the other lanes, the space below the rows, the Objects pane's empty space, and the preview's in either view list Camera under Add. One added in the timeline begins where it was clicked, framed as the camera that travels is at that moment, with the playhead put there and the new one selected.
  ADD1: `${HELP}
const out = {};
await start(${JSON.stringify(SHOTS)}, 'both', 'select');
const x = timeX('wide');
out.lane = await menuAt(track(), x(5), 0);
top().find((b) => b.textContent.trim().startsWith('Add camera'))?.click();
await tick(400);
out.added = { camera: decl('camera'), selected: S().selection, time: S().time, who: who([4.9, 5, 9]), declaredLast: smp.camerasOf(S().model).at(-1).name, baseEnds: obj('wide').until };
await undo();
out.undone = smp.camerasOf(S().model).map((c) => c.name);
out.objectsLane = await menuAt(track('objects'), x(8), 0);
out.objectsLaneAdd = words(await sub('Add'));
await shut();
out.below = await menuAt(document.querySelector('.tl-rows'), x(8), 0);
out.belowAdd = words(await sub('Add'));
await shut();
const list = document.querySelector('.object-list');
const pr = list.getBoundingClientRect();
out.objectsPane = await menuAt(list, pr.left + 20, pr.bottom - 4);
out.objectsPaneAdd = words(await sub('Add'));
S().setTime(6); await tick(150);
await shut();
await menuAt(list, pr.left + 20, pr.bottom - 4);
(await sub('Add'))?.find((b) => b.textContent.trim() === 'Camera')?.click();
await tick(400);
out.fromThePane = { camera: decl('camera'), selected: S().selection, who: who([5.9, 6, 9]) };
await undo();
const w = document.querySelector('.preview-world').getBoundingClientRect();
out.preview = await menuAt(document.querySelector('.preview-world canvas'), w.left + 30, w.bottom - 60);
out.previewAdd = words(await sub('Add'));
await shut();
const cp = document.querySelector('.preview-camera').getBoundingClientRect();
out.cameraView = await menuAt(document.querySelector('.preview-camera'), cp.left + 12, cp.top + 12);
out.cameraViewAdd = words(await sub('Add'));
await shut();
out.error = S().error;
return out`,

  // Cuts (D365). A camera added while the one at the bottom has the picture leaves it whole and has the picture until the next shot begins; one added while a shot has the picture takes the rest of its span, and that shot ends there. Cut to a camera that begins later is a copy framed as it will begin; to one that has ended, as it ended; to the one at the bottom, still alive beneath, it ends what is over it. The cameras offered leave out the one that has the picture. A cut where one is says so.
  CUT2: `${HELP}
const out = {};
await start(${JSON.stringify(LATER)}, 'both', 'select');
out.add3 = ops.addCamera(3); await tick(250);
out.after3 = { cams: cams(), who: who([2, 3, 5.9, 6, 7.9, 8, 9]) };
out.add45 = ops.addCamera(4.5); await tick(250);
out.after45 = { cams: cams(), who: who([4, 4.5, 5.9, 6]) };
out.toLater = ops.cutToCamera('shotA', 5); await tick(250);
out.afterLater = { cams: cams(), who: who([4.9, 5, 5.9, 6, 8]) };
out.toBottom = ops.cutToCamera('wide', 5.5); await tick(250);
out.afterBottom = { cams: cams(), who: who([5.4, 5.5, 5.9, 6, 8]), selected: S().selection };
const source0 = S().source;
out.there = { result: ops.addCamera(5.495), notice: S().notice, same: S().source === source0 };
out.already = { result: ops.cutToCamera('wide', 5.6), notice: S().notice, same: S().source === source0 };
out.offered = { at5: ops.cutToItems(5.2).map((i) => i.label), at7: ops.cutToItems(7).map((i) => i.label) };
// From the menus: the Cameras section at 9 s, and a camera's own row and clip.
await start(${JSON.stringify(SHOTS)}, 'both', 'select');
const x = timeX('wide');
out.laneAt6 = await menuAt(track(), x(6), 0);
const to = await sub('Cut to');
out.laneCutTo = words(to);
to?.find((b) => b.textContent.trim() === 'close')?.click();
await tick(400);
out.backToClose = { cams: cams(), selected: S().selection, time: S().time, who: who([5.9, 6, 9]), view: view(6) };
const clip = clipOf('close2');
out.clipMenu = (await menuAt(clip.querySelector('.oclip-title') ?? clip, x(7), clip.getBoundingClientRect().top + 4)).filter((l) => l.startsWith('Cut'));
const to2 = await sub('Cut to');
out.clipCutTo = words(to2);
to2?.find((b) => b.textContent.trim() === 'wide')?.click();
await tick(400);
out.backToWide = { cams: cams(), selected: S().selection, time: S().time, who: who([6.9, 7, 9]) };
S().setObjectsView('type'); S().setTime(6.5); await tick(300);
const rowOf = (name) => [...document.querySelectorAll('.object.camera')].find((li) => li.querySelector('.name')?.textContent === name);
const rowMenu = async (name) => { const row = rowOf(name)?.querySelector('.object-row') ?? rowOf(name); const rr = row.getBoundingClientRect(); const labels = await menuAt(row, rr.left + 30, rr.top + 6); await shut(); return labels.filter((l) => l.startsWith('Cut')) };
out.rows = { holder: await rowMenu('close2'), other: await rowMenu('wide'), ended: await rowMenu('close') };
S().setObjectsView('layers'); S().setTime(0); await tick(200);
out.error = S().error;
return out`,

  // The razor on a camera's clip, and Cut at in its menu (D365, revising D363): the clip is cut in two, the move that runs across the cut is cut with it and the zoom after it goes to the second, so the picture is what it was at every moment; one undo takes it all back. The camera at the bottom is cut the same way, and is still what the shots come back to.
  RAZOR1: `${HELP}
const out = {};
await start(${JSON.stringify(RAZOR)}, 'both', 'select');
const times = [1, 2.5, 3.5, 4, 4.5, 5.5, 6.5, 7.5, 9];
const before = JSON.stringify(times.map(view));
const source0 = S().source;
S().setTimelineTool('razor'); await tick(200);
const clip = clipOf('shot');
const cr = clip.getBoundingClientRect();
const x = timeX('shot');
pe(clip.querySelector('.oclip-title'), 'pointerdown', x(4), cr.top + 6); await tick(60); pe(document.body, 'pointerup', x(4), cr.top + 6); await tick(400);
S().setTimelineTool('select'); await tick(200);
out.cut = { cams: cams(), moves: [...stmts('shot', 'move'), ...stmts('shot2', 'move')], zooms: [...stmts('shot', 'to'), ...stmts('shot2', 'to')], who: who([3.9, 4, 7.9, 8]), samePicture: JSON.stringify(times.map(view)) === before, selected: S().selection, time: S().time };
const level = (name) => parseFloat(clipOf(name).style.top);
out.sideBySide = level('shot') === level('shot2');
await undo();
out.oneUndo = S().source === source0;
// From the menu, on the camera at the bottom, at 2 s.
const base = clipOf('wide');
const bx = timeX('wide');
out.menu = (await menuAt(base.querySelector('.oclip-title') ?? base, bx(2), base.getBoundingClientRect().top + 4)).filter((l) => l.startsWith('Cut'));
top().find((b) => b.textContent.trim().startsWith('Cut at'))?.click();
await tick(400);
out.bottom = { cams: cams(), moves: [...stmts('wide', 'move'), ...stmts('wide2', 'move')], who: who([1.9, 2, 2.5, 8, 9]), samePicture: JSON.stringify(times.map(view)) === before, time: S().time };
// A camera added later leaves the second half, now at the bottom, to run on.
out.add9 = ops.addCamera(9); await tick(250);
out.after9 = { who: who([8.5, 9]), wide2Ends: obj('wide2').until };
// At the edge of a clip a cut changes nothing.
const source1 = S().source;
out.edge = { result: ops.cutCamera('wide2', 2), notice: S().notice, same: S().source === source1 };
out.error = S().error;
return out`,

  // Fit (D367): the frame of the camera that has the picture fills the Preview view, wherever in the scene it is; at another moment, another camera's; with none alive, the project's frame at the scene's middle. The zoom and Fit are what is left at the top right of the preview.
  FIT1: `${HELP}
const out = {};
await start(${JSON.stringify(FAR)}, 'both', 'select');
const fit = [...document.querySelectorAll('.preview-tools button')].find((b) => b.textContent.trim() === 'Fit');
const world = document.querySelector('.preview-world');
// Where the lit frame sits in the Preview view: its name is at its top left corner.
const shown = () => { const w = world.getBoundingClientRect(); const f = QA.getRenderer().cameras().find((c) => c.live); const tag = document.querySelector('.camera-tag.live')?.getBoundingClientRect(); const zoom = parseFloat(document.querySelector('.preview-tools').textContent); return { zoom, live: f?.name ?? null, frameOnScreen: f ? Math.round((f.frame.width * zoom) / 100) : null, roomForIt: Math.round(w.width), tagFromLeft: tag ? Math.round(tag.left - w.left) : null } };
fit.click(); await tick(300);
out.far = shown();
S().setTime(4); await tick(250);
out.notFollowed = shown();
fit.click(); await tick(300);
out.near = shown();
await setSource(${JSON.stringify(NOCAM)}); await tick(300);
fit.click(); await tick(300);
out.none = { zoom: parseFloat(document.querySelector('.preview-tools').textContent), frames: QA.getRenderer().cameras().length };
out.topRight = [...document.querySelectorAll('.preview-tools button')].map((b) => b.textContent.trim().replace(/[0-9]+%/, 'zoom'));
out.title = fit.title;
out.error = S().error;
return out`,

  // The preview's options in the pane's header (D371): what a click picks, the pin, Chain, Snap (D370), Show Paths, Show Masks, Edges, Collision, then the views; the one that is on is lit; Snap brings its two numbers; a right-click on any of it does nothing; the header is one row at this size.
  HEADER1: `${HELP}
const out = {};
await start(${JSON.stringify(PLAIN)}, 'both', 'select');
S().setPick('object'); S().setPin('start'); S().setChain(false); if (S().showPaths) S().toggleShowPaths(); if (S().showMasks) S().toggleShowMasks(); await tick(200);
const header = document.querySelector('.pane.center .pane-header');
const buttons = () => [...header.querySelectorAll('button')].map((b) => b.textContent.trim() + (b.classList.contains('active') || b.classList.contains('on') ? '*' : ''));
out.header = buttons();
out.oneRow = Math.round(header.getBoundingClientRect().height);
out.noGrid = !buttons().some((b) => b.startsWith('Grid'));
const snap = [...header.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Snap');
snap.click(); await tick(200);
out.snapOn = { on: S().previewSnap.on, lit: snap.classList.contains('on'), numbers: [...header.querySelectorAll('.num-field')].map((f) => f.title), title: snap.title };
snap.click(); await tick(200);
out.snapOff = { on: S().previewSnap.on, numbers: header.querySelectorAll('.num-field').length, title: snap.title };
const group = [...header.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Group');
group.click(); await tick(150);
out.pick = { pick: S().pick, header: buttons().slice(0, 3) };
S().setPick('object');
const paths = [...header.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Show Paths');
paths.click(); await tick(150);
out.paths = { on: S().showPaths, lit: paths.classList.contains('on') };
paths.click(); await tick(150);
const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
snap.dispatchEvent(ev); await tick(120);
out.rightClick = { menu: !!document.querySelector('.context-menu'), prevented: ev.defaultPrevented };
out.palette = [...document.querySelectorAll('.preview-palette button')].map((b) => b.getAttribute('aria-label'));
out.error = S().error;
return out`,
}
