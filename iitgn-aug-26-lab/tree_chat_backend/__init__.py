"""Tree chat backend primitives for the prototype."""

import os
from pathlib import Path


def _load_dotenv() -> None:
    """Load KEY=VALUE lines from iitgn-aug-26-lab/.env without overriding the shell."""
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if not env_path.is_file():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.removeprefix("export ").strip()
        os.environ.setdefault(key, value.strip().strip("'\""))


_load_dotenv()
