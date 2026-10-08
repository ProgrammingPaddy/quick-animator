/** A small whole-number field with its own up and down buttons, in the app's style (D101). */
export function NumberField({ label, value, unit, min = 1, onChange }: { label: string; value: number; unit: string; min?: number; onChange: (value: number) => void }) {
  const set = (n: number) => onChange(Math.max(min, Math.round(n) || min))
  return (
    <label className="num-field" title={label}>
      <input type="number" min={min} step={1} value={value} onChange={(e) => set(Number(e.target.value))} />
      <span className="unit">{unit}</span>
      <span className="stepper">
        <button type="button" tabIndex={-1} onClick={() => set(value + 1)} aria-label={`${label}, more`}>
          {'▴'}
        </button>
        <button type="button" tabIndex={-1} onClick={() => set(value - 1)} aria-label={`${label}, less`}>
          {'▾'}
        </button>
      </span>
    </label>
  )
}
