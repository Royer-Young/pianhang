#!/usr/bin/env python3
"""Port helpers for the one-click launcher.

The launcher must not assume :8000 is free: media players and other local
services often hold it. These helpers find a usable port and verify that a
running service is actually Pianhang before the browser or cpolar points at it.

Usage:
    python scripts/server_port.py check <port>
    python scripts/server_port.py free [start] [end]
    python scripts/server_port.py wait <port> [timeout_seconds]
"""
import json
import socket
import sys
import time
import urllib.request

DEFAULT_START = 8000
DEFAULT_END = 8099


def is_pianhang(port):
    """Return True when /api/status on this port is Pianhang's API."""
    try:
        with urllib.request.urlopen(
            "http://127.0.0.1:%d/api/status" % port, timeout=0.8
        ) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception:
        return False
    return isinstance(data, dict) and "mode" in data


def find_free(start, end):
    for port in range(start, end + 1):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind(("0.0.0.0", port))
            except OSError:
                continue
        return port
    return None


def main(argv):
    if len(argv) < 2:
        return 2
    mode = argv[1]

    try:
        port = int(argv[2]) if len(argv) > 2 else DEFAULT_START
    except ValueError:
        return 2

    if mode == "check":
        return 0 if is_pianhang(port) else 1

    if mode == "free":
        end = DEFAULT_END
        if len(argv) > 3:
            try:
                end = int(argv[3])
            except ValueError:
                return 2
        free_port = find_free(port, end)
        if free_port is None:
            return 1
        print(free_port)
        return 0

    if mode == "wait":
        timeout = 20.0
        if len(argv) > 3:
            try:
                timeout = float(argv[3])
            except ValueError:
                return 2
        deadline = time.time() + timeout
        while time.time() < deadline:
            if is_pianhang(port):
                return 0
            time.sleep(0.4)
        return 1

    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
