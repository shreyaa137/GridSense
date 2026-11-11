import pytest

import main

HISTORICAL = "2024-03-15"   # inside the dataset
BEYOND = "2025-06-10"       # after the dataset ends: weather comes from Open-Meteo


def test_locations(client):
    assert client.get("/locations").json()["locations"] == sorted(main.CITIES)


@pytest.mark.parametrize("location", sorted(main.CITIES))
def test_day_forecast_shape_and_band(client, location):
    body = client.post("/forecast/day", json={"location": location, "date": HISTORICAL}).json()
    hours = body["hourly_forecast"]
    assert [h["hour"] for h in hours] == list(range(24))
    for h in hours:
        assert 0 <= h["lower_gw"] <= h["predicted_demand_gw"] <= h["upper_gw"]
        assert h["actual_demand_gw"] is not None
    assert body["in_training_data"] is True
    assert body["weather_source"] == "dataset"
    assert client.weather_calls == []


def test_forecast_is_close_to_actual_on_a_historical_day(client):
    hours = client.post("/forecast/day", json={"location": "National", "date": HISTORICAL}).json()["hourly_forecast"]
    error = sum(abs(h["predicted_demand_gw"] - h["actual_demand_gw"]) for h in hours)
    assert error / sum(h["actual_demand_gw"] for h in hours) < 0.15


def test_date_beyond_dataset_uses_one_weather_call(client):
    body = client.post("/forecast/day", json={"location": "Western", "date": BEYOND}).json()
    assert body["in_training_data"] is False
    assert all(h["actual_demand_gw"] is None for h in body["hourly_forecast"])
    assert len(client.weather_calls) == 1


def test_trend_carries_into_later_years(client):
    """The same weather a year later should give higher demand, because demand grows."""
    def mean_demand(date):
        hours = client.post("/forecast/day", json={"location": "National", "date": date}).json()["hourly_forecast"]
        return sum(h["predicted_demand_gw"] for h in hours) / 24

    # both dates are Tuesdays in June, so only the trend differs
    assert mean_demand("2026-06-09") > mean_demand("2025-06-10") * 1.03


def test_single_hour_matches_day_forecast(client):
    day = client.post("/forecast/day", json={"location": "Southern", "date": HISTORICAL}).json()
    one = client.post("/forecast", json={"location": "Southern", "target_datetime": f"{HISTORICAL}T19:00:00"}).json()
    assert one["predicted_demand_gw"] == day["hourly_forecast"][19]["predicted_demand_gw"]


def test_unknown_location_is_rejected(client):
    for path, body in [
        ("/forecast/day", {"location": "Mars", "date": HISTORICAL}),
        ("/summary/day", {"location": "Mars", "date": HISTORICAL}),
    ]:
        assert client.post(path, json=body).status_code == 400
    assert client.get("/metrics/series", params={"location": "Mars"}).status_code == 400


def test_explain_contributions_sum_to_100(client):
    body = client.post(
        "/explain", json={"location": "Northern", "target_datetime": f"{HISTORICAL}T14:00:00", "top_n": 20}
    ).json()
    assert sum(f["contribution_pct"] for f in body["top_features"]) == pytest.approx(100, abs=0.1)
    assert not any(f["feature"].startswith("location_") for f in body["top_features"])


def test_whatif_zero_delta_changes_nothing(client):
    body = client.post("/whatif", json={
        "location": "Eastern", "target_datetime": f"{HISTORICAL}T14:00:00",
        "changed_feature": "temperature", "delta": 0,
    }).json()
    assert body["change_gw"] == 0


def test_whatif_holiday_flag_is_clamped(client):
    # 26 January is Republic Day: making a holiday "more of a holiday" must do nothing
    body = client.post("/whatif", json={
        "location": "National", "target_datetime": "2024-01-26T10:00:00",
        "changed_feature": "is_holiday", "delta": 1,
    }).json()
    assert body["change_gw"] == 0


def test_whatif_rejects_unknown_feature(client):
    response = client.post("/whatif", json={
        "location": "National", "target_datetime": f"{HISTORICAL}T10:00:00",
        "changed_feature": "year", "delta": 1,
    })
    assert response.status_code == 400


def test_anomaly_day(client):
    hours = client.post("/anomaly/day", json={"location": "National", "date": HISTORICAL}).json()["hourly_anomalies"]
    assert len(hours) == 24
    for h in hours:
        assert h["is_anomaly"] == (abs(h["z_score"]) > 2.0)


def test_summary_mentions_peak_and_holiday(client):
    body = client.post("/summary/day", json={"location": "National", "date": "2023-08-15"}).json()
    forecast = client.post("/forecast/day", json={"location": "National", "date": "2023-08-15"}).json()
    peak = max(h["predicted_demand_gw"] for h in forecast["hourly_forecast"])
    assert f"{peak:.1f} GW" in body["headline"]
    assert any("Independence Day" in p for p in body["points"])


def test_summary_flags_extrapolation_beyond_dataset(client):
    body = client.post("/summary/day", json={"location": "National", "date": BEYOND}).json()
    assert any("past the end of the training data" in p for p in body["points"])


def test_metrics_report_model_against_baselines(client):
    body = client.get("/metrics").json()
    assert {"GridSense", "Original XGBoost", "Same hour last week", "Typical profile"} == set(body["summary"])
    assert body["summary"]["GridSense"]["wape_pct"] < body["summary"]["Original XGBoost"]["wape_pct"]
    assert "daily_series" not in body
    series = client.get("/metrics/series", params={"location": "Eastern"}).json()["series"]
    assert len(series) > 700
