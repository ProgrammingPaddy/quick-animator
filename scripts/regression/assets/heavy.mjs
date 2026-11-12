// A heavy SVG for timing: 60 overlapping blobs of 30 cubic segments each, as a drawing from an
// illustrator might be. The same text every time.
export function heavySvg() {
  let seed = 7
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const paths = []
  for (let i = 0; i < 60; i++) {
    const cx = 60 + rand() * 480
    const cy = 60 + rand() * 280
    const r = 30 + rand() * 50
    const n = 30
    const pts = Array.from({ length: n }, (_, k) => {
      const a = (k / n) * Math.PI * 2
      const rr = r * (0.7 + rand() * 0.6)
      return { x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr }
    })
    let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`
    for (let k = 0; k < n; k++) {
      const p0 = pts[k]
      const p1 = pts[(k + 1) % n]
      const c1 = { x: p0.x + (p1.x - p0.x) / 3 + (rand() - 0.5) * 10, y: p0.y + (p1.y - p0.y) / 3 + (rand() - 0.5) * 10 }
      const c2 = { x: p0.x + (2 * (p1.x - p0.x)) / 3 + (rand() - 0.5) * 10, y: p0.y + (2 * (p1.y - p0.y)) / 3 + (rand() - 0.5) * 10 }
      d += ` C ${c1.x.toFixed(1)} ${c1.y.toFixed(1)} ${c2.x.toFixed(1)} ${c2.y.toFixed(1)} ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`
    }
    d += ' Z'
    const hue = Math.round(rand() * 360)
    paths.push(`  <path id="blob${i}" d="${d}" fill="hsl(${hue}, 70%, 55%)" opacity="0.8"/>`)
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400" width="600" height="400">\n${paths.join('\n')}\n</svg>\n`
}
