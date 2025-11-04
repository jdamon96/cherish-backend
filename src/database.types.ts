export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "13.0.5"
  }
  public: {
    Tables: {
      event_preferences: {
        Row: {
          christmas_reminders: boolean | null
          created_at: string | null
          fathers_day_reminders: boolean | null
          id: string
          mothers_day_reminders: boolean | null
          person_id: string
          updated_at: string | null
          user_id: string
          valentine_reminders: boolean | null
        }
        Insert: {
          christmas_reminders?: boolean | null
          created_at?: string | null
          fathers_day_reminders?: boolean | null
          id?: string
          mothers_day_reminders?: boolean | null
          person_id: string
          updated_at?: string | null
          user_id: string
          valentine_reminders?: boolean | null
        }
        Update: {
          christmas_reminders?: boolean | null
          created_at?: string | null
          fathers_day_reminders?: boolean | null
          id?: string
          mothers_day_reminders?: boolean | null
          person_id?: string
          updated_at?: string | null
          user_id?: string
          valentine_reminders?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "event_preferences_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      events: {
        Row: {
          created_at: string | null
          event_type: string
          id: string
          name: string
          person_id: string | null
          recurring_day: number | null
          recurring_month: number | null
          specific_date: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          event_type: string
          id?: string
          name: string
          person_id?: string | null
          recurring_day?: number | null
          recurring_month?: number | null
          specific_date?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          event_type?: string
          id?: string
          name?: string
          person_id?: string | null
          recurring_day?: number | null
          recurring_month?: number | null
          specific_date?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "events_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      general_gift_idea_feedback: {
        Row: {
          created_at: string | null
          feedback_text: string | null
          feedback_type: string
          general_gift_idea_id: string
          id: string
          refinement_direction: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          feedback_text?: string | null
          feedback_type: string
          general_gift_idea_id: string
          id?: string
          refinement_direction?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          feedback_text?: string | null
          feedback_type?: string
          general_gift_idea_id?: string
          id?: string
          refinement_direction?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "general_gift_idea_feedback_general_gift_idea_id_fkey"
            columns: ["general_gift_idea_id"]
            isOneToOne: false
            referencedRelation: "general_gift_ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      general_gift_ideas: {
        Row: {
          created_at: string | null
          event_id: string
          id: string
          idea_text: string
          is_dismissed: boolean | null
          person_id: string
          reasoning: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          event_id: string
          id?: string
          idea_text: string
          is_dismissed?: boolean | null
          person_id: string
          reasoning?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          event_id?: string
          id?: string
          idea_text?: string
          is_dismissed?: boolean | null
          person_id?: string
          reasoning?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "general_gift_ideas_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "general_gift_ideas_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      gift_idea_interactions: {
        Row: {
          created_at: string | null
          event_id: string
          general_gift_idea_id: string | null
          id: string
          interaction_notes: string | null
          interaction_type: string
          person_id: string
          specific_gift_idea_id: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          event_id: string
          general_gift_idea_id?: string | null
          id?: string
          interaction_notes?: string | null
          interaction_type: string
          person_id: string
          specific_gift_idea_id: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          event_id?: string
          general_gift_idea_id?: string | null
          id?: string
          interaction_notes?: string | null
          interaction_type?: string
          person_id?: string
          specific_gift_idea_id?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "gift_idea_interactions_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_idea_interactions_general_gift_idea_id_fkey"
            columns: ["general_gift_idea_id"]
            isOneToOne: false
            referencedRelation: "general_gift_ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_idea_interactions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "gift_idea_interactions_specific_gift_idea_id_fkey"
            columns: ["specific_gift_idea_id"]
            isOneToOne: false
            referencedRelation: "specific_gift_ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      interests: {
        Row: {
          created_at: string | null
          id: string
          name: string
          person_id: string | null
          updated_at: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          person_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          person_id?: string | null
          updated_at?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "interests_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          contact_identifier: string | null
          created_at: string | null
          id: string
          name: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          contact_identifier?: string | null
          created_at?: string | null
          id?: string
          name: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          contact_identifier?: string | null
          created_at?: string | null
          id?: string
          name?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      person_facts: {
        Row: {
          content: string
          created_at: string | null
          id: string
          person_id: string
          summary_title: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string | null
          id?: string
          person_id: string
          summary_title?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string | null
          id?: string
          person_id?: string
          summary_title?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_facts_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string | null
          email: string | null
          full_name: string | null
          id: string
          onboarding_completed_at: string | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          onboarding_completed_at?: string | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          email?: string | null
          full_name?: string | null
          id?: string
          onboarding_completed_at?: string | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      specific_gift_ideas: {
        Row: {
          created_at: string | null
          description: string | null
          event_id: string | null
          general_gift_idea_id: string | null
          id: string
          image_urls: string[] | null
          name: string
          person_id: string | null
          price_amount: number | null
          price_currency: string | null
          source_provider: string | null
          updated_at: string | null
          url: string | null
          user_id: string
          viewed: boolean
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          event_id?: string | null
          general_gift_idea_id?: string | null
          id?: string
          image_urls?: string[] | null
          name: string
          person_id?: string | null
          price_amount?: number | null
          price_currency?: string | null
          source_provider?: string | null
          updated_at?: string | null
          url?: string | null
          user_id: string
          viewed?: boolean
        }
        Update: {
          created_at?: string | null
          description?: string | null
          event_id?: string | null
          general_gift_idea_id?: string | null
          id?: string
          image_urls?: string[] | null
          name?: string
          person_id?: string | null
          price_amount?: number | null
          price_currency?: string | null
          source_provider?: string | null
          updated_at?: string | null
          url?: string | null
          user_id?: string
          viewed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "specific_gift_ideas_event_id_fkey"
            columns: ["event_id"]
            isOneToOne: false
            referencedRelation: "events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "specific_gift_ideas_general_gift_idea_id_fkey"
            columns: ["general_gift_idea_id"]
            isOneToOne: false
            referencedRelation: "general_gift_ideas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "specific_gift_ideas_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
