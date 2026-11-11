# GridSense

Hourly electricity demand forecasting for India's power grid, with explanations of what drives each forecast.

GridSense predicts demand in GW for the national grid and its five regions (Northern, Western, Eastern, Southern, North-Eastern). An XGBoost model does the forecasting, SHAP explains it, and a React dashboard shows the result.

## Features

- **24-hour forecast with a range**: an hourly demand curve for any region and date, with an 80% range around it and actual demand overlaid where it is known.
- **Plain-language briefing**: a short written summary of the day (peak, how it compares with a typical day, the main driver, anything unusual), generated from the model's own outputs.
- **Explanations**: the factors that contributed most to a given hour's forecast, from SHAP values.
- **What-if simulator**: change temperature, humidity or holiday status and see how the forecast moves.
- **Anomaly indicator**: flags hours where predicted demand is far from what is typical for that region, hour and weekday.
- **Accuracy panel**: held-out results against three baselines, per region.
- **Live weather**: dates outside the training data use weather from [Open-Meteo](https://open-meteo.com), so you can forecast up to about 16 days ahead.

## Run it

You need Python 3 and Node.js. Run the backend and frontend in separate terminals, from the repo root.

**1. Backend** (http://127.0.0.1:8000)

```bash
python3 -m venv venv
venv/bin/pip install -r requirements.txt
venv/bin/uvicorn main:app --app-dir backend --reload
```

**2. Frontend** (http://localhost:5173)

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Interactive API docs are at http://127.0.0.1:8000/docs.

The trained model and processed data are committed, so there is nothing to train or download first.

## Model

Results from a rolling-origin backtest: four consecutive six-month windows (May 2022 to April 2024), each predicted by a model trained only on earlier data.

| Forecast | Error (WAPE) | MAE | Needs |
| --- | --- | --- | --- |
| **GridSense** | **7.1%** | 3.76 GW | A date and weather |
| Original XGBoost (first version) | 9.1% | 4.35 GW | A date and weather |
| Same hour last week | 6.2% | 3.21 GW | Last week's actual demand |
| Typical profile | 14.9% | 8.83 GW | Nothing |

WAPE is total absolute error as a share of total demand, averaged over the six regions. Regions differ about 100-fold in size, so pooled MAE mostly reflects the national series.

Reading the table:

- GridSense cuts error by 21% against the project's first model.
- It does not beat "same hour last week". That baseline needs actual demand from seven days earlier, so it cannot forecast further ahead than a week. GridSense uses no recent demand and can forecast any date that has weather.
- The gain is uneven: in the Southern region GridSense (8.3%) is slightly worse than the first model (8.1%).

How it works:

- **Trend plus ratio**: demand grows 4 to 7% a year and tree models cannot extrapolate a trend. Each region gets a fitted log-linear growth curve, and XGBoost predicts demand as a ratio to that curve.
- **Features**: temperature, humidity, hour, day of week, month, Indian public holiday flag, the typical ratio for that region, hour and weekday, and the region itself.
- **Range**: a second XGBoost model predicts the 10th and 90th percentiles. The range is then widened using backtest errors (conformalized quantile regression). With margins fitted on the first three windows, it covered 78% of hours in the fourth, against a target of 80%.
- **Data**: hourly demand from 1 January 2019 to 30 April 2024 for six locations, joined with hourly weather from the Open-Meteo archive for one representative city per region.

Forecasts for dates after April 2024 extrapolate the growth curve and have not been checked against actual demand.

## API

| Endpoint | What it returns |
| --- | --- |
| `GET /locations` | The available regions |
| `POST /forecast` | Demand and range for one location and hour |
| `POST /forecast/day` | Demand, range and actuals for all 24 hours of a date |
| `POST /summary/day` | The plain-language briefing for a date |
| `POST /explain` | The forecast and its top contributing features |
| `POST /whatif` | The forecast before and after changing one feature |
| `GET /anomaly` | Z-score of one hour's forecast against typical demand |
| `POST /anomaly/day` | The same for all 24 hours of a date |
| `GET /metrics` | Backtest results for the model and baselines |
| `GET /metrics/series` | Held-out daily actual and predicted demand for a region |

Request and response shapes are in the interactive docs at `/docs`.

## Project layout

```
backend/main.py       FastAPI app: all endpoints
backend/features.py   Trend and feature logic shared by training and serving
backend/train.py      Backtest, band calibration and final training
backend/tests/        API tests (weather is mocked, no network needed)
frontend/             React + Vite + Tailwind dashboard (charts with Recharts)
models/               Trained models, trend parameters and backtest results
data/processed/       Parquet files the API reads at startup
notebooks/            Original exploration and the first model
Dockerfile            Backend image
render.yaml           Deployment blueprint for Render
```

## Tests

```bash
venv/bin/pip install -r requirements-test.txt
venv/bin/python -m pytest backend/tests
```

GitHub Actions runs these, plus the frontend lint and build, on every push.

## Retraining

```bash
venv/bin/python backend/train.py
```

This reruns the backtest and rewrites everything in `models/` and `data/processed/typical_stats.parquet`. It needs only `data/processed/merged.parquet`, which is in the repo. It takes about a minute.

The notebooks record how the data was prepared and how the first model was built. They are not needed to retrain, and their saved models in `notebooks/models/` are no longer used by the API.

## Deploying

`render.yaml` defines two [Render](https://render.com) services: the API (built from the `Dockerfile`) and the dashboard (a static site).

1. In Render, create a new Blueprint from this repository.
2. Set `VITE_API_URL` on the dashboard to the API's URL, and redeploy the dashboard.
3. Set `GRIDSENSE_ALLOWED_ORIGINS` on the API to the dashboard's URL.

To run the API image locally:

```bash
docker build -t gridsense-api . && docker run -p 8000:8000 gridsense-api
```
