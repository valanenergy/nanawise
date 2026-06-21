import { OracleStatus } from '@nanawise/shared';
import type { Deps } from '../clients.js';
import { activeBtcOracle } from '../commands/trading.js';
import { chatCompletion, type ChatMessage, type ToolDef } from './openai.js';

/**
 * Natural-language / voice trading agent (gpt-4o + tool calling). The user states a
 * market view in plain language; the agent reads the live BTC market, picks ONE
 * binary-option position, and returns an explanation plus the exact trade params so
 * the bot can render a one-tap "Open position" (click-to-pay) button.
 *
 * The agent NEVER executes on-chain — opening always routes through the Mini App's
 * sponsored, user-signed flow. open_position just captures the chosen parameters.
 */

export interface TradeProposal {
  oracleId: string;
  expiryMs: number;
  strike1e9: bigint;
  isUp: boolean;
  quantity: bigint; // 1e6 per $1 face
  cost: bigint;
  payout: bigint;
  prob: number;
}

export interface AgentResult {
  text: string;
  trade?: TradeProposal;
}

const SYSTEM = `You are Nanawise, a friendly trading assistant for BTC up/down binary options on DeepBook Predict (Sui testnet).

The user describes a market view in natural language (typed or transcribed from voice). Translate it into ONE concrete binary-option position and open it.

How the instrument works:
- "up" = bet BTC will be ≥ the strike at expiry. "down" = bet BTC < strike.
- Each contract pays $1 if you win, $0 if you lose. The cost (1¢–99¢) is the implied probability.
- A position is a (strike, side, amount in dollars).

Rules:
1. ALWAYS call get_market first to see the current BTC price, time to expiry, and the list of tradeable strikes (only these can be traded — strikes priced under 1% or over 99% revert on-chain).
2. Pick a strike FROM that tradeable list that best matches the user's view. If they're bullish, prefer up at/near the money; if bearish, down; if they name a level ("above 64k"), use the nearest tradeable strike.
3. If the user gives an amount (e.g. "$2", "five bucks"), use it; otherwise default to $1.
4. Call preview_position to confirm cost/payout, then call open_position with a warm, plain-English "reason" (2-4 sentences) explaining the position and WHY it fits their view. Mention the side, strike, cost, max payout, implied probability, and time to expiry in the reason.
5. If the user is only asking a question (not requesting a trade), just answer briefly and do NOT open a position.
6. If no market is open or nothing matches, explain briefly and don't open.

Keep replies concise and conversational. Never invent strikes or prices — always use the tools.`;

const TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'get_market',
      description: 'Get the live BTC market: current price, minutes to expiry, and the list of tradeable strikes with their up-side implied probability and cost.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'preview_position',
      description: 'Preview the exact cost, max payout and implied probability for a specific position before opening.',
      parameters: {
        type: 'object',
        properties: {
          strike: { type: 'number', description: 'Strike price in USD, e.g. 63800' },
          side: { type: 'string', enum: ['up', 'down'] },
          amount_usd: { type: 'number', description: 'Dollar face value of contracts, e.g. 1' },
        },
        required: ['strike', 'side', 'amount_usd'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_position',
      description: 'Propose opening the position. Captures the parameters so the bot shows a one-tap pay button. Call this once you have decided.',
      parameters: {
        type: 'object',
        properties: {
          strike: { type: 'number' },
          side: { type: 'string', enum: ['up', 'down'] },
          amount_usd: { type: 'number' },
          reason: { type: 'string', description: 'Warm 2-4 sentence explanation of the position and why it fits the user\'s view.' },
        },
        required: ['strike', 'side', 'amount_usd', 'reason'],
      },
    },
  },
];

interface Ctx {
  deps: Deps;
  sender: string | undefined;
  // resolved lazily and reused across tool calls in one turn
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  oracle?: any;
}

async function ensureOracle(ctx: Ctx) {
  if (!ctx.oracle) ctx.oracle = await activeBtcOracle(ctx.deps);
  return ctx.oracle;
}

/** Build a compact, tradeable strike ladder around spot (in-band only). */
async function marketSnapshot(ctx: Ctx) {
  const o = await ensureOracle(ctx);
  if (!o || o.status !== OracleStatus.ACTIVE) return { open: false as const };
  const spot = Number(o.spot1e9) / 1e9;
  const minsToExpiry = Math.max(0, Math.round((o.expiryMs - Date.now()) / 60000));
  const center = Math.round(spot / 25) * 25;
  const strikes: { strike: number; upProbPct: number; upCostUsd: number }[] = [];
  for (let s = center - 400; s <= center + 400; s += 50) {
    try {
      const pv = await ctx.deps.predict.previewMint(
        { oracleId: o.oracleId, expiry: BigInt(o.expiryMs), strike: BigInt(s) * 1_000_000_000n, isUp: true, quantity: 1_000_000n },
        ctx.sender,
      );
      const prob = pv.impliedProb;
      if (prob > 0.01 && prob < 0.99) {
        strikes.push({ strike: s, upProbPct: Math.round(prob * 1000) / 10, upCostUsd: Math.round(Number(pv.cost) / 1e4) / 100 });
      }
    } catch {
      /* strike not priceable — skip */
    }
  }
  return {
    open: true as const,
    btcPrice: Math.round(spot * 100) / 100,
    minutesToExpiry: minsToExpiry,
    note: 'down cost ≈ $1 − up cost. Only strikes listed here are tradeable.',
    tradeableStrikes: strikes,
  };
}

