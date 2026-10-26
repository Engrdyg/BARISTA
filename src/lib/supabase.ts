import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// VITE_* names, or the NEXT_PUBLIC_* names that Vercel's Supabase
// integration sets (the publishable key is the client-safe key).
const env = import.meta.env;
const url = (env.VITE_SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL) as string | undefined;
const key = (env.VITE_SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY) as string | undefined;

/** Null when the app is built without Supabase: it then runs local-only. */
export const supabase: SupabaseClient | null =
  url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true } }) : null;

export const cloudEnabled = !!supabase;
