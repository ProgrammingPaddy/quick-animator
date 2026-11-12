// What bringing the chain in step found in the app (D355), each held by a check: the break after a line draws nothing, whatever a function gives it.
const NL = String.fromCharCode(10)
// Two lines of one letter each; a function puts a W where the break between them is, and leaves the letters.
const LINES = ['t = Text({', "  text: 'I\\nI',", '  fontSize: 200,', "  fill: '#ffffff',", '  until: 6,', '})', '', 't.to({', "  text: (progress, index, letter) => (index === 1 ? 'W' : letter),", "  by: 'char',", '  stagger: 0,', '  at: 0,', '  duration: 2,', "  ease: 'linear',", '})', ''].join(NL)

// The preview's pixel at a world point, as '#rrggbb', read right after a drawing.
const PIX = `
const px = (wx, wy) => { const g = geom(); const canvas = g.el.querySelector('canvas'); const gl = canvas.getContext('webgl2'); const r = canvas.getBoundingClientRect(); const k = canvas.width / r.width; const x = Math.round((g.sx(wx) - r.left) * k); const y = Math.round(canvas.height - (g.sy(wy) - r.top) * k); const out = new Uint8Array(4); st.setState({}); gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, out); return '#' + [...out.slice(0, 3)].map(v => v.toString(16).padStart(2, '0')).join('') };
`

export default {
  // The first line is its letter alone: nothing is drawn beside it, where a W put in the break's place would show.
  BREAK1: `${PIX}
await setSource(${JSON.stringify(LINES)}); S().select([]); S().setTime(1); await tick(400);
const lit = (points) => points.filter(([x, y]) => px(x, y) === '#ffffff').length;
const beside = []; for (let x = 50; x <= 120; x += 5) for (const y of [80, 100, 120, 140, 160]) beside.push([x, y]);
const onLetter = []; for (const y of [80, 100, 120, 140, 160]) onLetter.push([0, y]);
const text = await import('/src/model/text.ts');
return { besideTheLetter: lit(beside), onTheLetter: lit(onLetter) > 0, units: text.unitCount('I' + String.fromCharCode(10) + 'I', 'char'), running: S().model.objects[0].actions.length, err: S().error }`,
}
