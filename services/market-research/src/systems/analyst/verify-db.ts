/**
 * Verify DB Data for Analyst System
 */

import "dotenv/config";
import { getSupabase, isSupabaseConfigured, testConnection } from "@probable/db";

async function main() {
  console.log("🔍 Verifying Analyst System DB Data\n");

  if (!isSupabaseConfigured()) {
    console.log("❌ Supabase not configured");
    return;
  }

  const connected = await testConnection();
  if (!connected) {
    console.log("❌ Failed to connect");
    return;
  }

  console.log("✅ Connected to Supabase\n");

  const supabase = getSupabase();

  // Query recent sessions from analyst system
  console.log("--- Recent Analyst Sessions ---\n");
  const { data: sessions, error: sessionsError } = await supabase
    .from("agent_sessions")
    .select("*")
    .eq("task_type", "analyst")
    .order("created_at", { ascending: false })
    .limit(5);

  if (sessionsError) {
    console.log("❌ Error fetching sessions:", sessionsError.message);
  } else if (sessions && sessions.length > 0) {
    for (const s of sessions) {
      console.log(`Session: ${s.id}`);
      console.log(`  Agent: ${s.agent_name}`);
      console.log(`  Status: ${s.status}`);
      console.log(`  Task: ${s.task?.slice(0, 80)}...`);
      console.log(`  Cost: $${s.cost_usd?.toFixed(4) ?? "N/A"}`);
      console.log(`  Duration: ${s.duration_ms ?? "N/A"}ms`);
      console.log(`  Created: ${s.created_at}`);
      console.log();
    }
    console.log(`✅ Found ${sessions.length} analyst sessions`);
  } else {
    console.log("⚠️ No analyst sessions found");
  }

  // Query recent events
  console.log("\n--- Recent Events ---\n");
  const { data: events, error: eventsError } = await supabase
    .from("events")
    .select("*")
    .order("timestamp", { ascending: false })
    .limit(10);

  if (eventsError) {
    console.log("❌ Error fetching events:", eventsError.message);
  } else if (events && events.length > 0) {
    for (const e of events) {
      console.log(`${e.event_type} | ${e.timestamp} | Session: ${e.session_id?.slice(0, 8) ?? "N/A"}`);
    }
    console.log(`\n✅ Found ${events.length} recent events`);
  } else {
    console.log("⚠️ No events found");
  }
}

main().catch(console.error);
