// Masks and the Objects pane, first set: the model, the drawing, the operations.
import { readFileSync } from 'node:fs'

const BASE = readFileSync(new URL('./scene-base.js', import.meta.url), 'utf8')
const base = `await setSource(${JSON.stringify(BASE)}); S().select([]); S().setTime(0); S().setHidden(S().hidden, false); await tick(200);`
// The preview's pixel at a world point, as '#rrggbb', read right after a drawing.
const PIX = `
const px = (wx, wy) => { const g = geom(); const canvas = g.el.querySelector('canvas'); const gl = canvas.getContext('webgl2'); const r = canvas.getBoundingClientRect(); const k = canvas.width / r.width; const x = Math.round((g.sx(wx) - r.left) * k); const y = Math.round(canvas.height - (g.sy(wy) - r.top) * k); const out = new Uint8Array(4); st.setState({}); gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out); return '#' + [...out.slice(0, 3)].map(v => v.toString(16).padStart(2, '0')).join('') };
const BACK = '#24324a', ORANGE = '#f59e0b', BLUE = '#4f8cff', GREEN = '#10b981', PINK = '#ec4899';
`
const swap = (from, to) => `await setSource(S().source.replace(${JSON.stringify(from)}, ${JSON.stringify(to)}));`

export default {
  // What each list resolves to, and the notes for what it cannot.
  MODEL1: `${base}
const m = () => S().model.masks.map(k => k.name + (k.inverted ? '!' : '') + ' [' + k.shapes.join(' ') + '] -> ' + k.targets.join(' '));
const out = { base: m() };
${swap("masks: 'below except backdrop'", "masks: 'below'")} out.below = m();
${swap("masks: 'below'", "masks: 'above'")} out.above = m();
${swap("masks: 'above'", "masks: 'bar title'")} out.names = m();
${swap("masks: 'bar title'", "masks: 'Rect except bar1'")} out.type = m();
${swap("masks: 'Rect except bar1'", "masks: 'below above except bar'")} out.both = m();
${swap("masks: 'below above except bar'", "masks: 'nothing here'")} out.unknown = { m: m(), warnings: S().model.warnings.map(w => w.message) };
${swap("masks: 'nothing here'", "masks: ''")} out.empty = m();
${swap("masks: ''", "masks: 'below',\
  inverted: true")} out.inverted = m();
return out`,

  // The drawing: hidden outside the mask, whole where let out or above, and each way of combining.
  DRAW1: `${base}${PIX}
const out = {};
out.inside = px(-200, -150); out.outside = px(-460, -150); out.outside2 = px(460, -150); out.badge = px(700, 400); out.backdrop = px(-900, -500); out.logoIn = px(0, -290); out.logoOut = px(0, -420);
${swap("masks: 'below except backdrop'", "masks: 'below except backdrop',\
  inverted: true")}
out.inv = { inside: px(-200, -150), outside: px(-460, -150), logoOut: px(0, -420) };
${swap(",\
  inverted: true", "")}
// A second mask: both must let it through.
await setSource(S().source.replace("badge = Rect({", "strip = Rect({\\n  x: -300,\\n  y: -150,\\n  width: 200,\\n  height: 300,\\n  masks: 'bar',\\n})\\n\\nbadge = Rect({"));
out.two = { both: px(-250, -150), spotOnly: px(-150, -150), stripOnly: px(-390, -150), bar2: px(200, -150), masks: S().model.masks.map(k => k.name + ' -> ' + k.targets.join(' ')) };
// Switched off in the view.
S().setHidden(['spot'], true); await tick(100);
out.off = { stripOnly: px(-390, -150), outsideBoth: px(-480, -150), bar2far: px(460, -150) };
S().setHidden(['spot'], false); await tick(100);
return out`,

  // A mask made of several objects is their union; a mask's own opacity and its life.
  DRAW2: `${base}${PIX}
const out = {};
await setSource(S().source.replace("spot = Circle({\\n  x: 0,\\n  y: 0,\\n  radius: 300,\\n  masks: 'below except backdrop',\\n})", "spot = Circle({\\n  x: -300,\\n  y: -150,\\n  radius: 100,\\n})\\n\\nspot2 = Circle({\\n  x: 300,\\n  y: -150,\\n  radius: 100,\\n})\\n\\nspots = Group({\\n  members: 'spot spot2',\\n  masks: 'below except backdrop',\\n})").replace("spot.move({\\n  x: 400,\\n  duration: 2,\\n})", ""));
out.union = { masks: S().model.masks, left: px(-300, -150), right: px(300, -150), between: px(-150, -150), err: S().error, warnings: S().model.warnings };
// The group moves its picture.
await setSource(S().source + "\\nspots.move({\\n  x: 100,\\n  duration: 1,\\n})\\n"); S().setTime(1); await tick(150);
out.moved = { left: px(-200, -150), oldLeft: px(-390, -150), right: px(390, -150) };
// Half as solid, half as much shows.
S().setTime(0); ${swap("members: 'spot spot2',", "members: 'spot spot2',\
  opacity: 0.5,")} await tick(100);
out.half = px(-300, -150);
// Outside its life a mask hides nothing.
${base}
${swap("radius: 300,", "radius: 300,\
  at: 1,\
  until: 2,")}
S().setTime(0); await tick(120); out.before = px(-460, -150);
S().setTime(1.5); await tick(120); out.during = px(-460, -150);
S().setTime(2.5); await tick(120); out.after = px(-460, -150);
return out`,

  // The operations write the smallest code.
  OPS1: `${base}
const out = {};
const name = ops.addObject('Mask', 100, 50); await tick(200);
out.added = { name, decl: decl(name), selected: S().selection, targets: S().model.masks.find(k => k.name === name)?.targets };
S().undo?.();
${base}
const forBars = ops.addMaskFor(['bar1', 'bar2']); await tick(200);
out.forBars = { name: forBars, decl: decl(forBars), order: S().model.objects.map(o => o.name), targets: S().model.masks.find(k => k.name === forBars)?.targets };
${base}
out.use = { name: ops.useAsMask(['logo']) }; await tick(200); out.use.decl = decl('logo'); out.use.targets = S().model.masks.find(k => k.name === 'logo')?.targets;
ops.releaseMask('logo'); await tick(200); out.released = decl('logo');
const merged = ops.useAsMask(['logo', 'badge']); await tick(200);
out.merged = { name: merged, decl: decl(merged), masks: S().model.masks.map(k => k.name + ' [' + k.shapes.join(' ') + '] -> ' + k.targets.join(' ')), order: S().model.objects.map(o => o.name) };
${base}
// Two masks merged keep the higher one's list, and their own go.
ops.useAsMask(['logo']); await tick(150);
const both = ops.useAsMask(['logo', 'spot']); await tick(200);
out.mergeMasks = { name: both, decl: decl(both), logo: decl('logo'), spot: decl('spot'), masks: S().model.masks.map(k => k.name + ' [' + k.shapes.join(' ') + '] -> ' + k.targets.join(' ')) };
return out`,

  // Taking in and letting out, the shortest way.
  TICK1: `${base}
const out = {};
const scope = () => obj('spot').attrs.masks;
ops.setMasked('spot', ['title'], false); await tick(120); out.offTitle = scope();
ops.setMasked('spot', ['backdrop'], true); await tick(120); out.onBackdrop = scope();
ops.setMasked('spot', ['title'], true); await tick(120); out.onTitle = scope();
ops.setMasked('spot', ['badge'], true); await tick(120); out.onAbove = scope();
ops.setMasked('spot', ['badge'], false); await tick(120); out.offAbove = scope();
ops.setMasked('spot', ['bar'], false); await tick(120); out.offClass = scope();
ops.setMasked('spot', ['bar1'], true); await tick(120); out.onMember = scope();
ops.setMasked('spot', ['bar'], true); await tick(120); out.onClass = scope();
${swap("masks: 'below'", "masks: 'title logo'")}
ops.setMasked('spot', ['logo'], false); await tick(120); out.namesOff = scope();
ops.setMasked('spot', ['title'], false); await tick(120); out.namesEmpty = { scope: scope(), isMask: !!S().model.masks.find(k => k.name === 'spot'), decl: decl('spot') };
ops.setMasked('spot', ['bar2'], true); await tick(120); out.namesOn = scope();
out.selection = S().selection;
return out`,

  // A rename and a removal reach the lists; a mask of several goes with its picture; copies list the copies.
  NAMES1: `${base}
const out = {};
${swap("masks: 'below except backdrop'", "masks: 'title bar1 except bar1'")}
ops.requestRename({ object: 'title' }); await tick(200);
const input = document.querySelector('.dialog input'); const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; setter.call(input, 'headline'); input.dispatchEvent(new Event('input', { bubbles: true })); await tick(80);
document.querySelector('.dialog .dialog-actions .primary')?.click(); await tick(300);
out.renamed = { scope: obj('spot').attrs.masks, has: !!obj('headline'), err: S().error };
ops.deleteObjects(['bar1'], true); await tick(300);
out.deleted = { scope: obj('spot').attrs.masks, err: S().error };
${base}
const copies = ops.duplicateObjects(['spot', 'backdrop', 'title']); await tick(300);
out.copies = { names: copies, decl: decl(copies[0]) };
${base}
const merged = ops.useAsMask(['logo', 'badge']); await tick(200);
ops.deleteObjects([merged], true); await tick(300);
out.maskGroupDeleted = { objects: S().model.objects.map(o => o.name), masks: S().model.masks.map(k => k.name), err: S().error };
return out`,

  // The export draws what the view draws.
  EXPORT1: `${base}
const { FrameRenderer } = await import('/src/export/FrameRenderer.ts');
const at = (pixels, wx, wy) => { const i = ((540 - wy) * 1920 + (wx + 960)) * 4; return '#' + [pixels[i], pixels[i + 1], pixels[i + 2]].map(v => v.toString(16).padStart(2, '0')).join('') + (pixels[i + 3] === 255 ? '' : ' a' + pixels[i + 3]) };
const out = {};
for (const alpha of [false, true]) {
  const fr = new FrameRenderer(1920, 1080, '#1c1c1c', alpha);
  const p = fr.draw(S().model, 0);
  out[alpha ? 'alpha' : 'opaque'] = { inside: at(p, -200, -150), outside: at(p, -460, -150), badge: at(p, 700, 400), backdrop: at(p, -900, -500), logoOut: at(p, 0, -420) };
  const p2 = fr.draw(S().model, 2);
  out[alpha ? 'alphaMoved' : 'opaqueMoved'] = { bar2: at(p2, 460, -150), bar1: at(p2, -300, -150) };
  fr.dispose();
}
// A mask switched off in the view still masks in an export.
S().setHidden(['spot'], true); await tick(80);
const fr = new FrameRenderer(1920, 1080, '#1c1c1c', false); out.offInView = at(fr.draw(S().model, 0), -460, -150); fr.dispose(); S().setHidden(['spot'], false);
return out`,
}
