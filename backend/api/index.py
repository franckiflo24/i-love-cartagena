import sys
from pathlib import Path

# Add parent (backend/) to path so server.py imports work
backend_dir = str(Path(__file__).resolve().parent.parent)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from server import app
