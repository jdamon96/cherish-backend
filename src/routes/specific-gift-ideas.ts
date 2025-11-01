import { Router } from "express";
import { SupabaseClient } from "@supabase/supabase-js";
import Exa from "exa-js";
import OpenAI from "openai";
import { ApifyClient } from "apify-client";
import Parallel from "parallel-web";
import { Database } from "../config/supabase";

// Import types and orchestrators from product-search
interface SearchResult {
  title: string;
  url: string;
  publishedDate?: string;
  author?: string;
}

interface Price {
  amount: number | null;
  currency: string | null;
  formatted?: string | null;
}

interface ProductMetadata {
  name: string;
  price: Price;
  thumbnailImage: string | null;
  highResolutionImages: string[];
  description: string;
  productUrl: string;
  availability?: string;
  brand?: string | null;
  stars?: number | null;
  reviewsCount?: number | null;
  asin?: string | null;
}

enum SearchProvider {
  EXA = "exa",
  OPENAI_WEB_SEARCH = "openai_web_search",
  PARALLEL_WEB = "parallel_web",
}

enum MetadataProvider {
  EXA_CONTENTS = "exa_contents",
  APIFY_AMAZON = "apify_amazon",
  PARALLEL_WEB = "parallel_web",
}

interface SearchServiceResult {
  source: string;
  results: SearchResult[];
}

interface MetadataServiceResult {
  source: string;
  metadata: ProductMetadata;
}

// Configuration
const CONFIG = {
  searchProviders: [SearchProvider.PARALLEL_WEB] as SearchProvider[],
  metadataProviders: [MetadataProvider.PARALLEL_WEB] as MetadataProvider[],
  maxSearchResults: 10,
  useUrlRouting: false, // Use PARALLEL_WEB for ALL URLs (no automatic routing to Apify/Exa)
};

// Search Services
class ExaSearchService {
  constructor(private exa: Exa) {}

  async search(productName: string): Promise<SearchResult[]> {
    const searchQuery = `where to buy ${productName} online`;
    console.log("[ExaSearchService] Searching:", searchQuery);

    const searchResults = await this.exa.search(searchQuery, {
      numResults: CONFIG.maxSearchResults,
      type: "auto",
    });

    return searchResults.results.map((result) => ({
      title: result.title || "Unknown",
      url: result.url,
      publishedDate: result.publishedDate,
      author: result.author,
    }));
  }
}

class ParallelWebSearchService {
  constructor(private client: Parallel) {}

  async search(productName: string): Promise<SearchResult[]> {
    console.log("[ParallelWebSearchService] Searching:", productName);

    const searchQuery = `where to buy ${productName} online`;
    const search = await this.client.beta.search({
      objective: `Find online stores selling ${productName}`,
      search_queries: [searchQuery, productName],
      max_results: CONFIG.maxSearchResults,
      max_chars_per_result: 5000,
      betas: ["search-extract-2025-10-10"],
    });

    console.log(
      "[ParallelWebSearchService] Raw search response:",
      JSON.stringify(search, null, 2)
    );
    console.log(
      "[ParallelWebSearchService] Results count:",
      search.results?.length || 0
    );

    if (!search.results || search.results.length === 0) {
      console.warn(
        "[ParallelWebSearchService] No results returned from Parallel Web"
      );
      return [];
    }

    return search.results.map((result: any) => ({
      title: result.title || "Unknown",
      url: result.url,
      publishedDate: undefined,
      author: undefined,
    }));
  }
}

// Metadata Services
class ExaMetadataService {
  constructor(private exa: Exa) {}

  async extractMetadata(url: string): Promise<ProductMetadata> {
    console.log("[ExaMetadataService] Extracting metadata from:", url);

    const contentsResult = await this.exa.getContents([url], {
      text: true,
    });

    if (!contentsResult.results || contentsResult.results.length === 0) {
      throw new Error("No content retrieved from URL");
    }

    const result = contentsResult.results[0];

    return {
      name: result.title || "Unknown Product",
      price: {
        amount: null,
        currency: null,
        formatted: null,
      },
      thumbnailImage: null,
      highResolutionImages: [],
      description: result.text?.substring(0, 300) || "",
      productUrl: url,
    };
  }
}

class ApifyAmazonMetadataService {
  private client: ApifyClient;

