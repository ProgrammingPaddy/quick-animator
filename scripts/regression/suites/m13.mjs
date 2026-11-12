// The camera's first and second looks (D365 to D380): every tool at work in the Camera view; the wheel and the middle button on the camera there; the Camera tool as Select for cameras; the cameras' frames shown when asked; a new camera from the menus; cuts as shots of a camera, and a clip's length; the razor on a camera's clip; Fit by the camera; the preview's options in the pane's header; and the menus folded into Lifetime and Properties.
const NL = String.fromCharCode(10)
// A camera moved, zoomed, and rolled, so nothing in the Camera view is where the scene has it.
const WIDE = ['', 'wide = Camera({', '  x: 200,', '  y: 100,', '  zoom: 1.5,', '  rotation: 12,', '})', '']
const WORK = ['box = Rect({', '  x: -100,', '  y: 100,', '  width: 240,', '  height: 140,', "  fill: '#4f8cff',", '})', '', 'dot = Circle({', '  x: 500,', '  y: -50,', '  radius: 80,', "  fill: '#f59e0b',", '})', '', 'title = Text({', "  text: 'Chapter one',", '  x: 200,', '  y: 300,', '  fontSize: 72,', '})', '', 'badge = Rect({', '  x: 500,', '  y: 250,', '  width: 120,', '  height: 60,', "  fill: '#ff0000',", '  attached: true,', '})', ...WIDE].join(NL)
const PLAIN = ['box = Rect({', '  x: -100,', '  y: 100,', '  width: 240,', '  height: 140,', "  fill: '#4f8cff',", '})', '', 'dot = Circle({', '  x: 500,', '  y: -50,', '  radius: 80,', "  fill: '#f59e0b',", '})', ...WIDE].join(NL)
const NOCAM = ['box = Rect({', '  x: -100,', '  y: 100,', '  width: 240,', '  height: 140,', "  fill: '#4f8cff',", '})', ''].join(NL)
// A camera for the whole scene that travels, and shots over it.
const BASE = ['backdrop = Rect({', '  width: 1920,', '  height: 1080,', "  fill: '#203040',", '  until: 12,', '})', '', 'wide = Camera({', '  x: 0,', '  y: 0,', '  zoom: 1,', '})', '', 'wide.move({', '  x: 600,', '  at: 0,', '  duration: 4,', "  ease: 'linear',", '})', '']
// A shot that has ended, having traveled and zoomed: how it ended is not how it began.
const SHOTS = [...BASE, 'close = Camera({', '  x: -300,', '  y: 100,', '  zoom: 4,', '  at: 2,', '  until: 4,', '})', '', 'close.to({', '  zoom: 2,', '  at: 2,', '  duration: 2,', "  ease: 'linear',", '})', ''].join(NL)
const RAZOR = [...BASE, 'shot = Camera({', '  x: 0,', '  y: 0,', '  zoom: 1,', '  at: 2,', '  until: 8,', '})', '', 'shot.move({', '  x: 400,', '  at: 3,', '  duration: 2,', "  ease: 'linear',", '})', '', 'shot.to({', '  zoom: 2,', '  at: 6,', '  duration: 1,', "  ease: 'linear',", '})', ''].join(NL)
const FAR = ['box = Rect({', '  x: 2400,', '  y: 900,', '  width: 240,', '  height: 140,', "  fill: '#4f8cff',", '  until: 8,', '})', '', 'far = Camera({', '  x: 2400,', '  y: 900,', '  zoom: 2,', '})', '', 'near = Camera({', '  x: 0,', '  y: 0,', '  zoom: 1,', '  at: 4,', '})', ''].join(NL)
// Two cameras alive at once in the Preview view: one for the whole scene, and a closer one inside its frame, with a box and a backdrop under both.
const TWO = ['backdrop = Rect({', '  width: 1920,', '  height: 1080,', "  fill: '#203040',", '  until: 8,', '})', '', 'box = Rect({', '  x: -600,', '  y: 300,', '  width: 240,', '  height: 140,', "  fill: '#4f8cff',", '  until: 6,', '})', '', 'wide = Camera({', '  x: 0,', '  y: 0,', '  zoom: 1,', '})', '', 'right = Camera({', '  x: 500,', '  y: -250,', '  zoom: 3,', '})', ''].join(NL)

