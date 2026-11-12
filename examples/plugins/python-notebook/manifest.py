"""Contract shared by the portable UI package and separately deployed HTTP service."""
import json
from pathlib import Path
MANIFEST = json.loads(Path(__file__).with_name("manifest.json").read_text())
