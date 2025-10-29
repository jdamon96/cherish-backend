# Product Search Refactoring - Migration Guide

## Summary of Changes

The product search system has been completely refactored from a monolithic implementation to a modular, service-based architecture.

## What Changed

### 1. Architecture

- **Before**: Hardcoded Exa search with Amazon filtering
- **After**: Pluggable search and metadata providers with configurable routing

### 2. Amazon Support

- **Before**: Amazon URLs were filtered out and rejected
- **After**: Amazon URLs fully supported via Apify Amazon crawler

### 3. Configuration

- **Before**: No easy way to switch between providers
- **After**: Simple CONFIG object at the top of the file to enable/disable providers

### 4. Multiple Providers

- **Before**: Only Exa for search, only Exa for metadata
- **After**: Support for multiple providers that can run in parallel for testing

### 5. Response Format

- **Before**: Single result object
- **After**: Array of results tagged with source provider for comparison

## New Dependencies

Added `apify-client` package for Amazon product scraping:

```bash
npm install apify-client
```

## New Environment Variable

Add to your `.env` file:

```bash
APIFY_API_TOKEN=your_apify_api_token
```

Get your token from: https://console.apify.com/account/integrations

## Configuration Guide

### Located at top of `src/routes/product-search.ts`

```typescript
const CONFIG = {
  // Enable/disable search providers
  searchProviders: [
    SearchProvider.EXA,
    // SearchProvider.OPENAI_WEB_SEARCH,
  ],

  // Enable/disable metadata providers
  metadataProviders: [
    MetadataProvider.EXA_CONTENTS,
    MetadataProvider.APIFY_AMAZON,
  ],

  maxSearchResults: 10,

  // Smart URL routing (recommended: true)
  useUrlRouting: true,
};
```

### Recommended Production Config

```typescript
const CONFIG = {
  searchProviders: [SearchProvider.EXA],
  metadataProviders: [
    MetadataProvider.EXA_CONTENTS,
    MetadataProvider.APIFY_AMAZON,
  ],
  maxSearchResults: 10,
  useUrlRouting: true,
};
```

This configuration:

- Uses only Exa for search (fastest)
- Automatically routes Amazon URLs to Apify
- Automatically routes other URLs to Exa
- Optimal for production use

### Testing Multiple Providers

To compare provider effectiveness:

```typescript
const CONFIG = {
  searchProviders: [SearchProvider.EXA, SearchProvider.OPENAI_WEB_SEARCH],
  metadataProviders: [
    MetadataProvider.EXA_CONTENTS,
    MetadataProvider.APIFY_AMAZON,
  ],
  maxSearchResults: 10,
  useUrlRouting: false, // Run all providers on every URL
};
```

This will return results from all providers so you can compare quality.

## API Response Changes

### `/api/search` endpoint

**Before:**

```json
{
  "success": true,
  "data": {
    "productName": "...",
    "results": [...]
  }
}
```

**After:**

```json
{
  "success": true,
  "data": [
    {
      "source": "exa",
      "results": [...]
    }
  ],
  "config": {
    "providers": ["exa"]
  }
}
```

### `/api/metadata` endpoint

**Before:**

```json
{
  "success": true,
  "data": {
    "name": "...",
    "price": "...",
    ...
  }
}
```

**After:**

```json
{
  "success": true,
  "data": [
    {
      "source": "apify_amazon",
      "metadata": {
        "name": "...",
        "price": "...",
        "availability": "...",
        ...
      }
    }
  ],
  "config": {
    "providers": ["exa_contents", "apify_amazon"],
    "urlRouting": true
  }
}
```

## Breaking Changes

1. **Response format changed**: Results are now arrays with source tags
2. **Amazon URLs now accepted**: Previously rejected, now handled via Apify
3. **New environment variable required**: `APIFY_API_TOKEN` must be set

## Backward Compatibility

To maintain backward compatibility with existing clients, you may want to:

1. Add a version parameter (`?v=2`) to new endpoints
2. Create wrapper endpoints that transform new response format to old format
3. Update clients to handle new response structure

## Service Classes

New modular service classes:

### Search Services

- `ExaSearchService` - Exa neural search
- `OpenAIWebSearchService` - OpenAI web search

### Metadata Services

- `ExaMetadataService` - Exa content extraction
- `ApifyAmazonMetadataService` - Apify Amazon crawler

### Orchestrators

- `searchProductOrchestrator` - Coordinates search providers
- `extractMetadataOrchestrator` - Coordinates metadata providers

## Testing

Test the refactored system:

```bash
# Build
npm run build

# Start dev server
npm run dev

# Test search endpoint
curl -X POST http://localhost:3000/api/search \
  -H "Content-Type: application/json" \
  -d '{"productName": "Sony WH-1000XM5 headphones"}'

# Test metadata endpoint with Amazon URL
curl -X POST http://localhost:3000/api/metadata \
  -H "Content-Type: application/json" \
  -d '{"productUrl": "https://www.amazon.com/..."}'

# Test lookup endpoint
curl -X POST http://localhost:3000/api/product/lookup \
  -H "Content-Type: application/json" \
  -d '{"productName": "Sony WH-1000XM5 headphones"}'
```

## Rollback

If you need to rollback:

1. Revert the `product-search.ts` file
2. Remove `apify-client` from `package.json`
3. Remove `APIFY_API_TOKEN` from `.env`
4. Run `npm install` and `npm run build`

## Next Steps

1. Get Apify API token and add to `.env`
2. Test with Amazon URLs to verify Apify integration
3. Compare provider results to determine best configuration
4. Update frontend to handle new response format
5. Monitor provider costs and performance

## Support

For issues or questions:

- See [PRODUCT_SEARCH_ARCHITECTURE.md](./PRODUCT_SEARCH_ARCHITECTURE.md) for detailed documentation
- Check console logs for provider-specific error messages
- Verify all environment variables are set correctly