const HELP = `
const r1 = (v) => Math.round(v * 10) / 10;
const r2 = (v) => Math.round(v * 100) / 100;
const who = (ts) => ts.map((t) => smp.cameraAt(S().model, t)?.name ?? null);
const view = (t) => { const v = smp.viewAt(S().model, t); return [r1(v.x), r1(v.y), r2(v.zoom), r1(v.rotation)] };
// Every check begins the same: the Preview view fitted on a scene with no camera, so the project's frame at the scene's middle is what it shows, whatever camera the project opened with (D367); the cameras shown, since some read their frames and names; and a camera's clip two seconds long.
const start = async (source, shown, tool) => { S().setPreviewView(shown); S().setPreviewSplit(0.5); await setSource(''); [...document.querySelectorAll('.preview-tools button')].find((b) => b.textContent.trim() === 'Fit')?.click(); await tick(150); await setSource(source); S().setTool(tool); S().setTimelineTool('select'); S().select([]); S().setTransformMode('all'); S().setAnchor('center'); if (S().collide) S().setCollide(false); if (!S().showCameras) S().toggleShowCameras(); S().setPrefs({ cameraLength: 2 }); S().setObjectsView('layers'); S().setTime(0); await tick(500) };
// The Camera view: its picture on the screen, and where a place in the scene shows in it, through the camera.
const cam = () => { const el = document.querySelector('.preview'); const panel = document.querySelector('.preview-camera'); const r = document.querySelector('.preview-camera canvas').getBoundingClientRect(); const k = r.width / 1920; const at = (wx, wy, t = S().time) => { const v = smp.viewAt(S().model, t); const a = (v.rotation * Math.PI) / 180; const dx = (wx - v.x) * v.zoom; const dy = (wy - v.y) * v.zoom; return { x: r.left + r.width / 2 + (Math.cos(a) * dx + Math.sin(a) * dy) * k, y: r.top + r.height / 2 - (-Math.sin(a) * dx + Math.cos(a) * dy) * k } }; return { el, panel, r, k, at, cx: r.left + r.width / 2, cy: r.top + r.height / 2 } };
// The Preview view: where a place in the scene is on the screen, and the place in the scene of a place on the screen, as the view itself has them.
const world = () => { const el = document.querySelector('.preview'); const b = el.getBoundingClientRect(); const v = QA.getViewport(); return { el, panel: el, r: document.querySelector('.preview-world').getBoundingClientRect(), at: (wx, wy) => { const p = v.toPane(wx, wy); return { x: b.left + p.x, y: b.top + p.y } }, back: (x, y) => v.toWorld(x - b.left, y - b.top) } };
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
const word = (b) => b.textContent.replace('▸', '').replace(/\\s+/g, ' ').trim();
const menuAt = async (el, x, y) => { el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 })); await tick(200); return top().map(word) };
const sub = async (label) => { const b = top().find((x) => word(x).startsWith(label)); if (!b) return null; b.parentElement.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })); await tick(200); return [...document.querySelectorAll('.context-menu.submenu button')] };
const words = (buttons) => buttons?.map(word) ?? null;
const shut = async () => { if (document.querySelector('.context-menu')) { S().closeMenu(); await tick(150) } };
// The timeline's Cameras section: its track, a clip, and the place on the screen of a time.
const track = (lane = 'cameras') => document.querySelector('.tl-row.lane[data-lane="' + lane + '"] .tl-track');
const clipOf = (name, lane = 'cameras') => document.querySelector('.tl-row.lane[data-lane="' + lane + '"] .oclip[data-object="' + name + '"]');
const timeX = (name) => { const clip = clipOf(name); const cr = clip.getBoundingClientRect(); const per = cr.width / (Number(clip.dataset.end) - Number(clip.dataset.start)); return (t) => cr.left + (t - Number(clip.dataset.start)) * per };
const tags = () => [...document.querySelectorAll('.camera-tag.shown')].map((t) => t.dataset.camera);
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

  // The Camera tool is Select for cameras alone (D373). Taken up, it selects nothing. A press inside a frame picks that camera, the smaller frame where two hold the place, and a drag moves it and nothing under it; a corner of a picked camera zooms it. Empty space lets go, and a drag from there moves nothing, where it used to move the camera; a box drawn from there takes the cameras it touches. An object is not picked, and one that is selected has no handles. In the Camera view a drag is a drag of the camera that has the picture, which is selected. With no camera the tool makes none.
  TOOL3: `${HELP}
