// The wheel on the camera, far out and far in (D420, D426): the wheel zooms the lens and the camera stays where it is, wherever the pointer is. Below 1 a camera's zoom is written to three figures, so a tick still changes it far out; at the floor and at the ceiling more ticks change nothing; and ticks too small to change what is written add up.
const NL = String.fromCharCode(10)
const SCENE = ['box = Rect({', '  x: -100,', '  y: 100,', '  width: 240,', '  height: 140,', "  fill: '#4f8cff',", '})', '', 'wide = Camera({', '  x: 200,', '  y: 100,', '  zoom: 1,', '})', ''].join(NL)

const HELP = `
// Every check begins the same: the Camera view alone, Select in hand, nothing selected, the playhead at the start.
const start = async (source) => { if (S().recording) { S().toggleRecording(); await tick(60) } if (S().recordReview) ops.settleRecording([]); S().setPlaying(false); S().setPreviewView('camera'); await setSource(''); await tick(100); await setSource(source); S().setTool('select'); S().select([]); S().setTime(0); await tick(250) };
const canvas = () => document.querySelector('.preview-camera canvas');
const spot = (fx, fy) => { const r = canvas().getBoundingClientRect(); return { x: r.left + r.width * fx, y: r.top + r.height * fy } };
// A run of ticks, then the pause that ends the run and its undo step.
const wheel = async (p, deltaY, n = 1) => { for (let i = 0; i < n; i++) { canvas().dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y, deltaY })); await tick(30) } await tick(520) };
const written = () => /zoom: ([0-9.]+)/.exec(src())?.[1] ?? null;
const seen = () => { const v = smp.viewAt(S().model, S().time); return [Math.round(v.x), Math.round(v.y), v.zoom] };
`

export default {
  // Far out and far in, with the pointer off the picture's middle: the camera's place is what it was throughout.
  WHEEL1: `${HELP}
const out = {};
await start(${JSON.stringify(SCENE)});
const p = spot(0.8, 0.4);
await wheel(p, 100, 12);
out.out = { zoom: written(), view: seen() };
await wheel(p, 100, 30);
out.floor = { zoom: written(), view: seen() };
const atFloor = src();
await wheel(p, 100, 10);
out.floorStays = src() === atFloor;
const steps = [];
for (let i = 0; i < 6; i++) { await wheel(p, -100, 1); steps.push(written()) }
out.inFromFloor = steps;
out.everyTickChanges = new Set(steps).size === steps.length;
await start(${JSON.stringify(SCENE)});
await wheel(spot(0.5, 0.5), 4, 100);
out.smallTicks = { zoom: written(), view: seen() };
await wheel(p, -100, 45);
out.ceiling = written();
const atCeiling = src();
await wheel(p, -100, 5);
out.ceilingStays = src() === atCeiling;
out.error = S().error;
return out`,
}
