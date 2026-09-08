// ---------------------------------------------------------------------------
// Unified Inbox channel registry.
//
// Every channel the inbox can carry is declared here with the credentials it
// needs, what it is actually capable of, and where its docs live. Nothing in
// this file sends or receives a message — it answers "is this channel wired up,
// and if not, what is missing?" so the dashboard can show honest status instead
// of pretending all five demo channels are live.
//
// Adapters gain `send`/`receive` in a later pass. The contract is declared now
// so each channel plugs into the same shape.
// ---------------------------------------------------------------------------

// Storage-level ids. 'meta' is retained because existing conversations in
// db/conversations.json were seeded with it; new work should use the specific
// 'messenger' / 'instagram' ids instead.
export const CHANNEL_IDS = [
  'telegram',
  'whatsapp',
  'messenger',
  'instagram',
  'threads',
  'email',
  'tiktok',
  'meta',
] as const;

export type ChannelId = (typeof CHANNEL_IDS)[number];

export type ChannelKind = 'dm' | 'comments' | 'email';

export type ChannelSupport =
  | 'ready' // credentials present, adapter can run
  | 'needs-credentials' // buildable, waiting on env vars
  | 'unsupported'; // the platform has no public API for this

export interface ChannelCapabilities {
  /** Can the platform push messages to us (webhook or long poll)? */
  inbound: boolean;
  /** Can we send a reply back through the platform? */
  outbound: boolean;
  kind: ChannelKind;
}

export interface ChannelDefinition {
  id: ChannelId;
  label: string;
  /** Unicode only — the brand uses no icon set. */
  glyph: string;
  capabilities: ChannelCapabilities;
  /** All must be set for the channel to be considered configured. */
  requiredEnv: string[];
  optionalEnv: string[];
  docsUrl: string;
  /** Platform limitation worth surfacing in the UI, if any. */
  note?: string;
  /** True when the platform offers no public API for this channel at all. */
  unsupported?: boolean;
  /** Retained for existing data; hidden from new channel pickers. */
  deprecated?: boolean;
}

// Meta webhooks are signed with the app secret (X-Hub-Signature-256). Treat it
// as required for every Meta-family channel: an unverified webhook is the same
// class of hole as an unsigned Stripe webhook.
// WEBHOOK_VERIFY_TOKEN matches the name used in printezy247/wsapi-dashboard so
// the same credential moves across without renaming.
//
// META_APP_SECRET is required here on purpose. wsapi-dashboard's webhook checks
// only hub.verify_token on the GET handshake and processes any POST body it
// receives, so anyone who learns the URL can inject fake inbound messages and
// delivery statuses. Verifying X-Hub-Signature-256 is what closes that.
const META_SHARED = ['META_APP_SECRET', 'WEBHOOK_VERIFY_TOKEN'];

