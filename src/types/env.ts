export interface EnvironmentVariables {
  SUPABASE_URL: string;
  SUPABASE_PROJECT_ID: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  OPENAI_API_KEY: string;
  PORT?: string;
  NODE_ENV?: string;
}

export function validateEnvironment(): EnvironmentVariables {
  const requiredVars = [
    "SUPABASE_URL",
    "SUPABASE_PROJECT_ID",
    "SUPABASE_SERVICE_ROLE_KEY",
    "OPENAI_API_KEY",
  ];

  const missingVars = requiredVars.filter((varName) => !process.env[varName]);

  if (missingVars.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missingVars.join(", ")}`
    );
  }

  return {
    SUPABASE_URL: process.env.SUPABASE_URL!,
    SUPABASE_PROJECT_ID: process.env.SUPABASE_PROJECT_ID!,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY!,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY!,
    PORT: process.env.PORT || "3000",
    NODE_ENV: process.env.NODE_ENV || "development",
  };
}
