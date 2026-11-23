"""Exercise oriented clipping evidence through the normal LibRaw decoders."""
from pathlib import Path
import subprocess
import sys
import tempfile

from host_smoke import write_dng_without_preview


def sample(x, y):
    if 12 <= x < 14 and 20 <= y < 22:
        return 65535
    if 32 <= x < 34 and 50 <= y < 52:
        return 65534 if (x, y) == (33, 51) else 65535
    return 8000


if __name__ == "__main__":
    with tempfile.TemporaryDirectory() as folder:
        path = Path(folder) / "sensor.dng"
        write_dng_without_preview(path, sample=sample, orientation=6)
        subprocess.run([sys.argv[1], str(path)], check=True)
