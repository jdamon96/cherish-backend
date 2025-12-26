import { Router } from "express";
import { SupabaseClient } from "@supabase/supabase-js";
import Parallel from "parallel-web";
import OpenAI from "openai";
import { Database } from "../config/supabase";
import { jobTracker } from "../services/job-tracker";

// Types for gift idea creation
interface Price {
  amount: number | null;
  currency: string | null;
}

interface ProductMetadata {
  name: string;
  price: Price;
  imageUrls: string[];
  description: string;
  productUrl: string;
}

interface GiftIdeaCandidate {
  name: string;
  url: string;
  price_amount: number | null;
  price_currency: string | null;
  image_url: string | null;
  description: string | null;
}

type CreationMethod = 'manual' | 'phrase_search' | 'photo_capture' | 'url_import' | 'ai_generated';
type EnrichmentStatus = 'none' | 'pending' | 'completed' | 'failed';

// ParallelWeb Metadata Service (reused from specific-gift-ideas.ts)
class ParallelWebMetadataService {
  constructor(private client: Parallel) {}

  async extractMetadata(url: string): Promise<ProductMetadata> {
    console.log("[ParallelWebMetadataService] Extracting metadata from:", url);

    const inputSchema = {
      type: "object" as const,
      properties: {
        product_url: {
          type: "string" as const,
          description: "The URL of the product to retrieve structured metadata for",
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
          items: { type: "string" as const },
          description: "Array of product image URLs, with the primary/best image first",
        },
      },
      required: ["title", "description", "price_amount", "price_currency", "image_urls"],
      additionalProperties: false,
    };

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
        input_schema: { type: "json", json_schema: inputSchema },
        output_schema: { type: "json", json_schema: outputSchema },
      },
    });

    // Poll for results with timeout
    let runResult;
    for (let i = 0; i < 144; i++) {
      try {
        runResult = await this.client.taskRun.result(taskRun.run_id, { timeout: 25 });
        break;
      } catch (error) {
        if (i === 143) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    if (!runResult) {
      throw new Error("Failed to get task run result after retries");
    }

    const output = runResult.output.content as ParallelProductOutput;

    return {
      name: output.title || "Unknown Product",
      price: {
        amount: output.price_amount || null,
        currency: output.price_currency || null,
      },
      imageUrls: output.image_urls || [],
      description: output.description || "",
      productUrl: url,
    };
  }
}

// ParallelWeb Search Service for phrase search
class ParallelWebSearchService {
  constructor(private client: Parallel) {}

  async searchProducts(phrase: string, limit: number = 5): Promise<GiftIdeaCandidate[]> {
    console.log("[ParallelWebSearchService] Searching for:", phrase);

    const search = await this.client.beta.search({
      objective: `Find specific products to buy for: ${phrase}`,
      search_queries: [
        `buy ${phrase}`,
        `best ${phrase}`,
        `${phrase} price`,
      ],
      max_results: limit * 2, // Get extra in case some fail
      max_chars_per_result: 5000,
    });

    if (!search.results || search.results.length === 0) {
      console.warn("[ParallelWebSearchService] No results returned");
      return [];
    }

    // Extract basic info from search results
    const candidates: GiftIdeaCandidate[] = search.results
      .slice(0, limit)
      .map((result: any) => ({
        name: result.title || "Unknown Product",
        url: result.url,
        price_amount: null,
        price_currency: null,
        image_url: null,
        description: result.excerpts?.[0] || null,
      }));

    return candidates;
  }
}

// Vision AI service for photo parsing
class VisionAIService {
  constructor(private openai: OpenAI) {}