const out = {};
await start(${JSON.stringify(TWO)}, 'both', 'camera');
const w = world();
out.takenUp = S().selection;
await press(w, w.at(500, -250));
out.inside = S().selection;
await pull(w, w.at(500, -250), w.at(600, -150));
out.dragged = { right: lines('right', ['x', 'y', 'zoom']), wide: lines('wide', ['x', 'y', 'zoom']), backdropMoved: (decl('backdrop') ?? '').includes('x:') };
await press(w, w.at(-700, 400));
out.theLarger = S().selection;
// The box is under that press too, inside the wide camera's frame: it is the camera that is picked.
await press(w, w.at(-600, 300));
out.overTheBox = S().selection;
// Past every frame: a click lets go, and a drag moves nothing.
await press(w, w.at(1100, 620));
out.empty = S().selection;
const source0 = S().source;
await pull(w, w.at(1100, 620), w.at(1180, 560));
out.dragFromEmpty = { same: S().source === source0, selection: S().selection };
// A box drawn from there around the closer camera's frame takes it, and the wide camera whose frame it touches.
await pull(w, w.at(1100, 620), w.at(400, -100));
out.boxed = S().selection;
// A corner of the picked camera: 640 by 360 around 600, -150, out to twice as far from its middle.
S().select(['right']); await tick(250);
await pull(w, w.at(600 + 320, -150 + 180), w.at(600 + 640, -150 + 360));
out.zoomed = lines('right', ['x', 'y', 'zoom']);
// An object selected, with this tool: shown, with no handle to take.
S().select(['box']); await tick(250);
const f = QA.getRenderer().frameOf('box');
const source1 = S().source;
await pull(w, w.at(f.x + f.width / 2, f.y + f.height / 2), w.at(f.x + f.width, f.y + f.height));
out.objectHasNoHandles = lines('box', ['width', 'height']);
// The Camera view: the picture is the camera that has it.
S().select([]); await tick(200);
const c = cam();
const before = view(0);
await pull(c, { x: c.cx, y: c.cy }, { x: c.cx + 30, y: c.cy });
const after = view(0);
out.inItsOwnView = { selection: S().selection, went: [Math.round(after[0] - before[0]) < 0, after[1] === before[1]] };
await start(${JSON.stringify(NOCAM)}, 'both', 'camera');
const c2 = cam();
const bare = S().source;
await pull(c2, { x: c2.cx, y: c2.cy }, { x: c2.cx - 40, y: c2.cy });
out.makesNone = { same: S().source === bare, notice: S().notice };
out.error = S().error;
return out`,

  // Show Cameras (D374): off, no camera wears its frame or its name in the Preview view, and Select picks none by its line; a camera that is selected shows; the Camera tool shows them all. On, each camera alive shows, the button is lit, and Select picks one by its line.
  SHOW1: `${HELP}
const out = {};
await start(${JSON.stringify(TWO)}, 'both', 'select');
const button = () => [...document.querySelectorAll('.preview-options button')].find((b) => b.textContent.trim() === 'Show Cameras');
const shown = () => ({ names: tags(), frames: QA.getRenderer().cameras().filter((c) => c.shown).map((c) => c.name), lit: button().classList.contains('on') });
out.on = shown();
const w = world();
// The line of the closer camera's frame, at its right edge.
await press(w, w.at(500 + 320, -250));
out.pickedByLine = S().selection;
S().select([]);
button().click(); await tick(300);
out.off = { ...shown(), kept: localStorage.getItem('quick-animator.showCameras'), title: button().title };
await press(w, w.at(500 + 320, -250));
out.notPickedByLine = S().selection;
S().select(['right']); await tick(250);
out.selectedShows = shown();
S().select([]); S().setTool('camera'); await tick(250);
out.theToolShowsAll = shown();
S().setTool('select'); await tick(200);
button().click(); await tick(250);
out.onAgain = { ...shown(), title: button().title };
out.error = S().error;
return out`,

  // A new camera from the menus (D376). The timeline's Cameras section has Add camera in one click, with the time under the pointer, and Cut to; the other lanes, the space below the rows, the Objects pane's empty space, and the preview's in either view list Camera under Add. A camera added is one of its own: it looks at the scene's middle, not at what the picture was, lasts two seconds, and is selected, with the playhead put where it begins in the timeline. Added in the preview it looks at the place under the pointer.
  ADD1: `${HELP}
