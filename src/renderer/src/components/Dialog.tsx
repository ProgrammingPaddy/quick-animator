import { useEffect, useRef, useState } from 'react'
import { useStore } from '../state/store'

/** The one modal dialog of the app: a confirmation, optionally with a text field. */
export function DialogLayer() {
  const dialog = useStore((s) => s.dialog)
  const closeDialog = useStore((s) => s.closeDialog)
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    setValue(dialog?.input?.value ?? '')
    const handle = setTimeout(() => {
      if (dialog?.input) inputRef.current?.select()
      else confirmRef.current?.focus()
    }, 0)
    return () => clearTimeout(handle)
  }, [dialog])

  if (!dialog) return null
  const problem = dialog.input?.validate?.(value) ?? null
  const confirm = () => {
    if (problem) return
    const run = dialog.onConfirm
    closeDialog()
    run(value)
  }

  return (
    <div
      className="dialog-backdrop"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) closeDialog()
      }}
    >
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            confirm()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            closeDialog()
          }
        }}
      >
        <div className="dialog-title">{dialog.title}</div>
        {dialog.message && <div className="dialog-message">{dialog.message}</div>}
        {dialog.items && dialog.items.length > 0 && (
          <ul className="dialog-items">
            {dialog.items.map((item) => (
              <li key={item} className="mono">
                {item}
              </li>
            ))}
          </ul>
        )}
        {dialog.input && (
          <label className="dialog-input">
            <span>{dialog.input.label}</span>
            <input ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} spellCheck={false} autoComplete="off" />
          </label>
        )}
        {problem && <div className="dialog-problem">{problem}</div>}
        <div className="dialog-actions">
          <button onClick={closeDialog}>Cancel</button>
          <button ref={confirmRef} className={dialog.danger ? 'danger' : 'primary'} onClick={confirm} disabled={!!problem}>
            {dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
