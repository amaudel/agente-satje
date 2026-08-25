import pytest

from app.config import Settings


def test_live_mode_with_default_demo_key_raises_on_construction():
    with pytest.raises(ValueError, match="API_KEYS"):
        Settings(satje_mode="live", api_keys="demo-key-change-me")


def test_live_mode_with_empty_api_keys_raises_on_construction():
    with pytest.raises(ValueError, match="API_KEYS"):
        Settings(satje_mode="live", api_keys="")


def test_official_mode_with_default_demo_key_raises_on_construction():
    with pytest.raises(ValueError, match="API_KEYS"):
        Settings(satje_mode="official", api_keys="demo-key-change-me")


def test_live_mode_with_real_api_key_does_not_raise():
    s = Settings(satje_mode="live", api_keys="prod_real_key_123")
    assert s.satje_mode == "live"


def test_fixture_mode_with_default_demo_key_does_not_raise():
    s = Settings(satje_mode="fixture", api_keys="demo-key-change-me")
    assert s.satje_mode == "fixture"