  async identifyProduct(imageBase64: string): Promise<{ productName: string; searchQuery: string }> {
    console.log("[VisionAIService] Identifying product from image");

    const response = await this.openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: `You are an expert at identifying products from images. 
When shown an image, identify the specific product shown and provide:
1. The most likely product name (be specific - include brand if visible)
2. A search query that would help find this product online

Respond with valid JSON only: {"productName": "...", "searchQuery": "..."}`,
        },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: imageBase64.startsWith("data:")
                  ? imageBase64
                  : `data:image/jpeg;base64,${imageBase64}`,
              },
            },
            {
              type: "text",
              text: "What product is shown in this image? Provide the product name and a search query to find it online.",
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
      max_tokens: 500,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Vision AI failed to identify product");
    }

    const result = JSON.parse(content);
    return {
      productName: result.productName || "Unknown Product",
      searchQuery: result.searchQuery || result.productName || "gift",
    };
  }
}

// Background processing for photo-based gift creation
async function processPhotoGiftCreation(
  jobId: string,
  params: {
    user_id: string;
    person_id?: string;
    event_id?: string;
    photo_base64?: string;
    storage_path?: string;
  },
  clients: {
    supabase: SupabaseClient<Database>;
    openai: OpenAI;
    parallelClient: Parallel;
  }
): Promise<void> {
  try {
    const { user_id, person_id, event_id, photo_base64, storage_path } = params;
    const { supabase, openai, parallelClient } = clients;

    jobTracker.updateJob(jobId, { status: "in_progress" });
    console.log(`[Job ${jobId}] Starting photo gift creation`);

    // Get image data
    let imageData = photo_base64;
    if (storage_path && !imageData) {
      // Download from Supabase Storage
      const { data, error } = await supabase.storage
        .from("gift-photos")
        .download(storage_path);
      
      if (error) throw new Error(`Failed to download photo: ${error.message}`);
      
      const buffer = await data.arrayBuffer();
      imageData = `data:${data.type};base64,${Buffer.from(buffer).toString("base64")}`;
    }

    if (!imageData) {
      throw new Error("No image data provided");
    }

    // Step 1: Identify product using Vision AI
    const visionService = new VisionAIService(openai);
    const { productName, searchQuery } = await visionService.identifyProduct(imageData);
    console.log(`[Job ${jobId}] Identified product: ${productName}`);

    // Step 2: Search for the product
    const searchService = new ParallelWebSearchService(parallelClient);
    const candidates = await searchService.searchProducts(searchQuery, 3);

    if (candidates.length === 0) {
      throw new Error(`Could not find products matching: ${searchQuery}`);
    }

    // Step 3: Enrich the first candidate with metadata
    const metadataService = new ParallelWebMetadataService(parallelClient);
    const metadata = await metadataService.extractMetadata(candidates[0].url);

    // Step 4: Save to database
    const { data: insertedGift, error: insertError } = await supabase
      .from("specific_gift_ideas")
      .insert({
        user_id,
        person_id: person_id || null,
        event_id: event_id || null,
        name: metadata.name,
        description: metadata.description,
        url: metadata.productUrl,
        price_amount: metadata.price.amount,
        price_currency: metadata.price.currency,
        image_urls: metadata.imageUrls.length > 0 ? metadata.imageUrls : null,
        source_provider: "parallel_web",
        creation_method: "photo_capture" as CreationMethod,
        original_photo_path: storage_path || null,
        enrichment_status: "completed" as EnrichmentStatus,
      })
      .select()
      .single();

    if (insertError) {
      throw new Error(`Failed to save gift idea: ${insertError.message}`);
    }

    console.log(`[Job ${jobId}] Successfully created gift idea from photo`);

    jobTracker.updateJob(jobId, {
      status: "completed",
      result: { gift_idea: insertedGift },
    });
  } catch (error) {
    console.error(`[Job ${jobId}] Error:`, error);
    jobTracker.updateJob(jobId, {
      status: "failed",
      error: error instanceof Error ? error.message : "Failed to create gift from photo",
    });
  }
}

