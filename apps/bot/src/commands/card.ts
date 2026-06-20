import { createCanvas } from '@napi-rs/canvas';
import { streakBadge } from '@nanawise/shared';
import QRCode from 'qrcode';

/**
 * PnL share card (Phase 7). Renders a 1000×525 PNG: handle, total PnL, win-rate,
 * streak badge, BTC price, attribution, QR → /u/:telegramId. Returned as a Buffer
 * for ctx.replyWithPhoto.
 */
export interface CardInput {
  handle: string;
  totalPnl: number; // dUSDC
  winRate: number; // 0..1
  streak: number;
  btcPrice: number;
  profileUrl: string;
}

export async function renderPnlCard(input: CardInput): Promise<Buffer> {
  const W = 1000;
  const H = 525;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // background
  ctx.fillStyle = '#0b0e14';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#151a23';
  roundRect(ctx, 24, 24, W - 48, H - 48, 24);
  ctx.fill();

  // brand
  ctx.fillStyle = '#4c8bf5';
  ctx.font = 'bold 34px sans-serif';
  ctx.fillText('Nanawise', 56, 86);
  ctx.fillStyle = '#8b93a7';
  ctx.font = '20px sans-serif';
  ctx.fillText(`@${input.handle}`, 56, 120);

  // PnL big
  const up = input.totalPnl >= 0;
  ctx.fillStyle = up ? '#2ecc71' : '#e74c3c';
  ctx.font = 'bold 96px sans-serif';
  ctx.fillText(`${up ? '+' : ''}${input.totalPnl.toFixed(2)}`, 56, 250);
  ctx.fillStyle = '#8b93a7';
  ctx.font = '24px sans-serif';
  ctx.fillText('dUSDC total PnL', 60, 290);

  // stats row
  ctx.fillStyle = '#e6e9ef';
  ctx.font = 'bold 30px sans-serif';
  ctx.fillText(`${(input.winRate * 100).toFixed(0)}% win rate`, 56, 360);
  const badge = streakBadge(input.streak);
  ctx.fillText(`${badge} ${input.streak} streak`, 56, 405);
  ctx.fillStyle = '#8b93a7';
  ctx.font = '22px sans-serif';
  ctx.fillText(`BTC $${input.btcPrice.toLocaleString()}`, 56, 450);

  // attribution
  ctx.fillStyle = '#8b93a7';
  ctx.font = '18px sans-serif';
  ctx.fillText('traded on DeepBook Predict · Sui', 56, H - 50);

  // QR
  try {
    const qrDataUrl = await QRCode.toDataURL(input.profileUrl, { margin: 1, width: 200 });
    const { Image } = await import('@napi-rs/canvas');
    const img = new Image();
    img.src = Buffer.from(qrDataUrl.split(',')[1]!, 'base64');
    ctx.drawImage(img, W - 240, H - 240, 180, 180);
  } catch {
    /* QR optional */
  }

  return canvas.toBuffer('image/png');
}

function roundRect(
  ctx: ReturnType<ReturnType<typeof createCanvas>['getContext']>,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