const out = {};
await start(${JSON.stringify(SHOTS)}, 'both', 'select');
const x = timeX('wide');
out.lane = await menuAt(track(), x(5), 0);
top().find((b) => word(b).startsWith('Add camera'))?.click();
await tick(400);
out.added = { camera: decl('camera'), selected: S().selection, time: S().time, who: who([4.9, 5, 6.9, 7]), declaredLast: smp.camerasOf(S().model).at(-1).name, wideEnds: obj('wide').until };
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
(await sub('Add'))?.find((b) => word(b) === 'Camera')?.click();
await tick(400);
out.fromThePane = { camera: decl('camera'), selected: S().selection, who: who([5.9, 6, 7.9, 8]) };
await undo();
// The preview, past the frame's left edge, where nothing is under the pointer: the camera looks at that place.
const w = world();
const p = { x: w.r.left + 12, y: w.r.bottom - 30 };
out.preview = await menuAt(document.querySelector('.preview-world canvas'), p.x, p.y);
const add = await sub('Add');
out.previewAdd = words(add);
add?.find((b) => word(b) === 'Camera')?.click();
await tick(400);
const made = smp.camerasOf(S().model).at(-1);
const want = w.back(p.x, p.y);
out.atThePointer = { name: made.name, at: made.at, until: made.until, zoom: made.attrs.zoom, there: Math.abs(made.attrs.x - want.x) <= 1 && Math.abs(made.attrs.y - want.y) <= 1, selected: S().selection };
await undo();
const cp = document.querySelector('.preview-camera').getBoundingClientRect();
out.cameraView = await menuAt(document.querySelector('.preview-camera'), cp.left + 12, cp.top + 12);
out.cameraViewAdd = words(await sub('Add'));
await shut();
out.error = S().error;
return out`,

  // Cuts (D377, D378). Cut to offers each camera once, and not the one that has the picture. To a camera that has ended it is a new shot of it, named after it, framed as it ended, two seconds long. To the camera at the bottom, still running under the rest, it cuts the clip over it and makes nothing. A new clip never runs past the next cut, and a shot it covers to its end is ended where it begins, while one that outlasts it comes back after. The next shot of a camera takes after its latest. With no length in the preferences a clip lasts until the picture next changes hands; and no clip of a set length runs past the scene's end.
  CUT2: `${HELP}
const out = {};
await start(${JSON.stringify(SHOTS)}, 'both', 'select');
out.offered = { at3: ops.cutToItems(3).map((i) => i.label), at6: ops.cutToItems(6).map((i) => i.label) };
out.toClose = ops.cutToCamera('close', 6); await tick(250);
out.afterClose = { cams: cams(), who: who([5.9, 6, 7.9, 8]), selected: S().selection };
const source0 = S().source;
out.again = { result: ops.cutToCamera('close', 7), notice: S().notice, same: S().source === source0, offered: ops.cutToItems(7).map((i) => i.label) };
// A new camera inside that shot, at 7 s: it has the rest of the shot's span, and the shot ends there.
out.added = ops.addCamera(7, { x: 400, y: -200 }); await tick(250);
out.afterAdd = { cams: cams(), who: who([6.9, 7, 7.9, 8]) };
// To the camera at the bottom, at 7.5 s.
out.toWide = ops.cutToCamera('wide', 7.5); await tick(250);
out.afterWide = { cams: cams(), who: who([7.4, 7.5, 9]), selected: S().selection };
// The last shot of close zoomed in; the next shot of close, cut to from that shot's own name, takes after it.
ops.setObjectProp('close_shot2', 'zoom', 5); await tick(250);
out.toCloseAgain = ops.cutToCamera('close_shot2', 9); await tick(250);
out.afterAgain = { cams: cams(), who: who([8.9, 9, 10.9, 11]) };
// The next cut is protected: a camera added half a second before that shot lasts until it.
out.before9 = ops.addCamera(8.5); await tick(250);
out.before9Life = cams().filter((c) => c[0] === out.before9).map((c) => [c[1], c[2]]);
const source1 = S().source;
out.there = { result: ops.addCamera(8.995), notice: S().notice, same: S().source === source1 };
// A long shot over the bottom camera: a cut inside it is a cutaway, and the long shot comes back after.
await start(${JSON.stringify([...BASE, 'long = Camera({', '  x: 300,', '  y: 0,', '  zoom: 2,', '  at: 2,', '  until: 9,', '})', '', 'side = Camera({', '  x: -400,', '  y: 200,', '  zoom: 3,', '  at: 10,', '})', ''].join(NL))}, 'both', 'select');
out.cutaway = ops.cutToCamera('side', 4); await tick(250);
out.afterCutaway = { cams: cams(), who: who([3.9, 4, 5.9, 6, 8.9, 9]) };
// The scene ends at 12 s: a camera added at 11 s ends there, not a second past it.
out.atTheEnd = ops.addCamera(11); await tick(250);
out.atTheEndLife = cams().filter((c) => c[0] === out.atTheEnd).map((c) => [c[1], c[2]]);
await undo();
// No length set: a clip lasts until the picture next changes hands, which here is where side begins.
S().setPrefs({ cameraLength: null });
out.open = ops.addCamera(9.5); await tick(250);
out.openLife = cams().filter((c) => c[0] === out.open).map((c) => [c[1], c[2]]);
S().setPrefs({ cameraLength: 2 });
out.preference = S().prefs.cameraLength;
out.error = S().error;
return out`,

  // The same from the menus: the Cameras section's Cut to, a camera's clip, a camera's row. A shot's row offers no cut to its own camera while another shot of it has the picture.
  CUT3: `${HELP}
