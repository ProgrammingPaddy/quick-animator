import { forwardRef, useImperativeHandle, useRef, type PointerEvent as ReactPointerEvent } from 'react'

/** An end of one of the scene's axes, as the compass shows it: `x`, `y`, or `z`, the way it points or the other. */
export interface CompassAxis {
  axis: 'x' | 'y' | 'z'
  sign: 1 | -1
}

export interface CompassHandle {
  /** Show the scene's axes as a view sees them: by the view's own right, up, and the way it looks. */
  set(right: { x: number; y: number; z: number }, up: { x: number; y: number; z: number }, forward: { x: number; y: number; z: number }): void
}

const AXES = ['x', 'y', 'z'] as const
/** How far an axis reaches from the middle, in the compass's own units. */
const REACH = 24

/**
 * The compass in a view's top right corner (D428, D435): the scene's three axes as the view sees
 * them, x to the right, y up, z toward the viewer. It shows which way the view, or the camera,
 * looks; a drag on it turns, and a press on an end of an axis looks along it. What a press does
 * is the pane's to say: it is handed the press and the end it was on, if any.
 */
export const Compass = forwardRef<CompassHandle, { title: string; onPress: (e: ReactPointerEvent<SVGSVGElement>, axis: CompassAxis | null) => void }>(function Compass({ title, onPress }, ref) {
  const svgRef = useRef<SVGSVGElement>(null)
  useImperativeHandle(
    ref,
    () => ({
      set(right, up, forward) {
        const svg = svgRef.current
        if (!svg) return
        const ends: { el: Element; depth: number }[] = []
        for (const axis of AXES) {
          // Where the axis points on the pane, and how far toward the viewer.
          const x = right[axis] * REACH
          const y = -up[axis] * REACH
          const near = -forward[axis]
          const line = svg.querySelector(`[data-line="${axis}"]`)
          const positive = svg.querySelector(`[data-axis="${axis}+"]`)
          const negative = svg.querySelector(`[data-axis="${axis}-"]`)
          if (!line || !positive || !negative) continue
          line.setAttribute('x2', x.toFixed(2))
          line.setAttribute('y2', y.toFixed(2))
          positive.setAttribute('transform', `translate(${x.toFixed(2)} ${y.toFixed(2)})`)
          negative.setAttribute('transform', `translate(${(-x).toFixed(2)} ${(-y).toFixed(2)})`)
          ;(positive as SVGElement).style.opacity = String(0.7 + 0.3 * Math.max(0, near))
          ;(negative as SVGElement).style.opacity = String(0.45 + 0.3 * Math.max(0, -near))
          ends.push({ el: line, depth: near - 0.01 }, { el: positive, depth: near }, { el: negative, depth: -near })
        }
        // The far ends are drawn first, so the near ones lie over them.
        ends.sort((a, b) => a.depth - b.depth)
        for (const { el } of ends) svg.appendChild(el)
      },
    }),
    [],
  )
  return (
    <svg
      ref={svgRef}
      className="compass"
      viewBox="-36 -36 72 72"
      onPointerDown={(e) => {
        e.stopPropagation()
        const end = e.target instanceof Element ? e.target.closest('[data-axis]') : null
        const name = end?.getAttribute('data-axis')
        onPress(e, name ? { axis: name[0] as CompassAxis['axis'], sign: name[1] === '+' ? 1 : -1 } : null)
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
    >
      <title>{title}</title>
      <circle className="compass-disc" r="35" />
      {AXES.map((axis) => (
        <line key={`l${axis}`} data-line={axis} className={`compass-line ${axis}`} x1="0" y1="0" x2="0" y2="0" />
      ))}
      {AXES.map((axis) => (
        <g key={`n${axis}`} data-axis={`${axis}-`} className={`compass-end negative ${axis}`}>
          <circle r="5.5" />
        </g>
      ))}
      {AXES.map((axis) => (
        <g key={`p${axis}`} data-axis={`${axis}+`} className={`compass-end positive ${axis}`}>
          <circle r="8.5" />
          <text textAnchor="middle" dominantBaseline="central">
            {axis.toUpperCase()}
          </text>
        </g>
      ))}
    </svg>
  )
})
