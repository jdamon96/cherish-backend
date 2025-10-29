# Local Testing Guide

## Prerequisites

1. **Install dependencies:**

   ```bash
   npm install
   ```

2. **Set up environment variables:**
   Create a `.env` file in the root directory with:
   ```env
   SUPABASE_URL=your_supabase_url
   SUPABASE_PROJECT_ID=your_project_id
   SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
   OPENAI_API_KEY=your_openai_api_key
   EXA_API_KEY=your_exa_api_key
   PORT=3000
   NODE_ENV=development
   ```

## Running the Server

### Development Mode (with hot reload):

```bash
npm run dev:watch
```

### Production Build:

```bash
npm run build
npm start
```

The server will start on `http://localhost:3000`

## Testing the `/api/summarize-anecdote` Endpoint

### 1. Health Check

First, verify the server is running:

```bash
curl http://localhost:3000/health
```

Expected response:

```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "environment": "development"
}
```

### 2. Test Summarize Anecdote

**Endpoint:** `POST /api/summarize-anecdote`

**Required Body:**

```json
{
  "person_fact_id": "uuid-of-person-fact",
  "user_id": "uuid-of-user"
}
```

**Example Request:**

```bash
curl -X POST http://localhost:3000/api/summarize-anecdote \
  -H "Content-Type: application/json" \
  -d '{
    "person_fact_id": "123e4567-e89b-12d3-a456-426614174000",
    "user_id": "123e4567-e89b-12d3-a456-426614174001"
  }'
```

**Expected Success Response:**

```json
{
  "success": true,
  "data": {
    "id": "123e4567-e89b-12d3-a456-426614174000",
    "original_content": "She loves to garden (both flowers and vegetables + herbs). She has a beautiful home garden at her and my dad's house in Nashville.",
    "summary_title": "Loves to garden"
  }
}
```

**Expected Error Responses:**

Missing person_fact_id:

```json
{
  "error": "Missing required field",
  "message": "person_fact_id is required"
}
```

Missing user_id:

```json
{
  "error": "Missing required field",
  "message": "user_id is required"
}
```

Person fact not found:

```json
{
  "error": "Person fact not found",
  "message": "Could not find person fact with the provided ID"
}
```

## Using Postman/Insomnia

### Postman Collection

1. Create a new POST request
2. URL: `http://localhost:3000/api/summarize-anecdote`
3. Headers: `Content-Type: application/json`
4. Body (raw JSON):
   ```json
   {
     "person_fact_id": "your-person-fact-uuid",
     "user_id": "your-user-uuid"
   }
   ```

## Testing with Real Data

### 1. Get a Real Person Fact ID

First, you'll need a valid `person_fact_id` from your Supabase database:

```sql
-- Run this in your Supabase SQL editor
SELECT id, content, user_id, person_id
FROM person_facts
WHERE content IS NOT NULL
LIMIT 5;
```

### 2. Test with Real Data

Use the actual IDs from your database:

```bash
curl -X POST http://localhost:3000/api/summarize-anecdote \
  -H "Content-Type: application/json" \
  -d '{
    "person_fact_id": "actual-uuid-from-db",
    "user_id": "actual-user-uuid-from-db"
  }'
```

## Debugging

### Check Logs

The server logs will show:

- Successful requests
- Database errors
- OpenAI API errors
- Validation errors

### Common Issues

1. **Environment Variables Not Set:**

   ```
   Error: Missing required environment variables: SUPABASE_URL, ...
   ```

   Solution: Check your `.env` file

2. **Invalid Supabase Credentials:**

   ```
   Error: Invalid or missing Supabase credentials
   ```

   Solution: Verify your Supabase URL and service role key

3. **OpenAI API Error:**

   ```
   Error: OpenAI API Error
   ```

   Solution: Check your OpenAI API key

4. **Person Fact Not Found:**
   ```
   Error: Person fact not found
   ```
   Solution: Verify the person_fact_id exists and belongs to the user

## Stub Endpoints

The following endpoints are currently stubs and will return placeholder responses:

- `GET /api/get-gift-recs` - Returns stub response
- `POST /api/get-gift-recs` - Returns stub response
- `POST /api/parse-gift-image` - Returns stub response

## Testing Product Search Endpoints

### 1. Search Product - Find Where to Buy

**Endpoint:** `POST /api/product/search`

**Required Body:**

```json
{
  "productName": "Sony WH-1000XM5 Headphones"
}
```

**Example Request:**

```bash
curl -X POST http://localhost:3000/api/product/search \
  -H "Content-Type: application/json" \
  -d '{
    "productName": "Sony WH-1000XM5 Headphones"
  }'
```

**Expected Success Response:**

```json
{
  "success": true,
  "data": {
    "productName": "Sony WH-1000XM5 Headphones",
    "searchQuery": "where to buy Sony WH-1000XM5 Headphones online",
    "results": [
      {
        "title": "Sony WH-1000XM5 - Amazon.com",
        "url": "https://www.amazon.com/Sony-WH-1000XM5-Headphones/...",
        "publishedDate": "2023-05-15",
        "author": null
      },
      {
        "title": "Sony WH-1000XM5 - Best Buy",
        "url": "https://www.bestbuy.com/site/sony-wh-1000xm5/...",
        "publishedDate": "2023-06-20",
        "author": null
      }
    ],
    "totalResults": 10
  }
}
```

**Expected Error Response (Missing productName):**

```json
{
  "success": false,
  "error": "Missing or invalid parameter",
  "message": "productName (string) is required"
}
```

### 2. Product Metadata - Extract Product Details from URL

**Endpoint:** `POST /api/product/metadata`

**Required Body:**

```json
{
  "productUrl": "https://www.amazon.com/Sony-WH-1000XM5/..."
}
```

**Example Request:**

```bash
curl -X POST http://localhost:3000/api/product/metadata \
  -H "Content-Type: application/json" \
  -d '{
    "productUrl": "https://www.amazon.com/Sony-WH-1000XM5-Wireless-Canceling-Headphones/dp/B09XS7JWHH"
  }'
```

**Expected Success Response:**

```json
{
  "success": true,
  "data": {
    "name": "Sony WH-1000XM5 Wireless Noise Canceling Headphones",
    "price": "$399.99",
    "imageUrl": "https://m.media-amazon.com/images/I/61vFO3duAhL._AC_SL1500_.jpg",
    "description": "Industry-leading noise cancellation with two processors controlling 8 microphones for unprecedented noise cancellation...",
    "productUrl": "https://www.amazon.com/Sony-WH-1000XM5-Wireless-Canceling-Headphones/dp/B09XS7JWHH"
  }
}
```

**Expected Error Responses:**

Missing productUrl:

```json
{
  "success": false,
  "error": "Missing or invalid parameter",
  "message": "productUrl (string) is required"
}
```

Invalid URL format:

```json
{
  "success": false,
  "error": "Invalid URL format",
  "message": "productUrl must be a valid URL"
}
```

Product not found:

```json
{
  "success": false,
  "error": "Product not found",
  "message": "Could not retrieve product information from the provided URL"
}
```

### Product Endpoints Use Cases

1. **Search for where to buy a gift idea:**
   - User receives gift recommendations
   - Search for each gift to find purchase locations
   - Display multiple purchase options to user

2. **Extract product details from a URL:**
   - User finds a product they want to save
   - Extract metadata to store in database
   - Display product card with image, price, and description

## Next Steps

Once the endpoints are working correctly, you can:

1. Deploy to Render.com
2. Integrate with your frontend
3. Implement additional features as needed
