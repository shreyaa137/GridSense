import axios from 'axios'

// Set VITE_API_URL at build time to point a deployed frontend at its backend
const API_BASE = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'

// The backend explains failures (e.g. a date beyond the weather forecast) in `detail`
export function errorMessage(err, fallback) {
  const detail = err?.response?.data?.detail
  if (typeof detail === 'string') return detail
  if (!err?.response) return 'Could not reach the backend. Check that it is running.'
  return fallback
}

export async function getLocations() {
  const res = await axios.get(`${API_BASE}/locations`)
  return res.data.locations
}

export async function getDayForecast(location, date) {
  const res = await axios.post(`${API_BASE}/forecast/day`, { location, date })
  return res.data
}

export async function getExplanation(location, targetDatetime) {
  const res = await axios.post(`${API_BASE}/explain`, {
    location,
    target_datetime: targetDatetime,
  })
  return res.data
}

export async function getWhatif(location, targetDatetime, changedFeature, delta) {
  const res = await axios.post(`${API_BASE}/whatif`, {
    location,
    target_datetime: targetDatetime,
    changed_feature: changedFeature,
    delta,
  })
  return res.data
}

export async function getDayAnomalies(location, date, threshold = 2.0) {
  const res = await axios.post(`${API_BASE}/anomaly/day`, { location, date, threshold })
  return res.data.hourly_anomalies
}

export async function getDaySummary(location, date) {
  const res = await axios.post(`${API_BASE}/summary/day`, { location, date })
  return res.data
}

export async function getMetrics() {
  const res = await axios.get(`${API_BASE}/metrics`)
  return res.data
}

export async function getMetricsSeries(location) {
  const res = await axios.get(`${API_BASE}/metrics/series`, { params: { location } })
  return res.data.series
}
