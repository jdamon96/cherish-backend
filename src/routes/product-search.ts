import { Router } from "express";
import Exa from "exa-js";
import OpenAI from "openai";
import puppeteer from "puppeteer";
import { ApifyClient } from "apify-client";

// ==================== INTERFACES & TYPES ====================

interface SearchResult {
  title: string;
  url: string;
  publishedDate?: string;
  author?: string;
}

interface Price {
  amount: number | null;
  currency: string | null;
  formatted?: string | null; // For display purposes
}

interface ProductMetadata {
  name: string;
  price: Price;
  thumbnailImage: string | null;
  highResolutionImages: string[];
  description: string;
  productUrl: string;
  availability?: string;
  // Additional rich metadata
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

// ==================== CONFIGURATION ====================
const CONFIG = {
  // Configure which search providers to use (results from all will be returned)
  searchProviders: [
    SearchProvider.EXA,
    // SearchProvider.OPENAI_WEB_SEARCH,
  ] as SearchProvider[],

  // Configure which metadata providers to use (results from all will be returned)
  metadataProviders: [
    MetadataProvider.EXA_CONTENTS,
    MetadataProvider.APIFY_AMAZON,
  ] as MetadataProvider[],

  // Search settings
  maxSearchResults: 10,

  // Metadata settings
  useUrlRouting: true, // Route Amazon URLs to Apify, others to Exa
};
// ======================================================

// ==================== SEARCH SERVICES ====================

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

class OpenAIWebSearchService {
  constructor(private openai: OpenAI) {}

  async search(productName: string): Promise<SearchResult[]> {
    const searchQuery = `where to buy ${productName} online`;
    console.log("[OpenAIWebSearchService] Searching:", searchQuery);

    const response = await this.openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content:
            'You are a helpful assistant that finds online shopping URLs for products. Return results as a JSON object with a "results" key containing an array of objects with title and url fields.',
        },
        {
          role: "user",
          content: `Find ${CONFIG.maxSearchResults} reliable online shopping URLs where I can buy "${productName}". Include major retailers and official stores. Return as JSON: {"results": [{"title": "...", "url": "..."}]}`,
        },
      ],
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      return [];
    }

    try {
      const parsed = JSON.parse(content);
      const resultsArray = parsed.results || parsed.urls || parsed;

      if (Array.isArray(resultsArray)) {
        return resultsArray.map((item: any) => ({
          title: item.title || item.name || "Unknown",
          url: item.url || item.link || "",
          publishedDate: item.publishedDate,
          author: item.author,
        }));
      }
      return [];
    } catch (error) {
      console.error("[OpenAIWebSearchService] Error parsing results:", error);
      return [];
    }
  }
}

// ==================== METADATA SERVICES ====================

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

    console.log(
      "[ApifyAmazonMetadataService] items:\n",
      JSON.stringify(items, null, 2)
    );

    const item = items[0] as any;

    // Parse price - can be object {value, currency} or string or null
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
      // Fallback for string prices
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

    // Get high resolution images array
    const highResImages: string[] = [];
    if (Array.isArray(item.highResolutionImages)) {
      highResImages.push(...item.highResolutionImages);
    } else if (Array.isArray(item.images)) {
      highResImages.push(...item.images);
    }

    // Parse availability
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

// ==================== ORCHESTRATORS ====================

