/** Logo Spec : « S » bleu suivi d'un point, sur fond sombre aux coins arrondis. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden focusable="false">
      <rect width="100" height="100" rx="22.5" fill="#0B0B10" />
      <g transform="translate(9.457 8.276) scale(0.7872)">
        <path d="M74 14 H34 A20 20 0 0 0 34 54 H62 A16 16 0 0 1 62 86 H24"
              fill="none" stroke="#3B82F6" strokeWidth="16" strokeLinecap="round" />
        <circle cx="90" cy="93" r="7" fill="#3B82F6" />
      </g>
    </svg>
  );
}
