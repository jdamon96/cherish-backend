import { Router } from "express";
import { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "../config/supabase";

export function parseGiftRoutes(supabase: SupabaseClient<Database>) {
  const router = Router();

  router.post("/", async (req, res) => {
    res.json({
      success: true,
      message: "Parse gift image endpoint - not yet implemented",
      status: "stub",
    });
  });

  return router;
}
