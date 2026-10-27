#!/usr/bin/env python3
"""本地静态服务器。摄像头与 Service Worker 要求 HTTPS（或 localhost）。
用法：
  python3 serve.py                 # HTTP，仅电脑本机 localhost 可测试
  python3 serve.py cert.pem key.pem  # HTTPS，供 iPhone 通过局域网访问（证书用 mkcert 生成，见 README）
"""
import http.server, ssl, socket, sys, os

PORT = 8443
os.chdir(os.path.dirname(os.path.abspath(__file__)))

class H(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map,
                      '.webmanifest': 'application/manifest+json', '.js': 'text/javascript', '.bin': 'application/octet-stream'}
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

srv = http.server.ThreadingHTTPServer(('0.0.0.0', PORT), H)
scheme = 'http'
if len(sys.argv) == 3:
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(sys.argv[1], sys.argv[2])
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    scheme = 'https'
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.connect(('8.8.8.8', 80)); ip = s.getsockname()[0]
except Exception:
    ip = '<电脑局域网IP>'
print(f'Hold Rep: {scheme}://localhost:{PORT}  |  局域网: {scheme}://{ip}:{PORT}')
srv.serve_forever()
