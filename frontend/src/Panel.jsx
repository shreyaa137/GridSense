function Panel({ title, meta, children }) {
  return (
    <div className="relative border border-ink/30 bg-paper/70 p-6">
      <span className="absolute -top-px -left-px w-3 h-3 border-t-2 border-l-2 border-ink"></span>
      <span className="absolute -top-px -right-px w-3 h-3 border-t-2 border-r-2 border-ink"></span>
      <span className="absolute -bottom-px -left-px w-3 h-3 border-b-2 border-l-2 border-ink"></span>
      <span className="absolute -bottom-px -right-px w-3 h-3 border-b-2 border-r-2 border-ink"></span>

      {title && (
        <div className="mb-4 flex items-baseline justify-between border-b border-ink/20 pb-2">
          <h2 className="font-display font-semibold text-lg">{title}</h2>
          {meta && <span className="font-mono text-xs text-ink-soft">{meta}</span>}
        </div>
      )}

      {children}
    </div>
  )
}

export default Panel