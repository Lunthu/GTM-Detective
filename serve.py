#!/usr/bin/env python3
"""Tiny static dev server that disables caching, so edits to JS/CSS are always
picked up on reload. For local development/preview only."""
import http.server
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 4199


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True


with Server(('', PORT), NoCacheHandler) as httpd:
    print('Serving (no-cache) on port %d' % PORT)
    httpd.serve_forever()
