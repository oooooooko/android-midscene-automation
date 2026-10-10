"""Refresh reads local model settings without touching files or exposing credentials."""
import json

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
import pytest

from apps.admin_console.routers import system
from artemis.config import paths, settings
from artemis.llm.router import ModelFactory


@pytest.fixture
def files(tmp_path, monkeypatch):
    config = tmp_path / 'artemis.jsonc'
    config.write_text(json.dumps({'default': {
        'provider': 'openai', 'model': 'test-model',
        'fallback': {'provider': 'openai', 'model': 'test-model'},
    }}))
    env = tmp_path / '.env'
    env.write_text('OPENAI_API_KEY=test-secret-new-key\nOPENAI_BASE_URL=https://example.test/v1\nADB_PORT=1234\n')
    monkeypatch.setattr(paths, 'get_config_path', lambda _: config)
    monkeypatch.setattr(paths, 'get_env_file', lambda: env)
    for name in ('OPENAI_API_KEY', 'OPENAI_BASE_URL', 'GOOGLE_API_KEY', 'GEMINI_API_KEY',
                 'GCP_API_KEY', 'ANTHROPIC_API_KEY', 'OPEN_ROUTER_API_KEY', 'XAI_API_KEY',
                 'OCR_API_KEY', 'VISION_API_KEY', 'API_KEY'):
        monkeypatch.setattr(settings, name, getattr(settings, name))
        monkeypatch.setenv(name, 'test-previous-value')
    monkeypatch.setattr(ModelFactory, '_cache', {})
    return config, env


async def refresh(client_host='127.0.0.1', origin=None):
    app = FastAPI()
    app.include_router(system.router)
    async with AsyncClient(transport=ASGITransport(app=app, client=(client_host, 1234)),
                           base_url='http://localhost') as client:
        return await client.post('/api/system/model-config/refresh',
                                 headers={'Origin': origin} if origin else {})


@pytest.mark.asyncio
async def test_refresh_loads_disk_values_without_writing_or_exposing_keys(files):
    config, env = files
    original = (config.read_bytes(), env.read_bytes())
    adb_port = settings.ADB_PORT
    response = await refresh()
    assert response.status_code == 200
    assert settings.OPENAI_API_KEY.get_secret_value() == 'test-secret-new-key'
    assert settings.OPENAI_BASE_URL == 'https://example.test/v1'
    assert settings.ADB_PORT == adb_port
    assert 'test-secret-new-key' not in response.text
    assert response.json()['default_model']['model'] == 'test-model'
    assert (config.read_bytes(), env.read_bytes()) == original


@pytest.mark.asyncio
async def test_refresh_clears_removed_credentials_and_url(files):
    _, env = files
    assert (await refresh()).status_code == 200
    env.write_text('OPENAI_API_KEY=\n')
    response = await refresh()
    assert response.status_code == 200
    assert settings.OPENAI_API_KEY is None
    assert settings.OPENAI_BASE_URL is None
    assert not any(item['is_set'] for item in response.json()['env_vars'])


@pytest.mark.asyncio
@pytest.mark.parametrize('bad', ['json', 'schema', 'url', 'missing-env'])
async def test_invalid_refresh_does_not_change_loaded_settings(files, bad):
    config, env = files
    before = settings.OPENAI_API_KEY
    if bad == 'json': config.write_text('{ invalid')
    elif bad == 'schema': config.write_text('{}')
    elif bad == 'url': env.write_text('OPENAI_API_KEY=new-secret\nOPENAI_BASE_URL=https://[bad\n')
    else: env.unlink()
    assert (await refresh()).status_code == 400
    assert settings.OPENAI_API_KEY == before


@pytest.mark.asyncio
@pytest.mark.parametrize('host,origin', [('192.168.1.1', None), ('127.0.0.1', 'https://untrusted.test')])
async def test_refresh_requires_local_same_origin_request(files, host, origin):
    assert (await refresh(host, origin)).status_code == 403