  constructor(apiToken: string) {
    this.client = new ApifyClient({ token: apiToken });
  }

  isAmazonUrl(url: string): boolean {
    const urlLower = url.toLowerCase();
    return urlLower.includes("amazon.com") || urlLower.includes("amazon.");
  }

  async extractMetadata(url: string): Promise<ProductMetadata> {
    console.log("[ApifyAmazonMetadataService] Extracting metadata from:", url);

    if (!this.isAmazonUrl(url)) {
      throw new Error("Not an Amazon URL");
    }

    const input = {
      categoryOrProductUrls: [{ url }],
      maxItemsPerStartUrl: 1,
      proxyCountry: "AUTO_SELECT_PROXY_COUNTRY",
      maxSearchPagesPerStartUrl: 1,
      maxOffers: 0,
      locationDeliverableRoutes: ["PRODUCT"],
    };

    const run = await this.client.actor("junglee/amazon-crawler").call(input);
    const { items } = await this.client
      .dataset(run.defaultDatasetId)
      .listItems();

    if (!items || items.length === 0) {
      throw new Error("No product data retrieved from Apify");
    }

    const item = items[0] as any;

    let priceData: Price = {
      amount: null,
      currency: null,
      formatted: null,
    };

    if (item.price && typeof item.price === "object") {
      priceData = {
        amount: item.price.value || null,
        currency: item.price.currency || null,
        formatted:
          item.price.value && item.price.currency
            ? `${item.price.currency}${item.price.value}`
            : null,
      };
    } else if (item.price) {
      priceData = {
        amount: null,
        currency: null,
        formatted: String(item.price),
      };
    } else if (item.currentPrice) {
      priceData = {
        amount: null,
        currency: null,
        formatted: String(item.currentPrice),
      };
    }

    const highResImages: string[] = [];
    if (Array.isArray(item.highResolutionImages)) {
      highResImages.push(...item.highResolutionImages);
    } else if (Array.isArray(item.images)) {
      highResImages.push(...item.images);
    }

    let availability: string | undefined = undefined;
    if (item.inStockText && item.inStockText.trim()) {
      availability = String(item.inStockText);
    } else if (item.inStock !== undefined) {
      availability = item.inStock ? "In Stock" : "Out of Stock";
    } else if (item.availability) {
      availability = String(item.availability);
    }

    return {
      name: String(item.title || item.name || "Unknown Product"),
      price: priceData,
      thumbnailImage: item.thumbnailImage
        ? String(item.thumbnailImage)
        : item.image
        ? String(item.image)
        : item.imageUrl
        ? String(item.imageUrl)
        : null,
      highResolutionImages: highResImages,
      description: String(
        item.description ||
          item.productDescription ||
          item.bookDescription ||
          ""
      ),
      productUrl: String(item.url || url),
      availability,
      brand: item.brand ? String(item.brand) : null,
      stars: item.stars || null,
      reviewsCount: item.reviewsCount || null,
      asin: item.asin || item.originalAsin || null,
    };
  }
}

class ParallelWebMetadataService {
  constructor(private client: Parallel) {}

