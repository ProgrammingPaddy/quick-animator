// The camera and the background (D357 to D364): which camera has the picture, the preview's two views, the Camera tool, a camera picked by its frame, things held on the screen, the Cameras section and its razor, and what the panes say.
const NL = String.fromCharCode(10)
const SCENE = ['backdrop = Rect({', '  width: 1920,', '  height: 1080,', "  fill: '#203040',", '  until: 8,', '})', '', 'box = Rect({', '  x: -300,', '  y: 100,', '  width: 240,', '  height: 140,', "  fill: '#4f8cff',", '})', ''].join(NL)
const WIDE = ['', 'wide = Camera({', '  x: 0,', '  y: 0,', '  zoom: 2,', '})', ''].join(NL)
// A second camera over the first for a while, and a mask declared after both.
const TWO = SCENE + ['', 'wide = Camera({', '  x: 100,', '  y: 0,', '  zoom: 2,', '})', '', 'close = Camera({', '  x: -300,', '  y: 100,', '  zoom: 4,', '  rotation: 90,', '  at: 2,', '  until: 4,', '})', '', 'window = Circle({', '  radius: 300,', "  masks: 'below',", '})', ''].join(NL)
// A camera that travels, and a text held on the screen.
const HELD = SCENE + ['', 'label = Text({', "  text: 'Held',", '  x: -700,', '  y: 400,', '  fontSize: 60,', '  attached: true,', '})', '', 'wide = Camera({', '  x: 0,', '  y: 0,', '  zoom: 1,', '})', '', 'wide.move({', '  x: 600,', '  at: 0,', '  duration: 4,', "  ease: 'linear',", '})', ''].join(NL)

const HELP = `
const r2 = (v) => Math.round(v * 100) / 100;
const who = (t) => smp.cameraAt(S().model, t)?.name ?? null;
const view = (t) => { const v = smp.viewAt(S().model, t); return { x: r2(v.x), y: r2(v.y), zoom: r2(v.zoom), rotation: r2(v.rotation) } };
// The Preview view's own part of the pane, fitted: the scene's middle at its middle.
const wgeom = () => { const el = document.querySelector('.preview'); const r = document.querySelector('.preview-world').getBoundingClientRect(); const zoom = Math.max(Math.min((r.width - 80) / 1920, (r.height - 80) / 1080), 0.02); return { el, r, zoom, sx: (wx) => r.left + r.width / 2 + wx * zoom, sy: (wy) => r.top + r.height / 2 - wy * zoom } };
// The Camera view's picture: its middle, and how many of its pixels one of the project's is.
const cgeom = () => { const r = document.querySelector('.preview-camera canvas').getBoundingClientRect(); return { el: document.querySelector('.preview'), panel: document.querySelector('.preview-camera'), r, k: r.width / 1920, cx: r.left + r.width / 2, cy: r.top + r.height / 2 } };
const start = async (source, shown, tool) => { await setSource(source); S().setPreviewView(shown); S().setTool(tool); S().select([]); S().setTransformMode('all'); S().setAnchor('center'); if (S().collide) S().setCollide(false); S().setTime(0); await tick(500) };
// A drag between two places on the screen, begun on an element and carried on the pane.
const pull = async (onEl, from, to, extra = {}) => { const el = document.querySelector('.preview'); pe(onEl, 'pointerdown', from.x, from.y, extra); for (let i = 1; i <= 6; i++) { pe(el, 'pointermove', from.x + ((to.x - from.x) * i) / 6, from.y + ((to.y - from.y) * i) / 6, extra); await tick(30) } pe(el, 'pointerup', to.x, to.y, extra); await tick(280) };
const tail = (name) => S().source.slice(S().source.indexOf(name + ' = Camera'));
const acts = (name) => obj(name).actions.map((a) => [a.verb, a.start, a.end, Object.fromEntries(Object.entries(a.changes).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : 'fn']))]);
`

