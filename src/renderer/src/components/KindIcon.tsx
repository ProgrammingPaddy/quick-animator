const LINE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

/**
 * A small picture of what a row is (D342): a kind of object, a group, a class, a mask, which
 * shows through where its picture is, or, inverted, everywhere else, or a camera (D357).
 */
export function KindIcon({ kind }: { kind: 'Rect' | 'Circle' | 'Text' | 'Shape' | 'Group' | 'Class' | 'Mask' | 'InvertedMask' | 'Camera' | 'Background' | (string & {}) }) {
  return (
    <svg className="kind-icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      {kind === 'Rect' && <rect x="2" y="4" width="12" height="8" rx="1.5" {...LINE} />}
      {kind === 'Circle' && <circle cx="8" cy="8" r="5.5" {...LINE} />}
      {kind === 'Text' && <path d="M3.5 5V3.2h9V5M8 3.2v9.6M6.3 12.8h3.4" {...LINE} />}
      {kind === 'Shape' && <path d="M8 2.2l5.6 4.2-2.1 6.6H4.5L2.4 6.4z" {...LINE} />}
      {kind === 'Group' && (
        <>
          <rect x="5.5" y="2" width="8.5" height="8.5" rx="1.5" {...LINE} />
          <path d="M10.5 10.5v2A1.5 1.5 0 0 1 9 14H3.5A1.5 1.5 0 0 1 2 12.5V7a1.5 1.5 0 0 1 1.5-1.5h2" {...LINE} />
        </>
      )}
      {kind === 'Class' && (
        <>
          <path d="M2.5 3.6v4a1.2 1.2 0 0 0 .35.85l5.2 5.2a1.2 1.2 0 0 0 1.7 0l3.9-3.9a1.2 1.2 0 0 0 0-1.7l-5.2-5.2a1.2 1.2 0 0 0-.85-.35h-4a1.1 1.1 0 0 0-1.1 1.1z" {...LINE} />
          <circle cx="5.5" cy="5.5" r="0.9" fill="currentColor" />
        </>
      )}
      {kind === 'Mask' && <path fill="currentColor" fillRule="evenodd" d="M3 2.5h10A1.5 1.5 0 0 1 14.5 4v8a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 12V4A1.5 1.5 0 0 1 3 2.5zM8 4.8a3.2 3.2 0 1 0 0 6.4 3.2 3.2 0 0 0 0-6.4z" />}
      {kind === 'Camera' && (
        <>
          <rect x="1.8" y="4.5" width="8.8" height="7" rx="1.4" {...LINE} />
          <path d="M10.6 7.2l3.6-1.9v5.4l-3.6-1.9z" {...LINE} />
        </>
      )}
      {kind === 'Background' && <rect x="2" y="3.5" width="12" height="9" rx="1.5" fill="currentColor" opacity="0.55" />}
      {kind === 'InvertedMask' && (
        <>
          <rect x="2" y="3" width="12" height="10" rx="1.5" {...LINE} />
          <circle cx="8" cy="8" r="3" fill="currentColor" />
        </>
      )}
    </svg>
  )
}

/** The eye of a row (D335, D341): open while the thing shows in the view, struck through while it is hidden there. */
export function Eye({ off }: { off: boolean }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M1.5 8c1.6-3 3.9-4.5 6.5-4.5S12.9 5 14.5 8c-1.6 3-3.9 4.5-6.5 4.5S3.1 11 1.5 8z" fill="none" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="8" cy="8" r="2" fill="currentColor" />
      {off && <path d="M3 13.5L13 2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />}
    </svg>
  )
}
