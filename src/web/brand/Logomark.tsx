/**
 * Establo gate logomark — a rounded-square enclosure with three stacked
 * horizontal rails reading as an implied "E" and as a ledger / record.
 * The top rail is evergreen; the enclosure and lower rails follow currentColor
 * (foreground), so the mark adapts to light and dark surfaces. The `mono`
 * variant renders every stroke in currentColor (for single-color contexts).
 */
export function Logomark({
  className,
  variant = 'color',
  title,
}: {
  className?: string;
  variant?: 'color' | 'mono';
  title?: string;
}) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      xmlns="http://www.w3.org/2000/svg"
    >
      {title && <title>{title}</title>}
      <rect
        x="4"
        y="4"
        width="24"
        height="24"
        rx="7"
        stroke="currentColor"
        strokeWidth="2.5"
      />
      <line
        x1="10"
        y1="12"
        x2="22"
        y2="12"
        strokeWidth="2.5"
        strokeLinecap="round"
        className={variant === 'color' ? 'stroke-ever-600' : undefined}
        stroke={variant === 'color' ? undefined : 'currentColor'}
      />
      <line
        x1="10"
        y1="16"
        x2="22"
        y2="16"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <line
        x1="10"
        y1="20"
        x2="22"
        y2="20"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
