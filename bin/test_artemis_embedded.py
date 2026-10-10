import asyncio
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('embedded', Path(__file__).with_name('artemis-embedded.py'))
embedded = importlib.util.module_from_spec(spec)
spec.loader.exec_module(embedded)


class EmbedTests(unittest.TestCase):
    def test_only_explicit_origins(self):
        self.assertEqual(embedded.frame_policy('http://localhost:5173/'),
                         "frame-ancestors 'self' http://localhost:5173")
        for origin in ['*', 'https://*.example.com', 'http://localhost:5173;script-src *',
                       'http://user:pass@localhost:5173', 'http://localhost/path', 'null']:
            with self.subTest(origin=origin), self.assertRaises(ValueError):
                embedded.frame_policy(origin)

    def test_preserves_origin_rejection_and_other_headers(self):
        async def run():
            async def app(scope, receive, send):
                await send({'type': 'http.response.start', 'status': 403, 'headers': [
                    (b'x-frame-options', b'DENY'), (b'x-content-type-options', b'nosniff'),
                    (b'content-security-policy', b"script-src 'self'"),
                ]})
                await send({'type': 'http.response.body', 'body': b'Forbidden'})
            messages = []
            async def send(message):
                messages.append(message)
            await embedded.EmbedBoundary(app, embedded.frame_policy('http://localhost:5173'))(
                {'type': 'http'}, None, send)
            self.assertEqual(messages[0]['status'], 403)
            self.assertEqual(messages[1]['body'], b'Forbidden')
            headers = messages[0]['headers']
            self.assertIn((b'x-content-type-options', b'nosniff'), headers)
            self.assertIn((b'content-security-policy', b"script-src 'self'"), headers)
            self.assertNotIn((b'x-frame-options', b'DENY'), headers)
            self.assertIn((b'content-security-policy', b"frame-ancestors 'self' http://localhost:5173"), headers)
        asyncio.run(run())


if __name__ == '__main__':
    unittest.main()
