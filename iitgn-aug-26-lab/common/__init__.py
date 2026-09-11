import os
import sys
import threading
import time
from contextlib import contextmanager
from openai import OpenAI

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"

# Default free model options (uncomment any to switch default)
# DEFAULT_MODEL = "google/gemma-4-31b-it:free"
# DEFAULT_MODEL = "google/gemma-4-26b-a4b-it:free"
# DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b:free"
DEFAULT_MODEL = "nvidia/nemotron-3.5-lightning:free"
# DEFAULT_MODEL = "nvidia/nemotron-3-super-120b-a12b:free"
# DEFAULT_MODEL = "cohere/north-mini-code:free"


def get_api_key() -> str:
    """Retrieve OPENROUTER_API_KEY from shell environment."""
    api_key = os.environ.get("OPENROUTER_API_KEY")
    if not api_key:
        print("❌ Error: OPENROUTER_API_KEY is not set in your environment.", file=sys.stderr)
        print("Set it using: export OPENROUTER_API_KEY='sk-or-v1-...'", file=sys.stderr)
        sys.exit(1)
    return api_key


def get_client() -> OpenAI:
    """Return an OpenAI client configured for OpenRouter."""
    return OpenAI(
        base_url=OPENROUTER_BASE_URL,
        api_key=get_api_key(),
    )


class Loader:
    """A simple console loader that cycles: . .. ... .... until stopped."""

    def __init__(self, message: str = "Thinking"):
        self.message = message
        self._stop_event = threading.Event()
        self._thread: threading.Thread | None = None

    def _animate(self) -> None:
        dots = [".", "..", "...", "...."]
        i = 0
        while not self._stop_event.is_set():
            sys.stdout.write(f"\r{self.message}{dots[i % len(dots)]}    ")
            sys.stdout.flush()
            time.sleep(0.3)
            i += 1
        # Clear the loading line when done
        sys.stdout.write("\r" + " " * (len(self.message) + 10) + "\r")
        sys.stdout.flush()

    def start(self) -> None:
        self._stop_event.clear()
        self._thread = threading.Thread(target=self._animate, daemon=True)
        self._thread.start()

    def stop(self) -> None:
        if self._thread:
            self._stop_event.set()
            self._thread.join()

    def __enter__(self):
        self.start()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.stop()


@contextmanager
def loading(message: str = "Thinking"):
    """Convenient context manager: with loading('Thinking'): ..."""
    loader = Loader(message)
    with loader:
        yield
