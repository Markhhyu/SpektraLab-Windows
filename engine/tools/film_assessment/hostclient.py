"""Minimal client for spektralab-host.exe (desktop/HOST-PROTOCOL.md).

Framing: 8-byte header (uint32 LE jsonLen, uint32 LE payloadLen) then JSON then payload.
"""
import json
import os
import struct
import subprocess
import sys
import time

DEFAULT_HOST = os.environ.get("SPEKTRA_HOST", "")
DEFAULT_RES = os.environ.get("SPEKTRA_RES", "")


class Engine:
    def __init__(self, host=DEFAULT_HOST, res=DEFAULT_RES, log_level="info"):
        if not host or not res:
            raise SystemExit("set SPEKTRA_HOST and SPEKTRA_RES to spektralab-host.exe and its engine resources")
        self.p = subprocess.Popen(
            [host, "--resources", res, "--log-level", log_level],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            bufsize=0,
        )
        self.id = 0
        self.stderr_lines = []

    def send(self, method, params=None, payload=b"", timeout=120.0):
        self.id += 1
        body = json.dumps({"id": self.id, "method": method, "params": params or {}}).encode()
        hdr = struct.pack("<II", len(body), len(payload))
        self.p.stdin.write(hdr + body + payload)
        self.p.stdin.flush()
        return self._recv(timeout)

    def _read_exact(self, n):
        buf = b""
        while len(buf) < n:
            chunk = self.p.stdout.read(n - len(buf))
            if not chunk:
                raise RuntimeError("host closed stdout: %r" % (self.drain_err(),))
            buf += chunk
        return buf

    def _recv(self, timeout):
        hdr = self._read_exact(8)
        jl, pl = struct.unpack("<II", hdr)
        body = self._read_exact(jl) if jl else b"{}"
        payload = self._read_exact(pl) if pl else b""
        q = json.loads(body)
        if q.get("ok") is False:
            raise RuntimeError("engine error for id %s: %s" % (q.get("id"), q.get("error")))
        return q.get("result"), payload

    def drain_err(self):
        try:
            import os
            os.set_blocking(self.p.stderr.fileno(), False)
            data = self.p.stderr.read() or b""
            os.set_blocking(self.p.stderr.fileno(), True)
            self.stderr_lines.append(data.decode("utf-8", "replace"))
            return "".join(self.stderr_lines)
        except Exception as e:
            return "<stderr unavailable: %s>" % e

    def close(self):
        try:
            self.send("shutdown", {})
        except Exception:
            pass
        try:
            self.p.stdin.close()
        except Exception:
            pass
        try:
            self.p.wait(timeout=5)
        except Exception:
            self.p.kill()
        return "".join(self.stderr_lines)


if __name__ == "__main__":
    eng = Engine()
    t0 = time.time()
    hello, _ = eng.send("hello", {})
    print("HELLO in %.0f ms" % ((time.time() - t0) * 1000))
    print(json.dumps(hello, indent=1)[:6000])
    eng.close()
