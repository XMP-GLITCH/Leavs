import { useState } from 'react'

const ACTIONS = [
  {
    id: 'upload',
    label: 'Upload book',
    desc: 'Add from your device',
    iconClass: 'fab-action__icon--moss',
    pills: ['PDF', 'EPUB', 'TXT'],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>
    ),
  },
  {
    id: 'import-audio',
    label: 'Import audio',
    desc: 'Attach to an existing book',
    iconClass: 'fab-action__icon--soil',
    pills: ['YouTube', 'MP3', 'M4A'],
    pillVariant: 'soil',
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    ),
  },
  {
    id: 'generate-audio',
    label: 'Generate audio',
    desc: 'AI voice for a book you have',
    iconClass: 'fab-action__icon--moss',
    pills: ['Edge TTS', 'AI'],
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
        <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
        <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
      </svg>
    ),
  },
]

export default function FAB({ onAction }) {
  const [open, setOpen] = useState(false)

  function handleAction(id) {
    setOpen(false)
    onAction?.(id)
  }

  return (
    <>
      {open && (
        <div className="fab-backdrop" onClick={() => setOpen(false)} />
      )}

      <div className="fab-container">
        {open && (
          <div className="fab-sheet fade-in" role="menu" aria-label="Add to library">
            <div className="fab-sheet__handle" />
            <div className="fab-sheet__header">
              <div className="fab-sheet__title">Add to library</div>
              <div className="fab-sheet__sub">Upload, import, or generate audio</div>
            </div>

            {ACTIONS.map(({ id, label, desc, icon, iconClass, pills, pillVariant }) => (
              <button
                key={id}
                className="fab-action"
                onClick={() => handleAction(id)}
                role="menuitem"
              >
                <span className={`fab-action__icon ${iconClass}`}>{icon}</span>
                <span className="fab-action__text">
                  <span className="fab-action__label">{label}</span>
                  <span className="fab-action__desc">{desc}</span>
                </span>
                {pills && (
                  <div className="fab-pills">
                    {pills.map(p => (
                      <span key={p} className={`pill${pillVariant === 'soil' ? ' pill--soil' : ''}`}>{p}</span>
                    ))}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}

        <button
          className={`fab${open ? ' fab--open' : ''}`}
          onClick={() => setOpen(!open)}
          aria-label={open ? 'Close menu' : 'Add book'}
          aria-expanded={open}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </>
  )
}