  async extractMetadata(url: string): Promise<ProductMetadata> {
    console.log("[ParallelWebMetadataService] Extracting metadata from:", url);

    // Define schemas with proper typing using 'as const'
    const inputSchema = {
      type: "object" as const,
      properties: {
        product_url: {
          type: "string" as const,
          description:
            "The URL of the product to retrieve structured metadata for",
        },
      },
      required: ["product_url"],
    };

    const outputSchema = {
      type: "object" as const,
      properties: {
        title: {
          type: "string" as const,
          description: "The full, official title of the product",
        },
        description: {
          type: "string" as const,
          description: "A comprehensive description of the product",
        },
        price: {
          type: "string" as const,
          description: "The current selling price with currency symbol",
        },
        image_url: {
          type: "string" as const,
          description: "The direct URL to the primary product image",
        },
      },
      required: ["title", "description", "price", "image_url"],
      additionalProperties: false,
    };

    // Type for the expected output
    type ParallelProductOutput = {
      title: string;
      description: string;
      price: string;
      image_url: string;
    };

    const taskRun = await this.client.taskRun.create({
      input: { product_url: url },
      processor: "pro",
      task_spec: {
        input_schema: {
          type: "json",
          json_schema: inputSchema,
        },
        output_schema: {
          type: "json",
          json_schema: outputSchema,
        },
      },
    });

    // Poll for results with timeout and retry logic (following docs pattern)
    let runResult;
    for (let i = 0; i < 144; i++) {
      try {
        runResult = await this.client.taskRun.result(taskRun.run_id, {
          timeout: 25,
        });
        break;
      } catch (error) {
        if (i === 143) throw error; // Last attempt failed
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (!runResult) {
      throw new Error("Failed to get task run result after retries");
    }

    // Type the output content based on our schema
    const output = runResult.output.content as ParallelProductOutput;

    return {
      name: output.title || "Unknown Product",
      price: {
        amount: null,
        currency: null,
        formatted: output.price || null,
      },
      thumbnailImage: output.image_url || null,
      highResolutionImages: output.image_url ? [output.image_url] : [],
      description: output.description || "",
      productUrl: url,
    };
  }
}

// Orchestrators
async function searchProductOrchestrator(
  productName: string,
  providers: SearchProvider[],
  exa: Exa,
  openai: OpenAI,
  parallelClient: Parallel | null
): Promise<SearchServiceResult[]> {
  const services: { [key: string]: any } = {
    [SearchProvider.EXA]: new ExaSearchService(exa),
    ...(parallelClient && {
      [SearchProvider.PARALLEL_WEB]: new ParallelWebSearchService(parallelClient),
    }),
  };

  const promises = providers.map(async (provider) => {
    try {
      const service = services[provider];
      const results = await service.search(productName);
      return {
        source: provider,
        results,
      };
    } catch (error) {
      console.error(`[${provider}] Search failed:`, error);
      return {
        source: provider,
        results: [],
        error:
          error instanceof Error ? error.message : "Unknown error occurred",
      };
    }
  });

  return Promise.all(promises);
}

async function extractMetadataOrchestrator(
  url: string,
  providers: MetadataProvider[],
  exa: Exa,
  apifyToken: string,
  parallelClient: Parallel | null,
  config: typeof CONFIG
): Promise<MetadataServiceResult[]> {
  const apifyService = new ApifyAmazonMetadataService(apifyToken);
  const exaService = new ExaMetadataService(exa);
  const parallelService = parallelClient
    ? new ParallelWebMetadataService(parallelClient)
    : null;

  const isAmazon = apifyService.isAmazonUrl(url);

  if (config.useUrlRouting) {
    if (isAmazon) {
      try {
        const metadata = await apifyService.extractMetadata(url);
        return [{ source: MetadataProvider.APIFY_AMAZON, metadata }];
      } catch (error) {
        console.error("[ApifyAmazonMetadataService] Failed:", error);
        return [
          {
            source: MetadataProvider.APIFY_AMAZON,
            metadata: {
              name: "Error",
              price: { amount: null, currency: null, formatted: null },
              thumbnailImage: null,
              highResolutionImages: [],
              description:
                error instanceof Error
                  ? error.message
                  : "Failed to extract metadata",
              productUrl: url,
            },
          },
        ];
      }
    } else {
      try {
        const metadata = await exaService.extractMetadata(url);
        return [{ source: MetadataProvider.EXA_CONTENTS, metadata }];
      } catch (error) {
        console.error("[ExaMetadataService] Failed:", error);
        return [
          {
            source: MetadataProvider.EXA_CONTENTS,
            metadata: {
              name: "Error",
              price: { amount: null, currency: null, formatted: null },
              thumbnailImage: null,
              highResolutionImages: [],
              description:
                error instanceof Error
                  ? error.message
                  : "Failed to extract metadata",
              productUrl: url,
            },
          },
        ];
      }
    }
  }

  const services: { [key: string]: any } = {
    [MetadataProvider.EXA_CONTENTS]: exaService,
    [MetadataProvider.APIFY_AMAZON]: apifyService,
    ...(parallelService && {
      [MetadataProvider.PARALLEL_WEB]: parallelService,
    }),
  };

  const promises = providers.map(async (provider) => {
    try {
      const service = services[provider];
      const metadata = await service.extractMetadata(url);
      return {
        source: provider,
        metadata,
      };
    } catch (error) {
      console.error(`[${provider}] Metadata extraction failed:`, error);
      return {
        source: provider,
        metadata: {
          name: "Error",
          price: { amount: null, currency: null, formatted: null },
          thumbnailImage: null,
          highResolutionImages: [],
          description:
            error instanceof Error ? error.message : "Unknown error occurred",
          productUrl: url,
        },
      };
    }
  });

  return Promise.all(promises);
}

// Product Name Extraction
/**
 * Extract specific product names from a general gift idea
 * Step 1 of the 3-step pipeline: General Gift Idea → Product Names
 */
async function extractProductNamesFromIdea(
  giftIdeaText: string,
  count: number,
  parallelClient: Parallel,
  openai: OpenAI
): Promise<string[]> {
  console.log(
    `[ProductNameExtraction] Extracting ${count} product names for: "${giftIdeaText}"`
  );

  // Search for the gift idea (without "where to buy" - we want product listings/reviews)
  const search = await parallelClient.beta.search({
    objective: `Find specific real products for ${giftIdeaText}`,
    search_queries: [
      giftIdeaText,
      `best ${giftIdeaText}`,
      `top ${giftIdeaText}`,
    ],
    max_results: 20, // Get more results to increase variety
    max_chars_per_result: 5000,
    betas: ["search-extract-2025-10-10"],
  });

  console.log(
    `[ProductNameExtraction] Search returned ${search.results?.length || 0} results`
  );

  if (!search.results || search.results.length === 0) {
    console.warn(
      "[ProductNameExtraction] No search results returned, cannot extract product names"
    );
    return [];
  }

  // Prepare search results for LLM
  const searchResultsForLLM = search.results.map((result: any, index: number) => ({
    index: index + 1,
    title: result.title,
    url: result.url,
    excerpts: result.excerpts || [],
  }));

  // Use LLM to extract specific product names
  const llmPrompt = `You are helping to extract specific, real product names from search results.

Gift idea category: "${giftIdeaText}"

Here are search results about this category:
${JSON.stringify(searchResultsForLLM, null, 2)}

Your task: Extract ${count} SPECIFIC PRODUCT NAMES from these search results. Look for:
- Full product names with brands and titles (e.g., "The Garden-Fresh Vegetable Cookbook by Andrea Chesman")
- Actual products mentioned in titles or excerpts
- Real product names, not generic descriptions
- Include the author/brand if mentioned

IMPORTANT:
- Extract only REAL products that are actually mentioned in the search results
- Do NOT make up or invent product names
- Do NOT use generic terms like "Garden Cookbook" - use full specific names
- If a result mentions multiple products, extract all of them
- Prioritize products that appear on e-commerce sites (Amazon, retailers, etc.)

Respond with ONLY a JSON object with a "products" key containing an array of product name strings.
Example: {"products": ["Product Name 1", "Product Name 2", "Product Name 3"]}`;

  const llmResponse = await openai.chat.completions.create({
    model: "chatgpt-4o-latest",
    messages: [
      {
        role: "system",
        content:
          "You are an expert at extracting specific product names from search results. Respond only with valid JSON containing a products array.",
      },
      {
        role: "user",
        content: llmPrompt,
      },
    ],
    response_format: { type: "json_object" },
    temperature: 0,
  });

  const llmContent = llmResponse.choices[0]?.message?.content;
  if (!llmContent) {
    throw new Error("LLM failed to extract product names");
  }

  let productNames: string[];
  try {
    const parsed = JSON.parse(llmContent);
    productNames = parsed.products || [];
  } catch (parseError) {
    console.error("Error parsing LLM response:", parseError);
    return [];
  }

  console.log(
    `[ProductNameExtraction] Extracted ${productNames.length} product names:`,
    productNames
  );

  // Return up to 'count' product names
  return productNames.slice(0, count);
}

export function specificGiftIdeasRoutes(supabase: SupabaseClient<Database>) {
  const router = Router();

  // Initialize clients
  const exaApiKey = process.env.EXA_API_KEY;
  if (!exaApiKey) {
    throw new Error("EXA_API_KEY environment variable is not set");
  }
  const exa = new Exa(exaApiKey);

  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }
  const openai = new OpenAI({ apiKey: openaiApiKey });

  const apifyApiToken = process.env.APIFY_API_TOKEN;
  if (!apifyApiToken) {
    throw new Error("APIFY_API_TOKEN environment variable is not set");
  }

  const parallelApiKey = process.env.PARALLEL_API_KEY;
  let parallelClient: Parallel | null = null;
  if (parallelApiKey) {
    parallelClient = new Parallel({ apiKey: parallelApiKey });
  }

  /**
   * POST /api/specific-gift-ideas/generate
   * Generate specific purchasable products from a general gift idea
   */
  router.post("/generate", async (req, res) => {
    try {
      const {
        user_id,
        person_id,
        event_id,
        general_gift_idea_id,
        count = 10,
      } = req.body;

      // Validate required parameters
      if (!user_id || !person_id || !event_id || !general_gift_idea_id) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters",
          message:
            "user_id, person_id, event_id, and general_gift_idea_id are required",
        });
      }

      // Fetch the general gift idea
      const { data: generalIdea, error: generalError } = await supabase
        .from("general_gift_ideas")
        .select("*")
        .eq("id", general_gift_idea_id)
        .eq("user_id", user_id)
        .single();

      if (generalError || !generalIdea) {
        return res.status(404).json({
          success: false,
          error: "General gift idea not found",
          message: "The specified general gift idea does not exist",
        });
      }

      console.log(
        `[SpecificGiftIdeas] Generating products for: "${generalIdea.idea_text}"`
      );

      // NEW STEP 1: Extract specific product names from the general gift idea
      const productNames = await extractProductNamesFromIdea(
        generalIdea.idea_text,
        count,
        parallelClient,
        openai
      );

      if (productNames.length === 0) {
        console.error(
          `[SpecificGiftIdeas] No product names extracted for "${generalIdea.idea_text}"`
        );
        return res.status(404).json({
          success: false,
          error: "No products found",
          message: `Could not extract any product names from "${generalIdea.idea_text}"`,
        });
      }

      console.log(
        `[SpecificGiftIdeas] Extracted ${productNames.length} product names`
      );

      // NEW STEP 2: For each product name, search for purchase URLs
      // We'll search for 1-2 URLs per product to ensure we get the best match
      const allProductUrlSearches = await Promise.all(
        productNames.map(async (productName) => {
          console.log(
            `[SpecificGiftIdeas] Searching for purchase URLs for: "${productName}"`
          );
          const searchResults = await searchProductOrchestrator(
            productName,
            CONFIG.searchProviders,
            exa,
            openai,
            parallelClient
          );

          // Combine results from all providers
          const allResults: SearchResult[] = [];
          searchResults.forEach((result) => {
            allResults.push(...result.results);
          });

          return {
            productName,
            searchResults: allResults,
          };
        })
      );

      // Combine all search results with their product names
      const allSearchResults: Array<SearchResult & { productName: string }> = [];
      allProductUrlSearches.forEach(({ productName, searchResults }) => {
        searchResults.forEach((result) => {
          allSearchResults.push({ ...result, productName });
        });
      });

      console.log(
        `[SpecificGiftIdeas] Total search results across all products: ${allSearchResults.length}`
      );

      if (allSearchResults.length === 0) {
        console.error(
          `[SpecificGiftIdeas] No purchase URLs found for products`
        );
        return res.status(404).json({
          success: false,
          error: "No purchase URLs found",
          message: "Could not find purchase URLs for the extracted products",
        });
      }

      // NEW STEP 3: Use LLM to select the best purchase URLs (filter to e-commerce only)
      const searchResultsForLLM = allSearchResults.map((result, index) => ({
        index: index + 1,
        productName: result.productName,
        title: result.title,
        url: result.url,
      }));

      const topN = Math.min(count, allSearchResults.length);
      const llmPrompt = `You are helping to identify the best URLs where a user can PURCHASE specific products online.

Original gift idea: "${generalIdea.idea_text}"

Here are ${allSearchResults.length} search results for specific products:
${JSON.stringify(searchResultsForLLM, null, 2)}

Your task: Select the ${topN} BEST URLs where someone can actually purchase these products. Look for:
- Direct product pages on e-commerce sites (Amazon, BestBuy, Target, Walmart, etc.)
- Official manufacturer stores
- Reputable online retailers
- Favor .com links over international domains
- Try to select diverse products (different URLs for different product names)

AVOID:
- Review sites
- Comparison sites
- News articles
- General information pages
- Wholesale/bulk sites

Respond with ONLY a JSON object with an "indices" key containing an array of index numbers (e.g., {"indices": [1, 5, 8, 12]}). Select exactly ${topN} items.`;

      const llmResponse = await openai.chat.completions.create({
        model: "chatgpt-4o-latest",
        messages: [
          {
            role: "system",
            content:
              "You are an expert at identifying e-commerce purchase URLs. Respond only with valid JSON.",
          },
          {
            role: "user",
            content: llmPrompt,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      });

      const llmContent = llmResponse.choices[0]?.message?.content;
      if (!llmContent) {
        throw new Error("LLM failed to select URLs");
      }

      let selectedIndices: number[];
      try {
        const parsed = JSON.parse(llmContent);
        selectedIndices = parsed.indices || parsed.selected || [];
      } catch (parseError) {
        console.error("Error parsing LLM response:", parseError);
        // Fallback: use first N results
        selectedIndices = Array.from({ length: topN }, (_, i) => i + 1);
      }

      // Get the selected URLs
      const selectedUrls = selectedIndices
        .filter((idx) => idx >= 1 && idx <= allSearchResults.length)
        .slice(0, topN)
        .map((idx) => allSearchResults[idx - 1].url);

      console.log(
        `[SpecificGiftIdeas] Selected ${selectedUrls.length} URLs for metadata extraction`
      );

      // STEP 4: Extract metadata for selected URLs
      console.log(
        `[SpecificGiftIdeas] Extracting metadata for ${selectedUrls.length} products...`
      );

      // Extract metadata for all selected URLs in parallel
      const metadataPromises = selectedUrls.map(async (url) => {
        try {
          const metadataResults = await extractMetadataOrchestrator(
            url,
            CONFIG.metadataProviders,
            exa,
            apifyApiToken,
            parallelClient,
            CONFIG
          );
          // Use the first successful result
          return metadataResults[0];
        } catch (error) {
          console.error(`Failed to extract metadata for ${url}:`, error);
          return null;
        }
      });

      const metadataResults = await Promise.all(metadataPromises);
      const validMetadata = metadataResults.filter((m) => m !== null);

      // Step 4: Store in database
      const specificGiftsToInsert = validMetadata.map((metaResult) => {
        const meta = metaResult!.metadata;
        return {
          user_id,
          person_id,
          event_id,
          general_gift_idea_id,
          name: meta.name,
          description: meta.description,
          url: meta.productUrl,
          price: meta.price.amount,
          thumbnail_image: meta.thumbnailImage,
          source_provider: metaResult!.source,
        };
      });

      const { data: insertedGifts, error: insertError } = await supabase
        .from("specific_gift_ideas")
        .insert(specificGiftsToInsert)
        .select();

      if (insertError) {
        console.error("Error inserting specific gift ideas:", insertError);
        return res.status(500).json({
          success: false,
          error: "Database error",
          message: "Failed to save specific gift ideas",
        });
      }

      return res.json({
        success: true,
        data: {
          general_gift_idea: generalIdea,
          specific_gifts: insertedGifts,
          count: insertedGifts?.length || 0,
        },
      });
    } catch (error) {
      console.error("Error generating specific gift ideas:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to generate specific gift ideas",
      });
    }
  });

  /**
   * GET /api/specific-gift-ideas
   * Fetch previously generated specific gifts for a general category
   * Includes interaction status (saved/passed) for the requesting user
   */
  router.get("/", async (req, res) => {
    try {
      const {
        general_gift_idea_id,
        user_id,
        limit = "50",
        offset = "0",
      } = req.query;

      if (!general_gift_idea_id) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameter",
          message: "general_gift_idea_id query param is required",
        });
      }

      // Build query with optional user interaction join
      let query = supabase
        .from("specific_gift_ideas")
        .select(
          `
          *,
          gift_idea_interactions!left (
            id,
            interaction_type,
            interaction_notes,
            created_at
          )
        `
        )
        .eq("general_gift_idea_id", general_gift_idea_id as string)
        .order("created_at", { ascending: false })
        .range(
          parseInt(offset as string),
          parseInt(offset as string) + parseInt(limit as string) - 1
        );

      // If user_id provided, filter interactions to that user
      if (user_id) {
        query = query.eq("gift_idea_interactions.user_id", user_id as string);
      }

      const { data: specificGifts, error } = await query;

      if (error) {
        console.error("Error fetching specific gift ideas:", error);
        return res.status(500).json({
          success: false,
          error: "Database error",
          message: "Failed to fetch specific gift ideas",
        });
      }

      // Transform the data to include interaction status
      const giftsWithStatus = specificGifts?.map((gift: any) => {
        const interactions = gift.gift_idea_interactions || [];
        const interaction = interactions[0] || null; // Get first (most recent) interaction

        return {
          ...gift,
          interaction_status: interaction?.interaction_type || null,
          interaction_notes: interaction?.interaction_notes || null,
          interacted_at: interaction?.created_at || null,
          // Remove the raw join data
          gift_idea_interactions: undefined,
        };
      });

      return res.json({
        success: true,
        data: {
          specific_gifts: giftsWithStatus || [],
          count: giftsWithStatus?.length || 0,
        },
      });
    } catch (error) {
      console.error("Error in fetch specific gift ideas:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to fetch specific gift ideas",
      });
    }
  });

  /**
   * POST /api/specific-gift-ideas/save
   * Mark a specific gift as saved
   */
  router.post("/save", async (req, res) => {
    try {
      const {
        user_id,
        specific_gift_idea_id,
        person_id,
        event_id,
        general_gift_idea_id,
        interaction_notes,
      } = req.body;

      // Validate required parameters
      if (!user_id || !specific_gift_idea_id || !person_id || !event_id) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters",
          message:
            "user_id, specific_gift_idea_id, person_id, and event_id are required",
        });
      }

      // Check if the specific gift idea exists
      const { data: giftIdea, error: giftError } = await supabase
        .from("specific_gift_ideas")
        .select("*")
        .eq("id", specific_gift_idea_id)
        .single();

      if (giftError || !giftIdea) {
        return res.status(404).json({
          success: false,
          error: "Gift idea not found",
          message: "The specified gift idea does not exist",
        });
      }

      // Create interaction record
      const { data: interaction, error: interactionError } = await supabase
        .from("gift_idea_interactions")
        .insert({
          user_id,
          specific_gift_idea_id,
          person_id,
          event_id,
          general_gift_idea_id: general_gift_idea_id || null,
          interaction_type: "saved",
          interaction_notes: interaction_notes || null,
        })
        .select()
        .single();

      if (interactionError) {
        // Check if it's a duplicate error
        if (interactionError.code === "23505") {
          return res.status(409).json({
            success: false,
            error: "Duplicate interaction",
            message: "This gift has already been saved",
          });
        }

        console.error("Error creating interaction:", interactionError);
        return res.status(500).json({
          success: false,
          error: "Database error",
          message: "Failed to save interaction",
        });
      }

      return res.json({
        success: true,
        data: {
          interaction,
          gift_idea: giftIdea,
        },
      });
    } catch (error) {
      console.error("Error saving gift idea:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to save gift idea",
      });
    }
  });

  /**
   * POST /api/specific-gift-ideas/pass
   * Mark a specific gift as passed
   */
  router.post("/pass", async (req, res) => {
    try {
      const {
        user_id,
        specific_gift_idea_id,
        person_id,
        event_id,
        general_gift_idea_id,
        interaction_notes,
      } = req.body;

      // Validate required parameters
      if (!user_id || !specific_gift_idea_id || !person_id || !event_id) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters",
          message:
            "user_id, specific_gift_idea_id, person_id, and event_id are required",
        });
      }

      // Check if the specific gift idea exists
      const { data: giftIdea, error: giftError } = await supabase
        .from("specific_gift_ideas")
        .select("*")
        .eq("id", specific_gift_idea_id)
        .single();

      if (giftError || !giftIdea) {
        return res.status(404).json({
          success: false,
          error: "Gift idea not found",
          message: "The specified gift idea does not exist",
        });
      }

      // Create interaction record
      const { data: interaction, error: interactionError } = await supabase
        .from("gift_idea_interactions")
        .insert({
          user_id,
          specific_gift_idea_id,
          person_id,
          event_id,
          general_gift_idea_id: general_gift_idea_id || null,
          interaction_type: "passed",
          interaction_notes: interaction_notes || null,
        })
        .select()
        .single();

      if (interactionError) {
        // Check if it's a duplicate error
        if (interactionError.code === "23505") {
          return res.status(409).json({
            success: false,
            error: "Duplicate interaction",
            message: "This gift has already been passed on",
          });
        }

        console.error("Error creating interaction:", interactionError);
        return res.status(500).json({
          success: false,
          error: "Database error",
          message: "Failed to record interaction",
        });
      }

      return res.json({
        success: true,
        data: {
          interaction,
          gift_idea: giftIdea,
        },
      });
    } catch (error) {
      console.error("Error passing on gift idea:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to pass on gift idea",
      });
    }
  });

  /**
   * GET /api/specific-gift-ideas/saved
   * Fetch all saved specific gift ideas for a person + event
   */
  router.get("/saved", async (req, res) => {
    try {
      const { user_id, person_id, event_id } = req.query;

      // Validate required parameters
      if (!user_id || !person_id) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters",
          message: "user_id and person_id query params are required",
        });
      }

      // Handle different query modes
      if (event_id && event_id !== "all") {
        // Mode 1: Fetch gifts for specific event OR gifts with no event
        const [eventGifts, noEventGifts] = await Promise.all([
          supabase
            .from("gift_idea_interactions")
            .select(
              `
              *,
              specific_gift_ideas (*),
              events (
                id,
                name,
                event_type,
                recurring_month,
                recurring_day,
                specific_date
              )
            `
            )
            .eq("user_id", user_id as string)
            .eq("person_id", person_id as string)
            .eq("event_id", event_id as string)
            .eq("interaction_type", "saved")
            .order("created_at", { ascending: false }),
          supabase
            .from("gift_idea_interactions")
            .select(
              `
              *,
              specific_gift_ideas (*),
              events (
                id,
                name,
                event_type,
                recurring_month,
                recurring_day,
                specific_date
              )
            `
            )
            .eq("user_id", user_id as string)
            .eq("person_id", person_id as string)
            .is("event_id", null)
            .eq("interaction_type", "saved")
            .order("created_at", { ascending: false }),
        ]);

        if (eventGifts.error) {
          console.error("Error fetching event gifts:", eventGifts.error);
          return res.status(500).json({
            success: false,
            error: "Database error",
            message: "Failed to fetch saved gifts",
          });
        }

        if (noEventGifts.error) {
          console.error("Error fetching no-event gifts:", noEventGifts.error);
          return res.status(500).json({
            success: false,
            error: "Database error",
            message: "Failed to fetch saved gifts",
          });
        }

        // Combine: event-specific gifts first, then no-event gifts
        const allInteractions = [
          ...(eventGifts.data || []),
          ...(noEventGifts.data || []),
        ];

        const gifts = allInteractions
          .map((interaction: any) => ({
            ...interaction.specific_gift_ideas,
            saved_for_event: interaction.events || null,
            saved_at: interaction.created_at,
          }))
          .filter((gift: any) => gift.id !== undefined);

        return res.json({
          success: true,
          data: {
            gifts: gifts,
            count: gifts.length,
            event_specific_count: (eventGifts.data || []).length,
            no_event_count: (noEventGifts.data || []).length,
          },
        });
      } else {
        // Mode 2: Fetch all gifts for the person across all events
        const { data: interactions, error: interactionsError } = await supabase
          .from("gift_idea_interactions")
          .select(
            `
            *,
            specific_gift_ideas (*),
            events (
              id,
              name,
              event_type,
              recurring_month,
              recurring_day,
              specific_date
            )
          `
          )
          .eq("user_id", user_id as string)
          .eq("person_id", person_id as string)
          .eq("interaction_type", "saved")
          .order("created_at", { ascending: false });

        if (interactionsError) {
          console.error("Error fetching saved gifts:", interactionsError);
          return res.status(500).json({
            success: false,
            error: "Database error",
            message: "Failed to fetch saved gifts",
          });
        }

        // Extract gift ideas with event metadata
        const gifts =
          interactions
            ?.map((interaction: any) => ({
              ...interaction.specific_gift_ideas,
              saved_for_event: interaction.events || null,
              saved_at: interaction.created_at,
            }))
            .filter((gift: any) => gift.id !== undefined) || [];

        return res.json({
          success: true,
          data: {
            gifts: gifts,
            count: gifts.length,
          },
        });
      }
    } catch (error) {
      console.error("Error in fetch saved gifts:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to fetch saved gifts",
      });
    }
  });

  return router;
}
