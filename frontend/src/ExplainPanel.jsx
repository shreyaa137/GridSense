import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { getExplanation } from './api'
import Panel from './Panel'

const HAZARD = '#E8622C'
const INK = '#1B2A4A'
const INK_SOFT = '#5B6B84'
const PAPER_LINE = '#D8E0E7'

function ExplainPanel({ location, date, hour }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (hour === null) return

    const targetDatetime = `${date}T${String(hour).padStart(2, '0')}:00:00`

    setLoading(true)
    setError(null)

    getExplanation(location, targetDatetime)
      .then((result) => setData(result))
      .catch(() => setError('Could not load explanation.'))
      .finally(() => setLoading(false))
  }, [location, date, hour])

  if (hour === null) {
    return (
      <Panel title="explanation">
        <p className="text-ink-soft font-mono text-sm">click a point on the chart above to see why the model predicted that value</p>
      </Panel>
    )
  }

  if (loading) return <Panel title="explanation"><p className="text-ink-soft font-mono text-sm">loading...</p></Panel>
  if (error) return <Panel title="explanation"><p className="text-signal font-mono text-sm">{error}</p></Panel>
  if (!data) return null

  return (
    <Panel title="explanation" meta={`hour ${hour}`}>
      <p className="font-mono text-sm text-ink-soft mb-4">
        {data.predicted_demand_gw} GW predicted
      </p>
      <ResponsiveContainer width="100%" height={230}>
        <BarChart data={data.top_features} layout="vertical" margin={{ left: 40 }}>
          <CartesianGrid stroke={PAPER_LINE} />
          <XAxis type="number" stroke={INK_SOFT} tick={{ fontFamily: 'JetBrains Mono', fontSize: 12 }} label={{ value: '% contribution', position: 'insideBottom', offset: -5, fill: INK_SOFT, fontSize: 12 }} />
          <YAxis type="category" dataKey="feature" stroke={INK_SOFT} tick={{ fontFamily: 'JetBrains Mono', fontSize: 12 }} width={140} />
          <Tooltip contentStyle={{ backgroundColor: '#EFF3F6', border: `1px solid ${INK}`, borderRadius: 0, fontFamily: 'JetBrains Mono', fontSize: 12 }} />
          <Bar dataKey="contribution_pct" fill={HAZARD} />
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  )
}

export default ExplainPanel