const out = {};
await start(${JSON.stringify(SHOTS)}, 'both', 'select');
const x = timeX('wide');
out.laneAt6 = await menuAt(track(), x(6), 0);
const to = await sub('Cut to');
out.laneCutTo = words(to);
to?.find((b) => word(b) === 'close')?.click();
await tick(400);
out.backToClose = { cams: cams(), selected: S().selection, time: S().time, who: who([5.9, 6, 7.9, 8]), view: view(6) };
const clip = clipOf('close_shot2');
out.clipMenu = (await menuAt(clip.querySelector('.oclip-title') ?? clip, x(7), clip.getBoundingClientRect().top + 4)).filter((l) => l.startsWith('Cut'));
const to2 = await sub('Cut to');
out.clipCutTo = words(to2);
to2?.find((b) => word(b) === 'wide')?.click();
await tick(400);
out.backToWide = { cams: cams(), selected: S().selection, time: S().time, who: who([6.9, 7, 9]) };
S().setObjectsView('type'); S().setTime(6.5); await tick(300);
const rowOf = (name) => [...document.querySelectorAll('.object.camera')].find((li) => li.querySelector('.name')?.textContent === name);
const rowMenu = async (name) => { const row = rowOf(name)?.querySelector('.object-row') ?? rowOf(name); const rr = row.getBoundingClientRect(); const labels = await menuAt(row, rr.left + 30, rr.top + 6); await shut(); return labels.filter((l) => l.startsWith('Cut')) };
out.rows = { theShotThatHasIt: await rowMenu('close_shot2'), itsCamera: await rowMenu('close'), another: await rowMenu('wide') };
S().setObjectsView('layers'); S().setTime(0); await tick(200);
out.error = S().error;
return out`,

  // The razor on a camera's clip, and Cut at in its menu (D365, D377): the clip is cut in two, the second half the camera's next shot by its name; the move that runs across the cut is cut with it and the zoom after it goes to the second, so the picture is what it was at every moment; one undo takes it all back. The camera at the bottom is cut the same way, and is still what the shots come back to.
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
out.cut = { cams: cams(), moves: [...stmts('shot', 'move'), ...stmts('shot_shot2', 'move')], zooms: [...stmts('shot', 'to'), ...stmts('shot_shot2', 'to')], who: who([3.9, 4, 7.9, 8]), samePicture: JSON.stringify(times.map(view)) === before, selected: S().selection, time: S().time };
const level = (name) => parseFloat(clipOf(name).style.top);
out.sideBySide = level('shot') === level('shot_shot2');
await undo();
out.oneUndo = S().source === source0;
// From the menu, on the camera at the bottom, at 2 s.
const base = clipOf('wide');
const bx = timeX('wide');
out.menu = (await menuAt(base.querySelector('.oclip-title') ?? base, bx(2), base.getBoundingClientRect().top + 4)).filter((l) => l.startsWith('Cut'));
top().find((b) => word(b).startsWith('Cut at'))?.click();
await tick(400);
out.bottom = { cams: cams(), moves: [...stmts('wide', 'move'), ...stmts('wide_shot2', 'move')], who: who([1.9, 2, 2.5, 8, 9]), samePicture: JSON.stringify(times.map(view)) === before, time: S().time };
// Cut again, the second half's second half is the camera's third shot.
out.third = ops.cutCamera('wide_shot2', 10); await tick(250);
// A camera added later leaves the camera at the bottom to run on.
out.add9 = ops.addCamera(9); await tick(250);
out.after9 = { who: who([8.5, 9, 10.9, 11]), bottomEnds: obj('wide_shot2').until };
// At the edge of a clip a cut changes nothing.
const source1 = S().source;
out.edge = { result: ops.cutCamera('wide_shot2', 2), notice: S().notice, same: S().source === source1 };
out.error = S().error;
return out`,

  // Fit (D367): the frame of the camera that has the picture fills the Preview view, wherever in the scene it is; at another moment, another camera's; with none alive, the project's frame at the scene's middle. The zoom and Fit are what is left at the top right of the preview.
  FIT1: `${HELP}
const out = {};
await start(${JSON.stringify(FAR)}, 'both', 'select');
const fit = [...document.querySelectorAll('.preview-tools button')].find((b) => b.textContent.trim() === 'Fit');
const worldEl = document.querySelector('.preview-world');
// Where the lit frame sits in the Preview view: its name is at its top left corner.
const shown = () => { const w = worldEl.getBoundingClientRect(); const f = QA.getRenderer().cameras().find((c) => c.live); const tag = document.querySelector('.camera-tag.live')?.getBoundingClientRect(); const zoom = parseFloat(document.querySelector('.preview-tools').textContent); return { zoom, live: f?.name ?? null, frameOnScreen: f ? Math.round((f.frame.width * zoom) / 100) : null, roomForIt: Math.round(w.width), tagFromLeft: tag ? Math.round(tag.left - w.left) : null } };
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

  // The preview's options in the pane's header (D371, D374): what a click picks, the pin, Chain, Snap (D370), Show Paths, Show Masks, Show Cameras, Edges, Collision, then the views, which keep the header's top right corner while the options wrap under them; the one that is on is lit; Snap brings its two numbers without the header growing; a right-click on any of it does nothing.
  HEADER1: `${HELP}
