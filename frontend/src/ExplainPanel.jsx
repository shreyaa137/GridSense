import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { getExplanation } from './api'

function ExplainPanel({ location, date, hour }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (hour === null) return // nothing selected yet

    const targetDatetime = `${date}T${String(hour).padStart(2, '0')}:00:00`

    setLoading(true)
    setError(null)

    getExplanation(location, targetDatetime)
      .then((result) => setData(result))
      .catch(() => setError('Could not load explanation.'))
      .finally(() => setLoading(false))
  }, [location, date, hour])

  if (hour === null) {
    return <p className="text-slate-500 mt-6">Click a point on the chart above to see why the model predicted that value.</p>
  }

  if (loading) return <p className="text-slate-400 mt-6">Loading explanation...</p>
  if (error) return <p className="text-red-400 mt-6">{error}</p>
  if (!data) return null

  return (
    <div className="mt-8">
      <h2 className="text-xl font-semibold mb-2">
        Why {data.predicted_demand_gw} GW at hour {hour}?
      </h2>
      <ResponsiveContainer width="100%" height={250}>
        <BarChart data={data.top_features} layout="vertical" margin={{ left: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
          <XAxis type="number" stroke="#94a3b8" label={{ value: '% Contribution', position: 'insideBottom', offset: -5 }} />
          <YAxis type="category" dataKey="feature" stroke="#94a3b8" width={140} />
          <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none' }} />
          <Bar dataKey="contribution_pct" fill="#38bdf8" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export default ExplainPanel