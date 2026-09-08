// Single source of truth for plans — shared by web dashboard, auth server and bot.

export const TIERS = ['free', 'hobby', 'marketer', 'navigator', 'thinker'] as const;
export type PlanTier = (typeof TIERS)[number];

export interface PlanMeta {
  tier: PlanTier;
  label: string;
  price: string;
  blurb: string;
  features: string[];
}

export const PLANS: PlanMeta[] = [
  { tier: 'free', label: 'Free', price: '$0/mo', blurb: 'Personal CRM', features: ['Add leads', 'Pipeline board', 'Conversation inbox preview'] },
  { tier: 'hobby', label: 'Hobby', price: '$9/mo', blurb: 'Start creating with AI', features: ['Plan', 'Persona', 'SEO Meta'] },
  { tier: 'marketer', label: 'Marketer', price: '$29/mo', blurb: 'For active marketers', features: ['Content Review', 'Growth Prompts', 'Swipe Files'] },
  { tier: 'navigator', label: 'Navigator', price: '$99/mo', blurb: 'Run your whole funnel', features: ['Value Map', 'Workflow', 'Content Studio', 'Campaigns', 'Keywords', 'Lead Magnets', 'CSV exports'] },
  { tier: 'thinker', label: 'Thinker', price: '$299/mo', blurb: 'Complete command center', features: ['Everything in Navigator', 'Unified Inbox'] },
];

export const AI_DAILY_LIMIT_FREE = 10;

export function isTier(t: string | undefined | null): t is PlanTier {
  return !!t && (TIERS as readonly string[]).includes(t.toLowerCase());
}

export function tierIndex(t: string | undefined | null): number {
  const idx = TIERS.indexOf(String(t || '').toLowerCase() as PlanTier);
  return idx < 0 ? 0 : idx;
}

export function tierAtLeast(t: string | undefined | null, min: PlanTier): boolean {
  return tierIndex(t) >= tierIndex(min);
}

// Map the legacy 3-tier monetization (free/pro/enterprise) onto the 5-tier lineup.
export function mapLegacy(legacy: string | undefined | null): PlanTier {
  switch (String(legacy || '').toLowerCase()) {
    case 'enterprise':
      return 'thinker';
    case 'pro':
    case 'pro-trial':
      return 'navigator';
    case 'hobby':
    case 'marketer':
    case 'thinker':
    case 'navigator':
      return String(legacy).toLowerCase() as PlanTier;
    default:
      return 'free';
  }
}

export function upgradeToTier(tier: string | undefined | null): PlanTier {
  return mapLegacy(tier);
}