const out = {};
await start(${JSON.stringify(PLAIN)}, 'both', 'select');
S().setPick('object'); S().setPin('start'); S().setChain(false); if (S().showPaths) S().toggleShowPaths(); if (S().showMasks) S().toggleShowMasks(); if (S().showCameras) S().toggleShowCameras(); await tick(200);
const header = document.querySelector('.pane.center .pane-header');
const named = () => [...header.querySelectorAll('.preview-modes button, .preview-options > button, .preview-views button')].map((b) => b.textContent.trim() + (b.classList.contains('active') || b.classList.contains('on') ? '*' : ''));
const shape = () => { const h = header.getBoundingClientRect(); const v = header.querySelector('.preview-views').getBoundingClientRect(); return { height: Math.round(h.height), rows: new Set([...header.querySelectorAll('.preview-options > *')].map((b) => Math.round(b.getBoundingClientRect().top - h.top))).size, viewsAtTheTopRight: Math.round(v.top - h.top) <= 4 && Math.round(h.right - v.right) <= 8 } };
out.header = named();
out.shape = shape();
out.noGrid = !named().some((b) => b.startsWith('Grid'));
const find = (text) => [...header.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const snap = find('Snap');
snap.click(); await tick(200);
out.snapOn = { on: S().previewSnap.on, lit: snap.classList.contains('on'), numbers: [...header.querySelectorAll('.num-field')].map((f) => f.title), title: snap.title, shape: shape() };
snap.click(); await tick(200);
out.snapOff = { on: S().previewSnap.on, numbers: header.querySelectorAll('.num-field').length, title: snap.title };
find('Group').click(); await tick(150);
out.pick = { pick: S().pick, header: named().slice(0, 3) };
S().setPick('object');
const paths = find('Show Paths');
paths.click(); await tick(150);
out.paths = { on: S().showPaths, lit: paths.classList.contains('on') };
paths.click(); await tick(150);
const cameras = find('Show Cameras');
cameras.click(); await tick(150);
out.cameras = { on: S().showCameras, lit: cameras.classList.contains('on') };
cameras.click(); await tick(150);
const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
snap.dispatchEvent(ev); await tick(120);
out.rightClick = { menu: !!document.querySelector('.context-menu'), prevented: ev.defaultPrevented };
out.palette = [...document.querySelectorAll('.preview-palette button')].map((b) => b.getAttribute('aria-label'));
out.error = S().error;
return out`,

  // The menus, folded (D379, D375): in the preview an object's menu has Properties, with its classes, its links, Attach to camera, and how it takes a push; in the Objects pane and the timeline a row's and a clip's have Lifetime and Properties, in one order; a camera's have them too, with its cuts; the timeline's Properties attaches a thing to the camera; what is hidden is unhidden, by the menu's word and the eye's.
  MENU2: `${HELP}
const out = {};
await start(${JSON.stringify(TWO)}, 'both', 'select');
S().setTime(1); await tick(200);
const w = world();
const b = w.at(-600, 300);
const canvas = document.querySelector('.preview-world canvas');
out.preview = await menuAt(canvas, b.x, b.y);
out.previewProperties = words(await sub('Properties'));
(await sub('Properties'))?.find((x) => word(x) === 'Attach to camera')?.click();
await tick(300);
out.attachedInThePreview = (decl('box') ?? '').includes('attached: true');
const b2 = QA.getRenderer().frameOf('box');
await menuAt(canvas, w.at(b2.x, b2.y).x, w.at(b2.x, b2.y).y);
out.thenItSays = words(await sub('Properties'));
await shut();
await undo();
// The Objects pane.
const row = (name) => [...document.querySelectorAll('.object-list .object-row')].find((r) => r.querySelector('.name')?.textContent === name);
const rowMenu = async (el) => { const rr = el.getBoundingClientRect(); return await menuAt(el, rr.left + 30, rr.top + 6) };
out.row = await rowMenu(row('box'));
out.rowLifetime = words(await sub('Lifetime'));
out.rowProperties = words(await sub('Properties'));
await shut();
const eye = row('box').querySelector('.eye');
out.eye = eye.title;
eye.click(); await tick(250);
out.hidden = { eye: row('box').querySelector('.eye').title, menu: (await rowMenu(row('box'))).filter((l) => l === 'Hide' || l === 'Unhide' || l === 'Show') };
top().find((x) => word(x) === 'Unhide')?.click(); await tick(250);
out.unhidden = S().hidden;
S().setObjectsView('type'); await tick(300);
const camRow = [...document.querySelectorAll('.object.camera')].find((li) => li.querySelector('.name')?.textContent === 'wide').querySelector('.object-row');
out.cameraRow = await rowMenu(camRow);
out.cameraRowLifetime = words(await sub('Lifetime'));
out.cameraRowProperties = words(await sub('Properties'));
await shut();
S().setObjectsView('layers'); await tick(200);
// The timeline.
const clipMenu = async (name, lane) => { const c = clipOf(name, lane); const r = c.getBoundingClientRect(); return await menuAt(c.querySelector('.oclip-title') ?? c, r.left + 40, r.top + 4) };
out.clip = await clipMenu('box', 'objects');
out.clipLifetime = words(await sub('Lifetime')).map((l) => l.replace(/ [0-9:]+$/, ''));
out.clipProperties = words(await sub('Properties'));
(await sub('Properties'))?.find((x) => word(x) === 'Attach to camera')?.click();
await tick(300);
out.attachedInTheTimeline = (decl('box') ?? '').includes('attached: true');
await undo();
out.cameraClip = (await clipMenu('right', 'cameras')).map((l) => l.replace(/ [0-9:]+$/, ''));
out.cameraClipLifetime = words(await sub('Lifetime')).map((l) => l.replace(/ [0-9:]+$/, ''));
out.cameraClipProperties = words(await sub('Properties'));
await shut();
// End at, from the Lifetime of the row, at the playhead.
await rowMenu(row('box'));
(await sub('Lifetime'))?.find((x) => word(x).startsWith('End at'))?.click();
await tick(300);
out.endedAtThePlayhead = lines('box', ['until']);
out.words = { attach: ops.attachMenuItems(['box']).map((i) => i.label), hide: ops.hideMenuItems(['box']).map((i) => i.label) };
S().select([]);
out.error = S().error;
return out`,
}
