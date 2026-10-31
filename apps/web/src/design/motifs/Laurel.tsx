/** A tiny laurel sprig (the emblem holders' mark). */
export function Laurel({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className={`kb-laurel${className ? ` ${className}` : ''}`}>
      <g fill="currentColor">
        <path d="M12 21c-4-2-7-6-7-11 1.5 3 4 5.5 7 6.5z" opacity={0.9} />
        <path d="M12 21c4-2 7-6 7-11-1.5 3-4 5.5-7 6.5z" opacity={0.9} />
        <ellipse cx="6" cy="8" rx="1.6" ry="3" transform="rotate(-30 6 8)" />
        <ellipse cx="18" cy="8" rx="1.6" ry="3" transform="rotate(30 18 8)" />
        <ellipse cx="8.5" cy="4.5" rx="1.4" ry="2.6" transform="rotate(-15 8.5 4.5)" />
        <ellipse cx="15.5" cy="4.5" rx="1.4" ry="2.6" transform="rotate(15 15.5 4.5)" />
      </g>
    </svg>
  );
}
