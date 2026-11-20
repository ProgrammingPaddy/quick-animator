// The camera in depth and the two views' moves (D430 to D437): the Preview view's moves write nothing; the camera's are written, each only what it changes; a thing at a depth is worked on where it lies; a drag in a turned view carries a thing in depth; and the camera is reset, and takes the Preview view's place, and gives it its own.
const NL = String.fromCharCode(10)
const SCENE = [
  'back = Rect({',
  '  x: -300,',
  '  y: 60,',
  '  z: -600,',
  '  width: 500,',
  '  height: 320,',
  "  fill: '#334155',",
  '})',
  '',
  'mid = Rect({',
  '  x: 0,',
  '  y: 0,',
  '  width: 300,',
  '  height: 200,',
  "  fill: '#4f8cff',",
  '})',
  '',
  'ball = Circle({',
  '  x: 260,',
  '  y: -80,',
  '  z: 500,',
  '  radius: 90,',
  "  fill: '#f59e0b',",
  '})',
  '',
  'camera = Camera({',
  '  x: 0,',
  '  y: 0,',
  '  zoom: 1,',
  '})',
  '',
].join(NL)
const FLAT = ['box = Rect({', '  width: 200,', '  height: 100,', '})', '', 'camera = Camera({', '  zoom: 1,', '})', ''].join(NL)
const ORDER = ['near = Rect({', '  z: 300,', '  width: 200,', '  height: 200,', '})', '', 'far = Rect({', '  z: -300,', '  width: 400,', '  height: 400,', '})', '', 'camera = Camera({', '  zoom: 1,', '})', ''].join(NL)
const LENSES = ['box = Rect({', '  width: 200,', '  height: 100,', '})', '', 'camera = Camera({', '  focalLength: 24,', '  fov: 60,', '})', ''].join(NL)

const HELP = `
// Every check begins the same: no recording, both views, the Preview view from the front and fitted, Select in hand, nothing selected, no snapping, nothing colliding, the playhead at the start, the keys as they come.
const start = async (source = ${JSON.stringify(SCENE)}) => { if (S().recording) { S().toggleRecording(); await tick(60) } if (S().recordReview) ops.settleRecording([]); S().setPrefsOpen(false); S().setPlaying(false); S().setPreviewView('both'); S().setTool('select'); S().setTransformMode('all'); S().setPick('object'); S().select([]); S().setPreviewSnap({ on: false, edges: false }); S().setCollide(false); S().setPush(false); S().setNotice(null); S().setPin('start'); S().setChain(false); S().setPrefs({ hotkeys: {} }); await setSource(''); QA.getViewport().face(0, 0); [...document.querySelectorAll('.preview-tools button')].find((b) => b.textContent.trim() === 'Fit')?.click(); await tick(150); await setSource(source); S().select([]); S().setTime(0); await tick(300) };
const host = () => document.querySelector('.preview');
const panel = () => document.querySelector('.preview-camera');
const hb = () => host().getBoundingClientRect();
// Where a place of the scene shows on the screen, in the Preview view and in the Camera view.
const world = (x, y, z = 0) => { const b = hb(); const p = QA.getViewport().toPane(x, y, { z, turn: null }); return { x: b.left + p.x, y: b.top + p.y } };
const shot = (x, y, z = 0) => { const b = hb(); const p = QA.getCameraView().toPane(x, y, { z, turn: null }); return { x: b.left + p.x, y: b.top + p.y } };
const by = (a, dx, dy) => ({ x: a.x + dx, y: a.y + dy });
const pull = async (el, a, b, extra = {}) => { pe(el, 'pointerdown', a.x, a.y, extra); for (let i = 1; i <= 8; i++) { pe(host(), 'pointermove', a.x + ((b.x - a.x) * i) / 8, a.y + ((b.y - a.y) * i) / 8, extra); await tick(16) } await tick(60); pe(host(), 'pointerup', b.x, b.y, extra); await tick(220) };
const tap = async (el, at, extra = {}) => { pe(el, 'pointerdown', at.x, at.y, extra); await tick(30); pe(host(), 'pointerup', at.x, at.y, extra); await tick(240) };
const MID = { button: 1, buttons: 4 };
const RIGHT = { button: 2, buttons: 2 };
const wheel = async (el, at, deltaY, extra = {}) => { el.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, deltaY, ...extra })); await tick(520) };
const facing = () => { const f = QA.getViewport().facing; return [Math.round(f.yaw * 10) / 10, Math.round(f.pitch * 10) / 10] };
const said = (name) => (decl(name) ?? '').split(String.fromCharCode(10)).map((l) => l.trim()).join(' ');
const end = (view, name) => document.querySelector(view + ' .compass [data-axis="' + name + '"] circle');
const mid = (el) => { const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 } };
const face = async (view, name) => { const el = end(view, name); await tap(el, mid(el)) };
`

