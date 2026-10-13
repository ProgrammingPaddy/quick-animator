/** A small number field with its own up and down buttons, in the app's style (D101): whole numbers unless `step` says finer. */
export function NumberField({ label, value, unit, min = 1, step = 1, disabled = false, onChange }: { label: string; value: number; unit: string; min?: number; step?: number; disabled?: boolean; onChange: (value: number) => void }) {
  const decimals = step >= 1 ? 0 : Math.ceil(-Math.log10(step))
  const set = (n: number) => {
    const rounded = Number((Math.round(n / step) * step).toFixed(decimals))
    onChange(Math.max(min, Number.isFinite(rounded) ? rounded : min))
  }
  return (
    <label className="num-field" title={label}>
      <input type="number" min={min} step={step} value={value} disabled={disabled} onChange={(e) => set(Number(e.target.value))} />
      <span className="unit">{unit}</span>
      <span className="stepper">
        <button type="button" tabIndex={-1} onClick={() => set(value + step)} aria-label={`${label}, more`}>
          {'▴'}
        </button>
        <button type="button" tabIndex={-1} onClick={() => set(value - step)} aria-label={`${label}, less`}>
          {'▾'}
        </button>
      </span>
    </label>
  )
}
