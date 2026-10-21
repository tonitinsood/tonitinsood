#!/usr/bin/env python3
"""Extract human-readable text from a PDF on stdin. Writes UTF-8 to stdout.

Used by bot/lib/ingest/pdf.ts. Empty stdout means no extractable text
(scanned/image PDF or missing pypdf) — the caller must not dump binary.
"""
from __future__ import annotations

import sys
from io import BytesIO


def main() -> int:
    data = sys.stdin.buffer.read()
    if not data:
        return 2
    if not data.lstrip().startswith(b"%PDF"):
        return 4
    try:
        from pypdf import PdfReader
    except ImportError:
        sys.stderr.write("pypdf is not installed\n")
        return 3
    try:
        reader = PdfReader(BytesIO(data))
        pages: list[str] = []
        for page in reader.pages:
            pages.append(page.extract_text() or "")
        text = "\n\n".join(pages).strip()
        sys.stdout.write(text)
        return 0
    except Exception as exc:  # noqa: BLE001 — caller treats non-zero as unreadable
        sys.stderr.write(f"pdf extract failed: {exc}\n")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
