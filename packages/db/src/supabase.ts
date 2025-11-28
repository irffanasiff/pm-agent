/**
 * Supabase Client
 * Singleton client for database operations
 */

import { createClient, SupabaseClient } from "@supabase/supabase-js";

let supabaseInstance: SupabaseClient | null = null;

/**
 * Get the Supabase client instance
 * Lazy-loaded singleton
 */
export function getSupabase(): SupabaseClient {
  if (!supabaseInstance) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;

    if (!url || !key) {
      throw new Error(
        "Missing Supabase configuration. Set SUPABASE_URL and SUPABASE_KEY environment variables."
      );
    }

    supabaseInstance = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  return supabaseInstance;
}

/**
 * Check if Supabase is configured
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_KEY);
}

/**
 * Reset client (for testing)
 */
export function resetSupabase(): void {
  supabaseInstance = null;
}

/**
 * Test database connection
 */
export async function testConnection(): Promise<boolean> {
  if (!isSupabaseConfigured()) {
    return false;
  }

  try {
    const supabase = getSupabase();
    const { error } = await supabase.from("workflow_runs").select("id").limit(1);
    if (error) {
      console.error("   Connection error:", error.message);
    }
    return !error;
  } catch (e) {
    console.error("   Connection exception:", e);
    return false;
  }
}
