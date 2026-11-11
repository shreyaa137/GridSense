import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { getExplanation } from './api'
import Panel from './Panel'
import { PRIMARY, INK_SOFT, LINE, TICK, TOOLTIP_STYLE } from './theme'


const FEATURE_LABELS = {
  temperature: 'temperature',
  humidity: 'humidity',
  hour: 'time of day',
  day_of_week: 'day of week',
  month: 'time of year',
  is_holiday: 'holiday',
  typical_ratio: 'usual pattern',
}

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
      .then((result) => setData({
        ...result,
        top_features: result.top_features.map((f) => ({ ...f, label: FEATURE_LABELS[f.feature] ?? f.feature })),
      }))
      .catch(() => setError('Could not load explanation.'))
      .finally(() => setLoading(false))
  }, [location, date, hour])

  if (hour === null) {
    return (
      <Panel title="Explanation">
        <p className="text-ink-soft text-sm">Click a point on the chart to see what drove that forecast.</p>
      </Panel>
    )
  }

  if (loading) return <Panel title="Explanation"><p className="text-ink-soft text-sm">Loading…</p></Panel>
  if (error) return <Panel title="Explanation"><p className="text-signal text-sm">{error}</p></Panel>
  if (!data) return null

  return (
    <Panel title="Explanation" meta={`hour ${hour}`}>
      <p className="text-sm text-ink-soft mb-4">
        {data.predicted_demand_gw} GW predicted. Bars show each factor's share of the model's adjustment for this hour.
      </p>
      <ResponsiveContainer width="100%" height={230}>
        <BarChart data={data.top_features} layout="vertical" margin={{ left: 40, bottom: 16 }}>
          <CartesianGrid stroke={LINE} />
          <XAxis type="number" stroke={LINE} tick={TICK} label={{ value: '% contribution', position: 'insideBottom', offset: -5, fill: INK_SOFT, fontSize: 12 }} />
          <YAxis type="category" dataKey="label" stroke={LINE} tick={TICK} width={140} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#EFF6FF' }} />
          <Bar dataKey="contribution_pct" name="contribution %" fill={PRIMARY} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  )
}

export default ExplainPanel