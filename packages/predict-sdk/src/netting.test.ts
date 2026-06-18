import { describe, expect, it } from 'vitest';
import { PredictClient } from './client.js';
import type { MintRecord, RedeemRecord } from './types.js';

/**
 * Unit test for unredeemedBinaries netting (the keeper's redeem-selection logic).
 * We stub the two server reads so the test is deterministic and offline.
 */
const cfg = {
  rpcUrl: 'http://x',
  serverUrl: 'http://x',
  predictPackageId: '0xpkg',
  predictObjectId: '0xobj',
  predictRegistryId: '0xreg',
  dusdcType: '0xd::dusdc::DUSDC',
  plpType: '0xp::plp::PLP',
  clockId: '0x6',
};

function mint(p: Partial<MintRecord>): MintRecord {
  return {
    managerId: '0xm1',
    trader: '0xowner1',
    oracleId: '0xorc',
    expiry: 100n,
    strike: 60_000_000_000_000n,
    isUp: true,
    quantity: 1_000_000n,
    cost: 0n,
    askPrice: 0n,
    digest: 'd',
    checkpointMs: 0,
    raw: {},
    ...p,
  };
}
function redeem(p: Partial<RedeemRecord>): RedeemRecord {
  return {
    managerId: '0xm1',
    owner: '0xowner1',
    executor: '0xk',
    oracleId: '0xorc',
    expiry: 100n,
    strike: 60_000_000_000_000n,
    isUp: true,
    quantity: 1_000_000n,
    payout: 0n,
    bidPrice: 0n,
    isSettled: true,
    digest: 'd',
    raw: {},
    ...p,
  };
}

function clientWith(minted: MintRecord[], redeemed: RedeemRecord[]): PredictClient {
  const c = new PredictClient({} as never, cfg);
  c.getPositionsMinted = async () => minted;
  c.getPositionsRedeemed = async () => redeemed;
  return c;
}

describe('unredeemedBinaries netting', () => {
  it('returns nothing when every mint was redeemed', async () => {
    const c = clientWith([mint({})], [redeem({})]);
    expect(await c.unredeemedBinaries('0xorc')).toEqual([]);
  });

  it('returns the remaining quantity after partial redemption', async () => {
    const c = clientWith([mint({ quantity: 3_000_000n })], [redeem({ quantity: 1_000_000n })]);
    const out = await c.unredeemedBinaries('0xorc');
    expect(out).toHaveLength(1);
    expect(out[0]!.quantity).toBe(2_000_000n);
  });

  it('nets by (manager, strike, direction) independently', async () => {
    const c = clientWith(
      [
        mint({ managerId: '0xA', isUp: true, quantity: 1_000_000n }),
        mint({ managerId: '0xA', isUp: false, quantity: 2_000_000n }),
        mint({ managerId: '0xB', isUp: true, quantity: 5_000_000n }),
      ],
      [redeem({ managerId: '0xA', isUp: true, quantity: 1_000_000n })], // closes A/up only
    );
    const out = await c.unredeemedBinaries('0xorc');
    const keys = out.map((p) => `${p.managerId}/${p.isUp}/${p.quantity}`).sort();
    expect(keys).toEqual(['0xA/false/2000000', '0xB/true/5000000']);
  });

  it('aggregates multiple mints of the same key', async () => {
    const c = clientWith(
      [mint({ quantity: 1_000_000n }), mint({ quantity: 500_000n })],
      [],
    );
    const out = await c.unredeemedBinaries('0xorc');
    expect(out[0]!.quantity).toBe(1_500_000n);
  });
});
