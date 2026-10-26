// Supabase Edge Function: compares one essay answer with her own reference
// answer and returns structured notes. Never a source of law: the prompt
// limits the model to the problem, her answer and the reference.
//
// Secrets: ANTHROPIC_API_KEY (required), ESSAY_FEEDBACK_MODEL (optional).
// Deploy: supabase functions deploy essay-feedback
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';

const MODEL = Deno.env.get('ESSAY_FEEDBACK_MODEL') ?? 'claude-sonnet-5-5';
const anthropic = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') });

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const SCHEMA = {
  type: 'object',
  properties: {
    structure: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          part: { type: 'string' },
          mark: { type: 'string', enum: ['yes', 'partly', 'no'] },
          reason: { type: 'string' },
        },
        required: ['part', 'mark', 'reason'],
        additionalProperties: false,
      },
    },
    missingPoints: { type: 'array', items: { type: 'string' } },
    conflicts: { type: 'array', items: { type: 'string' } },
    suggestedScore: { type: 'number' },
    notes: { type: 'string' },
  },
  required: ['structure', 'missingPoints', 'conflicts', 'suggestedScore', 'notes'],
  additionalProperties: false,
};

const SYSTEM = `You compare a Philippine Bar examinee's essay answer against her own reference answer.

Rules:
- Compare only against the reference answer. Do not introduce any case, article, rule or doctrine that is not in the problem, her answer, or the reference.
- If something is uncertain or the reference doesn't settle it, write "unclear" rather than guessing.
- structure: one entry per part of the answer-structure template, in order, marked yes, partly or no with a one-line reason.
- missingPoints: points in the reference that her answer lacks.
- conflicts: statements in her answer that contradict the reference.
- suggestedScore: 0 to 5 in steps of 0.5 (the problem is worth 5 points).
- notes: at most three short sentences.`;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  // Only a signed-in reviewee may call this.
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  });
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return json({ error: 'Sign in first' }, 401);
  const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.user.id).maybeSingle();
  if (profile?.role !== 'reviewee') return json({ error: 'Not allowed' }, 403);

  const { problem, answer, reference, template } = await req.json();
  if (!problem || !answer || !reference) return json({ error: 'problem, answer and reference are required' }, 400);
  const parts: string[] = Array.isArray(template) && template.length ? template : ['Answer', 'Legal basis', 'Application', 'Conclusion'];

  try {
    const response = await anthropic.beta.messages.create({
      model: MODEL,
      max_tokens: 4000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      messages: [
        {
          role: 'user',
          content: `<template>${parts.join(', ')}</template>\n\n<problem>\n${problem}\n</problem>\n\n<reference_answer>\n${reference}\n</reference_answer>\n\n<her_answer>\n${answer}\n</her_answer>`,
        },
      ],
    } as never);
    if (response.stop_reason === 'refusal') return json({ error: 'The model declined this request.' }, 422);
    const text = response.content.find((b: { type: string }) => b.type === 'text') as { text: string } | undefined;
    if (!text) return json({ error: 'No output' }, 502);
    return json(JSON.parse(text.text));
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'Rate limited, try again later' }, 429);
    if (e instanceof Anthropic.APIError) return json({ error: `API error ${e.status}` }, 502);
    return json({ error: String(e) }, 500);
  }
});
