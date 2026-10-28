// Stroke icons, decorative unless a parent gives them a label.
type IconProps = { size?: number }

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true
})

export const CubeIcon = ({ size = 24 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M12 2.5 21 7.5v9L12 21.5 3 16.5v-9z" />
    <path d="M3 7.5 12 12.5l9-5M12 12.5v9" />
  </svg>
)

export const SearchIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
)

export const FolderIcon = ({ size = 14 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 6.5A1.5 1.5 0 0 1 4.5 5H9l2 2h8.5A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" />
  </svg>
)

export const ChevronRightIcon = ({ size = 12 }: IconProps) => (
  <svg {...base(size)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
)

export const ChevronLeftIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="m15 6-6 6 6 6" />
  </svg>
)

export const GearIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
)

export const GithubIcon = ({ size = 18 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M9 19c-4 1.5-4-2-6-2.5M15 21v-3.5a3 3 0 0 0-.8-2.3c2.8-.3 5.8-1.4 5.8-6.2a4.8 4.8 0 0 0-1.3-3.3 4.5 4.5 0 0 0-.1-3.3s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6.2 0C6.6 2.1 5.6 2.4 5.6 2.4a4.5 4.5 0 0 0-.1 3.3A4.8 4.8 0 0 0 4.2 9c0 4.8 3 5.9 5.8 6.2a3 3 0 0 0-.8 2.3V21" />
  </svg>
)

export const RefreshIcon = ({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4" />
  </svg>
)

export const InfoIcon =({ size = 16 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8v.01" />
  </svg>
)

export const SphereIcon = ({ size = 24 }: IconProps) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12c0 2.2 3.8 4 8.5 4s8.5-1.8 8.5-4" />
    <path d="M8.5 7.5a4 4 0 0 1 3-1.5" />
  </svg>
)

export const AudioIcon = ({ size = 24 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2" />
  </svg>
)

export const AnimIcon = ({ size = 24 }: IconProps) => (
  <svg {...base(size)}>
    <path d="M3 17c3 0 4-10 7-10s3 10 7 10 3-6 4-6" />
    <circle cx="10" cy="7" r="1.4" />
    <circle cx="17" cy="17" r="1.4" />
  </svg>
)

export const ImageIcon = ({ size = 24 }: IconProps) => (
  <svg {...base(size)}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
    <circle cx="9" cy="9.5" r="1.6" />
    <path d="m20.5 16-5-5-8.5 8.5" />
  </svg>
)