export default {
  // The Preview view's moves: Alt and the left button round, the middle button across and with Ctrl round, Alt and the right button its zoom, its compass. None of them is written, and the view from the front is the flat one.
  VIEW1: `${HELP}
const out = {};
await start();
const before = src();
const v = QA.getViewport();
const e = world(-900, -500);
out.front = { facing: facing(), flat: v.flat, straight: v.straight };
await pull(host(), e, by(e, 100, 0), { altKey: true });
out.altLeft = { facing: facing(), flat: v.flat, straight: v.straight };
await pull(host(), e, by(e, 0, -60), { altKey: true });
out.altLeftUp = facing();
await pull(host(), e, by(e, -100, 60), { ...MID, ctrlKey: true });
out.ctrlMiddleBack = { facing: facing(), straight: v.straight };
const b = hb();
const u0 = v.toWorld(e.x - b.left, e.y - b.top);
await pull(host(), e, by(e, 80, -40), MID);
const u1 = v.toWorld(e.x + 80 - b.left, e.y - 40 - b.top);
out.middleKeepsWhatIsPressed = Math.round(Math.hypot(u1.x - u0.x, u1.y - u0.y));
const z0 = v.scale;
await pull(host(), e, by(e, 140, 0), { ...RIGHT, altKey: true });
out.altRightCloser = Math.round((v.scale / z0) * 100) / 100;
host().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: e.x + 140, clientY: e.y, button: 2 })); await tick(150);
out.menuShutAfterIt = !document.querySelector('.context-menu');
await pull(host(), e, by(e, -140, 0), { ...RIGHT, altKey: true });
out.altRightBack = Math.round((v.scale / z0) * 100) / 100;
await face('.preview-world', 'x+');
out.compassX = { facing: facing(), flat: v.flat, straight: v.straight };
await face('.preview-world', 'x+');
out.compassXAgain = facing();
await face('.preview-world', 'y+');
out.compassY = facing();
const c = mid(document.querySelector('.preview-world .compass'));
await pull(document.querySelector('.preview-world .compass'), by(c, 0, 20), by(c, 10, 20));
out.compassDrag = { facing: facing(), flat: v.flat };
await face('.preview-world', 'z+');
out.compassZ = { facing: facing(), straight: v.straight };
out.nothingWritten = src() === before;
out.error = S().error;
return out`,

  // The camera's moves in its own view: the wheel is its lens; Alt and the wheel, Alt and the right button, closer; the middle button across; Alt and the left button, and Ctrl and the middle button, round what is at the middle; its compass turns it on the spot and faces it along an axis. Each writes only what it changes, and Reset leaves a camera as one never moved.
  CAMERA1: `${HELP}
const out = {};
await start();
const cv = QA.getCameraView();
const canvas = panel().querySelector('canvas');
const e = shot(900, -500);
const m = shot(0, 0);
const b = hb();
const under = (at) => { const w = cv.toWorld(at.x - b.left, at.y - b.top); return [Math.round(w.x), Math.round(w.y)] };
await wheel(canvas, e, -200);
out.wheel = said('camera');
await wheel(canvas, e, 200);
out.wheelBack = said('camera');
await wheel(canvas, e, -200, { altKey: true });
out.altWheel = said('camera');
await wheel(canvas, e, 200, { altKey: true });
out.altWheelBack = said('camera');
await pull(panel(), m, by(m, 60, -30), MID);
out.across = { camera: said('camera'), stillUnder: under(by(m, 60, -30)) };
await pull(panel(), by(m, 60, -30), m, MID);
out.acrossBack = said('camera');
await pull(panel(), e, by(e, 100, 0), { altKey: true });
out.round = { camera: said('camera'), middle: under(m) };
await pull(panel(), e, by(e, 0, -50), { altKey: true });
out.roundUp = { camera: said('camera'), middle: under(m) };
await pull(panel(), e, by(e, -100, 50), { ...MID, ctrlKey: true });
out.roundBack = said('camera');
await pull(panel(), e, by(e, 140, 0), { ...RIGHT, altKey: true });
out.closer = said('camera');
await pull(panel(), e, by(e, -140, 0), { ...RIGHT, altKey: true });
out.closerBack = said('camera');
const k = document.querySelector('.preview-camera .compass');
await pull(k, by(mid(k), 0, 22), by(mid(k), 10, 22));
out.turn = said('camera');
await face('.preview-camera', 'x+');
out.faceX = said('camera');
await face('.preview-camera', 'x+');
out.faceXAgain = said('camera');
document.querySelector('.preview-camera .view-corner-buttons button').click(); await tick(300);
out.reset = said('camera');
out.error = S().error;
return out`,

  // Things in depth: from the front a drag is across and writes no depth; in the Camera view a thing at a depth stays under the pointer; Alt on a handle keeps proportions and turns nothing; from above a drag carries a thing in depth; and the camera stands there as a body that is pressed and carried.
  DEPTH1: `${HELP}
const out = {};
await start();
let p = world(0, 0);
await pull(host(), p, by(p, 40, -20));
out.frontDrag = said('mid');
p = shot(260, -80, 500);
await pull(panel(), p, by(p, 50, 0));
const ball = obj('ball').attrs;
out.atDepthInTheCameraView = { ball: said('ball'), offThePointer: Math.round(shot(ball.x, ball.y, 500).x - (p.x + 50)) };
S().select(['mid']); await tick(250);
const f = QA.getRenderer().frameOf('mid');
const corner = world(f.x + f.width / 2, f.y + f.height / 2);
await pull(host(), corner, by(corner, 30, -5), { altKey: true });
const g = QA.getRenderer().frameOf('mid');
out.altOnAHandle = { grew: g.width > f.width, proportions: Math.round((g.width / g.height / (f.width / f.height)) * 1000) / 1000, facing: facing() };
S().select([]); await tick(100);
await face('.preview-world', 'y+');
out.above = facing();
const was = { ...obj('mid').attrs };
p = world(was.x, was.y, 0);
await pull(host(), p, by(p, 30, 40));
const now = obj('mid').attrs;
out.aboveDrag = { nearer: (now.z ?? 0) > 0, across: now.x > was.x, heightKept: now.y === was.y, selected: S().selection };
const view = QA.getRenderer().cameraView('camera');
p = world(view.x, view.y, view.z);
await pull(host(), p, by(p, -40, -30));
const c = obj('camera').attrs;
out.body = { selected: S().selection, left: (c.x ?? 0) < 0, farther: (c.z ?? view.z) < view.z, heightKept: (c.y ?? 0) === 0 };
await face('.preview-world', 'z+');
out.error = S().error;
return out`,

  // The camera takes the Preview view's place and gives it its own; and the key that animates, held with a move of the camera, makes the move an animation.
  MIRROR1: `${HELP}
const out = {};
await start();
const v = QA.getViewport();
const e = world(-900, -500);
await pull(host(), e, by(e, 50, -20), { altKey: true });
const eye = v.eye();
const side = facing();
document.querySelectorAll('.preview-camera .view-corner-buttons button')[1].click(); await tick(300);
const a = obj('camera').attrs;
out.cameraToView = { camera: said('camera'), atTheEye: Math.round(Math.hypot(a.x - eye.x, a.y - eye.y, a.z - eye.z)), looksAsItDoes: [a.rotationY, a.rotationX].join() === side.join() };
await face('.preview-world', 'z+');
out.front = facing();
document.querySelector('.preview-world .view-corner-buttons button').click(); await tick(300);
const there = v.eye();
out.viewFromCamera = { atTheCamera: Math.round(Math.hypot(a.x - there.x, a.y - there.y, a.z - there.z)), facing: facing() };
await face('.preview-world', 'z+');
document.querySelector('.preview-camera .view-corner-buttons button').click(); await tick(300);
out.reset = said('camera');
const c = shot(900, -500);
pe(host(), 'pointermove', c.x, c.y, { buttons: 0 });
key('keydown', 'Shift', { shiftKey: true }); await tick(80);
out.ahead = S().time;
await pull(panel(), c, by(c, 60, 0), { altKey: true, shiftKey: true });
key('keyup', 'Shift'); await tick(150);
const made = obj('camera').actions.at(-1);
out.animated = { camera: said('camera'), verb: made?.verb ?? null, changes: made ? Object.keys(made.changes).sort() : null, to: made ? [made.changes.x, made.changes.z, made.changes.rotationY] : null, span: made ? [made.start, made.end] : null, back: S().time };
out.error = S().error;
return out`,

  // The model: a scene with depth is taken through a lens, and one with none flat, as it always was; nearer covers farther whatever the cast's order; a lens written both ways goes by fov, and says so.
  LENS1: `${HELP}
const out = {};
await start();
const r = QA.getRenderer();
const cv = QA.getCameraView();
out.withDepth = { depthless: r.depthless, lens: cv.camera.isPerspectiveCamera === true };
await start(${JSON.stringify(FLAT)});
out.flat = { depthless: r.depthless, lens: cv.camera.isPerspectiveCamera === true, stands: Math.round(smp.viewAt(S().model, 0).z * 100) / 100 };
await start(${JSON.stringify(ORDER)});
const at = shot(0, 0, 300);
const b = hb();
out.nearerCoversFarther = r.pick(cv.camera, cv.toNdc(at.x - b.left, at.y - b.top));
const p = world(0, 0);
out.fromTheFrontToo = r.pick(QA.getViewport().camera, QA.getViewport().toNdc(p.x - b.left, p.y - b.top));
await start(${JSON.stringify(LENSES)});
const view = smp.viewAt(S().model, 0);
out.bothWays = { focal: Math.round(view.focal * 100) / 100, warnings: S().model.warnings.map((w) => w.message) };
out.error = S().error;
return out`,
}
