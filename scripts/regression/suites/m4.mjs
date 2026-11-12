// The examples the animation rules give for masks run as written.
const PIX = `
const px = (wx, wy) => { const g = geom(); const canvas = g.el.querySelector('canvas'); const gl = canvas.getContext('webgl2'); const r = canvas.getBoundingClientRect(); const k = canvas.width / r.width; const x = Math.round((g.sx(wx) - r.left) * k); const y = Math.round(canvas.height - (g.sy(wy) - r.top) * k); const out = new Uint8Array(4); st.setState({}); gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out); return '#' + [...out.slice(0, 3)].map(v => v.toString(16).padStart(2, '0')).join('') };
const lit = (y) => { let n = 0; for (let x = -420; x <= 420; x += 6) if (px(x, y) === '#ffffff') n++; return n };
`
const REVEAL = [
  'backdrop = Rect({',
  '  width: 1920,',
  '  height: 1080,',
  "  fill: '#24324a',",
  '})',
  '',
  'title = Text({',
  "  text: 'Quick Animator',",
  '  fontSize: 120,',
  '})',
  '',
  'reveal = Rect({',
  '  x: -960,',
  '  width: 0,',
  '  height: 1080,',
  "  masks: 'title',",
  '})',
  '',
  'reveal.to({',
  '  x: 0,',
  '  width: 1920,',
  '  duration: 1,',
  '})',
  '',
].join('\n')
const EYES = [
  'backdrop = Rect({',
  '  width: 1920,',
  '  height: 1080,',
  "  fill: '#24324a',",
  '})',
  '',
  'left = Circle({',
  '  x: -300,',
  '  radius: 150,',
  '})',
  '',
  'right = Circle({',
  '  x: 300,',
  '  radius: 150,',
  '})',
  '',
  'eyes = Group({',
  "  members: 'left right',",
  "  masks: 'below',",
  '})',
  '',
].join('\n')
const SPOT = [
  'backdrop = Rect({',
  '  width: 1920,',
  '  height: 1080,',
  "  fill: '#24324a',",
  '})',
  '',
  'card = Rect({',
  '  width: 800,',
  '  height: 400,',
  "  fill: '#f59e0b',",
  '})',
  '',
  'spot = Circle({',
  '  x: 0,',
  '  y: 0,',
  '  radius: 300,',
  "  masks: 'below except backdrop',",
  '})',
  '',
].join('\n')

export default {
  RULES1: `${PIX}
S().select([]); S().setHidden(S().hidden, false);
const out = {};
await setSource(${JSON.stringify(REVEAL)}); S().setTime(0); await tick(250);
out.reveal = { err: S().error, warnings: S().model.warnings, at0: lit(0), masks: S().model.masks.map(k => k.name + ' -> ' + k.targets.join(' ')) };
S().setTime(0.5); await tick(200); out.reveal.half = { left: (() => { let n = 0; for (let x = -420; x < 0; x += 6) if (px(x, 0) === '#ffffff') n++; return n })(), right: (() => { let n = 0; for (let x = 60; x <= 420; x += 6) if (px(x, 0) === '#ffffff') n++; return n })() };
S().setTime(1); await tick(200); out.reveal.at1 = lit(0);
await setSource(${JSON.stringify(EYES)}); S().setTime(0); await tick(250);
out.eyes = { err: S().error, warnings: S().model.warnings, left: px(-300, 0), right: px(300, 0), between: px(0, 0), masks: S().model.masks.map(k => k.name + ' [' + k.shapes.join(' ') + '] -> ' + k.targets.join(' ')) };
await setSource(${JSON.stringify(SPOT)}); await tick(250);
out.spot = { err: S().error, warnings: S().model.warnings, inside: px(-200, 0), cardOutside: px(-380, 150), backdrop: px(-900, 500) };
return out`,
}
