"""Gemeinsame Fixtures für die Tests der HA-Integration (pytest-homeassistant-custom-component)."""

import sys
from pathlib import Path

import pytest

# custom_components/ aus dem Repo-Root importierbar machen
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    """Eigene Integrationen in jedem Test erlauben."""
    yield
