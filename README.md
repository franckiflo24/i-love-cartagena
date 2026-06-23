# AMO Cartagena

The official city-experience app for Cartagena — agenda, live map, certified partners,
transport, curated itineraries, City Pass, reservations, rewards, and an AI concierge.

- **frontend/** — Expo (expo-router) app for iOS, Android, and Web.
- **backend/** — FastAPI + MongoDB API (AI search/itinerary/moderation, reservations, reviews, rewards, Wompi payments, push).

## Stack
Expo · React Native · FastAPI · MongoDB (Atlas) · Anthropic Claude · Wompi · Render · Vercel · EAS

## Develop
```bash
# Frontend
cd frontend && npm install && npx expo start

# Backend
cd backend && pip install -r requirements.txt && uvicorn server:app --reload
```
Copy `frontend/.env.example` → `frontend/.env.local` and `backend/.env.example` → `backend/.env`.
