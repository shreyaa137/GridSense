import axios from 'axios'

const API_BASE = 'http://127.0.0.1:8000'

export async function getLocations() {
  const res = await axios.get(`${API_BASE}/locations`)
  return res.data.locations
}

export async function getDayForecast(location, date) {
  const res = await axios.post(`${API_BASE}/forecast/day`, {
    location,
    date,
  })
  return res.data.hourly_forecast
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
  const res = await axios.post(`${API_BASE}/anomaly/day`, {
    location,
    date,
    threshold,
  })
  return res.data.hourly_anomalies
}