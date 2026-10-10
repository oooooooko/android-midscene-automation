"""Model editor writes only validated JSONC and preserves external changes."""

import json

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
import pytest

from apps.admin_console.routers import system
from artemis.config import paths


@pytest.fixture
def config_file(tmp_path, monkeypatch):
    path = tmp_path / 'artemis.jsonc'
    path.write_text((paths.ROOT_DIR / 'config/artemis.jsonc').read_text(encoding='utf-8'), encoding='utf-8')
    path.chmod(0o600)
    monkeypatch.setattr(paths, 'get_config_path', lambda _: path)

    async def snapshot():
        return {'config_content': path.read_text(encoding='utf-8')}

    monkeypatch.setattr(system, 'get_model_config_and_env', snapshot)
    return path


async def save(content, original, client_host='127.0.0.1', origin=None):
    app = FastAPI()
    app.include_router(system.router)
    transport = ASGITransport(app=app, client=(client_host, 12345))
    async with AsyncClient(transport=transport, base_url='http://localhost') as client:
        return await client.put('/api/system/model-config',
                                json={'content': content, 'original_content': original},
                                headers={'Origin': origin} if origin else {})


@pytest.mark.asyncio
async def test_save_preserves_jsonc_comments_format_and_permissions(config_file):
    original = config_file.read_text()
    edited = original + '\n// editor test\n'
    response = await save(edited, original)
    assert response.status_code == 200
    assert response.json()['config_content'] == edited
    assert config_file.read_text() == edited
    assert config_file.stat().st_mode & 0o777 == 0o600
    assert list(config_file.parent.iterdir()) == [config_file]


@pytest.mark.asyncio
@pytest.mark.parametrize('edited', [
    '{ invalid JSON',
    '[]',
    '{}',
    json.dumps({'default': {'provider': 'unknown', 'model': 'test',
                           'fallback': {'provider': 'openai', 'model': 'test'}}}),
    json.dumps({'default': {'provider': 'openai', 'model': 'test'}}),
])
async def test_invalid_config_keeps_original_file(config_file, edited):
    original = config_file.read_text()
    assert (await save(edited, original)).status_code == 400
    assert config_file.read_text() == original


@pytest.mark.asyncio
async def test_conflicting_external_edit_is_not_overwritten(config_file):
    original = config_file.read_text()
    external = original + '\n// external edit\n'
    config_file.write_text(external)
    assert (await save(original + '\n// draft\n', original)).status_code == 409
    assert config_file.read_text() == external


@pytest.mark.asyncio
async def test_failed_atomic_replace_preserves_original_and_cleans_temp(config_file, monkeypatch):
    original = config_file.read_text()

    def fail(*args):
        raise PermissionError('test')

    monkeypatch.setattr(system.os, 'replace', fail)
    assert (await save(original + '\n// draft\n', original)).status_code == 500
    assert config_file.read_text() == original
    assert list(config_file.parent.iterdir()) == [config_file]


@pytest.mark.asyncio
@pytest.mark.parametrize('client_host,origin', [
    ('192.168.1.20', None), ('127.0.0.1', 'https://untrusted.example')
])
async def test_editor_rejects_remote_or_cross_origin_writes(config_file, client_host, origin):
    original = config_file.read_text()
    assert (await save(original + '\n// draft\n', original, client_host, origin)).status_code == 403
    assert config_file.read_text() == original
