# Cherish Backend API

A TypeScript Node.js/Express API for the Cherish application, providing endpoints for summarizing anecdotes, parsing gift images, and gift recommendations.

## Features

- **Summarize Anecdote**: Generate concise titles for personal anecdotes using OpenAI
- **Parse Gift Image**: Analyze product images and extract structured information
- **Gift Recommendations**: Placeholder endpoint for future gift recommendation functionality

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
SUPABASE_URL=your_supabase_url
SUPABASE_PROJECT_ID=your_project_id
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
OPENAI_API_KEY=your_openai_api_key
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
   - `NODE_ENV=production`

4. Deploy!

## Development

- **Development with hot reload**: `npm run dev:watch`
- **Build only**: `npm run build`
- **Production start**: `npm start`

## Project Structure

```
src/
├── app.ts              # Main Express application setup
├── index.ts            # Server startup script
├── config/
│   └── supabase.ts     # Supabase client configuration
├── routes/
│   ├── summarize.ts    # Summarize anecdote endpoint
│   ├── parse-gift.ts   # Parse gift image endpoint
│   └── gift-recs.ts    # Gift recommendations endpoint (stub)
└── types/
    └── env.ts          # Environment variable types
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
