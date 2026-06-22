import sys
from pathlib import Path

# Add backend directory to Python path so all imports resolve
backend_dir = str(Path(__file__).resolve().parent.parent.parent / "backend")
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from server import app
