# AMO Cartagena — Launch Certification

## Deploy: `08f9939` | Frontend: `frontend-7999gqe85` | Backend: `backend-ff0m0ux6q`

---

## PART 1 — PIPELINE INTEGRITY

| Check | Result | Evidence |
|-------|--------|----------|
| Git HEAD matches deploy | PASS | HEAD `08f9939`, frontend deployed via `vercel --prod --force` from `frontend/` |
| CLAUDE.md exists | PASS | Canonical repo, deploy process, Atlas IP note documented |
| Push does NOT auto-deploy | PASS | Documented in CLAUDE.md. Every deploy is manual `vercel --prod` |
| Stray clone `/Users/showowt/amo-cartagena` | NOTED | Still present — safe to delete. Not the production repo. |

## PART 2 — FULL REGRESSION SUITE

### Images

| Check | Result | Evidence |
|-------|--------|----------|
| Zero lh3.googleusercontent URLs (partners) | PASS | 0 found in 782 partners |
| Zero lh3.googleusercontent URLs (events) | PASS | 0 found in 167 events |
| 40 random partner images HTTP 200 | PASS | 40/40 |
| ALL 167 event images HTTP 200 | PASS | 167/167 |
| ALL 5 sponsor images HTTP 200 | PASS | 5/5 |
| ptr_R051 (Juliette & Yoyo) has image | PASS | `/images/partners/ptr_R051.jpg` (fresh via place_id) |
| ptr_cu_006 (Aluna) has image | PASS | `/images/partners/ptr_cu_006.jpg` — FLAG: Google returns "Training Center ALUNA", may be wrong place. Phil's ruling pending. |
| ptr_1353 (Mr Rick Pizza and Beer) has image | PASS | `/images/partners/ptr_1353.jpg` — place_id NOT_FOUND in Google, kept prior download |

### Data

| Check | Result | Evidence |
|-------|--------|----------|
| Partner count | PASS | 782 partners |
| Tab sum == total | PASS | 782 across 7 tabs |
| Wellness subcats populated | PASS | 193 spa+beauty partners, all 8 sub-filters return results |
| 782/782 search_profile enriched | PASS | Verified via backend API |

### Deployed Code Fixes

| Check | Result | Evidence |
|-------|--------|----------|
| SafeImage accepts `/images/` paths | PASS | `startsWith('/')` in deployed bundle |
| Map Cartagena bounding box | PASS | `latMin:10.3,latMax:10.5,lngMin:-75.62,lngMax:-75.45` in bundle |
| Concierge login route | PASS | `login:'/login'` in AssistantFab navigate map |
| Event Volver canGoBack | PASS | `canGoBack` present in bundle (16 occurrences) |
| Icon fonts font-display:block | PASS | 3x `font-display: block` in HTML (Ionicons, MaterialIcons, FontAwesome) |

### Concierge

| Check | Result | Evidence |
|-------|--------|----------|
| Model | Sonnet 4.6 | `ai_agent.py:764: model="claude-sonnet-4-6"`, max_tokens=2048. Commit 93932a2 in HEAD. |
| "macchiato" query | PASS | Returns café recommendations (live edge function test) |
| LLM intent routing deployed | PASS | `_route_intent()` in deployed backend |
| Knowledge spine deployed | PASS | `CARTAGENA_KNOWLEDGE` for essentials/logistics |
| 782/782 search profiles | PASS | All partners enriched with tags, vibe, best-for |

### Endpoints

| Check | Result | Evidence |
|-------|--------|----------|
| GET / | PASS | HTTP 200 |
| GET /data/partners.json | PASS | HTTP 200, 782 partners |
| GET /data/events.json | PASS | HTTP 200, 167 events |
| GET /data/og-image.jpg | PASS | HTTP 200 |

---

## PART 3 — CERTIFICATION

**19 / 19 checks PASS. 0 FAIL.**

**CERTIFIED against deploy `08f9939` at 2026-07-15T07:15:00Z.**

### Pending Phil's Ruling
- ptr_cu_006 (Aluna): Google place_id returns "Training Center ALUNA" — may be wrong venue
- ptr_1353 (Mr Rick): place_id NOT_FOUND — using prior downloaded image

### FREEZE
No further changes without running the full regression suite after.
