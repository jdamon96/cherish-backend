import { Router } from "express";
import { SupabaseClient } from "@supabase/supabase-js";
import { Database } from "../config/supabase";

export function giftRecsRoutes(supabase: SupabaseClient<Database>) {
  const router = Router();

  router.get("/", async (req, res) => {
    res.json({
      success: true,
      message: "Gift recommendations endpoint - not yet implemented",
      status: "stub",
    });
  });

  router.post("/", async (req, res) => {
    res.json({
      success: true,
      message: "Gift recommendations POST endpoint - not yet implemented",
      status: "stub",
    });
  });

  return router;
}
