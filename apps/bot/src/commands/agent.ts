import { prisma } from '@nanawise/db';
import { isExpired } from '@nanawise/sui-auth';
import { formatUsdc, parseUsdc, type StrategyName } from '@nanawise/shared';
import { Bot, InlineKeyboard } from 'grammy';
import type { Deps } from '../clients.js';

/**
 * Agent wallet commands (Phase 4, docs/04):
 *   /policy <budget> <hours>  — Mini App signs create_policy (funds the escrow)
 *   /auto <strategy> | off    — set/clear the enabled strategy in Redis (no tx)
 *   /revoke                   — Mini App signs revoke (returns unspent funds)
 */

const STRATEGIES: StrategyName[] = ['vol-harvest', 'momentum', 'contrarian', 'delta-neutral'];
const AGENT_ADDRESS_ENV = process.env.AGENT_ADDRESS ?? '';

export function registerAgentCommands(bot: Bot, deps: Deps): void {
  async function requireSession(tgId: number) {
    const sess = await deps.sessions.getSession(tgId);
    return sess && !isExpired(sess) ? sess : null;
  }

  bot.command('policy', async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId) return;
    const sess = await requireSession(tgId);
    if (!sess) {
      await ctx.reply('Tap /start to set up your wallet first.');
      return;
    }
    const [budgetStr, hoursStr] = (ctx.match ?? '').trim().split(/\s+/);
    if (!budgetStr || !hoursStr) {
      await ctx.reply('Usage: /policy <budget dUSDC> <hours>\nExample: /policy 50 24');
      return;
    }
    let budget: bigint;
    try {
      budget = parseUsdc(budgetStr);
    } catch {
      await ctx.reply('Could not read the budget. Example: /policy 50 24');
      return;
    }
    const hours = Number(hoursStr);
    if (!Number.isFinite(hours) || hours <= 0) {
      await ctx.reply('Hours must be a positive number.');
      return;
    }
    const kb = new InlineKeyboard().webApp(
      `Fund agent with ${formatUsdc(budget)} dUSDC →`,
      `${deps.cfg.miniAppUrl}/miniapp/agent?action=create&budget=${budget}&hours=${hours}`,
    );
    await ctx.reply(
      [
        `*Create an agent budget*`,
        `Budget: *${formatUsdc(budget)} dUSDC* · valid for *${hours}h*`,
        'The agent can only ever spend from this escrow — you can /revoke anytime and reclaim what is unspent.',
        '',
        'Then pick a strategy with /auto.',
      ].join('\n'),
      { parse_mode: 'Markdown', reply_markup: kb },
    );
  });

  bot.command('auto', async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId) return;
    const sess = await requireSession(tgId);
    if (!sess) {
      await ctx.reply('Tap /start to set up your wallet first.');
      return;
    }
    const user = await prisma.user.findUnique({ where: { telegramId: BigInt(tgId) } });
    if (!user?.agentPolicyId) {
      await ctx.reply('No agent budget yet. Create one with /policy <budget> <hours>.');
      return;
    }
    const arg = (ctx.match ?? '').trim().toLowerCase();
    if (arg === 'off') {
      await deps.redis.del(`agent:strategy:${user.agentPolicyId}`);
      await ctx.reply('🛑 Agent paused. It will not place new trades. (Budget stays escrowed — /revoke to reclaim.)');
      return;
    }
    if (!STRATEGIES.includes(arg as StrategyName)) {
      await ctx.reply(`Pick a strategy: ${STRATEGIES.map((s) => `/auto ${s}`).join('  ')}\nor /auto off`);
      return;
    }
    await deps.redis.set(`agent:strategy:${user.agentPolicyId}`, arg);
    const policy = await deps.predict.readAgentPolicy(user.agentPolicyId).catch(() => null);
    await ctx.reply(
      [
        `🤖 Agent on — *${arg}*`,
        policy ? `Budget left: *${formatUsdc(policy.budgetRemaining)} dUSDC*` : '',
        'It trades each new BTC round within your budget. /auto off to pause, /revoke to stop & reclaim.',
      ]
        .filter(Boolean)
        .join('\n'),
      { parse_mode: 'Markdown' },
    );
  });

  bot.command('revoke', async (ctx) => {
    const tgId = ctx.from?.id;
    if (!tgId) return;
    const sess = await requireSession(tgId);
    if (!sess) {
      await ctx.reply('Tap /start to set up your wallet first.');
      return;
    }
    const user = await prisma.user.findUnique({ where: { telegramId: BigInt(tgId) } });
    if (!user?.agentPolicyId) {
      await ctx.reply('No active agent budget to revoke.');
      return;
    }
    await deps.redis.del(`agent:strategy:${user.agentPolicyId}`); // stop new trades immediately
    const kb = new InlineKeyboard().webApp(
      'Confirm revoke & reclaim funds →',
      `${deps.cfg.miniAppUrl}/miniapp/agent?action=revoke&policyId=${user.agentPolicyId}`,
    );
    await ctx.reply('Revoke the agent and return all unspent dUSDC to your wallet?', { reply_markup: kb });
  });

  // expose agent address for the Mini App create flow (config echo)
  bot.command('agentinfo', async (ctx) => {
    await ctx.reply(`Agent address: ${AGENT_ADDRESS_ENV || '(set AGENT_ADDRESS in env)'}`);
  });
}
