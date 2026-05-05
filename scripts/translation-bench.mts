// Translation provider bench. Runs the same 10 phrases through both
// providers, prints token usage, and validates the JSON shape.
//
// Run: tsx scripts/translation-bench.mts
// Requires OPENAI_API_KEY + ANTHROPIC_API_KEY in env (loads from .env).

import { readFileSync } from 'node:fs';
import { translateWithOpenAI } from '../src/lib/translation/openai.ts';
import { translateWithAnthropic } from '../src/lib/translation/anthropic.ts';

// Tiny .env loader — just OPENAI/ANTHROPIC keys
try {
  const env = readFileSync('.env', 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {
  // ignore — assume env is already populated
}

const PHRASES = [
  'hi',
  "you're beautiful",
  "you're smart",
  "do you have a boyfriend?",
  "let's get out of here",
  "I want you right now",
  "where is the bathroom?",
  "how much does it cost?",
  "fucking awesome",
  "can I see you again tomorrow?",
];

function parseTotals(rows: Array<{ in: number; out: number }>) {
  const sumIn = rows.reduce((a, r) => a + r.in, 0);
  const sumOut = rows.reduce((a, r) => a + r.out, 0);
  return {
    avgIn: Math.round(sumIn / rows.length),
    avgOut: Math.round(sumOut / rows.length),
    totalIn: sumIn,
    totalOut: sumOut,
  };
}

async function bench() {
  const openaiKey = process.env.OPENAI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (!openaiKey) console.warn('⚠️  OPENAI_API_KEY missing, skipping OpenAI');
  if (!anthropicKey) console.warn('⚠️  ANTHROPIC_API_KEY missing, skipping Anthropic');

  console.log(`\n${'='.repeat(80)}\nOPENAI gpt-4o-mini\n${'='.repeat(80)}`);
  const openaiRows: Array<{ in: number; out: number }> = [];
  if (openaiKey) {
    for (const p of PHRASES) {
      try {
        const t0 = Date.now();
        const { result, usage } = await translateWithOpenAI(p, openaiKey);
        const ms = Date.now() - t0;
        openaiRows.push({ in: usage.prompt_tokens, out: usage.completion_tokens });
        console.log(
          `  ${ms.toString().padStart(4)}ms  in=${String(usage.prompt_tokens).padStart(3)} out=${String(usage.completion_tokens).padStart(3)}  ${p.padEnd(35)} → ${result.ru}${result.notes ? '  // ' + result.notes : ''}`,
        );
      } catch (err) {
        console.log(`  ✗ ${p}: ${String(err).slice(0, 100)}`);
      }
    }
    const t = parseTotals(openaiRows);
    console.log(`\n  AVG: in=${t.avgIn}, out=${t.avgOut}   TOTAL: in=${t.totalIn}, out=${t.totalOut}`);
  }

  console.log(`\n${'='.repeat(80)}\nANTHROPIC claude-haiku-4-5\n${'='.repeat(80)}`);
  const anthRows: Array<{ in: number; out: number }> = [];
  if (anthropicKey) {
    for (const p of PHRASES) {
      try {
        const t0 = Date.now();
        const { result, usage } = await translateWithAnthropic(p, anthropicKey);
        const ms = Date.now() - t0;
        anthRows.push({ in: usage.input_tokens, out: usage.output_tokens });
        console.log(
          `  ${ms.toString().padStart(4)}ms  in=${String(usage.input_tokens).padStart(3)} out=${String(usage.output_tokens).padStart(3)}  ${p.padEnd(35)} → ${result.ru}${result.notes ? '  // ' + result.notes : ''}`,
        );
      } catch (err) {
        console.log(`  ✗ ${p}: ${String(err).slice(0, 100)}`);
      }
    }
    const t = parseTotals(anthRows);
    console.log(`\n  AVG: in=${t.avgIn}, out=${t.avgOut}   TOTAL: in=${t.totalIn}, out=${t.totalOut}`);
  }

  console.log(`\n${'='.repeat(80)}\nDone.\n`);
}

bench().catch((e) => {
  console.error(e);
  process.exit(1);
});
