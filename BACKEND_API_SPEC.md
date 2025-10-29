# Cherish Backend API Spec

**Base URL:** `http://localhost:3000` (dev) | `https://cherish-backend-f13q.onrender.com` (prod)

## Person Facts

```
POST /api/insert-person-fact
```

Create a new anecdote/fact about a person. AI generates a summary title automatically.

- Body: `{ user_id, person_id, content }`
- Returns: Created person fact with generated summary_title

---

## General Gift Ideas

```
POST /api/general-gift-ideas/generate
```

Generate initial AI gift idea categories for a person + event (e.g., "wireless workout headphones", "fitness gear").

- Body: `{ user_id, person_id, event_id, count?: 10 }`
- Returns: Array of general gift ideas with reasoning

```
GET /api/general-gift-ideas
```

Fetch stored general gift ideas. Includes user feedback status.

- Query: `?user_id=X&person_id=Y&event_id=Z&include_dismissed=false`
- Returns: Ideas with feedback_type, feedback_text, refinement_direction, feedback_given_at

```
POST /api/general-gift-ideas/refresh
```

Generate NEW gift ideas (excludes already-generated ones).

- Body: `{ user_id, person_id, event_id, count?: 5 }`
- Returns: Fresh gift ideas

```
PUT /api/general-gift-ideas/:id/dismiss
```

Mark a general gift idea as dismissed (soft delete).

- Body: `{ user_id }`
- Returns: Updated idea

```
POST /api/general-gift-ideas/:id/feedback
```

Provide feedback on a gift idea (like, dismiss, mark not relevant).

- Body: `{ user_id, feedback_type, feedback_text?, refinement_direction? }`
- feedback_type: `"dismissed"` | `"not_relevant"` | `"refine"` | `"like"`
- Returns: Feedback record

```
POST /api/general-gift-ideas/:id/refine
```

Generate refined versions based on user direction (e.g., "make it more affordable").

- Body: `{ user_id, refinement_direction, count?: 5 }`
- Returns: New refined gift ideas

---

## Specific Gift Ideas

```
POST /api/specific-gift-ideas/generate
```

Generate specific purchasable products from a general gift idea category. Uses product search to find real items with prices/links.

- Body: `{ user_id, person_id, event_id, general_gift_idea_id, count?: 10 }`
- Returns: Array of specific products with name, price, url, thumbnail_image, description

```
GET /api/specific-gift-ideas
```

Fetch previously generated specific gifts for a category. Includes interaction status (saved/passed) when user_id provided.

- Query: `?general_gift_idea_id=X&user_id=Y&limit=50&offset=0`
- Returns: Products with interaction_status, interaction_notes, interacted_at

```
POST /api/specific-gift-ideas/save
```

Mark a specific gift as saved.

- Body: `{ user_id, specific_gift_idea_id, person_id, event_id, general_gift_idea_id?, interaction_notes? }`
- Returns: Interaction record + gift details

```
POST /api/specific-gift-ideas/pass
```

Mark a specific gift as passed (user doesn't like it).

- Body: `{ user_id, specific_gift_idea_id, person_id, event_id, general_gift_idea_id?, interaction_notes? }`
- Returns: Interaction record

```
GET /api/specific-gift-ideas/saved
```

Fetch all saved gifts for a person + event.

- Query: `?user_id=X&person_id=Y&event_id=Z`
- Returns: Saved gifts with full product details and interaction data

---

## Typical User Flow

1. **User views person + event page**

   - `GET /api/general-gift-ideas?user_id=X&person_id=Y&event_id=Z`
   - If empty, call `POST /api/general-gift-ideas/generate`

2. **User clicks on a general idea** (e.g., "wireless headphones")

   - `GET /api/specific-gift-ideas?general_gift_idea_id=X&user_id=Y`
   - If empty, call `POST /api/specific-gift-ideas/generate`

3. **User saves or passes on products**

   - `POST /api/specific-gift-ideas/save` or `POST /api/specific-gift-ideas/pass`

4. **User views saved gifts**

   - `GET /api/specific-gift-ideas/saved?user_id=X&person_id=Y&event_id=Z`

5. **User doesn't like a general idea**

   - Option A: `PUT /api/general-gift-ideas/:id/dismiss`
   - Option B: `POST /api/general-gift-ideas/:id/refine` with refinement_direction

6. **User wants more ideas**
   - `POST /api/general-gift-ideas/refresh`

---

## Response Format

All endpoints return:

```json
{
  "success": true,
  "data": { ... },
  "error": "...",      // only on failure
  "message": "..."     // only on failure
}
```

## Authentication

All routes require `user_id` in request body/query. Frontend should get this from Supabase auth session.

## Error Handling

- `400` - Missing/invalid parameters
- `404` - Resource not found
- `409` - Duplicate interaction (e.g., already saved this gift)
- `500` - Server error

---

## Notes for Frontend

- **General ideas include feedback status** - check `feedback_type` field to show UI state
- **Specific gifts include interaction status** - check `interaction_status` ("saved"/"passed"/null)
- **IDs are UUIDs** - all IDs are uuid format from Supabase
- **Pagination supported** - specific gifts GET endpoint supports limit/offset
- **On-demand generation** - specific gifts generate when clicked, not pre-generated
- **Refinement is iterative** - users can refine general ideas multiple times
