export function Spinner({ label = 'Loading…', className = '' }: { label?: string; className?: string }) {
  return (
    <div role="status" className={`flex items-center justify-center gap-3 text-sm text-slate-600 ${className}`}>
      <svg className="size-5 animate-spin text-indigo-600 motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      <span>{label}</span>
    </div>
  );
}
