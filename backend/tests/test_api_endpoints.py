"""Test all backend API endpoints for Cartagena Music Week App"""
import pytest
import requests
import os
from datetime import datetime, timezone, timedelta
from pathlib import Path

# Load BASE_URL from frontend .env
frontend_env = Path('/app/frontend/.env')
BASE_URL = 'https://cartagena-week.preview.emergentagent.com'
if frontend_env.exists():
    for line in frontend_env.read_text().splitlines():
        if line.startswith('EXPO_PUBLIC_BACKEND_URL='):
            BASE_URL = line.split('=', 1)[1].strip().rstrip('/')
            break

class TestPublicEndpoints:
    """Test public endpoints that don't require authentication"""

    def test_events_list(self, api_client):
        """Test GET /api/events returns all events"""
        response = api_client.get(f"{BASE_URL}/api/events")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Response should be a list"
        assert len(data) == 15, f"Expected 15 events, got {len(data)}"
        
        # Verify first event structure
        if data:
            event = data[0]
            assert "event_id" in event
            assert "title" in event
            assert "date" in event
            assert "venue_name" in event
            assert "type" in event
            assert "_id" not in event, "MongoDB _id should be excluded"
        print("✓ GET /api/events - 15 events returned")

    def test_events_featured(self, api_client):
        """Test GET /api/events/featured returns featured events"""
        response = api_client.get(f"{BASE_URL}/api/events/featured")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        assert len(data) > 0, "Should return at least one featured event"
        
        # Verify featured events have featured flag or are valid events
        for event in data:
            assert "event_id" in event
            assert "title" in event
            assert "_id" not in event
        print(f"✓ GET /api/events/featured - {len(data)} featured events returned")

    def test_events_filter_by_date(self, api_client):
        """Test GET /api/events?date=2026-01-12 returns filtered events"""
        response = api_client.get(f"{BASE_URL}/api/events?date=2026-01-12")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        
        # Verify all events are for the specified date
        for event in data:
            assert event["date"] == "2026-01-12", f"Event {event['event_id']} has wrong date: {event['date']}"
        print(f"✓ GET /api/events?date=2026-01-12 - {len(data)} events for that date")

    def test_event_detail(self, api_client):
        """Test GET /api/events/evt_001 returns specific event"""
        response = api_client.get(f"{BASE_URL}/api/events/evt_001")
        assert response.status_code == 200
        
        event = response.json()
        assert event["event_id"] == "evt_001"
        assert event["title"] == "Sunset Session"
        assert "description" in event
        assert "venue_name" in event
        assert "_id" not in event
        print("✓ GET /api/events/evt_001 - Event detail returned")

    def test_event_not_found(self, api_client):
        """Test GET /api/events/invalid returns 404"""
        response = api_client.get(f"{BASE_URL}/api/events/invalid_event_id")
        assert response.status_code == 404
        print("✓ GET /api/events/invalid - 404 returned correctly")

    def test_venues_list(self, api_client):
        """Test GET /api/venues returns all venues"""
        response = api_client.get(f"{BASE_URL}/api/venues")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 10, f"Expected 10 venues, got {len(data)}"
        
        # Verify venue structure
        if data:
            venue = data[0]
            assert "venue_id" in venue
            assert "name" in venue
            assert "type" in venue
            assert "_id" not in venue
        print("✓ GET /api/venues - 10 venues returned")

    def test_venue_detail(self, api_client):
        """Test GET /api/venues/ven_001 returns specific venue"""
        response = api_client.get(f"{BASE_URL}/api/venues/ven_001")
        assert response.status_code == 200
        
        venue = response.json()
        assert venue["venue_id"] == "ven_001"
        assert venue["name"] == "La Muralla"
        assert "_id" not in venue
        print("✓ GET /api/venues/ven_001 - Venue detail returned")

    def test_partners_list(self, api_client):
        """Test GET /api/partners returns all partners"""
        response = api_client.get(f"{BASE_URL}/api/partners")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        assert len(data) == 8, f"Expected 8 partners, got {len(data)}"
        
        # Verify partner structure
        if data:
            partner = data[0]
            assert "partner_id" in partner
            assert "name" in partner
            assert "category" in partner
            assert "is_certified" in partner
            assert "_id" not in partner
        print("✓ GET /api/partners - 8 partners returned")

    def test_partner_detail(self, api_client):
        """Test GET /api/partners/ptr_001 returns specific partner"""
        response = api_client.get(f"{BASE_URL}/api/partners/ptr_001")
        assert response.status_code == 200
        
        partner = response.json()
        assert partner["partner_id"] == "ptr_001"
        assert partner["name"] == "Casa Bohème"
        assert partner["is_certified"] == True
        assert "_id" not in partner
        print("✓ GET /api/partners/ptr_001 - Partner detail returned")

    def test_itineraries_list(self, api_client):
        """Test GET /api/itineraries returns curated itineraries"""
        response = api_client.get(f"{BASE_URL}/api/itineraries")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 3, f"Expected at least 3 itineraries, got {len(data)}"
        
        # Verify itinerary structure
        if data:
            itinerary = data[0]
            assert "itinerary_id" in itinerary
            assert "name" in itinerary
            assert "stops" in itinerary
            assert "_id" not in itinerary
        print(f"✓ GET /api/itineraries - {len(data)} itineraries returned")

    def test_transport_list(self, api_client):
        """Test GET /api/transport returns transport routes"""
        response = api_client.get(f"{BASE_URL}/api/transport")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        assert len(data) >= 4, f"Expected at least 4 transport routes, got {len(data)}"
        
        # Verify transport structure
        if data:
            transport = data[0]
            assert "transport_id" in transport
            assert "type" in transport
            assert "route" in transport
            assert "schedule" in transport
            assert "_id" not in transport
        print(f"✓ GET /api/transport - {len(data)} transport routes returned")

    def test_event_types(self, api_client):
        """Test GET /api/event-types returns event type list"""
        response = api_client.get(f"{BASE_URL}/api/event-types")
        assert response.status_code == 200
        
        data = response.json()
        assert isinstance(data, list)
        assert "sunset" in data
        assert "concert" in data
        assert "wellness" in data
        print(f"✓ GET /api/event-types - {len(data)} event types returned")


class TestAuthEndpoints:
    """Test authentication endpoints"""

    def test_auth_me_without_token(self, api_client):
        """Test GET /api/auth/me without token returns 401"""
        response = api_client.get(f"{BASE_URL}/api/auth/me")
        assert response.status_code == 401
        print("✓ GET /api/auth/me (no token) - 401 returned correctly")

    def test_session_exchange_invalid(self, api_client):
        """Test POST /api/auth/session with invalid session_id"""
        response = api_client.post(
            f"{BASE_URL}/api/auth/session",
            json={"session_id": "invalid_session_id"}
        )
        # Should return 401 or 502 depending on auth service response
        assert response.status_code in [401, 502]
        print(f"✓ POST /api/auth/session (invalid) - {response.status_code} returned correctly")
