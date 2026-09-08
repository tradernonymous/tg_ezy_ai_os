// ---------- Single source of truth for ALL keyboards & labels ----------
// Every label below MUST have a matching handler in bot.ts (enforced at boot).

export interface LocalizedLabel {
  es?: string;
  fr?: string;
  de?: string;
  zh?: string;
}

export const LABELS: Record<string, LocalizedLabel> = {
  // --- Main menu ---
  '📊 Stats & Leads': { es: '📊 Estadísticas y Leads', fr: '📊 Stats et Leads', de: '📊 Statistiken & Leads', zh: '📊 数据与线索' },
  '➕ Add Lead': { es: '➕ Añadir Lead', fr: '➕ Ajouter un Lead', de: '➕ Lead hinzufügen', zh: '➕ 添加线索' },
  '💼 Marketing': { es: '💼 Marketing', fr: '💼 Marketing', de: '💼 Marketing', zh: '💼 营销' },
  '⚙️ Tools & Auto': { es: '⚙️ Herramientas y Auto', fr: '⚙️ Outils et Auto', de: '⚙️ Tools & Auto', zh: '⚙️ 工具与自动化' },
  '🌐 Language': { es: '🌐 Idioma', fr: '🌐 Langue', de: '🌐 Sprache', zh: '🌐 语言' },
  '⚙️ Settings': { es: '⚙️ Ajustes', fr: '⚙️ Paramètres', de: '⚙️ Einstellungen', zh: '⚙️ 设置' },

  // --- Navigation ---
  '⬅️ Back': { es: '⬅️ Atrás', fr: '⬅️ Retour', de: '⬅️ Zurück', zh: '⬅️ 返回' },
  '🏠 Main Menu': { es: '🏠 Menú Principal', fr: '🏠 Menu Principal', de: '🏠 Hauptmenü', zh: '🏠 主菜单' },

  // --- Stats & Leads submenu ---
  '📊 Stats': { es: '📊 Estadísticas', fr: '📊 Statistiques', de: '📊 Statistiken', zh: '📊 统计' },
  '📂 Leads List': { es: '📂 Lista de Leads', fr: '📂 Liste des Leads', de: '📂 Lead-Liste', zh: '📂 线索列表' },
  '📈 Pipeline': { es: '📈 Embudo', fr: '📈 Pipeline', de: '📈 Pipeline', zh: '📈 销售漏斗' },

  // --- Tools & Auto submenu ---
  '⏰ Remind': { es: '⏰ Recordar', fr: '⏰ Rappel', de: '⏰ Erinnern', zh: '⏰ 提醒' },
  '🚩 Handoff': { es: '🚩 Traspaso', fr: '🚩 Transfert', de: '🚩 Übergabe', zh: '🚩 转交' },
  '⚡ Automation Rules': { es: '⚡ Reglas de Auto', fr: '⚡ Règles Auto', de: '⚡ Automations-Regeln', zh: '⚡ 自动化规则' },
  '📣 Broadcast': { es: '📣 Transmisión', fr: '📣 Diffusion', de: '📣 Rundsendung', zh: '📣 群发' },
  '📦 Export CSV': { es: '📦 Exportar CSV', fr: '📦 Exporter CSV', de: '📦 CSV-Export', zh: '📦 导出 CSV' },
  '📬 Inbox': { es: '📬 Bandeja', fr: '📬 Boîte de réception', de: '📬 Posteingang', zh: '📬 收件箱' },

  // --- Settings submenu ---
  '👤 Profile': { es: '👤 Perfil', fr: '👤 Profil', de: '👤 Profil', zh: '👤 资料' },
  '🔔 Notifications': { es: '🔔 Notificaciones', fr: '🔔 Notifications', de: '🔔 Benachrichtigungen', zh: '🔔 通知' },
  '🏢 Business': { es: '🏢 Negocio', fr: '🏢 Entreprise', de: '🏢 Unternehmen', zh: '🏢 企业' },
  '🗑️ Danger Zone': { es: '🗑️ Zona de Riesgo', fr: '🗑️ Zone de Danger', de: '🗑️ Gefahrenzone', zh: '🗑️ 危险区' },

  // --- Plan submenu ---
  '📊 Current Plan': { es: '📊 Plan Actual', fr: '📊 Plan Actuel', de: '📊 Aktueller Plan', zh: '📊 当前套餐' },
  '💳 Set Free': { es: '💳 Free', fr: '💳 Free', de: '💳 Free', zh: '💳 Free' },
  '💳 Set Pro': { es: '💳 PRO', fr: '💳 PRO', de: '💳 PRO', zh: '💳 PRO' },
  '💳 Set Enterprise': { es: '💳 Enterprise', fr: '💳 Enterprise', de: '💳 Enterprise', zh: '💳 Enterprise' },
};

