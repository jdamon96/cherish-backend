import { Router } from "express";
import { SupabaseClient } from "@supabase/supabase-js";
import Exa from "exa-js";
import OpenAI from "openai";
import { ApifyClient } from "apify-client";
import Parallel from "parallel-web";
import { Database } from "../config/supabase";
import { jobTracker } from "../services/job-tracker";
import { sendProductsReadyNotification } from "../services/apns";

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
  imageUrls: string[];
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
      max_chars_per_result: 10000,
      //betas: ["search-extract-2025-10-10"],
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
      imageUrls: [],
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

    // Build image URLs array with primary image first, then additional images
    const imageUrls: string[] = [];

    // Add primary/thumbnail image first
    if (item.thumbnailImage) {
      imageUrls.push(String(item.thumbnailImage));
    } else if (item.image) {
      imageUrls.push(String(item.image));
    } else if (item.imageUrl) {
      imageUrls.push(String(item.imageUrl));
    }

    // Add high-resolution images
    if (Array.isArray(item.highResolutionImages)) {
      imageUrls.push(...item.highResolutionImages.map(String));
    } else if (Array.isArray(item.images)) {
      imageUrls.push(...item.images.map(String));
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
      imageUrls,
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
        price_amount: {
          type: "number" as const,
          description: "The numeric price amount (e.g., 29.99)",
        },
        price_currency: {
          type: "string" as const,
          description: "The ISO 4217 currency code (e.g., USD, EUR, GBP)",
        },
        image_urls: {
          type: "array" as const,
          items: {
            type: "string" as const,
          },
          description:
            "Array of product image URLs, with the primary/best image first",
        },
      },
      required: [
        "title",
        "description",
        "price_amount",
        "price_currency",
        "image_urls",
      ],
      additionalProperties: false,
    };

    // Type for the expected output
    type ParallelProductOutput = {
      title: string;
      description: string;
      price_amount: number;
      price_currency: string;
      image_urls: string[];
    };

    const taskRun = await this.client.taskRun.create({
      input: { product_url: url },
      processor: "lite",
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
        amount: output.price_amount || null,
        currency: output.price_currency || null,
        formatted:
          output.price_amount && output.price_currency
            ? `${output.price_currency} ${output.price_amount.toFixed(2)}`
            : null,
      },
      imageUrls: output.image_urls || [],
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
      [SearchProvider.PARALLEL_WEB]: new ParallelWebSearchService(
        parallelClient
      ),
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
              imageUrls: [],
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
              imageUrls: [],
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
          imageUrls: [],
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
    //betas: ["search-extract-2025-10-10"],
  });

  console.log(
    `[ProductNameExtraction] Search returned ${
      search.results?.length || 0
    } results`
  );

  if (!search.results || search.results.length === 0) {
    console.warn(
      "[ProductNameExtraction] No search results returned, cannot extract product names"
    );
    return [];
  }

  // Prepare search results for LLM
  const searchResultsForLLM = search.results.map(
    (result: any, index: number) => ({
      index: index + 1,
      title: result.title,
      url: result.url,
      excerpts: result.excerpts || [],
    })
  );

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

/**
 * Async function to process product generation in the background
 * Updates job status as it progresses
 */