export function giftIdeaCreateRoutes(supabase: SupabaseClient<Database>) {
  const router = Router();

  // Initialize clients
  const openaiApiKey = process.env.OPENAI_API_KEY;
  if (!openaiApiKey) {
    throw new Error("OPENAI_API_KEY environment variable is not set");
  }
  const openai = new OpenAI({ apiKey: openaiApiKey });

  const parallelApiKey = process.env.PARALLEL_API_KEY;
  let parallelClient: Parallel | null = null;
  if (parallelApiKey) {
    parallelClient = new Parallel({ apiKey: parallelApiKey });
  }

  /**
   * POST /api/gift-ideas/create
   * Create a gift idea with optional fields
   * Supports manual creation and saving selected candidates
   */
  router.post("/create", async (req, res) => {
    try {
      const {
        user_id,
        person_id,
        event_id,
        name,
        description,
        url,
        price_amount,
        price_currency,
        image_urls,
        creation_method = "manual",
        original_input_text,
      } = req.body;

      // Validate required parameters
      if (!user_id || !name) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters",
          message: "user_id and name are required",
        });
      }

      // Validate creation_method
      const validMethods: CreationMethod[] = ['manual', 'phrase_search', 'photo_capture', 'url_import', 'ai_generated'];
      if (creation_method && !validMethods.includes(creation_method)) {
        return res.status(400).json({
          success: false,
          error: "Invalid creation_method",
          message: `creation_method must be one of: ${validMethods.join(', ')}`,
        });
      }

      // Insert the gift idea
      const { data: giftIdea, error: insertError } = await supabase
        .from("specific_gift_ideas")
        .insert({
          user_id,
          person_id: person_id || null,
          event_id: event_id || null,
          name,
          description: description || null,
          url: url || null,
          price_amount: price_amount || null,
          price_currency: price_currency || null,
          image_urls: image_urls || null,
          creation_method: creation_method as CreationMethod,
          original_input_text: original_input_text || null,
          enrichment_status: "none" as EnrichmentStatus,
        })
        .select()
        .single();

      if (insertError) {
        console.error("Error inserting gift idea:", insertError);
        return res.status(500).json({
          success: false,
          error: "Database error",
          message: "Failed to create gift idea",
        });
      }

      return res.json({
        success: true,
        data: { gift_idea: giftIdea },
      });
    } catch (error) {
      console.error("Error creating gift idea:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Failed to create gift idea",
      });
    }
  });

  /**
   * POST /api/gift-ideas/search-phrase
   * Search for products matching a phrase
   * Returns candidates for user to choose from
   */
  router.post("/search-phrase", async (req, res) => {
    try {
      const { user_id, phrase, limit = 5 } = req.body;

      // Validate required parameters
      if (!user_id || !phrase) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters",
          message: "user_id and phrase are required",
        });
      }

      if (!parallelClient) {
        return res.status(500).json({
          success: false,
          error: "Service unavailable",
          message: "Search service is not configured",
        });
      }

      // Search for products
      const searchService = new ParallelWebSearchService(parallelClient);
      const candidates = await searchService.searchProducts(phrase, limit);

      return res.json({
        success: true,
        data: {
          phrase,
          candidates,
          count: candidates.length,
        },
      });
    } catch (error) {
      console.error("Error searching for products:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Failed to search for products",
      });
    }
  });

  /**
   * POST /api/gift-ideas/from-url
   * Create a gift idea from a URL by scraping metadata
   */
  router.post("/from-url", async (req, res) => {
    try {
      const { user_id, person_id, event_id, url } = req.body;

      // Validate required parameters
      if (!user_id || !url) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters",
          message: "user_id and url are required",
        });
      }

      if (!parallelClient) {
        return res.status(500).json({
          success: false,
          error: "Service unavailable",
          message: "Metadata service is not configured",
        });
      }

      // Extract metadata from URL
      const metadataService = new ParallelWebMetadataService(parallelClient);
      
      try {
        const metadata = await metadataService.extractMetadata(url);

        // Save to database
        const { data: giftIdea, error: insertError } = await supabase
          .from("specific_gift_ideas")
          .insert({
            user_id,
            person_id: person_id || null,
            event_id: event_id || null,
            name: metadata.name,
            description: metadata.description,
            url: metadata.productUrl,
            price_amount: metadata.price.amount,
            price_currency: metadata.price.currency,
            image_urls: metadata.imageUrls.length > 0 ? metadata.imageUrls : null,
            source_provider: "parallel_web",
            creation_method: "url_import" as CreationMethod,
            original_input_text: url,
            enrichment_status: "completed" as EnrichmentStatus,
          })
          .select()
          .single();

        if (insertError) {
          console.error("Error inserting gift idea:", insertError);
          return res.status(500).json({
            success: false,
            error: "Database error",
            message: "Failed to save gift idea",
          });
        }

        return res.json({
          success: true,
          data: { gift_idea: giftIdea },
        });
      } catch (metadataError) {
        console.error("Error extracting metadata:", metadataError);
        
        // Fall back to creating a basic entry with just the URL
        const { data: basicGift, error: basicError } = await supabase
          .from("specific_gift_ideas")
          .insert({
            user_id,
            person_id: person_id || null,
            event_id: event_id || null,
            name: "Gift from link",
            url: url,
            creation_method: "url_import" as CreationMethod,
            original_input_text: url,
            enrichment_status: "failed" as EnrichmentStatus,
          })
          .select()
          .single();

        if (basicError) {
          return res.status(500).json({
            success: false,
            error: "Database error",
            message: "Failed to save gift idea",
          });
        }

        return res.json({
          success: true,
          data: { 
            gift_idea: basicGift,
            enrichment_failed: true,
            message: "Saved with basic info - metadata extraction failed",
          },
        });
      }
    } catch (error) {
      console.error("Error creating gift from URL:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Failed to create gift from URL",
      });
    }
  });

  /**
   * POST /api/gift-ideas/from-photo
   * Create a gift idea from a photo using vision AI
   * Returns job_id for async processing
   */
  router.post("/from-photo", async (req, res) => {
    try {
      const { user_id, person_id, event_id, photo_base64, storage_path } = req.body;

      // Validate required parameters
      if (!user_id) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters",
          message: "user_id is required",
        });
      }

      if (!photo_base64 && !storage_path) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters",
          message: "Either photo_base64 or storage_path is required",
        });
      }

      if (!parallelClient) {
        return res.status(500).json({
          success: false,
          error: "Service unavailable",
          message: "Search service is not configured",
        });
      }

      // Create job and start async processing
      const jobId = jobTracker.createJob("pending");
      console.log(`[GiftIdeas] Created job ${jobId} for photo gift creation`);

      // Start background processing
      processPhotoGiftCreation(
        jobId,
        { user_id, person_id, event_id, photo_base64, storage_path },
        { supabase, openai, parallelClient }
      ).catch((error) => {
        console.error(`[Job ${jobId}] Unexpected error:`, error);
      });

      return res.json({
        success: true,
        job_id: jobId,
        message: "Photo processing started",
        estimated_time: "30-60 seconds",
      });
    } catch (error) {
      console.error("Error starting photo processing:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Failed to start photo processing",
      });
    }
  });

  /**
   * GET /api/gift-ideas/job/:job_id
   * Check status of async gift creation job
   */
  router.get("/job/:job_id", async (req, res) => {
    try {
      const { job_id } = req.params;

      if (!job_id) {
        return res.status(400).json({
          success: false,
          error: "Missing job_id",
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

      const response: any = {
        success: true,
        job_id: job.id,
        status: job.status,
        created_at: job.createdAt,
        updated_at: job.updatedAt,
      };

      if (job.status === "completed") {
        response.result = job.result;
      } else if (job.status === "failed") {
        response.error = job.error;
      }

      return res.json(response);
    } catch (error) {
      console.error("Error checking job status:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
      });
    }
  });

  return router;
}

