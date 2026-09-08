// Minimum plan tier required to run each dashboard / bot tool.
// tiers: 0 free · 1 hobby · 2 marketer · 3 navigator · 4 thinker

import type { PlanTier } from './plans';

export interface ToolGate {
  id: string;
  emoji: string;
  name: string;
  desc: string;
  min: PlanTier;
}

export const TOOLS: ToolGate[] = [
  { id: 'plan', emoji: '💳', name: 'Plan', desc: 'Switch plan / view current tier', min: 'free' },
  { id: 'persona', emoji: '🎭', name: 'Persona', desc: 'Tone, audience and style', min: 'hobby' },
  { id: 'meta', emoji: '🔍', name: 'SEO Meta', desc: 'Titles & descriptions', min: 'hobby' },
  { id: 'review', emoji: '✎', name: 'Content Review', desc: 'OSP editing-codes review', min: 'marketer' },
  { id: 'growth', emoji: '↗', name: 'Growth Prompts', desc: 'Ads, SEO, email, CRO', min: 'marketer' },
  { id: 'swipe', emoji: '▤', name: 'Swipe Files', desc: 'Hooks & headlines', min: 'marketer' },
  { id: 'valuemap', emoji: '🗺', name: 'Value Map', desc: 'OSP product positioning', min: 'navigator' },
  { id: 'workflow', emoji: '⚙', name: 'Workflow', desc: 'Automation triggers', min: 'navigator' },
  { id: 'content', emoji: '📝', name: 'Content Studio', desc: 'Posts, emails, captions', min: 'navigator' },
  { id: 'campaign', emoji: '✉', name: 'Campaigns', desc: 'Ideas + checklists', min: 'navigator' },
  { id: 'keywords', emoji: '⌗', name: 'Keywords', desc: 'Intent-based research', min: 'navigator' },
  { id: 'leadmagnet', emoji: '🧲', name: 'Lead Magnets', desc: 'Conversion ideas', min: 'navigator' },
];

export const PLAN_TOOL_MIN: Record<string, PlanTier> = Object.fromEntries(TOOLS.map((t) => [t.id, t.min]));

export function gateFor(toolId: string): ToolGate | undefined {
  return TOOLS.find((t) => t.id === toolId);
}