export default {
  // Which camera has the picture: the highest one alive; the one beneath again when it ends; the scene's middle with none. A mask's words do not reach a camera, and nothing is noted.
  VIEW1: `${HELP}
const out = {};
await start(${JSON.stringify(TWO)}, 'preview', 'select');
out.who = [0, 1.99, 2, 3.99, 4, 6].map(who);
out.views = [view(1), view(3)];
out.maskTargets = S().model.masks[0].targets;
out.warnings = S().model.warnings.map((w) => w.message);
out.kinds = S().model.objects.map((o) => o.className);
await setSource(${JSON.stringify(SCENE + ['', 'late = Camera({', '  x: 50,', '  zoom: 2,', '  at: 2,', '  until: 3,', '})', ''].join(NL))});
out.gaps = { who: [0, 2.5, 5].map(who), views: [view(0), view(2.5), view(5)] };
await setSource(${JSON.stringify(SCENE)});
out.none = { who: who(1), view: view(1), frames: QA.getRenderer().cameras().length };
return out`,

  // The preview's views: C goes round them, the switch in the header lights the one that is on, each view wears its name, the Camera view's picture keeps the project's proportions, and the line between the two drags.
  VIEW2: `${HELP}
const out = {};
await start(${JSON.stringify(SCENE + WIDE)}, 'preview', 'select');
const seen = () => ({ view: S().previewView, lit: [...document.querySelectorAll('.preview-views button')].filter((b) => b.classList.contains('active')).map((b) => b.textContent.trim()), world: document.querySelector('.preview-world').getBoundingClientRect().width > 0, camera: getComputedStyle(document.querySelector('.preview-camera')).display !== 'none', names: [...document.querySelectorAll('.view-tag')].filter((t) => t.getBoundingClientRect().width > 0).map((t) => t.textContent.replace(/\\s+/g, ' ').trim()) });
out.first = seen();
const round = [];
for (let i = 0; i < 3; i++) { key('keydown', 'KeyC'); await tick(350); round.push(seen()) }
out.round = round;
S().setPreviewView('both'); await tick(450);
const host = document.querySelector('.preview').getBoundingClientRect();
const c = cgeom();
out.both = { worldShare: r2(document.querySelector('.preview-world').getBoundingClientRect().width / host.width), proportions: r2(c.r.width / c.r.height), insideItsPart: c.r.left >= host.left + host.width / 2 - 1 && c.r.right <= host.right + 1 };
// The line between them, dragged to a third of the pane.
const line = document.querySelector('.preview-divider');
const lr = line.getBoundingClientRect();
pe(line, 'pointerdown', lr.left + 3, lr.top + 200);
pe(line, 'pointermove', host.left + host.width * 0.33, lr.top + 200);
pe(line, 'pointerup', host.left + host.width * 0.33, lr.top + 200);
await tick(450);
out.dragged = { split: r2(S().previewSplit), worldShare: r2(document.querySelector('.preview-world').getBoundingClientRect().width / host.width) };
S().setPreviewSplit(0.5); S().setPreviewView('preview'); await tick(300);
// The frame in the Preview view sits where the camera puts it, and the camera wears its name there.
out.frame = QA.getRenderer().cameras();
out.name = [...document.querySelectorAll('.camera-tag')].map((el) => ({ text: el.textContent.trim(), cls: el.className }));
return out`,

  // The Camera tool in the Camera view: a drag moves the picture, so the camera goes the other way by the picture's scale and its zoom; the wheel zooms, the place under the pointer staying under it. In a scene with no camera the first press makes one, in one undo step with what the drag does.
  TOOL1: `${HELP}
const out = {};
await start(${JSON.stringify(SCENE + WIDE)}, 'both', 'camera');
out.inHand = S().selection;
const c = cgeom();
await pull(c.panel, { x: c.cx, y: c.cy }, { x: c.cx + 60, y: c.cy + 30 });
out.afterDrag = { decl: decl('wide'), expected: { x: Math.round(-60 / c.k / 2), y: Math.round(30 / c.k / 2) } };
// The wheel, 100 px right of the picture's middle: twice as close, and that place still under the pointer.
const before = view(0);
const under = { x: before.x + 100 / c.k / before.zoom, y: before.y };
document.querySelector('.preview-camera canvas').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: c.cx + 100, clientY: c.cy, deltaY: -Math.log(2) / 0.0015 }));
await tick(700);
const after = view(0);
out.afterWheel = { decl: decl('wide'), zoom: after.zoom, stillUnder: Math.abs(after.x + 100 / c.k / after.zoom - under.x) < 1.5 };
// With another tool the Camera view only shows.
S().setTool('select'); S().select([]); await tick(200);
const was = decl('wide');
await pull(c.panel, { x: c.cx, y: c.cy }, { x: c.cx + 60, y: c.cy + 30 });
document.querySelector('.preview-camera canvas').dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: c.cx, clientY: c.cy, deltaY: -200 }));
await tick(300);
out.onlyShows = decl('wide') === was && S().selection.length === 0;
// No camera yet: the tool's first drag makes one and moves it; one undo takes both away.
await start(${JSON.stringify(SCENE)}, 'both', 'camera');
const c2 = cgeom();
await pull(c2.panel, { x: c2.cx, y: c2.cy }, { x: c2.cx - 40, y: c2.cy });
out.made = { decl: decl('camera'), selected: S().selection, expectedX: Math.round(40 / c2.k) };
key('keydown', 'KeyZ', { ctrlKey: true }); await tick(400);
out.undone = S().model.objects.map((o) => o.name);
return out`,

  // In the Preview view: the Camera tool drags the frame from anywhere, and a corner dragged out to twice as far halves the zoom, the middle kept. With Select the frame's line picks the camera, and so does its name; what is inside the frame does not.
  TOOL2: `${HELP}
const out = {};
await start(${JSON.stringify(SCENE + WIDE)}, 'both', 'camera');
const g = wgeom();
// From empty space outside the frame, 300 to the right and 100 up in the scene.
await pull(g.el, { x: g.sx(-800), y: g.sy(-450) }, { x: g.sx(-500), y: g.sy(-350) });
out.moved = decl('wide');
// The frame is 960 by 540 around 300, 100: its top right corner, out to twice as far from its middle.
await pull(g.el, { x: g.sx(300 + 480), y: g.sy(100 + 270) }, { x: g.sx(300 + 960), y: g.sy(100 + 540) });
out.zoomed = decl('wide');
await start(${JSON.stringify(SCENE + WIDE)}, 'both', 'select');
const h = wgeom();
const press = async (x, y) => { pe(h.el, 'pointerdown', x, y); await tick(40); pe(h.el, 'pointerup', x, y); await tick(220); return S().selection };
out.byLine = await press(h.sx(200), h.sy(270));
S().select([]); await tick(100);
out.inside = await press(h.sx(200), h.sy(-150));
S().select([]); await tick(100);
const tag = document.querySelector('.camera-tag[data-camera="wide"]');
const tr = tag.getBoundingClientRect();
pe(tag, 'pointerdown', tr.left + 6, tr.top + 6); await tick(40); pe(h.el, 'pointerup', tr.left + 6, tr.top + 6); await tick(220);
out.byName = S().selection;
// Picked, it drags by its line as any object does by its body: 100 to the right.
await pull(h.el, { x: h.sx(200), y: h.sy(270) }, { x: h.sx(300), y: h.sy(270) });
out.draggedByLine = decl('wide');
out.selectAll = (() => { key('keydown', 'KeyA', { ctrlKey: true }); return S().selection })();
return out`,

  // Shift makes the change an animation, in the Camera view as anywhere: held over it, the playhead looks ahead; the picture dragged, the camera gets a move from where the playhead was. Later, a plain drag after that move's end is a new move from the end to the playhead (D328); at the move's end it sets the end.
  SHIFT1: `${HELP}
const out = {};
await start(${JSON.stringify(SCENE + WIDE)}, 'both', 'camera');
const c = cgeom();
pe(c.el, 'pointermove', c.cx, c.cy);
key('keydown', 'Shift', { shiftKey: true }); await tick(150);
out.lookAhead = S().time;
await pull(c.panel, { x: c.cx, y: c.cy }, { x: c.cx - 60, y: c.cy }, { shiftKey: true });
key('keyup', 'Shift'); await tick(300);
out.made = { acts: acts('wide'), decl: decl('wide'), time: S().time, expectedX: Math.round(60 / c.k / 2) };
// At 3 s, past the move's end: a plain drag of the picture.
S().select(['wide']); S().setTime(3); await tick(250);
await pull(c.panel, { x: c.cx, y: c.cy }, { x: c.cx, y: c.cy + 40 });
out.later = { acts: acts('wide'), time: S().time };
// At the first move's end: a plain drag sets that end.
S().setTime(1); await tick(250);
await pull(c.panel, { x: c.cx, y: c.cy }, { x: c.cx + 20, y: c.cy });
out.atTheEnd = acts('wide');
// A corner with Shift, in the Preview view, animates the zoom.
await start(${JSON.stringify(SCENE + WIDE)}, 'both', 'camera');
const g = wgeom();
pe(g.el, 'pointermove', g.sx(480), g.sy(270));
key('keydown', 'Shift', { shiftKey: true }); await tick(150);
await pull(g.el, { x: g.sx(480), y: g.sy(270) }, { x: g.sx(960), y: g.sy(540) }, { shiftKey: true });
key('keyup', 'Shift'); await tick(300);
out.zoomAnimated = { acts: acts('wide'), decl: decl('wide') };
return out`,

  // The timeline's Cameras section: the clips stack as the cast has them, each lit where it has the picture. The razor on a camera's clip writes a second camera from there, framed as the first is at that moment, puts the playhead on the cut, and has the new one selected.
  CUT1: `${HELP}
const out = {};
await start(${JSON.stringify(HELD)}, 'both', 'select');
const lanes = () => [...document.querySelectorAll('.tl-row.lane')].map((l) => l.dataset.lane);
const clips = () => [...document.querySelectorAll('.tl-row.lane[data-lane="cameras"] .oclip')].map((c) => ({ name: c.dataset.object, start: Number(c.dataset.start), end: Number(c.dataset.end), level: parseFloat(c.style.top), lit: [...c.querySelectorAll('.oclip-live')].map((b) => [Math.round(parseFloat(b.style.left)), Math.round(parseFloat(b.style.width))]) }));
out.lanes = lanes();
out.before = clips();
S().setTimelineTool('razor'); await tick(200);
const clip = document.querySelector('.tl-row.lane[data-lane="cameras"] .oclip[data-object="wide"]');
const cr = clip.getBoundingClientRect();
const xAt = (t) => cr.left + ((t - Number(clip.dataset.start)) / (Number(clip.dataset.end) - Number(clip.dataset.start))) * cr.width;
pe(clip.querySelector('.oclip-title'), 'pointerdown', xAt(3), cr.top + 6); await tick(60); pe(document.body, 'pointerup', xAt(3), cr.top + 6); await tick(400);
S().setTimelineTool('select'); await tick(200);
out.cut = { code: tail('wide').slice(0, tail('wide').indexOf('wide.move')).trim(), selected: S().selection, time: S().time, clips: clips(), who: [2, 3, 5].map(who) };
out.higherIsAbove = out.cut.clips.find((c) => c.name === 'wide2').level < out.cut.clips.find((c) => c.name === 'wide').level;
// Nothing shows until the new one is reframed: the picture at the cut is what it was.
out.sameAtTheCut = JSON.stringify(view(3)) === JSON.stringify({ x: 450, y: 0, zoom: 1, rotation: 0 });
out.shownName = document.querySelector('.preview-camera .view-tag b').textContent;
// A cut at the clip's very start changes nothing, and says so.
S().setTimelineTool('razor'); await tick(150);
const first = document.querySelector('.tl-row.lane[data-lane="cameras"] .oclip[data-object="wide"]');
const fr = first.getBoundingClientRect();
const count = S().model.objects.length;
pe(first.querySelector('.oclip-title'), 'pointerdown', fr.left + 1, fr.top + 6); await tick(60); pe(document.body, 'pointerup', fr.left + 1, fr.top + 6); await tick(300);
S().setTimelineTool('select'); await tick(150);
out.atTheEdge = { same: S().model.objects.length === count, notice: S().notice };
return out`,

  // A thing held on the screen: where it is drawn in the scene follows the camera, and in the picture it stays. Attached from the operation the menus call, it stays where it shows, its place, turn, and size written for the picture; let go, they come back. Dragged in the Preview view, it lands under the pointer. An export's frame has it where its values say.
  HELD1: `${HELP}
const out = {};
await start(${JSON.stringify(HELD)}, 'both', 'select');
const pose = (t) => { const p = smp.worldPose(S().model, obj('label'), t); return [r2(p.x), r2(p.y), r2(p.rotation), r2(p.scale)] };
out.inTheScene = [pose(0), pose(2), pose(4)];
// Dragged at 2 s, 200 to the right and 100 down in the scene.
S().setTime(2); await tick(250);
const g = wgeom();
const f = QA.getRenderer().frameOf('label');
await pull(g.el, { x: g.sx(f.x), y: g.sy(f.y) }, { x: g.sx(f.x + 200), y: g.sy(f.y - 100) });
const f2 = QA.getRenderer().frameOf('label');
out.dragged = { decl: decl('label'), landed: [Math.round(f2.x - f.x), Math.round(f2.y - f.y)] };
// Under a camera turned and twice as close, a circle attached stays where it shows, and comes back as it was.
await start(${JSON.stringify(SCENE + ['', 'badge = Circle({', '  x: 700,', '  y: 400,', '  radius: 50,', "  fill: '#ff0000',", '})', '', 'wide = Camera({', '  x: -400,', '  y: 100,', '  zoom: 2,', '  rotation: 90,', '})', ''].join(NL))}, 'both', 'select');
const where = () => { const b = QA.getRenderer().frameOf('badge'); return [Math.round(b.x), Math.round(b.y), Math.round(b.width)] };
const was = where();
out.menu = ops.attachMenuItems(['badge']).map((i) => i.label);
ops.setAttached(['badge'], true); await tick(300);
out.attached = { decl: decl('badge'), stays: JSON.stringify(where()) === JSON.stringify(was), menu: ops.attachMenuItems(['badge']).map((i) => i.label) };
key('keydown', 'KeyZ', { ctrlKey: true }); await tick(350);
out.oneUndo = /attached/.test(decl('badge')) === false && JSON.stringify(where()) === JSON.stringify(was);
ops.setAttached(['badge'], true); await tick(250);
ops.setAttached(['badge'], false); await tick(300);
out.letGo = { decl: decl('badge'), stays: JSON.stringify(where()) === JSON.stringify(was) };
out.cameraTakesNone = ops.attachMenuItems(['wide']).length;
return out`,

  // What an export is: the frame through the camera that has the picture, the background behind whatever the camera does, and a thing held on the screen where its own values put it. The Camera view shows the same picture.
  EXPORT1: `${HELP}
const out = {};
await start(${JSON.stringify(['box = Rect({', '  x: -300,', '  y: 100,', '  width: 240,', '  height: 140,', "  fill: '#4f8cff',", '})', '', 'mark = Rect({', '  x: 800,', '  y: -400,', '  width: 100,', '  height: 100,', "  fill: '#ff0000',", '  attached: true,', '})', '', 'wide = Camera({', '  x: -300,', '  y: 100,', '  zoom: 4,', '  rotation: 90,', '  at: 1,', '})', ''].join(NL))}, 'both', 'select');
const { FrameRenderer } = await import('/src/export/FrameRenderer.ts');
const fr = new FrameRenderer(1920, 1080, '#1c1c1c', false);
const shot = (t) => { const px = fr.draw(S().model, t); return (x, y) => { const i = (y * 1920 + x) * 4; return '#' + [px[i], px[i + 1], px[i + 2]].map((v) => v.toString(16).padStart(2, '0')).join('') } };
// Before the camera begins: the scene's middle. The box is left of the middle and above it; the mark is where it is written.
const a = shot(0);
out.noCamera = { middle: a(960, 540), box: a(960 - 300, 540 - 100), mark: a(960 + 800, 540 + 400) };
// Through the camera: the box fills the picture's middle, turned a quarter, 560 wide and 960 tall; past it the background; the mark has not moved.
const b = shot(2);
out.through = { middle: b(960, 540), tallWay: b(960, 540 - 400), wideWay: b(960 + 320, 540), mark: b(960 + 800, 540 + 400), corner: b(4, 4) };
fr.dispose();
// The Camera view, at 2 s: the same picture, read from its own canvas.
S().setTime(2); await tick(300);
const canvas = document.querySelector('.preview-camera canvas');
const gl = canvas.getContext('webgl2');
const read = (fx, fy) => { const o = new Uint8Array(4); st.setState({}); gl.readPixels(Math.round(fx * canvas.width), Math.round((1 - fy) * canvas.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, o); return '#' + [...o.slice(0, 3)].map((v) => v.toString(16).padStart(2, '0')).join('') };
out.cameraView = { middle: read(0.5, 0.5), wideWay: read(0.5 + 320 / 1920, 0.5), mark: read(0.5 + 800 / 1920, 0.5 + 400 / 1080) };
return out`,

  // The panes: no camera among the layers, which end in the Background with the project's color; the cameras under Type, the one that has the picture lit and the other dim; the Selected pane says which has it; the code pane completes Camera to where it looks and how close.
  PANE1: `${HELP}
const out = {};
await start(${JSON.stringify(TWO)}, 'both', 'select');
S().setObjectsView('layers'); await tick(250);
out.layers = [...document.querySelectorAll('.object-list > li')].map((li) => li.querySelector('.object-row .name')?.textContent);
out.background = { color: S().settings.background, row: !!document.querySelector('.object.background .color-well, .object.background button, .object.background input') };
S().setObjectsView('type'); await tick(250);
const cams = () => [...document.querySelectorAll('.object.camera')].map((li) => ({ name: li.querySelector('.name').textContent, live: li.classList.contains('live'), dim: li.classList.contains('inactive'), eye: !!li.querySelector('.eye') }));
out.at0 = cams();
S().setTime(3); await tick(250);
out.at3 = cams();
S().select(['wide']); await tick(250);
out.selectedSays = document.querySelector('.now-head')?.textContent.replace(/\\s+/g, ' ').trim();
out.sections = [...document.querySelectorAll('.now-section')].map((s) => s.textContent.trim());
out.rows = [...document.querySelectorAll('.now-values tr:not(.now-section) td:first-child')].map((td) => td.textContent.trim()).filter(Boolean);
S().select(['close']); await tick(250);
out.otherSays = document.querySelector('.now-head')?.textContent.replace(/\\s+/g, ' ').trim();
S().select([]); S().setTime(0); S().setObjectsView('layers');
const comp = await import('/src/code/completions.ts');
out.newCamera = comp.objectSnippetAttrs('Camera');
out.hotkey = (await import('/src/state/hotkeys.ts')).HOTKEYS.filter((h) => h.id === 'previewView').map((h) => [h.label, h.defaults.join(' ')]);
return out`,
}
