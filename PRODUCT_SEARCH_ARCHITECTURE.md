# Product Search Architecture

## Overview

The product search system has been refactored into a modular, service-based architecture that allows easy configuration and swapping of different providers for product search and metadata extraction.

## Architecture

### Two-Step Process

1. **Product Search** - Find purchasable URLs for a product
2. **Metadata Extraction** - Extract product details (price, description, image) from URLs

### Modular Design

The system uses a plugin-based architecture where:

- Each service implements a consistent interface
- Services can be easily enabled/disabled via configuration
- Multiple services can run in parallel for testing/comparison
- Results are tagged with their source for easy comparison

## Configuration

Located at the top of `src/routes/product-search.ts`:

```typescript
const CONFIG = {
  // Configure which search providers to use
  searchProviders: [
    SearchProvider.EXA,
    // SearchProvider.OPENAI_WEB_SEARCH,
  ],

  // Configure which metadata providers to use
  metadataProviders: [
    MetadataProvider.EXA_CONTENTS,
    MetadataProvider.APIFY_AMAZON,
  ],

  // Search settings
  maxSearchResults: 10,

  // Metadata settings
  useUrlRouting: true, // Route Amazon URLs to Apify, others to Exa
};
```

### Search Providers

#### EXA (SearchProvider.EXA)

- Uses Exa's neural search API
- Optimized for finding purchase locations
- Fast and accurate for e-commerce searches

#### OpenAI Web Search (SearchProvider.OPENAI_WEB_SEARCH)

- Uses OpenAI GPT-4o to generate search results
- Can leverage web search capabilities
- Good for complex queries

### Metadata Providers

#### Exa Contents (MetadataProvider.EXA_CONTENTS)

- Uses Exa's getContents API
- Works for most websites
- Fast content extraction

#### Apify Amazon (MetadataProvider.APIFY_AMAZON)

- Uses Apify's Amazon crawler
- Specifically designed for Amazon products
- Bypasses Amazon's anti-scraping measures
- Extracts detailed product information including:
  - Product name/title
  - Price
  - Images
  - Description
  - Availability

## URL Routing

When `useUrlRouting: true` (default):

- Amazon URLs → automatically routed to Apify
- Other URLs → automatically routed to Exa
- Ensures best service is used for each URL type

When `useUrlRouting: false`:

- All configured providers run in parallel
- Useful for testing and comparing providers

## API Endpoints

### POST /api/search

Search for purchasable URLs for a product.

**Request:**

```json
{
  "productName": "Sony WH-1000XM5 headphones"
}
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "source": "exa",
      "results": [
        {
          "title": "Sony WH-1000XM5 - Best Buy",
          "url": "https://www.bestbuy.com/...",
          "publishedDate": "2024-01-15",
          "author": "Best Buy"
        }
      ]
    }
  ],
  "config": {
    "providers": ["exa"]
  }
}
```

### POST /api/metadata

Extract product metadata from a URL.

**Request:**

```json
{
  "productUrl": "https://www.amazon.com/Sony-WH-1000XM5/..."
}
```

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "source": "apify_amazon",
      "metadata": {
        "name": "Sony WH-1000XM5 Wireless Headphones",
        "price": "$399.99",
        "imageUrl": "https://...",
        "description": "Industry-leading noise cancellation...",
        "productUrl": "https://www.amazon.com/...",
        "availability": "In Stock"
      }
    }
  ],
  "config": {
    "providers": ["exa_contents", "apify_amazon"],
    "urlRouting": true
  }
}
```

### POST /api/product/lookup

Combined endpoint: search for a product and return metadata for the best result.

**Request:**

```json
{
  "productName": "Sony WH-1000XM5 headphones"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "selectedUrl": "https://www.amazon.com/...",
    "searchResults": [...],
    "metadata": [...]
  },
  "debug": {
    "totalSearchResults": 10,
    "llmSelection": {
      "selectedIndex": 3,
      "selectedUrl": "https://www.amazon.com/...",
      "llmResponse": "3"
    }
  }
}
```

### POST /api/product/screenshot

Takes a screenshot of a product page (legacy endpoint).

## Service Classes

### ExaSearchService

```typescript
class ExaSearchService {
  async search(productName: string): Promise<SearchResult[]>;
}
```

### OpenAIWebSearchService

```typescript
class OpenAIWebSearchService {
  async search(productName: string): Promise<SearchResult[]>;
}
```

### ExaMetadataService

```typescript
class ExaMetadataService {
  async extractMetadata(url: string): Promise<ProductMetadata>;
}
```

### ApifyAmazonMetadataService

```typescript
class ApifyAmazonMetadataService {
  async extractMetadata(url: string): Promise<ProductMetadata>;
  isAmazonUrl(url: string): boolean;
}
```

## Orchestrators

### searchProductOrchestrator

Coordinates multiple search providers:

- Calls all configured providers in parallel
- Handles errors gracefully
- Returns results tagged with source

### extractMetadataOrchestrator

Coordinates multiple metadata extractors:

- Intelligently routes based on URL (if routing enabled)
- Calls all providers in parallel (if routing disabled)
- Handles errors gracefully
- Returns results tagged with source

## Environment Variables

Required environment variables in `.env`:

```bash
EXA_API_KEY=your_exa_api_key
OPENAI_API_KEY=your_openai_api_key
APIFY_API_TOKEN=your_apify_api_token
```

## Testing Different Providers

### Compare Search Providers

Enable both providers to compare results:

```typescript
searchProviders: [SearchProvider.EXA, SearchProvider.OPENAI_WEB_SEARCH];
```

Response will include results from both:

```json
{
  "data": [
    { "source": "exa", "results": [...] },
    { "source": "openai_web_search", "results": [...] }
  ]
}
```

### Compare Metadata Providers

Disable URL routing to test all providers:

```typescript
metadataProviders: [
  MetadataProvider.EXA_CONTENTS,
  MetadataProvider.APIFY_AMAZON,
],
useUrlRouting: false,
```

Both providers will run on every URL, allowing you to compare quality.

## Adding New Providers

### Adding a Search Provider

1. Add to enum:

```typescript
enum SearchProvider {
  EXA = "exa",
  OPENAI_WEB_SEARCH = "openai_web_search",
  YOUR_NEW_PROVIDER = "your_new_provider",
}
```

2. Create service class:

```typescript
class YourNewSearchService {
  async search(productName: string): Promise<SearchResult[]> {
    // Implementation
  }
}
```

3. Add to orchestrator:

```typescript
const services = {
  [SearchProvider.YOUR_NEW_PROVIDER]: new YourNewSearchService(),
  // ...
};
```

4. Enable in config:

```typescript
searchProviders: [SearchProvider.YOUR_NEW_PROVIDER];
```

### Adding a Metadata Provider

Follow the same pattern with `MetadataProvider` enum and `ProductMetadata` interface.

## Key Benefits

1. **Modularity** - Easy to add/remove/swap providers
2. **Configuration** - Simple config object to control behavior
3. **Parallel Testing** - Run multiple providers simultaneously
4. **Tagged Results** - Know which provider gave which results
5. **Smart Routing** - Automatically use best provider for each URL type
6. **Error Handling** - Graceful degradation if one provider fails
7. **Type Safety** - Consistent interfaces ensure compatibility

## Production Recommendations

For production, we recommend:

1. Enable only one search provider (fastest)
2. Keep URL routing enabled (optimal per-domain extraction)
3. Monitor provider performance and costs
4. Use Apify for all Amazon products
5. Use Exa for other e-commerce sites
