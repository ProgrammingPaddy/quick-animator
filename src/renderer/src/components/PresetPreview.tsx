import { useEffect, useMemo, useRef } from 'react'
import { evaluateScene } from '../model/evaluate'
import { existsAt, valueAt } from '../model/sample'
import { presetDemo } from '../project/presets'

const WIDTH = 240
const HEIGHT = 135
/** The frame is 1920 by 1080; the card shows it this much smaller. */
const SCALE = WIDTH / 1920

/**
 * A small scene playing a preset on a sample rectangle, over and over (D219), by a row of the
 * presets pane. It samples the same model the app would, so what it shows is what the preset
 * writes.
 */
export function PresetPreview({ id, variant, left, top, label }: { id: string; variant: string | undefined; left: number; top: number; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const demo = useMemo(() => presetDemo(id, variant), [id, variant])
  const model = useMemo(() => (demo ? evaluateScene(demo.source, 60).model : null), [demo])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx || !model || !demo) return
    const obj = model.objects[0]
    if (!obj) return
    const num = (attr: string, t: number): number => {
      const v = valueAt(model, obj, attr, t)
      return typeof v === 'number' ? v : 0
    }
    const started = performance.now()
    let handle = 0
    const draw = (now: number) => {
      const t = ((now - started) / 1000) % demo.length
      ctx.clearRect(0, 0, WIDTH, HEIGHT)
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
      ctx.lineWidth = 1
      ctx.strokeRect(0.5, 0.5, WIDTH - 1, HEIGHT - 1)
      if (existsAt(model, obj, t)) {
        ctx.save()
        ctx.globalAlpha = Math.max(0, Math.min(1, num('opacity', t)))
        ctx.translate(WIDTH / 2 + num('x', t) * SCALE, HEIGHT / 2 - num('y', t) * SCALE)
        ctx.rotate((-num('rotation', t) * Math.PI) / 180)
        const s = num('scale', t) || 1
        ctx.scale(s, s)
        const w = num('width', t) * SCALE
        const h = num('height', t) * SCALE
        ctx.fillStyle = '#4f8cff'
        ctx.fillRect(-w / 2, -h / 2, w, h)
        ctx.restore()
      }
      // The playhead's share of the loop, along the bottom.
      ctx.fillStyle = 'rgba(255, 255, 255, 0.35)'
      ctx.fillRect(0, HEIGHT - 2, (WIDTH * t) / demo.length, 2)
      handle = requestAnimationFrame(draw)
    }
    handle = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(handle)
  }, [model, demo])

  const x = Math.min(left, window.innerWidth - WIDTH - 24)
  const y = Math.min(top, window.innerHeight - HEIGHT - 40)
  return (
    <div className="preset-preview" style={{ left: x, top: y }} role="dialog" aria-label={`${label} preview`}>
      <canvas ref={canvasRef} width={WIDTH} height={HEIGHT} />
      <div className="caption">{label}</div>
    </div>
  )
}
