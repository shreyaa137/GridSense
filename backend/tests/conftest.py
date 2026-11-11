import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import main  # noqa: E402


@pytest.fixture
def client(monkeypatch):
    """API client with Open-Meteo replaced by fixed weather, so tests never hit the network."""
    calls = []

    def fake_weather(location, day):
        calls.append((location, day))
        return [(25.0 + hour / 4, 60.0) for hour in range(24)]

    monkeypatch.setattr(main, "fetch_day_weather", fake_weather)
    test_client = TestClient(main.app)
    test_client.weather_calls = calls
    return test_client
