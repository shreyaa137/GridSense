function Panel({ title, meta, children }) {
  return (
    <section className="rounded-xl border border-line bg-card p-5 sm:p-6 shadow-sm">
      {title && (
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 className="text-base font-semibold">{title}</h2>
          {meta && <span className="text-xs text-ink-soft">{meta}</span>}
        </div>
      )}

      {children}
    </section>
  )
}

export default Panel