async function processProductGeneration(
  jobId: string,
  params: {
    user_id: string;
    person_id: string;
    general_gift_idea_id: string;
    count: number;
  },
  clients: {
    supabase: SupabaseClient<Database>;
    exa: Exa;
    openai: OpenAI;
    apifyToken: string;
    parallelClient: Parallel;
  }
): Promise<void> {
  try {
    const { user_id, person_id, general_gift_idea_id, count } = params;
    const { supabase, exa, openai, apifyToken, parallelClient } = clients;

    // Update job to in_progress
    jobTracker.updateJob(jobId, { status: "in_progress" });

    console.log(
      `[Job ${jobId}] Starting product generation for general_gift_idea ${general_gift_idea_id}`
    );

    // Fetch the general gift idea
    const { data: generalIdea, error: generalError } = await supabase
      .from("general_gift_ideas")
      .select("*")
      .eq("id", general_gift_idea_id)
      .eq("user_id", user_id)
      .single();

    if (generalError || !generalIdea) {
      throw new Error("General gift idea not found");
    }

    console.log(
      `[Job ${jobId}] Generating products for: "${generalIdea.idea_text}"`
    );

    // STEP 1: Extract specific product names from the general gift idea
    const productNames = await extractProductNamesFromIdea(
      generalIdea.idea_text,
      count,
      parallelClient,
      openai
    );

    if (productNames.length === 0) {
      throw new Error(
        `Could not extract any product names from "${generalIdea.idea_text}"`
      );
    }

    console.log(
      `[Job ${jobId}] Extracted ${productNames.length} product names`
    );

    // STEP 2: For each product name, search for purchase URLs
    const allProductUrlSearches = await Promise.all(
      productNames.map(async (productName) => {
        console.log(
          `[Job ${jobId}] Searching for purchase URLs for: "${productName}"`
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
      `[Job ${jobId}] Total search results across all products: ${allSearchResults.length}`
    );

    if (allSearchResults.length === 0) {
      throw new Error(
        "Could not find purchase URLs for the extracted products"
      );
    }

    // STEP 3: Use LLM to select the best purchase URLs
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
      console.error(`[Job ${jobId}] Error parsing LLM response:`, parseError);
      // Fallback: use first N results
      selectedIndices = Array.from({ length: topN }, (_, i) => i + 1);
    }

    // Get the selected URLs
    const selectedUrls = selectedIndices
      .filter((idx) => idx >= 1 && idx <= allSearchResults.length)
      .slice(0, topN)
      .map((idx) => allSearchResults[idx - 1].url);

    console.log(
      `[Job ${jobId}] Selected ${selectedUrls.length} URLs for metadata extraction`
    );

    // STEP 4: Extract metadata for selected URLs
    console.log(
      `[Job ${jobId}] Extracting metadata for ${selectedUrls.length} products...`
    );

    const metadataPromises = selectedUrls.map(async (url, index) => {
      try {
        console.log(
          `[Job ${jobId}] [${index + 1}/${
            selectedUrls.length
          }] Starting metadata extraction for: ${url}`
        );
        const metadataResults = await extractMetadataOrchestrator(
          url,
          CONFIG.metadataProviders,
          exa,
          apifyToken,
          parallelClient,
          CONFIG
        );
        console.log(
          `[Job ${jobId}] [${index + 1}/${
            selectedUrls.length
          }] ✅ Metadata extracted for: ${url}`
        );
        return metadataResults[0];
      } catch (error) {
        console.error(
          `[Job ${jobId}] [${index + 1}/${
            selectedUrls.length
          }] ❌ Failed to extract metadata for ${url}:`,
          error
        );
        return null;
      }
    });

    console.log(
      `[Job ${jobId}] Waiting for all metadata extractions to complete...`
    );
    const metadataResults = await Promise.all(metadataPromises);
    const validMetadata = metadataResults.filter((m) => m !== null);

    console.log(
      `[Job ${jobId}] Metadata extraction complete. Valid: ${
        validMetadata.length
      }, Failed: ${metadataResults.length - validMetadata.length}`
    );

    if (validMetadata.length === 0) {
      throw new Error("Failed to extract metadata for any products");
    }

    // STEP 5: Store in database (person-scoped, event_id is null)
    const specificGiftsToInsert = validMetadata.map((metaResult) => {
      const meta = metaResult!.metadata;
      return {
        user_id,
        person_id,
        event_id: null, // Gift ideas are now person-scoped, not event-scoped
        general_gift_idea_id,
        name: meta.name,
        description: meta.description,
        url: meta.productUrl,
        price_amount: meta.price.amount,
        price_currency: meta.price.currency,
        image_urls: meta.imageUrls.length > 0 ? meta.imageUrls : null,
        source_provider: metaResult!.source,
      };
    });

    console.log(
      `[Job ${jobId}] Attempting to insert ${specificGiftsToInsert.length} products into database...`
    );
    console.log(
      `[Job ${jobId}] Sample product:`,
      JSON.stringify(specificGiftsToInsert[0], null, 2)
    );

    const { data: insertedGifts, error: insertError } = await supabase
      .from("specific_gift_ideas")
      .insert(specificGiftsToInsert)
      .select();

    if (insertError) {
      console.error(`[Job ${jobId}] Database insert error:`, insertError);
      throw new Error(
        `Failed to save specific gift ideas: ${insertError.message}`
      );
    }

    console.log(
      `[Job ${jobId}] ✅ Successfully inserted ${
        insertedGifts?.length || 0
      } specific gift ideas into database`
    );

    // Update job to completed with results
    jobTracker.updateJob(jobId, {
      status: "completed",
      result: {
        general_gift_idea: generalIdea,
        specific_gifts: insertedGifts,
        count: insertedGifts?.length || 0,
      },
    });

    // Send push notification to user that products are ready
    try {
      await sendProductsReadyNotification(
        supabase,
        user_id,
        general_gift_idea_id,
        insertedGifts?.length || 0,
        generalIdea.idea_text
      );
    } catch (notificationError) {
      // Don't fail the job if notification fails
      console.error(
        `[Job ${jobId}] ⚠️ Failed to send push notification:`,
        notificationError
      );
    }
  } catch (error) {
    console.error(
      `[Job ${jobId}] Error generating specific gift ideas:`,
      error
    );
    jobTracker.updateJob(jobId, {
      status: "failed",
      error:
        error instanceof Error
          ? error.message
          : "Failed to generate specific gift ideas",
    });
  }
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
   * Generate specific purchasable products from a general gift idea (person-scoped)
   * NOW ASYNC: Returns a job_id immediately and processes in the background
   */
  router.post("/generate", async (req, res) => {
    try {
      const { user_id, person_id, general_gift_idea_id, count = 10 } = req.body;

      // Validate required parameters (event_id no longer required)
      if (!user_id || !person_id || !general_gift_idea_id) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters",
          message: "user_id, person_id, and general_gift_idea_id are required",
        });
      }

      // Validate that Parallel client is available
      if (!parallelClient) {
        return res.status(500).json({
          success: false,
          error: "Service unavailable",
          message: "Parallel API is not configured",
        });
      }

      // Quick validation: check if general gift idea exists
      const { data: generalIdea, error: generalError } = await supabase
        .from("general_gift_ideas")
        .select("id, idea_text")
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

      // Create a job and return immediately
      const jobId = jobTracker.createJob("pending");

      console.log(
        `[SpecificGiftIdeas] Created job ${jobId} for "${generalIdea.idea_text}"`
      );

      // Start background processing (don't await - fire and forget)
      processProductGeneration(
        jobId,
        { user_id, person_id, general_gift_idea_id, count },
        { supabase, exa, openai, apifyToken: apifyApiToken, parallelClient }
      ).catch((error) => {
        // This should not happen as processProductGeneration handles its own errors
        console.error(`[Job ${jobId}] Unexpected error:`, error);
      });

      // Return immediately with job_id
      return res.json({
        success: true,
        job_id: jobId,
        message: "Product generation started",
        estimated_time: "2-3 minutes",
      });
    } catch (error) {
      console.error("Error starting product generation:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to start product generation",
      });
    }
  });

  /**
   * GET /api/specific-gift-ideas/job/:job_id
   * Check the status of a product generation job
   */
  router.get("/job/:job_id", async (req, res) => {
    try {
      const { job_id } = req.params;

      if (!job_id) {
        return res.status(400).json({
          success: false,
          error: "Missing job_id",
          message: "job_id parameter is required",
        });
      }

      const job = jobTracker.getJob(job_id);

      if (!job) {
        return res.status(404).json({
          success: false,
          error: "Job not found",
          message: "The specified job does not exist or has expired",
        });
      }

      // Return job status
      const response: any = {
        success: true,
        job_id: job.id,
        status: job.status,
        created_at: job.createdAt,
        updated_at: job.updatedAt,
      };

      // Add status-specific messaging
      if (job.status === "pending") {
        response.message = "Job is queued and will start shortly";
      } else if (job.status === "in_progress") {
        response.message = "Searching for the best products...";
      } else if (job.status === "completed") {
        response.message = "Products found!";
        response.result = job.result;
      } else if (job.status === "failed") {
        response.message = "Job failed";
        response.error = job.error;
      }

      return res.json(response);
    } catch (error) {
      console.error("Error checking job status:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to check job status",
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
   * Mark a specific gift as saved (person-scoped)
   */
  router.post("/save", async (req, res) => {
    try {
      const {
        user_id,
        specific_gift_idea_id,
        person_id,
        general_gift_idea_id,
        interaction_notes,
      } = req.body;

      // Validate required parameters (event_id no longer required)
      if (!user_id || !specific_gift_idea_id || !person_id) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters",
          message: "user_id, specific_gift_idea_id, and person_id are required",
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

      // Create interaction record (person-scoped, event_id is null)
      const { data: interaction, error: interactionError } = await supabase
        .from("gift_idea_interactions")
        .insert({
          user_id,
          specific_gift_idea_id,
          person_id,
          event_id: null, // Gift ideas are now person-scoped, not event-scoped
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
   * Mark a specific gift as passed (person-scoped)
   */
  router.post("/pass", async (req, res) => {
    try {
      const {
        user_id,
        specific_gift_idea_id,
        person_id,
        general_gift_idea_id,
        interaction_notes,
      } = req.body;

      // Validate required parameters (event_id no longer required)
      if (!user_id || !specific_gift_idea_id || !person_id) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters",
          message: "user_id, specific_gift_idea_id, and person_id are required",
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

      // Create interaction record (person-scoped, event_id is null)
      const { data: interaction, error: interactionError } = await supabase
        .from("gift_idea_interactions")
        .insert({
          user_id,
          specific_gift_idea_id,
          person_id,
          event_id: null, // Gift ideas are now person-scoped, not event-scoped
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
   * Fetch all saved specific gift ideas for a person (person-scoped)
   */
  router.get("/saved", async (req, res) => {
    try {
      const { user_id, person_id } = req.query;

      // Validate required parameters (event_id no longer used)
      if (!user_id || !person_id) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters",
          message: "user_id and person_id query params are required",
        });
      }

      // Fetch all saved gifts for the person (person-scoped)
      const { data: interactions, error: interactionsError } = await supabase
        .from("gift_idea_interactions")
        .select(
          `
          *,
          specific_gift_ideas (*)
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

      // Extract gift ideas
      const gifts =
        interactions
          ?.map((interaction: any) => ({
            ...interaction.specific_gift_ideas,
            saved_at: interaction.created_at,
            interaction_status: "saved",
          }))
          .filter((gift: any) => gift.id !== undefined) || [];

      return res.json({
        success: true,
        data: {
          gifts: gifts,
          count: gifts.length,
        },
      });
    } catch (error) {
      console.error("Error in fetch saved gifts:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to fetch saved gifts",
      });
    }
  });

  /**
   * POST /api/specific-gift-ideas/mark-viewed
   * Bulk mark all products for a general gift idea as viewed
   */
  router.post("/mark-viewed", async (req, res) => {
    try {
      const { user_id, general_gift_idea_id } = req.body;

      // Validate required parameters
      if (!user_id || !general_gift_idea_id) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters",
          message: "user_id and general_gift_idea_id are required",
        });
      }

      // Update all products for this general gift idea to viewed=true
      const { data, error } = await supabase
        .from("specific_gift_ideas")
        .update({ viewed: true })
        .eq("general_gift_idea_id", general_gift_idea_id)
        .eq("user_id", user_id)
        .select();

      if (error) {
        console.error("Error marking products as viewed:", error);
        return res.status(500).json({
          success: false,
          error: "Database error",
          message: "Failed to mark products as viewed",
        });
      }

      const count = data?.length || 0;
      console.log(
        `✅ Marked ${count} products as viewed for general idea ${general_gift_idea_id}`
      );

      return res.json({
        success: true,
        data: {
          count,
          general_gift_idea_id,
        },
      });
    } catch (error) {
      console.error("Error marking products as viewed:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to mark products as viewed",
      });
    }
  });

  return router;
}