export type SupportedLang = 'en' | 'es' | 'fr' | 'de' | 'zh';

export function normalizeLang(lang?: string): SupportedLang {
  return (['es', 'fr', 'de', 'zh'] as string[]).includes(lang || '') ? (lang as SupportedLang) : 'en';
}

export function localize(lang?: string): (label: string) => string {
  const code = normalizeLang(lang);
  return (label: string) => {
    if (code === 'en') return label;
    return LABELS[label]?.[code] || label;
  };
}

export function labelVariants(label: string): string[] {
  const v = LABELS[label];
  const variants = v ? Object.values(v).filter((x): x is string => !!x) : [];
  return [label, ...variants];
}

export interface KeyboardReply {
  keyboard: { text: string }[][];
  resize_keyboard: boolean;
  is_persistent?: boolean;
}

export type MenuBuilder = (l: (s: string) => string) => KeyboardReply;

export const MENUS: Record<string, MenuBuilder> = {
  main: (l) => ({
    keyboard: [
      [{ text: l('📊 Stats & Leads') }, { text: l('➕ Add Lead') }],
      [{ text: l('💼 Marketing') }, { text: l('⚙️ Tools & Auto') }],
      [{ text: l('🌐 Language') }, { text: l('⚙️ Settings') }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  }),

  statsLeads: (l) => ({
    keyboard: [
      [{ text: l('📊 Stats') }, { text: l('📂 Leads List') }],
      [{ text: l('📈 Pipeline') }, { text: l('⬅️ Back') }],
    ],
    resize_keyboard: true,
  }),

  marketing: () => ({
    keyboard: [
      [{ text: '💳 Plan' }, { text: '🎭 Persona' }],
      [{ text: '🔍 Meta' }, { text: '🗺️ Value' }],
      [{ text: '✏️ Review' }, { text: '📈 Growth' }],
      [{ text: '📂 Swipe' }, { text: '⚙️ Workflow' }],
      [{ text: '📝 Content' }, { text: '✉️ Campaign' }],
      [{ text: '🔑 Keywords' }, { text: '🧲 Lead Magnet' }],
      [{ text: '⬅️ Back' }],
    ],
    resize_keyboard: true,
  }),

  toolsAuto: (l) => ({
    keyboard: [
      [{ text: l('⏰ Remind') }, { text: l('🚩 Handoff') }],
      [{ text: l('⚡ Automation Rules') }, { text: l('📬 Inbox') }],
      [{ text: l('📣 Broadcast') }, { text: l('📦 Export CSV') }],
      [{ text: l('⚙️ Settings') }, { text: l('⬅️ Back') }],
    ],
    resize_keyboard: true,
  }),

  settings: (l) => ({
    keyboard: [
      [{ text: l('👤 Profile') }, { text: '💳 Plan' }],
      [{ text: l('🔔 Notifications') }, { text: l('🏢 Business') }],
      [{ text: l('🌐 Language') }, { text: l('🗑️ Danger Zone') }],
      [{ text: l('⬅️ Back') }],
    ],
    resize_keyboard: true,
  }),

  plan: (l) => ({
    keyboard: [
      [{ text: l('📊 Current Plan') }, { text: l('💳 Set Free') }],
      [{ text: l('💳 Set Pro') }, { text: l('💳 Set Enterprise') }],
      [{ text: l('🏠 Main Menu') }, { text: l('⬅️ Back') }],
    ],
    resize_keyboard: true,
  }),

  persona: (l) => ({
    keyboard: [
      [{ text: '🎭 Tone' }, { text: '🎭 Audience' }],
      [{ text: '🎭 Style' }, { text: l('🏠 Main Menu') }],
      [{ text: l('⬅️ Back') }],
    ],
    resize_keyboard: true,
  }),

  metaSub: (l) => ({
    keyboard: [
      [{ text: '🔍 Generate Meta' }, { text: l('🏠 Main Menu') }],
      [{ text: l('⬅️ Back') }],
    ],
    resize_keyboard: true,
  }),

  valueSub: (l) => ({
    keyboard: [
      [{ text: '🗺️ Generate Map' }, { text: l('🏠 Main Menu') }],
      [{ text: l('⬅️ Back') }],
    ],
    resize_keyboard: true,
  }),

  reviewSub: (l) => ({
    keyboard: [
      [{ text: '✏️ Review Content' }, { text: l('🏠 Main Menu') }],
      [{ text: l('⬅️ Back') }],
    ],
    resize_keyboard: true,
  }),

  growthSub: (l) => ({
    keyboard: [
      [{ text: '📈 Show Prompts' }, { text: l('🏠 Main Menu') }],
      [{ text: l('⬅️ Back') }],
    ],
    resize_keyboard: true,
  }),

  swipeSub: (l) => ({
    keyboard: [
      [{ text: '📂 Show Swipe' }, { text: l('🏠 Main Menu') }],
      [{ text: l('⬅️ Back') }],
    ],
    resize_keyboard: true,
  }),

  workflowSub: (l) => ({
    keyboard: [
      [{ text: '⚙️ Show Workflow' }, { text: l('🏠 Main Menu') }],
      [{ text: l('⬅️ Back') }],
    ],
    resize_keyboard: true,
  }),

  contentSub: (l) => ({
    keyboard: [
      [{ text: '📝 Post' }, { text: '📧 Email' }],
      [{ text: '✍️ Hook' }, { text: '🏷️ Caption' }],
      [{ text: l('🏠 Main Menu') }, { text: l('⬅️ Back') }],
    ],
    resize_keyboard: true,
  }),

  campaignSub: (l) => ({
    keyboard: [
      [{ text: '💡 Ideas' }, { text: '📰 Launch' }],
      [{ text: l('🏠 Main Menu') }, { text: l('⬅️ Back') }],
    ],
    resize_keyboard: true,
  }),

  keywordsSub: (l) => ({
    keyboard: [
      [{ text: '🔑 Research' }, { text: l('🏠 Main Menu') }],
      [{ text: l('⬅️ Back') }],
    ],
    resize_keyboard: true,
  }),

  leadMagnetSub: (l) => ({
    keyboard: [
      [{ text: '🧲 Generate' }, { text: l('🏠 Main Menu') }],
      [{ text: l('⬅️ Back') }],
    ],
    resize_keyboard: true,
  }),

  langSub: (l) => ({
    keyboard: [
      [{ text: '🇬🇧 EN' }, { text: '🇪🇸 ES' }],
      [{ text: '🇫🇷 FR' }, { text: '🇩🇪 DE' }],
      [{ text: '🇨🇳 ZH' }, { text: l('⬅️ Back') }],
    ],
    resize_keyboard: true,
  }),
};

export const MENU_PARENT: Record<string, string> = {
  statsLeads: 'main',
  marketing: 'main',
  toolsAuto: 'main',
  settings: 'main',
  langSub: 'main',
  plan: 'marketing',
  persona: 'marketing',
  metaSub: 'marketing',
  valueSub: 'marketing',
  reviewSub: 'marketing',
  growthSub: 'marketing',
  swipeSub: 'marketing',
  workflowSub: 'marketing',
  contentSub: 'marketing',
  campaignSub: 'marketing',
  keywordsSub: 'marketing',
  leadMagnetSub: 'marketing',
};

export const MENUS_IDS: string[] = Object.keys(MENUS);

// Every keyboard label in the system (English originals). bot.ts asserts each
// has a registered handler, so a dead button is impossible to ship.
export const ALL_LABELS: string[] = (() => {
  const set = new Set<string>();
  for (const builder of Object.values(MENUS)) {
    for (const row of builder((s) => s).keyboard) {
      for (const btn of row) set.add(btn.text);
    }
  }
  return Array.from(set);
})();