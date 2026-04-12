# Auth Testing Playbook for Cartagena Music Week App

## Test User & Session Setup

```bash
mongosh --eval "
use('test_database');
var userId = 'test-user-' + Date.now();
var sessionToken = 'test_session_' + Date.now();
db.users.insertOne({
  user_id: userId,
  email: 'test.user.' + Date.now() + '@example.com',
  name: 'Test User',
  picture: 'https://via.placeholder.com/150',
  favorites: [],
  my_week: [],
  created_at: new Date()
});
db.user_sessions.insertOne({
  user_id: userId,
  session_token: sessionToken,
  expires_at: new Date(Date.now() + 7*24*60*60*1000),
  created_at: new Date()
});
print('Session token: ' + sessionToken);
print('User ID: ' + userId);
"
```

## Test Backend API

```bash
# Test auth endpoint
curl -X GET "https://music-week-ctg.preview.emergentagent.com/api/auth/me" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN"

# Test events
curl "https://music-week-ctg.preview.emergentagent.com/api/events"
curl "https://music-week-ctg.preview.emergentagent.com/api/events/featured"
curl "https://music-week-ctg.preview.emergentagent.com/api/events?date=2026-01-12"

# Test venues
curl "https://music-week-ctg.preview.emergentagent.com/api/venues"

# Test partners
curl "https://music-week-ctg.preview.emergentagent.com/api/partners"

# Test itineraries
curl "https://music-week-ctg.preview.emergentagent.com/api/itineraries"

# Test transport
curl "https://music-week-ctg.preview.emergentagent.com/api/transport"

# Test favorites (authenticated)
curl -X POST "https://music-week-ctg.preview.emergentagent.com/api/favorites/toggle" \
  -H "Authorization: Bearer YOUR_SESSION_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"event_id": "evt_001"}'
```

## Browser Testing

```python
# Set cookie and navigate
await page.context.add_cookies([{
    "name": "session_token",
    "value": "YOUR_SESSION_TOKEN",
    "domain": "music-week-ctg.preview.emergentagent.com",
    "path": "/",
    "httpOnly": True,
    "secure": True,
    "sameSite": "None"
}]);
await page.goto("https://music-week-ctg.preview.emergentagent.com");
```
