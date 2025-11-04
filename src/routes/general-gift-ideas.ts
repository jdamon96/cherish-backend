import { Router } from "express";
import { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { Database } from "../config/supabase";

export function generalGiftIdeasRoutes(supabase: SupabaseClient<Database>) {
  const router = Router();

  // Initialize OpenAI client
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });

  interface GeneralGiftIdea {
    idea_text: string;
    reasoning: string;
  }

  // Feedback type ENUM - matches what should be in the database
  enum FeedbackType {
    BAD_IDEA = "bad_idea",
    NOT_RELEVANT = "not_relevant",
    REFINE = "refine",
    LIKE = "like",
    DISMISSED = "dismissed",
  }

  // Valid feedback types array for validation
  const VALID_FEEDBACK_TYPES = Object.values(FeedbackType);

  /**
   * POST /api/general-gift-ideas/generate
   * Generate initial set of general gift ideas for a person + event
   */
  router.post("/generate", async (req, res) => {
    try {
      const { user_id, person_id, event_id, count = 10 } = req.body;

      // Validate required parameters
      if (!user_id || !person_id || !event_id) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters",
          message: "user_id, person_id, and event_id are required",
        });
      }

      // Fetch person details
      const { data: person, error: personError } = await supabase
        .from("people")
        .select("*")
        .eq("id", person_id)
        .eq("user_id", user_id)
        .single();

      if (personError || !person) {
        return res.status(404).json({
          success: false,
          error: "Person not found",
          message: "The specified person does not exist or access denied",
        });
      }

      // Fetch event details
      const { data: event, error: eventError } = await supabase
        .from("events")
        .select("*")
        .eq("id", event_id)
        .eq("user_id", user_id)
        .single();

      if (eventError || !event) {
        return res.status(404).json({
          success: false,
          error: "Event not found",
          message: "The specified event does not exist or access denied",
        });
      }

      // Fetch person facts
      const { data: personFacts, error: factsError } = await supabase
        .from("person_facts")
        .select("*")
        .eq("person_id", person_id)
        .eq("user_id", user_id);

      if (factsError) {
        console.error("Error fetching person facts:", factsError);
        return res.status(500).json({
          success: false,
          error: "Database error",
          message: "Failed to fetch person facts",
        });
      }

      // Build context for OpenAI
      const personContext = {
        name: person.name,
        facts:
          personFacts?.map((fact) => ({
            title: fact.summary_title,
            content: fact.content,
          })) || [],
      };

      const eventContext = {
        name: event.name,
        type: event.event_type,
        date:
          event.specific_date ||
          `${event.recurring_month}/${event.recurring_day}`,
      };

      // Generate general gift ideas using OpenAI
      const prompt = `You are a thoughtful gift recommendation assistant. Generate ${count} diverse and creative general gift idea categories for a person based on their profile and an upcoming event.

Person: ${personContext.name}
Event: ${eventContext.name} (${eventContext.type})

Person Facts:
${personContext.facts.map((f: any) => `- ${f.title}: ${f.content}`).join("\n")}

Generate exactly ${count} general gift idea categories that:
1. Range from specific (e.g., "wireless workout headphones") to broader (e.g., "fitness gear")
2. Are thoughtful and personalized based on the person's interests and facts
3. Are appropriate for the event type
4. Cover diverse categories and price ranges
5. Each idea should be 2-6 words

IMPORTANT: Return a JSON object with an "ideas" array containing exactly ${count} gift ideas.

Expected format:
{
  "ideas": [
    {
      "idea_text": "wireless workout headphones",
      "reasoning": "Since they love fitness and enjoy running, high-quality wireless headphones would enhance their workout experience"
    },
    {
      "idea_text": "personalized water bottle",
      "reasoning": "A high-quality water bottle with their name would be practical for their active lifestyle"
    }
  ]
}

Generate all ${count} ideas in this format.`;

      console.log("[GeneralGiftIdeas] Generating ideas with OpenAI...");

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              'You are a gift recommendation expert. Always respond with a JSON object containing an "ideas" array. Never return a single object - always return multiple ideas in an array.',
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      });

      const content = response.choices[0]?.message?.content;
      console.log("[GeneralGiftIdeas] OpenAI raw response:", content);

      if (!content) {
        throw new Error("No response from OpenAI");
      }

      let ideas: GeneralGiftIdea[];
      try {
        const parsed = JSON.parse(content);
        console.log(
          "[GeneralGiftIdeas] Parsed JSON keys:",
          Object.keys(parsed)
        );
        console.log(
          "[GeneralGiftIdeas] Parsed JSON:",
          JSON.stringify(parsed, null, 2)
        );

        // Handle both array and object with array property
        ideas = Array.isArray(parsed)
          ? parsed
          : parsed.ideas || parsed.gift_ideas || [];
      } catch (parseError) {
        console.error(
          "[GeneralGiftIdeas] Error parsing OpenAI response:",
          parseError
        );
        throw new Error("Failed to parse gift ideas from AI response");
      }

      console.log(
        "[GeneralGiftIdeas] Extracted ideas count:",
        ideas?.length || 0
      );

      if (!ideas || ideas.length === 0) {
        throw new Error(
          "No gift ideas generated - check logs for OpenAI response format"
        );
      }

      // Store ideas in database
      const ideasToInsert = ideas.map((idea) => ({
        user_id,
        person_id,
        event_id,
        idea_text: idea.idea_text,
        reasoning: idea.reasoning,
        is_dismissed: false,
      }));

      const { data: insertedIdeas, error: insertError } = await supabase
        .from("general_gift_ideas")
        .insert(ideasToInsert)
        .select();

      if (insertError) {
        console.error("Error inserting gift ideas:", insertError);
        return res.status(500).json({
          success: false,
          error: "Database error",
          message: "Failed to save gift ideas",
        });
      }

      return res.json({
        success: true,
        data: {
          ideas: insertedIdeas,
          person: personContext,
          event: eventContext,
        },
      });
    } catch (error) {
      console.error("Error in generate general gift ideas:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to generate gift ideas",
      });
    }
  });

  /**
   * GET /api/general-gift-ideas
   * Fetch stored general gift ideas for a person + event
   * Includes user feedback status for each idea
   */
  router.get("/", async (req, res) => {
    try {
      const {
        user_id,
        person_id,
        event_id,
        include_dismissed = "false",
      } = req.query;

      // Validate required parameters
      if (!user_id || !person_id || !event_id) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters",
          message: "user_id, person_id, and event_id query params are required",
        });
      }

      let query = supabase
        .from("general_gift_ideas")
        .select(
          `
          *,
          general_gift_idea_feedback!left (
            id,
            feedback_type,
            feedback_text,
            refinement_direction,
            created_at
          )
        `
        )
        .eq("user_id", user_id as string)
        .eq("person_id", person_id as string)
        .eq("event_id", event_id as string)
        .eq("general_gift_idea_feedback.user_id", user_id as string)
        .order("created_at", { ascending: false });

      // Filter by dismissal status if requested
      if (include_dismissed === "false") {
        query = query.eq("is_dismissed", false);
      }

      const { data: ideas, error } = await query;

      if (error) {
        console.error("Error fetching gift ideas:", error);
        return res.status(500).json({
          success: false,
          error: "Database error",
          message: "Failed to fetch gift ideas",
        });
      }

      // Transform data to include feedback status
      const ideasWithFeedback = ideas?.map((idea: any) => {
        const feedbackArray = idea.general_gift_idea_feedback || [];
        const feedback = feedbackArray[0] || null;

        return {
          ...idea,
          feedback_type: feedback?.feedback_type || null,
          feedback_text: feedback?.feedback_text || null,
          refinement_direction: feedback?.refinement_direction || null,
          feedback_given_at: feedback?.created_at || null,
          // Remove the raw join data
          general_gift_idea_feedback: undefined,
        };
      });

      return res.json({
        success: true,
        data: {
          ideas: ideasWithFeedback || [],
          count: ideasWithFeedback?.length || 0,
        },
      });
    } catch (error) {
      console.error("Error in fetch general gift ideas:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to fetch gift ideas",
      });
    }
  });

  /**
   * POST /api/general-gift-ideas/refresh
   * Generate NEW general gift ideas (excluding existing ones)
   */
  router.post("/refresh", async (req, res) => {
    try {
      const { user_id, person_id, event_id, count = 5 } = req.body;

      // Validate required parameters
      if (!user_id || !person_id || !event_id) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters",
          message: "user_id, person_id, and event_id are required",
        });
      }

      // Fetch existing ideas to exclude them
      const { data: existingIdeas, error: existingError } = await supabase
        .from("general_gift_ideas")
        .select("idea_text")
        .eq("user_id", user_id)
        .eq("person_id", person_id)
        .eq("event_id", event_id);

      if (existingError) {
        console.error("Error fetching existing ideas:", existingError);
        return res.status(500).json({
          success: false,
          error: "Database error",
          message: "Failed to fetch existing ideas",
        });
      }

      const existingIdeaTexts = existingIdeas?.map((i) => i.idea_text) || [];

      // Fetch person details
      const { data: person, error: personError } = await supabase
        .from("people")
        .select("*")
        .eq("id", person_id)
        .eq("user_id", user_id)
        .single();

      if (personError || !person) {
        return res.status(404).json({
          success: false,
          error: "Person not found",
          message: "The specified person does not exist or access denied",
        });
      }

      // Fetch event details
      const { data: event, error: eventError } = await supabase
        .from("events")
        .select("*")
        .eq("id", event_id)
        .eq("user_id", user_id)
        .single();

      if (eventError || !event) {
        return res.status(404).json({
          success: false,
          error: "Event not found",
          message: "The specified event does not exist or access denied",
        });
      }

      // Fetch person facts
      const { data: personFacts, error: factsError } = await supabase
        .from("person_facts")
        .select("*")
        .eq("person_id", person_id)
        .eq("user_id", user_id);

      if (factsError) {
        console.error("Error fetching person facts:", factsError);
        return res.status(500).json({
          success: false,
          error: "Database error",
          message: "Failed to fetch person facts",
        });
      }

      // Build context for OpenAI
      const personContext = {
        name: person.name,
        facts:
          personFacts?.map((fact) => ({
            title: fact.summary_title,
            content: fact.content,
          })) || [],
      };

      const eventContext = {
        name: event.name,
        type: event.event_type,
        date:
          event.specific_date ||
          `${event.recurring_month}/${event.recurring_day}`,
      };

      // Generate NEW gift ideas using OpenAI
      const prompt = `You are a thoughtful gift recommendation assistant. Generate ${count} NEW and diverse general gift idea categories for a person based on their profile and an upcoming event.

Person: ${personContext.name}
Event: ${eventContext.name} (${eventContext.type})

Person Facts:
${personContext.facts.map((f: any) => `- ${f.title}: ${f.content}`).join("\n")}

IMPORTANT: The following gift ideas have already been suggested. Generate DIFFERENT ideas:
${existingIdeaTexts.map((text) => `- ${text}`).join("\n")}

Generate exactly ${count} NEW general gift idea categories that:
1. Are completely different from the existing suggestions above
2. Range from specific (e.g., "wireless workout headphones") to broader (e.g., "fitness gear")
3. Are thoughtful and personalized based on the person's interests and facts
4. Are appropriate for the event type
5. Cover diverse categories and price ranges
6. Each idea should be 2-6 words

IMPORTANT: Return a JSON object with an "ideas" array containing exactly ${count} NEW gift ideas.

Expected format:
{
  "ideas": [
    {
      "idea_text": "vintage vinyl records",
      "reasoning": "They mentioned loving classic music, and a curated collection of vintage records would be a unique gift"
    },
    {
      "idea_text": "concert tickets",
      "reasoning": "Experience gifts align with their love of live music"
    }
  ]
}

Generate all ${count} NEW ideas in this format.`;

      console.log("[GeneralGiftIdeas] Refreshing ideas with OpenAI...");

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              'You are a gift recommendation expert. Always respond with a JSON object containing an "ideas" array. Never return a single object - always return multiple ideas in an array. Never repeat previously suggested ideas.',
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.8, // Higher temperature for more creative/diverse ideas
      });

      const content = response.choices[0]?.message?.content;
      console.log("[GeneralGiftIdeas] OpenAI raw response (refresh):", content);

      if (!content) {
        throw new Error("No response from OpenAI");
      }

      let ideas: GeneralGiftIdea[];
      try {
        const parsed = JSON.parse(content);
        console.log(
          "[GeneralGiftIdeas] Parsed JSON keys (refresh):",
          Object.keys(parsed)
        );
        console.log(
          "[GeneralGiftIdeas] Parsed JSON (refresh):",
          JSON.stringify(parsed, null, 2)
        );

        ideas = Array.isArray(parsed)
          ? parsed
          : parsed.ideas || parsed.gift_ideas || [];
      } catch (parseError) {
        console.error(
          "[GeneralGiftIdeas] Error parsing OpenAI response (refresh):",
          parseError
        );
        throw new Error("Failed to parse gift ideas from AI response");
      }

      console.log(
        "[GeneralGiftIdeas] Extracted ideas count (refresh):",
        ideas?.length || 0
      );

      if (!ideas || ideas.length === 0) {
        throw new Error(
          "No gift ideas generated - check logs for OpenAI response format"
        );
      }

      // Store ideas in database
      const ideasToInsert = ideas.map((idea) => ({
        user_id,
        person_id,
        event_id,
        idea_text: idea.idea_text,
        reasoning: idea.reasoning,
        is_dismissed: false,
      }));

      const { data: insertedIdeas, error: insertError } = await supabase
        .from("general_gift_ideas")
        .insert(ideasToInsert)
        .select();

      if (insertError) {
        console.error("Error inserting gift ideas:", insertError);
        return res.status(500).json({
          success: false,
          error: "Database error",
          message: "Failed to save gift ideas",
        });
      }

      return res.json({
        success: true,
        data: {
          ideas: insertedIdeas,
          person: personContext,
          event: eventContext,
        },
      });
    } catch (error) {
      console.error("Error in refresh general gift ideas:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to refresh gift ideas",
      });
    }
  });

  /**
   * PUT /api/general-gift-ideas/:id/dismiss
   * Mark a general gift idea as dismissed
   */
  router.put("/:id/dismiss", async (req, res) => {
    try {
      const { id } = req.params;
      const { user_id } = req.body;

      if (!user_id) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameter",
          message: "user_id is required",
        });
      }

      // Update the gift idea
      const { data: updatedIdea, error: updateError } = await supabase
        .from("general_gift_ideas")
        .update({
          is_dismissed: true,
          updated_at: new Date().toISOString(),
        })
        .eq("id", id)
        .eq("user_id", user_id)
        .select()
        .single();

      if (updateError) {
        console.error("Error dismissing gift idea:", updateError);
        return res.status(500).json({
          success: false,
          error: "Database error",
          message: "Failed to dismiss gift idea",
        });
      }

      if (!updatedIdea) {
        return res.status(404).json({
          success: false,
          error: "Not found",
          message: "Gift idea not found or access denied",
        });
      }

      return res.json({
        success: true,
        data: updatedIdea,
      });
    } catch (error) {
      console.error("Error in dismiss general gift idea:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to dismiss gift idea",
      });
    }
  });

  /**
   * POST /api/general-gift-ideas/:id/feedback
   * Provide feedback on a general gift idea (not relevant, refine, like, etc.)
   */
  router.post("/:id/feedback", async (req, res) => {
    try {
      const { id } = req.params;
      const { user_id, feedback_type, feedback_text, refinement_direction } =
        req.body;

      // Validate required parameters
      if (!user_id || !feedback_type) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters",
          message: "user_id and feedback_type are required",
        });
      }

      // Validate feedback_type
      if (!VALID_FEEDBACK_TYPES.includes(feedback_type)) {
        return res.status(400).json({
          success: false,
          error: "Invalid feedback_type",
          message: `feedback_type must be one of: ${VALID_FEEDBACK_TYPES.join(
            ", "
          )}`,
        });
      }

      // Check if the general gift idea exists and belongs to the user
      const { data: giftIdea, error: giftError } = await supabase
        .from("general_gift_ideas")
        .select("*")
        .eq("id", id)
        .eq("user_id", user_id)
        .single();

      if (giftError || !giftIdea) {
        return res.status(404).json({
          success: false,
          error: "Gift idea not found",
          message: "The specified gift idea does not exist or access denied",
        });
      }

      // Upsert feedback (update if exists, insert if new)
      const { data: feedback, error: feedbackError } = await supabase
        .from("general_gift_idea_feedback")
        .upsert(
          {
            user_id,
            general_gift_idea_id: id,
            feedback_type,
            feedback_text: feedback_text || null,
            refinement_direction: refinement_direction || null,
            updated_at: new Date().toISOString(),
          },
          {
            onConflict: "user_id,general_gift_idea_id",
          }
        )
        .select()
        .single();

      if (feedbackError) {
        console.error("Error saving feedback:", feedbackError);
        return res.status(500).json({
          success: false,
          error: "Database error",
          message: "Failed to save feedback",
        });
      }

      // If feedback is dismissed/not_relevant/bad_idea, also update is_dismissed on the idea
      if (
        feedback_type === FeedbackType.DISMISSED ||
        feedback_type === FeedbackType.NOT_RELEVANT ||
        feedback_type === FeedbackType.BAD_IDEA
      ) {
        await supabase
          .from("general_gift_ideas")
          .update({
            is_dismissed: true,
            updated_at: new Date().toISOString(),
          })
          .eq("id", id)
          .eq("user_id", user_id);
      }

      return res.json({
        success: true,
        data: {
          feedback,
          gift_idea: giftIdea,
        },
      });
    } catch (error) {
      console.error("Error providing feedback on general gift idea:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message: "Failed to provide feedback",
      });
    }
  });

  /**
   * POST /api/general-gift-ideas/:id/refine
   * Generate refined versions of a general gift idea based on user feedback
   */
  router.post("/:id/refine", async (req, res) => {
    try {
      const { id } = req.params;
      const { user_id, refinement_direction, count = 5 } = req.body;

      // Validate required parameters
      if (!user_id || !refinement_direction) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters",
          message: "user_id and refinement_direction are required",
        });
      }

      // Fetch the original gift idea
      const { data: originalIdea, error: ideaError } = await supabase
        .from("general_gift_ideas")
        .select("*, people(*), events(*)")
        .eq("id", id)
        .eq("user_id", user_id)
        .single();

      if (ideaError || !originalIdea) {
        return res.status(404).json({
          success: false,
          error: "Gift idea not found",
          message: "The specified gift idea does not exist or access denied",
        });
      }

      // Fetch person facts for context
      const { data: personFacts } = await supabase
        .from("person_facts")
        .select("*")
        .eq("person_id", originalIdea.person_id)
        .eq("user_id", user_id);

      const personContext = {
        name: originalIdea.people.name,
        facts:
          personFacts?.map((fact) => ({
            title: fact.summary_title,
            content: fact.content,
          })) || [],
      };

      const eventContext = {
        name: originalIdea.events.name,
        type: originalIdea.events.event_type,
      };

      // Generate refined ideas using OpenAI
      const prompt = `You are a thoughtful gift recommendation assistant. The user has a gift idea but wants to refine it.

Original Gift Idea: "${originalIdea.idea_text}"
Refinement Request: "${refinement_direction}"

Person: ${personContext.name}
Event: ${eventContext.name} (${eventContext.type})

Person Facts:
${personContext.facts.map((f: any) => `- ${f.title}: ${f.content}`).join("\n")}

Generate exactly ${count} refined gift idea categories that:
1. Take the original idea and adjust it based on the refinement request
2. Stay relevant to the person's interests and the event
3. Each idea should be 2-6 words

IMPORTANT: Return a JSON object with an "ideas" array containing exactly ${count} refined gift ideas.

Expected format:
{
  "ideas": [
    {
      "idea_text": "affordable fitness tracker",
      "reasoning": "More budget-friendly version of the original wireless workout headphones, still fitness-focused"
    }
  ]
}

Generate all ${count} refined ideas in this format.`;

      console.log("[GeneralGiftIdeas] Refining idea with OpenAI...");

      const response = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              'You are a gift recommendation expert. Always respond with a JSON object containing an "ideas" array. Focus on refining ideas based on user feedback.',
          },
          {
            role: "user",
            content: prompt,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0.7,
      });

      const content = response.choices[0]?.message?.content;
      console.log("[GeneralGiftIdeas] OpenAI refinement response:", content);

      if (!content) {
        throw new Error("No response from OpenAI");
      }

      let ideas: GeneralGiftIdea[];
      try {
        const parsed = JSON.parse(content);
        ideas = Array.isArray(parsed)
          ? parsed
          : parsed.ideas || parsed.gift_ideas || [];
      } catch (parseError) {
        console.error("[GeneralGiftIdeas] Error parsing response:", parseError);
        throw new Error("Failed to parse refined ideas from AI response");
      }

      if (!ideas || ideas.length === 0) {
        throw new Error("No refined ideas generated");
      }

      // Store refined ideas in database
      const ideasToInsert = ideas.map((idea) => ({
        user_id,
        person_id: originalIdea.person_id,
        event_id: originalIdea.event_id,
        idea_text: idea.idea_text,
        reasoning: `Refined from "${originalIdea.idea_text}": ${idea.reasoning}`,
        is_dismissed: false,
      }));

      const { data: insertedIdeas, error: insertError } = await supabase
        .from("general_gift_ideas")
        .insert(ideasToInsert)
        .select();

      if (insertError) {
        console.error("Error inserting refined ideas:", insertError);
        return res.status(500).json({
          success: false,
          error: "Database error",
          message: "Failed to save refined ideas",
        });
      }

      // Record the refinement feedback
      await supabase.from("general_gift_idea_feedback").upsert(
        {
          user_id,
          general_gift_idea_id: id,
          feedback_type: "refine",
          refinement_direction,
          updated_at: new Date().toISOString(),
        },
        {
          onConflict: "user_id,general_gift_idea_id",
        }
      );

      return res.json({
        success: true,
        data: {
          original_idea: originalIdea,
          refined_ideas: insertedIdeas,
          refinement_direction,
        },
      });
    } catch (error) {
      console.error("Error refining general gift idea:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message:
          error instanceof Error ? error.message : "Failed to refine gift idea",
      });
    }
  });

  /**
   * GET /api/general-gift-ideas/unreviewed-counts
   * Get unreviewed product counts for all general gift ideas for a person/event
   * This endpoint fetches all data in bulk and computes counts efficiently on the backend
   */
  router.get("/unreviewed-counts", async (req, res) => {
    try {
      const { user_id, person_id, event_id } = req.query;

      // Validate required parameters
      if (!user_id || !person_id) {
        return res.status(400).json({
          success: false,
          error: "Missing required parameters",
          message: "user_id and person_id are required",
        });
      }

      // Fetch all general gift ideas for this person/event
      let generalIdeasQuery = supabase
        .from("general_gift_ideas")
        .select("id")
        .eq("user_id", user_id as string)
        .eq("person_id", person_id as string);
      
      if (event_id) {
        generalIdeasQuery = generalIdeasQuery.eq("event_id", event_id as string);
      }

      const { data: generalIdeas, error: generalError } = await generalIdeasQuery;

      if (generalError) {
        return res.status(500).json({
          success: false,
          error: "Database error",
          message: "Failed to fetch general gift ideas",
        });
      }

      if (!generalIdeas || generalIdeas.length === 0) {
        return res.json({
          success: true,
          data: { counts: {} },
        });
      }

      // Fetch all specific gift ideas for these general ideas, counting unseen ones
      const generalIdeaIds = generalIdeas.map((idea) => idea.id);
      const { data: specificGifts, error: specificError } = await supabase
        .from("specific_gift_ideas")
        .select("id, general_gift_idea_id, viewed")
        .in("general_gift_idea_id", generalIdeaIds);

      if (specificError) {
        return res.status(500).json({
          success: false,
          error: "Database error",
          message: "Failed to fetch specific gift ideas",
        });
      }

      // Count unseen products (viewed=false) for each general idea
      const counts: Record<string, number> = {};
      
      for (const generalIdea of generalIdeas) {
        const relatedGifts = (specificGifts || []).filter(
          (gift) => gift.general_gift_idea_id === generalIdea.id
        );
        
        const unseenCount = relatedGifts.filter(
          (gift) => !gift.viewed
        ).length;
        
        counts[generalIdea.id] = unseenCount;
      }

      return res.json({
        success: true,
        data: { counts },
      });
    } catch (error) {
      console.error("Error fetching unreviewed counts:", error);
      return res.status(500).json({
        success: false,
        error: "Internal server error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to fetch unreviewed counts",
      });
    }
  });

  return router;
}
