import { Router } from "express";
import { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { Database } from "../config/supabase";

export function giftRecsRoutes(supabase: SupabaseClient<Database>) {
  const router = Router();

  // Initialize OpenAI client
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  interface GiftRecommendation {
    name: string;
    description: string;
    price?: number;
    url?: string;
    category: string;
    reasoning: string;
  }

  interface GiftRecsRequest {
    eventId: string;
    personId: string;
  }

  // GET endpoint for testing - returns available events and people
  router.get("/", async (req, res) => {
    try {
      // Get sample events and people for testing
      const { data: events } = await supabase
        .from("events")
        .select("id, name, event_type, person_id")
        .limit(5);

      const { data: people } = await supabase
        .from("people")
        .select("id, name")
        .limit(5);

      return res.json({
        success: true,
        message: "Gift recommendations endpoint is ready",
        testData: {
          events: events || [],
          people: people || [],
        },
        usage: {
          method: "POST",
          endpoint: "/api/get-gift-recs",
          body: {
            eventId: "uuid",
            personId: "uuid",
          },
        },
      });
    } catch (error) {
      console.error("Error in GET gift recommendations:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to fetch test data",
      });
    }
  });

  router.post("/", async (req, res) => {
    try {
      const { eventId, personId }: GiftRecsRequest = req.body;

      // Validate required parameters
      if (!eventId || !personId) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters",
          message: "Both eventId and personId are required",
        });
      }

      // Fetch event details
      const { data: event, error: eventError } = await supabase
        .from("events")
        .select("*")
        .eq("id", eventId)
        .single();

      if (eventError || !event) {
        return res.status(404).json({
          success: false,
          error: "Event not found",
          message: "The specified event does not exist",
        });
      }

      // Fetch person details
      const { data: person, error: personError } = await supabase
        .from("people")
        .select("*")
        .eq("id", personId)
        .single();

      if (personError || !person) {
        return res.status(404).json({
          success: false,
          error: "Person not found",
          message: "The specified person does not exist",
        });
      }

      // Fetch person facts
      const { data: personFacts, error: factsError } = await supabase
        .from("person_facts")
        .select("*")
        .eq("person_id", personId);

      if (factsError) {
        console.error("Error fetching person facts:", factsError);
        return res.status(500).json({
          success: false,
          error: "Database error",
          message: "Failed to fetch person facts",
        });
      }

      // Fetch person interests
      const { data: interests, error: interestsError } = await supabase
        .from("interests")
        .select("*")
        .eq("person_id", personId);

      if (interestsError) {
        console.error("Error fetching interests:", interestsError);
        return res.status(500).json({
          success: false,
          error: "Database error",
          message: "Failed to fetch interests",
        });
      }

      // Prepare context for OpenAI
      const eventContext = {
        name: event.name,
        type: event.event_type,
        date:
          event.specific_date ||
          `${event.recurring_month}/${event.recurring_day}`,
      };

      const personContext = {
        name: person.name,
        facts:
          personFacts?.map((fact) => ({
            title: fact.summary_title,
            content: fact.content,
          })) || [],
        interests: interests?.map((interest) => interest.name) || [],
      };

      // Create search query for gift recommendations
      const searchQuery = `Gift recommendations for ${personContext.name} for ${
        eventContext.name
      } (${eventContext.type}). 
        Person interests: ${personContext.interests.join(", ")}. 
        Person facts: ${personContext.facts
          .map((f: any) => `${f.title}: ${f.content}`)
          .join(". ")}.
        Find specific products, brands, and gift ideas with prices and where to buy them.`;

      console.log("Searching for gifts with query:", searchQuery);

      // Use OpenAI web search to find gift recommendations
      const response = await openai.responses.create({
        model: "gpt-4o",
        tools: [
          {
            type: "web_search_preview",
          },
        ],
        input: searchQuery,
      });

      // Parse the response to extract gift recommendations
      const giftRecommendations = await parseGiftRecommendations(
        response.output_text,
        personContext,
        eventContext
      );

      // Store recommendations in database for future reference
      if (giftRecommendations.length > 0) {
        const giftIdeas = giftRecommendations.map((rec) => ({
          name: rec.name,
          description: rec.description,
          price: rec.price,
          url: rec.url,
          person_id: personId,
          event_id: eventId,
          user_id: event.user_id,
        }));

        const { error: insertError } = await supabase
          .from("specific_gift_ideas")
          .insert(giftIdeas);

        if (insertError) {
          console.error("Error storing gift recommendations:", insertError);
          // Don't fail the request if storage fails
        }
      }

      return res.json({
        success: true,
        data: {
          person: personContext,
          event: eventContext,
          recommendations: giftRecommendations,
          searchQuery,
        },
      });
    } catch (error) {
      console.error("Error in gift recommendations:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to generate gift recommendations",
      });
    }
  });

  // Helper function to parse OpenAI response into structured gift recommendations
  async function parseGiftRecommendations(
    responseText: string,
    personContext: any,
    eventContext: any
  ): Promise<GiftRecommendation[]> {
    try {
      // Use OpenAI to parse the web search results into structured recommendations
      const parseResponse = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content: `You are a gift recommendation parser. Parse the following web search results about gift recommendations into a structured JSON format.

            Return an array of gift recommendations with this structure:
            [
              {
                "name": "Product name",
                "description": "Brief description of the product",
                "price": 29.99,
                "url": "https://example.com/product",
                "category": "Category like Electronics, Books, Clothing, etc.",
                "reasoning": "Why this gift is perfect for this person and event"
              }
            ]

            Focus on specific products with clear names, descriptions, and pricing. Include reasoning that connects the gift to the person's interests and the event context.`,
          },
          {
            role: "user",
            content: `Person: ${personContext.name}
            Event: ${eventContext.name} (${eventContext.type})
            Interests: ${personContext.interests.join(", ")}
            Facts: ${personContext.facts
              .map((f: any) => `${f.title}: ${f.content}`)
              .join(". ")}

            Web search results:
            ${responseText}

            Parse these results into structured gift recommendations.`,
          },
        ],
        temperature: 0.3,
      });

      const parsedContent = parseResponse.choices[0]?.message?.content;
      if (!parsedContent) {
        throw new Error("No content in parse response");
      }

      // Try to extract JSON from the response
      const jsonMatch = parsedContent.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error("No JSON array found in response");
      }

      const recommendations = JSON.parse(jsonMatch[0]);
      return recommendations;
    } catch (error) {
      console.error("Error parsing gift recommendations:", error);
      // Fallback: return a simple recommendation based on the original response
      return [
        {
          name: "Personalized Gift Recommendation",
          description:
            "Based on the person's interests and the event, here are some gift ideas to consider.",
          category: "General",
          reasoning: `This recommendation is based on ${
            personContext.name
          }'s interests in ${personContext.interests.join(", ")} and the ${
            eventContext.type
          } event.`,
        },
      ];
    }
  }

  return router;
}
