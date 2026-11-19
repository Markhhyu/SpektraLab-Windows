#!/usr/bin/env python3
"""Print the release notes for one version of this repository.

RELEASES.md is the single source of truth for what changed in each release:
its History section holds the bilingual notes, in the same shape the GitHub
release page uses. Earlier versions also carried per-release copies such as
release-notes-1.7.0.md, which drifted from History and added one more file to
the tree every time we shipped. This helper replaces those files: it slices
the version out of History and lowers the heading level by one, because the
release page stands on its own while the changelog nests under "## History".

Usage:
    python scripts/release_notes.py 1.9.3 > notes.md
    gh release create v1.9.3 --notes-file notes.md
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

RELEASES = Path(__file__).resolve().parent.parent / "RELEASES.md"


def notes_for(version: str) -> str:
    wanted = version if version.startswith("v") else f"v{version}"
    text = RELEASES.read_text(encoding="utf-8")
    lines = text.splitlines()
    try:
        start = next(i for i, line in enumerate(lines) if line.startswith("## History"))
    except StopIteration:
        raise SystemExit("RELEASES.md has no '## History' section")

    heading = f"### {wanted} — "
    body: list[str] = []
    inside = False
    for line in lines[start + 1 :]:
        if line.startswith("### v"):
            if inside:
                break
            inside = line.startswith(heading)
            continue
        if inside:
            body.append(line)

    if not body:
        raise SystemExit(f"RELEASES.md has no entry for {wanted}")

    # The release page is a top-level document, so its sections render one
    # level higher than the same sections inside the changelog.
    out = "\n".join(body).strip("\n")
    out = out.replace('<h4 id="', '<h3 id="').replace("</h4>", "</h3>")
    out = re.sub(r"^#### ", "### ", out, flags=re.M)
    return out + "\n"


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.strip().splitlines()[0], file=sys.stderr)
        print("usage: release_notes.py <version>", file=sys.stderr)
        return 2
    # Write bytes: the notes are UTF-8 and a redirect on Windows would otherwise
    # encode them with the console code page and mangle every Chinese character.
    sys.stdout.buffer.write(notes_for(argv[1]).encode("utf-8"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
