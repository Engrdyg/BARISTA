import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// VITE_* names, or the NEXT_PUBLIC_* names that Vercel's Supabase
// integration sets (the publishable key is the client-safe key).
const env = import.meta.env;
const rawUrl = ((env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL) as string | undefined)?.trim();
// Keep only the origin: a pasted ".../rest/v1/" or trailing slash breaks auth requests.
const url = rawUrl ? safeOrigin(rawUrl) : undefined;

function safeOrigin(u: string): string | undefined {
  try {
    return new URL(u).origin;
  } catch {
    return undefined;
  }
}
const key = ((env.VITE_SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY) as string | undefined)?.trim();

/** Null when the app is built without Supabase: it then runs local-only. */
export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

export const cloudEnabled = !!supabase;
