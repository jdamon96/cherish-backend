import { Router } from "express";
import { SupabaseClient } from "@supabase/supabase-js";
import OpenAI from "openai";
import { Database, PersonFactInsert } from "../config/supabase";
import { validateEnvironment } from "../types/env";

// Core prompt template for generating anecdote summaries
const ANECDOTE_SUMMARY_PROMPT = `You are a helpful assistant that creates concise, descriptive titles for personal anecdotes. These summaries will be used as "pill" or "badge" UI elements in an app, representing anecdotes the user has shared about someone they want to find gifts for. The summaries should serve as quick, contextual references to the anecdote from the user's perspective, and will be displayed back to the user. For example, if the user writes "She is my mom" about a person, a useful summary would be "Your mom". Your task is to summarize the given text into a short, meaningful title (ideally under 5 words) that captures the essence of what the person likes, does, is interested in, or their relationship to the user. Examples: 'Loves to garden', 'Enjoys cooking', 'Passionate about music', 'Loves hiking', 'Your mom'.`;

export function insertPersonFactRoutes(supabase: SupabaseClient<Database>) {
  const router = Router();

  router.post("/", async (req, res) => {
    // Initialize environment and OpenAI client inside the route
    const env = validateEnvironment();
    const openai = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    });
    try {
      const { content, user_id, person_id } = req.body;

      if (!content) {
        return res.status(400).json({
          error: "Missing required field",
          message: "content is required",
        });
      }

      if (!user_id) {
        return res.status(400).json({
          error: "Missing required field",
          message: "user_id is required",
        });
      }

      if (!person_id) {
        return res.status(400).json({
          error: "Missing required field",
          message: "person_id is required",
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
            content: `Create a concise title for this personal anecdote: "${content}"`,
          },
        ],
        max_tokens: 50,
        temperature: 0.3,
      });

      const rawSummaryTitle = completion.choices[0]?.message?.content?.trim();

      if (!rawSummaryTitle) {
        throw new Error("Failed to generate summary title");
      }

      // Remove quotes from the beginning and end of the summary title
      const summaryTitle = rawSummaryTitle.replace(/^["']|["']$/g, "").trim();

      // Insert the new person fact with the generated summary
      const personFactData: PersonFactInsert = {
        user_id,
        person_id,
        content,
        summary_title: summaryTitle,
      };

      const { data: newPersonFact, error: insertError } = await supabase
        .from("person_facts")
        .insert(personFactData)
        .select()
        .single();

      if (insertError) {
        console.error("Error inserting person fact:", insertError);
        return res.status(500).json({
          error: "Database insert failed",
          message: "Could not save the person fact",
        });
      }

      return res.json({
        success: true,
        data: {
          id: newPersonFact.id,
          content: newPersonFact.content,
          summary_title: newPersonFact.summary_title,
          user_id: newPersonFact.user_id,
          person_id: newPersonFact.person_id,
          created_at: newPersonFact.created_at,
        },
      });
    } catch (error) {
      console.error("Error in insert person fact:", error);

      if (error instanceof Error && error.message.includes("API key")) {
        return res.status(500).json({
          error: "OpenAI API Error",
          message: "Invalid or missing OpenAI API key",
        });
      }

      return res.status(500).json({
        error: "Internal Server Error",
        message: "Failed to insert person fact",
      });
    }
  });

  return router;
}
