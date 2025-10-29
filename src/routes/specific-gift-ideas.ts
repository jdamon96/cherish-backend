import { Router } from "express";
import { SupabaseClient } from "@supabase/supabase-js";
import Exa from "exa-js";
import OpenAI from "openai";
import { ApifyClient } from "apify-client";
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
}

enum MetadataProvider {
  EXA_CONTENTS = "exa_contents",
  APIFY_AMAZON = "apify_amazon",
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
  searchProviders: [SearchProvider.EXA] as SearchProvider[],
  metadataProviders: [
    MetadataProvider.EXA_CONTENTS,
    MetadataProvider.APIFY_AMAZON,
  ] as MetadataProvider[],
  maxSearchResults: 10,
  useUrlRouting: true,
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

// Orchestrators
async function searchProductOrchestrator(
  productName: string,
  providers: SearchProvider[],
  exa: Exa,
  openai: OpenAI
): Promise<SearchServiceResult[]> {
  const services: { [key: string]: any } = {
    [SearchProvider.EXA]: new ExaSearchService(exa),
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
  config: typeof CONFIG
): Promise<MetadataServiceResult[]> {
  const apifyService = new ApifyAmazonMetadataService(apifyToken);
  const exaService = new ExaMetadataService(exa);

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

      // Step 1: Search for products using the general idea text
      const searchResults = await searchProductOrchestrator(
        generalIdea.idea_text,
        CONFIG.searchProviders,
        exa,
        openai
      );

      // Combine all search results
      const allResults: SearchResult[] = [];
      searchResults.forEach((result) => {
        allResults.push(...result.results);
      });

      if (allResults.length === 0) {
        return res.status(404).json({
          success: false,
          error: "No products found",
          message: `Could not find any products for "${generalIdea.idea_text}"`,
        });
      }

      // Step 2: Use LLM to select the best purchase URLs (top N based on count)
      const topN = Math.min(count, allResults.length);
      const searchResultsForLLM = allResults.map((result, index) => ({
        index: index + 1,
        title: result.title,
        url: result.url,
      }));

      const llmPrompt = `You are helping to identify the best URLs where a user can PURCHASE products online.

Product category: "${generalIdea.idea_text}"

Here are ${allResults.length} search results:
${JSON.stringify(searchResultsForLLM, null, 2)}

Your task: Select the ${topN} BEST URLs where someone can actually purchase products in this category. Look for:
- Direct product pages on e-commerce sites (Amazon, BestBuy, Target, Walmart, etc.)
- Official manufacturer stores
- Reputable online retailers
- Favor .com links over international domains

AVOID:
- Review sites
- Comparison sites
- News articles
- General information pages

Respond with ONLY a JSON array of the index numbers (e.g., [1, 5, 8, 12]). Select exactly ${topN} items.`;

      const llmResponse = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content:
              "You are an expert at identifying e-commerce purchase URLs. Respond only with a JSON array of numbers.",
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
        selectedIndices = Array.isArray(parsed)
          ? parsed
          : parsed.indices || parsed.selected || [];
      } catch (parseError) {
        console.error("Error parsing LLM response:", parseError);
        // Fallback: use first N results
        selectedIndices = Array.from({ length: topN }, (_, i) => i + 1);
      }

      // Step 3: Extract metadata for selected URLs
      const selectedUrls = selectedIndices
        .filter((idx) => idx >= 1 && idx <= allResults.length)
        .slice(0, topN)
        .map((idx) => allResults[idx - 1].url);

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
   */
  router.get("/", async (req, res) => {
    try {
      const { general_gift_idea_id, limit = "50", offset = "0" } = req.query;

      if (!general_gift_idea_id) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameter",
          message: "general_gift_idea_id query param is required",
        });
      }

      const { data: specificGifts, error } = await supabase
        .from("specific_gift_ideas")
        .select("*")
        .eq("general_gift_idea_id", general_gift_idea_id as string)
        .order("created_at", { ascending: false })
        .range(
          parseInt(offset as string),
          parseInt(offset as string) + parseInt(limit as string) - 1
        );

      if (error) {
        console.error("Error fetching specific gift ideas:", error);
        return res.status(500).json({
          success: false,
          error: "Database error",
          message: "Failed to fetch specific gift ideas",
        });
      }

      return res.json({
        success: true,
        data: {
          specific_gifts: specificGifts || [],
          count: specificGifts?.length || 0,
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
      if (!user_id || !person_id || !event_id) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters",
          message: "user_id, person_id, and event_id query params are required",
        });
      }

      // Fetch saved interactions with gift details
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
        .eq("event_id", event_id as string)
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

      return res.json({
        success: true,
        data: {
          saved_gifts: interactions || [],
          count: interactions?.length || 0,
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

  return router;
}
