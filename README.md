# Cherish Backend API

A TypeScript Node.js/Express API for the Cherish application, providing endpoints for summarizing anecdotes, parsing gift images, and gift recommendations.

## Features

- **Summarize Anecdote**: Generate concise titles for personal anecdotes using OpenAI
- **Parse Gift Image**: Analyze product images and extract structured information
- **Gift Recommendations**: Personalized gift recommendations based on person's interests and events
- **Product Search**: Modular product search system with pluggable search and metadata extraction providers

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
SUPABASE_URL=your_supabase_url
SUPABASE_PROJECT_ID=your_project_id
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
OPENAI_API_KEY=your_openai_api_key
EXA_API_KEY=your_exa_api_key
APIFY_API_TOKEN=your_apify_api_token
PORT=3000
NODE_ENV=development
```

## Installation

1. Install dependencies:

```bash
npm install
```

2. Build the TypeScript code:

```bash
npm run build
```

3. Start the development server:

```bash
npm run dev
```

Or start the production server:

```bash
npm start
```

## API Endpoints

### Health Check

- **GET** `/health` - Returns server health status

### Summarize Anecdote

- **POST** `/api/summarize-anecdote`
- **Body**: `{ "person_fact_id": "uuid", "user_id": "uuid" }`
- **Response**: Returns the generated summary title and updates the `person_facts` table
- **Security**: Validates user ownership of the person fact

### Parse Gift Image

- **POST** `/api/parse-gift-image`
- **Body**: Form data with `image` field (multipart/form-data) + `user_id`, optional `person_id`, `event_id`, `save_to_db`
- **Response**: Returns structured product information extracted from the image
- **Optional**: Saves parsed gift data to `specific_gift_ideas` table if `save_to_db=true`

### Gift Recommendations

- **GET** `/api/get-gift-recs?user_id=uuid&person_id=uuid&event_type=BIRTHDAY&budget_min=10&budget_max=100`
- **Response**: Returns personalized gift recommendations based on person's interests, events, and existing gift ideas
- **Data Sources**: Uses `people`, `interests`, `events`, and `specific_gift_ideas` tables

### Product Search

**See [PRODUCT_SEARCH_ARCHITECTURE.md](./PRODUCT_SEARCH_ARCHITECTURE.md) for detailed documentation.**

- **POST** `/api/search` - Search for purchasable URLs for a product
- **POST** `/api/metadata` - Extract product metadata (price, description, images) from a URL
- **POST** `/api/product/lookup` - Combined search and metadata extraction with intelligent URL selection
- **POST** `/api/product/screenshot` - Capture a screenshot of a product page

The product search system features a modular architecture with configurable providers:

- Search providers: Exa, OpenAI Web Search
- Metadata providers: Exa Contents, Apify Amazon Scraper

### General Gift Ideas

Two-tier gift recommendation system: general categories → specific products

#### General Gift Ideas Routes

- **POST** `/api/general-gift-ideas/generate`

  - Body: `{ user_id, person_id, event_id, count?: 10 }`
  - Generate initial set of general gift idea categories using AI + person facts
  - Returns stored gift ideas with reasoning

- **GET** `/api/general-gift-ideas`

  - Query: `?user_id=X&person_id=Y&event_id=Z&include_dismissed=false`
  - Fetch stored general gift ideas
  - **Includes user feedback status** (dismissed, not_relevant, refine, like)
  - Filter by dismissal status

- **POST** `/api/general-gift-ideas/refresh`

  - Body: `{ user_id, person_id, event_id, count?: 5 }`
  - Generate NEW gift ideas (excludes existing ones)
  - Returns fresh gift ideas

- **PUT** `/api/general-gift-ideas/:id/dismiss`

  - Body: `{ user_id }`
  - Mark a general gift idea as dismissed

- **POST** `/api/general-gift-ideas/:id/feedback`

  - Body: `{ user_id, feedback_type, feedback_text?, refinement_direction? }`
  - Provide feedback on a general gift idea
  - Feedback types: `dismissed`, `not_relevant`, `refine`, `like`
  - Tracks user preferences for ML/personalization

- **POST** `/api/general-gift-ideas/:id/refine`

  - Body: `{ user_id, refinement_direction, count?: 5 }`
  - Generate refined versions based on user feedback
  - Example: "make it more affordable", "make it more tech-focused"
  - Returns new refined gift ideas

#### Specific Gift Ideas Routes

- **POST** `/api/specific-gift-ideas/generate`

  - Body: `{ user_id, person_id, event_id, general_gift_idea_id, count?: 10 }`
  - Generate specific purchasable products from a general gift idea
  - Uses product search system to find real products
  - Stores products with metadata (price, images, URL)

- **GET** `/api/specific-gift-ideas`

  - Query: `?general_gift_idea_id=X&user_id=Y&limit=50&offset=0`
  - Fetch previously generated specific gifts for a general category
  - **Includes interaction status** (saved/passed) when user_id provided
  - Supports pagination

- **POST** `/api/specific-gift-ideas/save`

  - Body: `{ user_id, specific_gift_idea_id, person_id, event_id, general_gift_idea_id?, interaction_notes? }`
  - Mark a specific gift as saved
  - Tracks user interaction in `gift_idea_interactions` table

- **POST** `/api/specific-gift-ideas/pass`

  - Body: `{ user_id, specific_gift_idea_id, person_id, event_id, general_gift_idea_id?, interaction_notes? }`
  - Mark a specific gift as passed
  - Tracks user interaction for future insights

- **GET** `/api/specific-gift-ideas/saved`
  - Query: `?user_id=X&person_id=Y&event_id=Z`
  - Fetch all saved specific gift ideas for a person + event
  - Returns full gift details with interaction data

## Deployment to Render.com

1. Push your code to a Git repository (GitHub, GitLab, etc.)

2. In Render.com:

   - Create a new "Web Service"
   - Connect your repository
   - Set the following build settings:
     - **Build Command**: `npm run build`
     - **Start Command**: `npm start`
     - **Environment**: `Node`

3. Add your environment variables in the Render dashboard:

   - `SUPABASE_URL`
   - `SUPABASE_PROJECT_ID`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `OPENAI_API_KEY`
   - `EXA_API_KEY`
   - `APIFY_API_TOKEN`
   - `NODE_ENV=production`

4. Deploy!

## Development

- **Development with hot reload**: `npm run dev:watch`
- **Build only**: `npm run build`
- **Production start**: `npm start`

## Project Structure

```
src/
├── app.ts                      # Main Express application setup
├── index.ts                    # Server startup script
├── database.types.ts           # Generated Supabase TypeScript types
├── config/
│   └── supabase.ts             # Supabase client configuration
├── routes/
│   ├── insert-person-fact.ts   # Insert person facts endpoint
│   ├── parse-gift.ts           # Parse gift image endpoint
│   ├── gift-recs.ts            # Gift recommendations endpoint
│   ├── product-search.ts       # Product search with modular providers
│   ├── general-gift-ideas.ts   # General gift idea generation & management
│   └── specific-gift-ideas.ts  # Specific gift generation & user interactions
└── types/
    └── env.ts                  # Environment variable types
```

## Error Handling

The API includes comprehensive error handling for:

- Missing environment variables
- Invalid API keys
- Database connection issues
- File upload errors
- OpenAI API errors
- Validation errors

## Security Features

- Helmet.js for security headers
- CORS configuration
- Rate limiting (100 requests per 15 minutes per IP)
- File size limits for uploads
- Input validation
- Error message sanitization in production

# cherish-backend
