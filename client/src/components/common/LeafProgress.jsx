import { useId } from 'react'

export default function LeafProgress({ progress = 0, size = 32, className = '' }) {
  const uid = useId().replace(/:/g, '')
  const clipId = `lp-${uid}`
  const clampedProgress = Math.max(0, Math.min(1, progress))

  // Leaf runs from y=2 (tip) to y=56 (stem). Fill starts at stem and rises.
  const fillHeight = clampedProgress * 54
  const fillY = 56 - fillHeight

  return (
    <svg
      width={size}
      height={size * 1.5}
      viewBox="0 0 40 60"
      fill="none"
      className={className}
      aria-label={`${Math.round(clampedProgress * 100)}% complete`}
      role="img"
    >
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y={fillY} width="40" height={fillHeight + 2} />
        </clipPath>
      </defs>

      {/* Background leaf */}
      <path
        d="M20 56 C6 46 1 30 4 16 C7 6 20 2 20 2 C20 2 33 6 36 16 C39 30 34 46 20 56 Z"
        fill="var(--parchment-deep)"
        stroke="var(--vein)"
        strokeWidth="1.25"
      />

      {/* Centre vein */}
      <line x1="20" y1="54" x2="20" y2="6" stroke="var(--vein)" strokeWidth="0.75" />

      {/* Branch veins */}
      <path
        d="M20 44 L11 34 M20 36 L10 26 M20 28 L13 21"
        stroke="var(--vein)"
        strokeWidth="0.5"
        strokeLinecap="round"
      />
      <path
        d="M20 44 L29 34 M20 36 L30 26 M20 28 L27 21"
        stroke="var(--vein)"
        strokeWidth="0.5"
        strokeLinecap="round"
      />

      {/* Moss fill — clipped from stem upward */}
      <path
        d="M20 56 C6 46 1 30 4 16 C7 6 20 2 20 2 C20 2 33 6 36 16 C39 30 34 46 20 56 Z"
        fill="var(--moss)"
        clipPath={`url(#${clipId})`}
      />
    </svg>
  )
}
