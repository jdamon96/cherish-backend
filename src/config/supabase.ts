import { createClient } from "@supabase/supabase-js";
import { Database } from "../database.types";
import { EnvironmentVariables } from "../types/env";

// Re-export Database type for use in other files
export { Database };

export function createSupabaseClient(env: EnvironmentVariables) {
  return createClient<Database>(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

// Re-export official database types for convenience
export type PersonFact = Database["public"]["Tables"]["person_facts"]["Row"];
export type PersonFactInsert =
  Database["public"]["Tables"]["person_facts"]["Insert"];
export type PersonFactUpdate =
  Database["public"]["Tables"]["person_facts"]["Update"];

export type SpecificGiftIdea =
  Database["public"]["Tables"]["specific_gift_ideas"]["Row"];
export type SpecificGiftIdeaInsert =
  Database["public"]["Tables"]["specific_gift_ideas"]["Insert"];
export type SpecificGiftIdeaUpdate =
  Database["public"]["Tables"]["specific_gift_ideas"]["Update"];

export type Person = Database["public"]["Tables"]["people"]["Row"];
export type PersonInsert = Database["public"]["Tables"]["people"]["Insert"];
export type PersonUpdate = Database["public"]["Tables"]["people"]["Update"];

export type Interest = Database["public"]["Tables"]["interests"]["Row"];
export type InterestInsert =
  Database["public"]["Tables"]["interests"]["Insert"];
export type InterestUpdate =
  Database["public"]["Tables"]["interests"]["Update"];

export type Event = Database["public"]["Tables"]["events"]["Row"];
export type EventInsert = Database["public"]["Tables"]["events"]["Insert"];
export type EventUpdate = Database["public"]["Tables"]["events"]["Update"];

export type EventPreferences =
  Database["public"]["Tables"]["event_preferences"]["Row"];
export type EventPreferencesInsert =
  Database["public"]["Tables"]["event_preferences"]["Insert"];
export type EventPreferencesUpdate =
  Database["public"]["Tables"]["event_preferences"]["Update"];

export type Profile = Database["public"]["Tables"]["profiles"]["Row"];
export type ProfileInsert = Database["public"]["Tables"]["profiles"]["Insert"];
export type ProfileUpdate = Database["public"]["Tables"]["profiles"]["Update"];
