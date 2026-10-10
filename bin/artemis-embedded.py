"""Launch an unmodified Artemis checkout with an explicit frame-ancestor allowlist."""

import os
from pathlib import Path
import sys
from urllib.parse import urlsplit


def frame_policy(origins: str) -> str:
    allowed = []
    for value in origins.split(','):
        origin = value.strip()
        parsed = urlsplit(origin)
        if (parsed.scheme not in {'http', 'https'} or not parsed.hostname
                or parsed.username or parsed.password or parsed.path not in {'', '/'}
                or parsed.query or parsed.fragment
                or any(char in origin for char in " \t\r\n;*'")):
            raise ValueError(f'Invalid ARTEMIS_EMBED_ORIGINS origin: {origin!r}')
        allowed.append(f'{parsed.scheme}://{parsed.netloc}')
    return "frame-ancestors 'self' " + ' '.join(allowed)


class EmbedBoundary:
    def __init__(self, app, policy: str):
        self.app = app
        self.policy = policy.encode('ascii')

    async def __call__(self, scope, receive, send):
        async def send_headers(message):
            if message['type'] == 'http.response.start':
                # Replace only the framing restriction; retain Host/Origin checks
                # and all other headers installed by Artemis's inner middleware.
                headers = [(key, value) for key, value in message.get('headers', [])
                           if key.lower() != b'x-frame-options']
                # Multiple CSP headers are enforced together by the browser.
                headers.append((b'content-security-policy', self.policy))
                message = {**message, 'headers': headers}
            await send(message)

        await self.app(scope, receive, send_headers)


if __name__ == '__main__':
    policy = frame_policy(os.environ.get(
        'ARTEMIS_EMBED_ORIGINS',
        'http://127.0.0.1:5173,http://localhost:5173,'
        'http://127.0.0.1:4173,http://localhost:4173',
    ))
    sys.path.insert(0, str(Path(os.environ['ARTEMIS_PROJECT_DIR']).resolve()))
    from apps.admin_console.server import app, run_ui_server
    from artemis.interfaces.cli.commands.ui import ensure_showcase_built
    from rich.console import Console

    ensure_showcase_built(Console())
    app.add_middleware(EmbedBoundary, policy=policy)
    run_ui_server(host='127.0.0.1', port=int(os.environ.get('ARTEMIS_PORT', '8000')))
