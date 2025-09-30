import { Router } from "express";
import { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { Database, PersonFact, PersonFactUpdate } from "../config/supabase";
import { validateEnvironment } from "../types/env";

// Core prompt template for generating anecdote summaries
const ANECDOTE_SUMMARY_PROMPT = `You are a helpful assistant that creates concise, descriptive titles for personal anecdotes. These summaries will be used as "pill" or "badge" UI elements in an app, representing anecdotes the user has shared about someone they want to find gifts for. The summaries should serve as quick, contextual references to the anecdote from the user's perspective, and will be displayed back to the user. For example, if the user writes "She is my mom" about a person, a useful summary would be "Your mom". Your task is to summarize the given text into a short, meaningful title (ideally under 5 words) that captures the essence of what the person likes, does, is interested in, or their relationship to the user. Examples: 'Loves to garden', 'Enjoys cooking', 'Passionate about music', 'Loves hiking', 'Your mom'.`;

export function summarizeAnecdoteRoutes(supabase: SupabaseClient<Database>) {
  const router = Router();

  router.post("/", async (req, res) => {
    // Initialize environment and OpenAI client inside the route
    const env = validateEnvironment();
    const openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    });
    try {
      const { person_fact_id, user_id } = req.body;

      if (!person_fact_id) {
        return res.status(400).json({
          error: "Missing required field",
          message: "person_fact_id is required",
        });
      }

      if (!user_id) {
        return res.status(400).json({
          error: "Missing required field",
          message: "user_id is required",
        });
      }

      // Fetch the person fact from Supabase (with user_id validation for security)
      const { data: personFact, error: fetchError } = await supabase
        .from("person_facts")
        .select("*")
        .eq("id", person_fact_id)
        .eq("user_id", user_id)
        .single();

      if (fetchError) {
        console.error("Error fetching person fact:", fetchError);
        return res.status(404).json({
          error: "Person fact not found",
          message: "Could not find person fact with the provided ID",
        });
      }

      if (!personFact.content) {
        return res.status(400).json({
          error: "Invalid data",
          message: "Person fact has no content to summarize",
        });
      }

      // Generate summary using OpenAI
      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          {
            role: "system",
            content: ANECDOTE_SUMMARY_PROMPT,
          },
          {
            role: "user",
            content: `Create a concise title for this personal anecdote: "${personFact.content}"`,
          },
        ],
        max_tokens: 50,
        temperature: 0.3,
      });

      const summaryTitle = completion.choices[0]?.message?.content?.trim();

      if (!summaryTitle) {
        throw new Error("Failed to generate summary title");
      }

      // Update the person fact with the summary title
      const updateData: PersonFactUpdate = {
        summary_title: summaryTitle,
        updated_at: new Date().toISOString(),
      };

      const { error: updateError } = await supabase
        .from("person_facts")
        .update(updateData)
        .eq("id", person_fact_id);

      if (updateError) {
        console.error("Error updating person fact:", updateError);
        return res.status(500).json({
          error: "Database update failed",
          message: "Could not save the summary title",
        });
      }

      return res.json({
        success: true,
        data: {
          id: person_fact_id,
          original_content: personFact.content,
          summary_title: summaryTitle,
        },
      });
    } catch (error) {
      console.error("Error in summarize anecdote:", error);

      if (error instanceof Error && error.message.includes("API key")) {
        return res.status(500).json({
          error: "OpenAI API Error",
          message: "Invalid or missing OpenAI API key",
        });
      }

      return res.status(500).json({
        error: "Internal Server Error",
        message: "Failed to summarize anecdote",
      });
    }
  });

  return router;
}