async function previewPosition(ctx: Ctx, strike: number, side: string, amountUsd: number) {
  const o = await ensureOracle(ctx);
  if (!o) return { error: 'No BTC market open right now.' };
  const isUp = side === 'up';
  const quantity = BigInt(Math.max(1, Math.round(amountUsd * 1e6)));
  try {
    const pv = await ctx.deps.predict.previewMint(
      { oracleId: o.oracleId, expiry: BigInt(o.expiryMs), strike: BigInt(Math.round(strike)) * 1_000_000_000n, isUp, quantity },
      ctx.sender,
    );
    const tradeable = pv.impliedProb > 0.01 && pv.impliedProb < 0.99;
    return {
      costUsd: Math.round(Number(pv.cost) / 1e4) / 100,
      maxPayoutUsd: Math.round(Number(pv.payout) / 1e4) / 100,
      impliedProbPct: Math.round(pv.impliedProb * 1000) / 10,
      tradeable,
      ...(tradeable ? {} : { warning: 'This strike is outside the tradeable band and would revert. Pick a strike from get_market.' }),
    };
  } catch {
    return { error: 'That strike is not priceable. Use a strike from get_market.' };
  }
}

/**
 * Run the agent for one user message. Returns the final text and, if the agent
 * decided to open, a fully-priced TradeProposal for the bot to render as a button.
 */
export async function runAgent(deps: Deps, sender: string | undefined, userText: string): Promise<AgentResult> {
  const apiKey = deps.cfg.openaiApiKey;
  if (!apiKey) return { text: 'AI assistant is not configured yet.' };

  const ctx: Ctx = { deps, sender };
  const messages: ChatMessage[] = [
    { role: 'system', content: SYSTEM },
    { role: 'user', content: userText },
  ];

  let proposal: TradeProposal | undefined;
  let finalText = '';

  for (let i = 0; i < 6; i++) {
    const { message } = await chatCompletion(apiKey, messages, TOOLS);
    messages.push(message);
    const toolCalls = message?.tool_calls ?? [];
    if (!toolCalls.length) {
      finalText = message?.content ?? '';
      break;
    }
    for (const tc of toolCalls) {
      const name = tc.function?.name;
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.function?.arguments ?? '{}');
      } catch {
        /* ignore bad JSON */
      }
      let result: unknown;
      if (name === 'get_market') {
        result = await marketSnapshot(ctx);
      } else if (name === 'preview_position') {
        result = await previewPosition(ctx, Number(args.strike), String(args.side), Number(args.amount_usd));
      } else if (name === 'open_position') {
        const o = await ensureOracle(ctx);
        if (!o) {
          result = { ok: false, error: 'No BTC market open.' };
        } else {
          const isUp = String(args.side) === 'up';
          const quantity = BigInt(Math.max(1, Math.round(Number(args.amount_usd) * 1e6)));
          const strike1e9 = BigInt(Math.round(Number(args.strike))) * 1_000_000_000n;
          try {
            const pv = await deps.predict.previewMint(
              { oracleId: o.oracleId, expiry: BigInt(o.expiryMs), strike: strike1e9, isUp, quantity },
              sender,
            );
            if (pv.impliedProb <= 0.01 || pv.impliedProb >= 0.99) {
              result = { ok: false, error: 'Strike out of tradeable band — choose another from get_market.' };
            } else {
              proposal = {
                oracleId: o.oracleId,
                expiryMs: o.expiryMs,
                strike1e9,
                isUp,
                quantity,
                cost: pv.cost,
                payout: pv.payout,
                prob: pv.impliedProb,
              };
              finalText = String(args.reason ?? '');
              result = { ok: true };
            }
          } catch {
            result = { ok: false, error: 'Strike not priceable — choose another from get_market.' };
          }
        }
      } else {
        result = { error: `unknown tool ${name}` };
      }
      messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result) });
    }
    if (proposal) break; // decided — stop after capturing
  }

  return { text: finalText || 'I could not work that into a trade — try rephrasing, or use /market.', trade: proposal };
}
