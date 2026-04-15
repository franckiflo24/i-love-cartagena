import pytest
import requests
import os
from pathlib import Path

# Load BASE_URL from frontend .env
frontend_env = Path('/app/frontend/.env')
BASE_URL = 'https://cartagena-week.preview.emergentagent.com'
if frontend_env.exists():
    for line in frontend_env.read_text().splitlines():
        if line.startswith('EXPO_PUBLIC_BACKEND_URL='):
            BASE_URL = line.split('=', 1)[1].strip().rstrip('/')
            break

@pytest.fixture
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session

@pytest.fixture
def auth_token():
    """Returns a test auth token if available"""
    return os.environ.get('TEST_AUTH_TOKEN', None)
