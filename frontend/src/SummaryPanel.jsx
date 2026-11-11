import Panel from './Panel'

function SummaryPanel({ summary }) {
  if (!summary) return null

  return (
    <Panel title="Briefing" meta="Written from the model's outputs">
      <p className="text-lg font-semibold leading-snug mb-3">{summary.headline}</p>
      <ul className="space-y-1.5 text-sm leading-relaxed text-ink/80">
        {summary.points.map((point) => (
          <li key={point} className="flex gap-2">
            <span className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-primary"></span>
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </Panel>
  )
}

export default SummaryPanel
