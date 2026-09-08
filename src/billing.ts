import type { Account } from './accountStore';
import { isTier, PlanTier } from './plans';

// ---------- Billing abstraction (Stripe + USDT placeholders) ----------
// Nothing ships money today: with STRIPE_SECRET_KEY unset the API reports
// status 'pending-config' and the dashboard shows a "coming soon" toast.

export type CheckoutResult =
  | { status: 'pending-config' }
  | { status: 'usdt-manual'; usdtAddress: string }
  | { status: 'ok'; url: string };

export async function createCheckout(account: Account, tier: string, provider: string): Promise<CheckoutResult> {
  const normalized = isTier(tier) ? (tier as PlanTier) : 'free';

  if (provider === 'usdt') {
    const address = process.env.USDT_ADDRESS;
    if (address) return { status: 'usdt-manual', usdtAddress: address };
    return { status: 'pending-config' };
  }

  // Stripe placeholder — the SDK is intentionally not installed yet.
  if (!process.env.STRIPE_SECRET_KEY) return { status: 'pending-config' };
  return { status: 'pending-config' }; // wire real checkout.create() here later
}

export function entitle(_account: Account, tier: string): string {
  return isTier(tier) ? tier : 'free';
}