async function searchProductOrchestrator(
  productName: string,
  providers: SearchProvider[],
  exa: Exa,
  openai: OpenAI
): Promise<SearchServiceResult[]> {
  const services: { [key: string]: any } = {
    [SearchProvider.EXA]: new ExaSearchService(exa),
    [SearchProvider.OPENAI_WEB_SEARCH]: new OpenAIWebSearchService(openai),
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

  // Smart routing: if URL routing is enabled, automatically select appropriate service
  if (config.useUrlRouting) {
    if (isAmazon) {
      // Use Apify for Amazon URLs
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
              price: {
                amount: null,
                currency: null,
                formatted: null,
              },
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
      // Use Exa for non-Amazon URLs
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
              price: {
                amount: null,
                currency: null,
                formatted: null,
              },
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

  // If routing disabled, call all configured providers in parallel
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
          price: {
            amount: null,
            currency: null,
            formatted: null,
          },
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

// ==================== ROUTES ====================

export function productSearchRoutes() {
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
   * POST /api/search
   * Accepts a product name and returns search results for where to purchase it
   */
  router.post("/search", async (req, res) => {
    try {
      const { productName } = req.body;

      if (!productName || typeof productName !== "string") {
        return res.status(400).json({
          success: false,
          error: "Missing or invalid parameter",
          message: "productName (string) is required",
        });
      }

      console.log("=== Product Search Request ===");
      console.log("Product:", productName);
      console.log("Providers:", CONFIG.searchProviders);

      const results = await searchProductOrchestrator(
        productName,
        CONFIG.searchProviders,
        exa,
        openai
      );

      return res.json({
        success: true,
        data: results,
        config: {
          providers: CONFIG.searchProviders,
        },
      });
    } catch (error) {
      console.error("Error in product search:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to search for product",
      });
    }
  });

  /**
   * POST /api/metadata
   * Accepts a product purchase URL and returns metadata about the product
   */
  router.post("/metadata", async (req, res) => {
    try {
      const { productUrl } = req.body;

      if (!productUrl || typeof productUrl !== "string") {
        return res.status(400).json({
          success: false,
          error: "Missing or invalid parameter",
          message: "productUrl (string) is required",
        });
      }

      // Validate URL format
      try {
        new URL(productUrl);
      } catch (urlError) {
        return res.status(400).json({
          success: false,
          error: "Invalid URL format",
          message: "productUrl must be a valid URL",
        });
      }

      console.log("=== Product Metadata Request ===");
      console.log("URL:", productUrl);
      console.log("Providers:", CONFIG.metadataProviders);
      console.log("URL Routing:", CONFIG.useUrlRouting);

      const results = await extractMetadataOrchestrator(
        productUrl,
        CONFIG.metadataProviders,
        exa,
        apifyApiToken,
        CONFIG
      );

      return res.json({
        success: true,
        data: results,
        config: {
          providers: CONFIG.metadataProviders,
          urlRouting: CONFIG.useUrlRouting,
        },
      });
    } catch (error) {
      console.error("Error fetching product metadata:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to fetch product metadata",
      });
    }
  });

  /**
   * POST /api/product/lookup
   * Combined endpoint: searches for a product and returns metadata
   * Uses LLM to intelligently select the best purchase URL from search results
   */
  router.post("/lookup", async (req, res) => {
    try {
      const { productName } = req.body;

      if (!productName || typeof productName !== "string") {
        return res.status(400).json({
          success: false,
          error: "Missing or invalid parameter",
          message: "productName (string) is required",
        });
      }

      console.log("=== Product Lookup Request ===");
      console.log("Product:", productName);

      // Step 1: Search for the product
      const searchResults = await searchProductOrchestrator(
        productName,
        CONFIG.searchProviders,
        exa,
        openai
      );

      // Combine all search results from different providers
      const allResults: SearchResult[] = [];
      searchResults.forEach((result) => {
        allResults.push(...result.results);
      });

      if (allResults.length === 0) {
        return res.status(404).json({
          success: false,
          error: "No results found",
          message: "Could not find any purchase locations for this product",
        });
      }

      // Step 2: Use LLM to select the best purchase URL
      const searchResultsForLLM = allResults.map((result, index) => ({
        index: index + 1,
        title: result.title,
        url: result.url,
      }));

      const llmPrompt = `You are helping to identify the best URL where a user can PURCHASE a product online. 

Product being searched: "${productName}"

Here are the search results:
${JSON.stringify(searchResultsForLLM, null, 2)}

Your task: Select the SINGLE BEST URL where someone can actually purchase this product. Look for:
- Direct product pages on e-commerce sites (Amazon, BestBuy, Target, Walmart, etc.)
- Official manufacturer stores
- Reputable online retailers
- Favor .com links over international domains (e.g., if presented with two options ""https://www.amazon.in/{productName}/dp/{productId}"" or """https://www.strandbooks.com/{productName}-{productId}.html""", choose the .com link even though the other is an Amazon link)

IMPORTANT: Avoid these types of sites:
- Review sites
- Comparison sites
- News articles
- General information pages

Respond with ONLY the index number (1-${
        searchResultsForLLM.length
      }) of the best purchase URL. No other text.`;

      const llmResponse = await openai.chat.completions.create({
        model: "gpt-4",
        messages: [
          {
            role: "system",
            content:
              "You are an expert at identifying e-commerce purchase URLs. Respond only with a number.",
          },
          {
            role: "user",
            content: llmPrompt,
          },
        ],
        max_tokens: 10,
        temperature: 0,
      });

      const selectedIndexText =
        llmResponse.choices[0]?.message?.content?.trim();
      if (!selectedIndexText) {
        throw new Error("LLM failed to select a URL");
      }

      const selectedIndex = parseInt(selectedIndexText, 10);
      if (
        isNaN(selectedIndex) ||
        selectedIndex < 1 ||
        selectedIndex > allResults.length
      ) {
        console.error("Invalid LLM response:", selectedIndexText);
        throw new Error("LLM returned invalid index");
      }

      const selectedUrl = allResults[selectedIndex - 1].url;
      console.log("LLM selected URL:", selectedUrl);

      // Step 3: Fetch metadata for the selected URL
      const metadataResults = await extractMetadataOrchestrator(
        selectedUrl,
        CONFIG.metadataProviders,
        exa,
        apifyApiToken,
        CONFIG
      );

      return res.json({
        success: true,
        data: {
          selectedUrl,
          searchResults: searchResults,
          metadata: metadataResults,
        },
        debug: {
          totalSearchResults: allResults.length,
          llmSelection: {
            selectedIndex,
            selectedUrl,
            llmResponse: selectedIndexText,
          },
        },
      });
    } catch (error) {
      console.error("Error in product lookup:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message:
          error instanceof Error ? error.message : "Failed to lookup product",
      });
    }
  });

  /**
   * POST /api/product/screenshot
   * Takes a screenshot of a product page instead of scraping metadata
   */
  router.post("/screenshot", async (req, res) => {
    try {
      const { productUrl } = req.body;

      if (!productUrl || typeof productUrl !== "string") {
        return res.status(400).json({
          success: false,
          error: "Missing or invalid parameter",
          message: "productUrl (string) is required",
        });
      }

      // Validate URL format
      try {
        new URL(productUrl);
      } catch (urlError) {
        return res.status(400).json({
          success: false,
          error: "Invalid URL format",
          message: "productUrl must be a valid URL",
        });
      }

      console.log("Taking screenshot of:", productUrl);

      // Launch headless browser
      const browser = await puppeteer.launch({
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
        ],
      });

      try {
        const page = await browser.newPage();

        // Set viewport size for consistent screenshots
        await page.setViewport({
          width: 1280,
          height: 1024,
          deviceScaleFactor: 1,
        });

        // Set a realistic user agent to avoid bot detection
        await page.setUserAgent(
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        );

        // Navigate to the product page with a timeout
        await page.goto(productUrl, {
          waitUntil: "networkidle2",
          timeout: 30000,
        });

        // Wait a bit for any dynamic content to load
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // Take a full page screenshot
        const screenshot = await page.screenshot({
          fullPage: true,
          type: "png",
        });

        await browser.close();

        // Convert buffer to base64
        const base64Screenshot = Buffer.from(screenshot).toString("base64");

        console.log(
          "Screenshot captured successfully, size:",
          screenshot.length,
          "bytes"
        );

        return res.json({
          success: true,
          data: {
            productUrl,
            screenshot: base64Screenshot,
            format: "png",
            encoding: "base64",
            size: screenshot.length,
          },
        });
      } catch (pageError) {
        await browser.close();
        throw pageError;
      }
    } catch (error) {
      console.error("Error taking screenshot:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to take screenshot of product page",
      });
    }
  });

  return router;
}
