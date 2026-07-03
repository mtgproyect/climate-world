#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"

required = [
    DOCS / "index.html",
    DOCS / "assets/css/app.css",
    DOCS / "assets/js/app.js",
    DOCS / "assets/js/wind-overlay.js",
    DOCS / "config/app.json",
    DOCS / "data/latest.json",
]

missing = [str(path.relative_to(ROOT)) for path in required if not path.exists()]
if missing:
    print("Faltan archivos:")
    for item in missing:
        print(f" - {item}")
    raise SystemExit(1)

manifest = json.loads((DOCS / "data/latest.json").read_text(encoding="utf-8"))
if manifest.get("status") == "ready" and not manifest.get("frames"):
    print("El manifest dice ready pero no contiene cuadros.")
    raise SystemExit(1)

for frame in manifest.get("frames", []):
    for product in frame.get("products", {}).values():
        for key in ("west", "east", "data"):
            value = product.get(key)
            if value and not (DOCS / value).exists():
                print(f"No existe el producto declarado: {value}")
                raise SystemExit(1)

print("Validación correcta.")
