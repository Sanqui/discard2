#!/usr/bin/env python
"""
Read a mitmproxy dump file.
Used by src/reader/mitmproxy.ts
"""
import json
import sys

from mitmproxy import io, http
from mitmproxy.exceptions import FlowReadException

with open(sys.argv[1], "rb") as logfile:
    freader = io.FlowReader(logfile)
    try:
        for f in freader.stream():
            if isinstance(f, http.HTTPFlow):
                if f.request.host == 'gateway.discord.gg' and f.websocket:
                    for message in f.websocket.messages:
                        obj = {
                            'type': 'ws',
                            'timestamp': message.timestamp,
                            'direction': 'send' if message.from_client else 'recv'
                        }
                        if message.from_client:
                            obj['data'] = json.loads(message.text)
                        else:
                            obj['type'] = 'ws_compressed'
                            obj['compressed_data'] = message.content.hex()
                        
                        print(json.dumps(obj))
                
                if not f.response:
                    continue
                
                if f.request.host != 'discord.com':
                    continue

                skip_paths = ['/assets/', '/cdn-cgi/', '/login', '/api/v9/science']
                if any(f.request.path.startswith(path) for path in skip_paths):
                    continue

                response_headers = dict(f.response.headers)
                if response_headers.get('content-type') != 'application/json':
                    continue
                
                data = json.loads(f.response.content)
                
                obj = {
                    'type': 'http',
                    'timestamp_start': f.client_conn.timestamp_start,
                    'timestamp_end': f.server_conn.timestamp_end,
                    'request': {
                        'method': f.request.method,
                        'path': f.request.path,
                    },
                    'response': {
                        'status_code': f.response.status_code,
                        'data': data,
                    },
                }
                print(json.dumps(obj))

    except FlowReadException as e:
        print(f"Flow file corrupted: {e}")