export const CHANNELS: ChannelDefinition[] = [
  {
    id: 'telegram',
    label: 'Telegram',
    glyph: '✈',
    capabilities: { inbound: true, outbound: true, kind: 'dm' },
    // This app uses Telegraf with BOT_TOKEN. The sibling bot repo
    // (printezy247/tg-ezy-chatbot) uses node-telegram-bot-api with
    // TELEGRAM_BOT_TOKEN — same credential, different variable name.
    requiredEnv: ['BOT_TOKEN'],
    optionalEnv: ['BOT_USERNAME', 'TELEGRAM_BOT_TOKEN'],
    docsUrl: 'https://core.telegram.org/bots/api',
    note: 'Outbound already works via bot.telegram.sendMessage; inbound capture into the inbox is not wired yet.',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp',
    glyph: '◆',
    capabilities: { inbound: true, outbound: true, kind: 'dm' },
    requiredEnv: ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', ...META_SHARED],
    // Names mirror printezy247/wsapi-dashboard exactly.
    optionalEnv: ['WHATSAPP_WABA_ID', 'WHATSAPP_APP_ID', 'WHATSAPP_API_VERSION', 'WHATSAPP_API_BASE'],
    docsUrl: 'https://developers.facebook.com/docs/whatsapp/cloud-api',
    note: 'Cloud API on graph.facebook.com. Replies outside the 24-hour customer service window must use an approved template.',
  },
  {
    id: 'messenger',
    label: 'Messenger',
    glyph: '●',
    capabilities: { inbound: true, outbound: true, kind: 'dm' },
    requiredEnv: ['MESSENGER_PAGE_ID', 'MESSENGER_PAGE_ACCESS_TOKEN', ...META_SHARED],
    optionalEnv: [],
    docsUrl: 'https://developers.facebook.com/docs/messenger-platform',
    note: 'Production use needs the pages_messaging permission through App Review.',
  },
  {
    id: 'instagram',
    label: 'Instagram',
    glyph: '✦',
    capabilities: { inbound: true, outbound: true, kind: 'dm' },
    requiredEnv: ['INSTAGRAM_ACCOUNT_ID', 'INSTAGRAM_ACCESS_TOKEN', ...META_SHARED],
    optionalEnv: [],
    docsUrl: 'https://developers.facebook.com/docs/messenger-platform/instagram',
    note: 'Requires an Instagram Business or Creator account linked to a Facebook Page.',
  },
  {
    id: 'threads',
    label: 'Threads',
    glyph: '✧',
    // Threads exposes posts, replies and mentions — there is no public DM API.
    capabilities: { inbound: true, outbound: true, kind: 'comments' },
    requiredEnv: ['THREADS_USER_ID', 'THREADS_ACCESS_TOKEN'],
    optionalEnv: [],
    docsUrl: 'https://developers.facebook.com/docs/threads',
    note: 'Threads has no direct-message API. This channel carries replies and mentions, not DMs.',
  },
  {
    id: 'email',
    label: 'Email',
    glyph: '✉',
    capabilities: { inbound: true, outbound: true, kind: 'email' },
    // Outbound already exists for magic-key codes; inbound needs a provider
    // webhook posting parsed mail back to us.
    requiredEnv: ['EMAIL_API_KEY', 'EMAIL_FROM', 'EMAIL_INBOUND_SECRET'],
    optionalEnv: [],
    docsUrl: 'https://resend.com/docs/dashboard/webhooks/introduction',
    note: 'Outbound is already configured for magic keys. Inbound needs a provider webhook.',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    glyph: '▲',
    capabilities: { inbound: false, outbound: false, kind: 'comments' },
    requiredEnv: [],
    optionalEnv: [],
    unsupported: true,
    docsUrl: 'https://developers.tiktok.com/doc/overview',
    note: 'TikTok publishes no direct-message API. Comment access needs approved scopes and cannot back a DM inbox.',
  },
  {
    id: 'meta',
    label: 'Meta (legacy)',
    glyph: '◇',
    capabilities: { inbound: false, outbound: false, kind: 'dm' },
    requiredEnv: [],
    optionalEnv: [],
    deprecated: true,
    docsUrl: 'https://developers.facebook.com/docs',
    note: 'Kept so seeded conversations keep resolving. Use messenger or instagram instead.',
  },
];

const BY_ID = new Map<ChannelId, ChannelDefinition>(CHANNELS.map((c) => [c.id, c]));

export function getChannel(id: string): ChannelDefinition | undefined {
  return BY_ID.get(id as ChannelId);
}

export function isChannelId(id: string): id is ChannelId {
  return BY_ID.has(id as ChannelId);
}

/** Env vars a channel still needs before it can run. */
export function missingEnv(def: ChannelDefinition, env: NodeJS.ProcessEnv = process.env): string[] {
  return def.requiredEnv.filter((k) => !String(env[k] ?? '').trim());
}

export function isConfigured(def: ChannelDefinition, env: NodeJS.ProcessEnv = process.env): boolean {
  // A channel with no required env is not "configured by default" — an
  // unsupported or deprecated channel can never be ready.
  if (def.unsupported || def.deprecated) return false;
  if (def.requiredEnv.length === 0) return false;
  return missingEnv(def, env).length === 0;
}

export function supportOf(def: ChannelDefinition, env: NodeJS.ProcessEnv = process.env): ChannelSupport {
  if (def.unsupported) return 'unsupported';
  if (isConfigured(def, env)) return 'ready';
  return 'needs-credentials';
}

export interface ChannelStatus {
  id: ChannelId;
  label: string;
  glyph: string;
  support: ChannelSupport;
  capabilities: ChannelCapabilities;
  missingEnv: string[];
  docsUrl: string;
  note?: string;
  deprecated?: boolean;
}

export function channelStatus(env: NodeJS.ProcessEnv = process.env): ChannelStatus[] {
  return CHANNELS.filter((c) => !c.deprecated).map((c) => ({
    id: c.id,
    label: c.label,
    glyph: c.glyph,
    support: supportOf(c, env),
    capabilities: c.capabilities,
    // Never leak values — only the names of what is absent.
    missingEnv: c.unsupported ? [] : missingEnv(c, env),
    docsUrl: c.docsUrl,
    note: c.note,
    deprecated: c.deprecated,
  }));
}

export function channelSummary(env: NodeJS.ProcessEnv = process.env): {
  ready: number;
  needsCredentials: number;
  unsupported: number;
} {
  const all = channelStatus(env);
  return {
    ready: all.filter((c) => c.support === 'ready').length,
    needsCredentials: all.filter((c) => c.support === 'needs-credentials').length,
    unsupported: all.filter((c) => c.support === 'unsupported').length,
  };
}
