/**
 * SAMPLE DATA for local development, taken from the Figma prototype (12 Oct 2026).
 * Every record here is sample data. It is never loaded in production.
 * People, organisations and numbers are illustrative only.
 */
import type {
  BriefClaim,
  ChecklistItem,
  ClaimFlag,
  ClaudeSuggestions,
  ContentMode,
  IntegrationStatus,
  KitBehaviour,
  KitNotBuilt,
  Language,
  LeadSource,
  LeadStage,
  Platform,
  ProductRole,
  ProductStatus,
  Ratio,
  Role,
} from '@growth-desk/contract';

export const SAMPLE_EMAIL_DOMAIN = 'example.com';

/* ---------- People ---------- */

export interface SeedUser {
  key: string;
  name: string;
  initials: string;
  title: string;
  role: Role;
  isBrandApprover: boolean;
}

export const USERS: SeedUser[] = [
  {
    key: 'jeeva',
    name: 'Jeeva Santiago',
    initials: 'JS',
    title: 'Marketing · Design',
    role: 'editor',
    isBrandApprover: false,
  },
  {
    key: 'elan',
    name: 'Elan',
    initials: 'E',
    title: 'Founder · brand',
    role: 'admin',
    isBrandApprover: true,
  },
  {
    key: 'tamil',
    name: 'Tamil',
    initials: 'T',
    title: 'AI video · shoots',
    role: 'member',
    isBrandApprover: false,
  },
  {
    key: 'sundaran',
    name: 'Sundaran',
    initials: 'S',
    title: 'Motion · automation admin',
    role: 'admin',
    isBrandApprover: false,
  },
  {
    key: 'tester',
    name: 'Kavya Raman',
    initials: 'KR',
    title: 'Tester · review checklist',
    role: 'member',
    isBrandApprover: false,
  },
  {
    key: 'developer',
    name: 'Arjun Kumar',
    initials: 'AK',
    title: 'Developer · integrations',
    role: 'member',
    isBrandApprover: false,
  },
  {
    key: 'liveowner',
    name: 'Meera Iyer',
    initials: 'MI',
    title: 'Product owner · Humini Live',
    role: 'member',
    isBrandApprover: false,
  },
];

export const emailFor = (key: string) => `${key}@${SAMPLE_EMAIL_DOMAIN}`;

/* ---------- Products and kits ---------- */

export interface SeedProduct {
  key: string;
  slug: string;
  name: string;
  shortName: string;
  status: ProductStatus;
  statusNote: string | null;
  color: string;
  repoUrl: string | null;
  siteUrl: string | null;
  ownerKey: string | null;
  kit: {
    promise: string | null;
    behaviours: KitBehaviour[];
    neverSay: string[];
    notBuilt: KitNotBuilt[];
    audiences: string[];
    activationEvent: string | null;
    truthSources: string[];
    score: number;
    signedByKey: string | null;
    /** `YYYY-MM-DD`, signed at 10:00 IST. */
    signedOn: string | null;
  };
  members: { userKey: string; role: ProductRole }[];
}

export const PRODUCTS: SeedProduct[] = [
  {
    key: 'live',
    slug: 'humini-live',
    name: 'Humini Live',
    shortName: 'Live',
    status: 'in_build',
    statusNote: 'v2',
    color: '#ff9a00',
    repoUrl: 'https://github.com/humini-ecosystem/humini-live-app',
    siteUrl: 'https://live.humini.app',
    ownerKey: 'elan',
    kit: {
      promise: 'Be there for your people, in Joy and Care.',
      behaviours: [
        { text: 'A heart: the owner sees how many, never who', specRef: '006' },
        { text: 'A byte: up to 60 seconds, video or voice, replayable', specRef: '006' },
        { text: 'A call rings only when availability is on; audio first', specRef: '007' },
      ],
      neverSay: [
        'anonymous',
        'strangers',
        '60-second call',
        'vanishes',
        'one view',
        'surprise moments',
        '100% private',
        'call Amma',
      ],
      notBuilt: [
        { text: 'Surprise moments (later)', specRef: '013' },
        { text: 'A moment made for someone else, in reels (not shippable yet)', specRef: '013-02' },
      ],
      audiences: ['Circle admin', 'Family abroad', 'College batch', 'Team lead', 'Elders'],
      activationEvent: 'A circle’s first moment gets a response',
      truthSources: [
        'github · humini-live-app/docs/specs',
        'live.humini.app',
        'Figma · Design 01 masters',
        'Play Store · App Store listings',
      ],
      score: 10,
      signedByKey: 'elan',
      signedOn: '2026-10-08',
    },
    members: [
      { userKey: 'elan', role: 'owner' },
      { userKey: 'liveowner', role: 'owner' },
      { userKey: 'jeeva', role: 'maker' },
      { userKey: 'tamil', role: 'maker' },
      { userKey: 'sundaran', role: 'maker' },
      { userKey: 'tester', role: 'reviewer' },
      { userKey: 'developer', role: 'reviewer' },
    ],
  },
  {
    key: 'pulse',
    slug: 'humini-pulse',
    name: 'Humini Pulse',
    shortName: 'Pulse',
    status: 'live',
    statusNote: 'pulse.humini.app',
    color: '#427bbf',
    repoUrl: 'https://github.com/humini-ecosystem/humini-pulse',
    siteUrl: 'https://pulse.humini.app',
    ownerKey: null,
    kit: {
      promise: 'One question. Honest answers. Real signal.',
      behaviours: [{ text: 'One question at a time, answered in seconds', specRef: null }],
      neverSay: ['anonymous survey', 'spy'],
      notBuilt: [],
      audiences: ['Team lead', 'HR team'],
      activationEvent: null,
      truthSources: ['pulse.humini.app'],
      score: 6,
      signedByKey: null,
      signedOn: null,
    },
    members: [{ userKey: 'jeeva', role: 'maker' }],
  },
  {
    key: 'proof',
    slug: 'humini-proof',
    name: 'Humini Proof',
    shortName: 'Proof',
    status: 'draft',
    statusNote: null,
    color: '#3e7568',
    repoUrl: null,
    siteUrl: null,
    ownerKey: null,
    kit: {
      promise: null,
      behaviours: [],
      neverSay: [],
      notBuilt: [],
      audiences: [],
      activationEvent: null,
      truthSources: [],
      score: 2,
      signedByKey: null,
      signedOn: null,
    },
    members: [{ userKey: 'jeeva', role: 'maker' }],
  },
];

/* ---------- Occasions ---------- */

export const OCCASIONS = [
  {
    key: 'deepavali',
    name: 'Deepavali',
    date: '2026-11-08',
    endDate: '2026-11-11',
    notes: 'Deepavali week',
    products: ['live'],
  },
  {
    key: 'childrens-day',
    name: 'Children’s Day',
    date: '2026-11-14',
    endDate: null,
    notes: null,
    products: ['live', 'pulse'],
  },
  {
    key: 'exam-season',
    name: 'Exam season starts',
    date: '2026-11-23',
    endDate: null,
    notes: null,
    products: ['live'],
  },
];

/* ---------- Ideas (Ideas board) ---------- */

export interface SeedIdea {
  key: string;
  productKey: string;
  title: string;
  mode: ContentMode;
  fitScore: number | null;
  status: 'new' | 'starred' | 'briefed' | 'parked';
  source: 'claude' | 'human';
  note: string | null;
  channels: Platform[];
  /** "audience / behaviour / twist" (content memory angle tag). */
  angle: string | null;
}

export const IDEAS: SeedIdea[] = [
  {
    key: 'group-chat',
    productKey: 'live',
    title: 'Elan reads your group chat',
    mode: 'M1',
    fitScore: 86,
    status: 'new',
    source: 'claude',
    note: null,
    channels: ['instagram', 'youtube'],
    angle: 'young adults away from home / family group chat / founder reacts',
  },
  {
    key: 'rating-family',
    productKey: 'live',
    title: 'Rating the family group',
    mode: 'M5',
    fitScore: 78,
    status: 'new',
    source: 'claude',
    note: null,
    channels: ['instagram', 'youtube'],
    angle: 'young adults away from home / family group chat / ratings game',
  },
  {
    key: 'whole-office',
    productKey: 'pulse',
    title: 'One question, whole office',
    mode: 'M5',
    fitScore: 74,
    status: 'new',
    source: 'claude',
    note: null,
    channels: ['linkedin', 'instagram'],
    angle: 'team leads / one question a day / whole office answers',
  },
  {
    key: 'their-clock',
    productKey: 'live',
    title: 'Their clock, not yours',
    mode: 'M3',
    fitScore: 91,
    status: 'starred',
    source: 'claude',
    note: null,
    channels: ['instagram', 'youtube'],
    angle: 'parents abroad / call at their time / time zone swap',
  },
  {
    key: 'first-day',
    productKey: 'live',
    title: 'First day at the new job',
    mode: 'M2',
    fitScore: 88,
    status: 'starred',
    source: 'claude',
    note: null,
    channels: ['instagram', 'facebook'],
    angle: 'young adults away from home / share a big day / first day nerves',
  },
  {
    key: '60s-elan-1',
    productKey: 'live',
    title: '60 seconds with Elan, ep. 1',
    mode: 'M1',
    fitScore: 90,
    status: 'briefed',
    source: 'claude',
    note: null,
    channels: ['instagram', 'youtube', 'linkedin'],
    angle: 'early users / why we build / founder in 60 seconds',
  },
  {
    key: 'influencer',
    productKey: 'live',
    title: 'The influencer who could not',
    mode: 'M5',
    fitScore: 69,
    status: 'parked',
    source: 'claude',
    note: 'Needs a new cast',
    channels: ['instagram'],
    angle: 'young adults away from home / honest sharing / influencer parody',
  },
];

/* ---------- November plan (Humini Live, draft) ---------- */

export const PLAN_MONTH = '2026-11';

export const PLAN_ITEMS: {
  date: string;
  title: string;
  mode: ContentMode | null;
  channel: Platform | null;
  occasionKey?: string;
  briefKey?: string;
  needsShootSlot?: boolean;
}[] = [
  { date: '2026-11-02', title: 'Why I build', mode: 'M1', channel: 'instagram' },
  { date: '2026-11-03', title: 'Q#14 poll', mode: 'M4', channel: 'instagram' },
  { date: '2026-11-04', title: 'Two hearts', mode: 'M3', channel: 'youtube' },
  {
    date: '2026-11-06',
    title: '60s with Elan',
    mode: 'M1',
    channel: 'instagram',
    briefKey: 'reel-031',
  },
  {
    date: '2026-11-08',
    title: 'Deepavali circle',
    mode: null,
    channel: 'whatsapp',
    occasionKey: 'deepavali',
  },
  { date: '2026-11-09', title: 'Grandma’s blessing', mode: 'M2', channel: 'facebook' },
  { date: '2026-11-11', title: 'Meet the builder', mode: 'M6', channel: 'linkedin' },
  { date: '2026-11-13', title: 'Ask Elan', mode: 'M1', channel: 'instagram', needsShootSlot: true },
  { date: '2026-11-16', title: 'Rating chats', mode: 'M5', channel: 'instagram' },
  { date: '2026-11-18', title: 'Their clock', mode: 'M3', channel: 'youtube' },
  { date: '2026-11-20', title: 'Decisions', mode: 'M1', channel: 'linkedin', needsShootSlot: true },
  { date: '2026-11-23', title: 'Self-funded', mode: 'M7', channel: 'linkedin' },
  { date: '2026-11-25', title: 'O8 poster', mode: 'M4', channel: 'whatsapp' },
  { date: '2026-11-27', title: '60s with Elan', mode: 'M1', channel: 'instagram' },
];

/* ---------- Briefs ---------- */

export interface SeedBrief {
  key: string;
  code: string;
  kind: 'reel' | 'poster' | 'short' | 'carousel' | 'post';
  productKey: string;
  ideaKey: string | null;
  title: string;
  mode: ContentMode;
  stage: 'brief' | 'frozen' | 'made' | 'reviewed' | 'approved' | 'scheduled' | 'live';
  hook: string | null;
  beats: string[];
  ask: string | null;
  ratios: Ratio[];
  captionLanguages: Language[];
  channels: Platform[];
  ownerKey: string;
  claimsApproverKey: string | null;
  brandApproverKey: string | null;
  claimFlags: ClaimFlag[];
  claims: BriefClaim[];
  claudeSuggestions: ClaudeSuggestions;
  /** Days before seed time the brief was frozen (null = not frozen). */
  frozenDaysAgo: number | null;
}

const emptySuggestions: ClaudeSuggestions = {
  captions: [],
  altHooks: [],
  bRoll: [],
  generatedAt: null,
};

const passFlags: ClaimFlag[] = [
  { rule: 'never_say', status: 'pass', message: 'No never-say words', suggestion: null },
  { rule: 'spec_cited', status: 'pass', message: 'Every behaviour cites a spec', suggestion: null },
  { rule: 'brand_line', status: 'pass', message: 'Ends on the brand line', suggestion: null },
];

export const BRIEFS: SeedBrief[] = [
  {
    key: 'reel-031',
    code: 'REEL-031',
    kind: 'reel',
    productKey: 'live',
    ideaKey: '60s-elan-1',
    title: '60 seconds with Elan, ep. 1',
    mode: 'M1',
    stage: 'reviewed',
    hook: '“You are not a bad friend. You are doing arithmetic.”',
    beats: [
      'A catch-up call runs 30 minutes, and it is unscheduled.',
      'Across a timezone, that window has to exist twice.',
      'Sixty seconds needs no window. That is the whole idea.',
    ],
    ask: 'Send one byte to someone you have been meaning to call.',
    ratios: ['9:16', '4:5'],
    captionLanguages: ['en', 'ta'],
    channels: ['instagram', 'youtube', 'linkedin'],
    ownerKey: 'jeeva',
    claimsApproverKey: 'liveowner',
    brandApproverKey: 'elan',
    claimFlags: [
      {
        rule: 'never_say',
        status: 'pass',
        message: 'No never-say words',
        suggestion: '“60-second byte”, not “60-second call”',
      },
      {
        rule: 'spec_cited',
        status: 'pass',
        message: 'Every behaviour cites a spec',
        suggestion: null,
      },
      {
        rule: 'other',
        status: 'warn',
        message: '“Call your mum”: calls cannot be aimed at a person (spec 007).',
        suggestion: 'someone from your circles',
      },
      { rule: 'brand_line', status: 'pass', message: 'Ends on the brand line', suggestion: null },
    ],
    claims: [
      { text: 'A byte is 60 seconds of you', source: 'spec 006', check: 'matches' },
      { text: 'It waits for them, in their own time', source: 'spec 006', check: 'matches' },
      { text: 'Nobody has to say “I should go”', source: 'spec 006', check: 'matches' },
      { text: 'Send one byte to someone you miss', source: 'kit · ask', check: 'matches' },
    ],
    claudeSuggestions: {
      captions: [
        {
          language: 'en',
          text: 'You are not a bad friend. You are doing arithmetic. Send one byte today.',
        },
        { language: 'ta', text: 'நீங்கள் மோசமான நண்பர் அல்ல. இன்று ஒரு பைட் அனுப்புங்கள்.' },
      ],
      altHooks: [
        'Thirty minutes is a lot to ask. Sixty seconds is not.',
        'Your friend is asleep. Your byte will wait.',
        'Stop waiting for the perfect time to call.',
      ],
      bRoll: ['phone clock', 'two timezones', 'voice note waveform'],
      generatedAt: null,
    },
    frozenDaysAgo: 5,
  },
  {
    key: 'reel-029',
    code: 'REEL-029',
    kind: 'reel',
    productKey: 'live',
    ideaKey: null,
    title: 'Their clock, not yours',
    mode: 'M3',
    stage: 'scheduled',
    hook: 'It is 2 am for them. Your byte can wait.',
    beats: [
      'Two cities, two clocks.',
      'A byte waits until they wake.',
      'They answer in their own time.',
    ],
    ask: 'Send a byte that waits for their morning.',
    ratios: ['9:16'],
    captionLanguages: ['en', 'ta'],
    channels: ['instagram', 'youtube', 'facebook', 'whatsapp'],
    ownerKey: 'jeeva',
    claimsApproverKey: 'liveowner',
    brandApproverKey: 'elan',
    claimFlags: passFlags,
    claims: [
      { text: 'It waits for them, in their own time', source: 'spec 006', check: 'matches' },
    ],
    claudeSuggestions: emptySuggestions,
    frozenDaysAgo: 9,
  },
  {
    key: 'poster-008',
    code: 'POSTER-008',
    kind: 'poster',
    productKey: 'live',
    ideaKey: null,
    title: 'Festival circle poster',
    mode: 'M4',
    stage: 'reviewed',
    hook: 'One circle for the whole family this Deepavali.',
    beats: ['Start a festival circle.', 'Everyone shares a moment.'],
    ask: 'Start your festival circle.',
    ratios: ['4:5', '9:16'],
    captionLanguages: ['en', 'ta'],
    channels: ['instagram', 'whatsapp'],
    ownerKey: 'jeeva',
    claimsApproverKey: 'liveowner',
    brandApproverKey: 'elan',
    claimFlags: passFlags,
    claims: [
      { text: 'Everyone in the circle can share a moment', source: 'spec 006', check: 'matches' },
    ],
    claudeSuggestions: emptySuggestions,
    frozenDaysAgo: 3,
  },
  {
    key: 'pulse-007',
    code: 'PULSE-007',
    kind: 'reel',
    productKey: 'pulse',
    ideaKey: 'whole-office',
    title: 'One question, whole office',
    mode: 'M5',
    stage: 'reviewed',
    hook: 'One question. Forty people. Ten seconds each.',
    beats: ['Ask one thing.', 'Everyone answers honestly.', 'See the signal.'],
    ask: 'Ask your team one question today.',
    ratios: ['9:16'],
    captionLanguages: ['en'],
    channels: ['linkedin', 'instagram'],
    ownerKey: 'jeeva',
    claimsApproverKey: null,
    brandApproverKey: 'elan',
    claimFlags: passFlags,
    claims: [{ text: 'One question at a time', source: 'kit · behaviour', check: 'matches' }],
    claudeSuggestions: emptySuggestions,
    frozenDaysAgo: 2,
  },
  // Published pieces behind the Analytics and Sales sample numbers.
  ...(
    [
      ['reel-011', 'REEL-011', 'Why a byte, not a call', 'M1', ['instagram']],
      ['reel-020', 'REEL-020', 'Two hearts, explained', 'M3', ['youtube', 'instagram']],
      ['reel-022', 'REEL-022', 'Rating the cousins group', 'M5', ['whatsapp']],
      ['reel-023', 'REEL-023', 'Meet the builder: Arjun', 'M6', ['instagram', 'linkedin']],
      ['reel-024', 'REEL-024', 'Grandma learns the byte', 'M2', ['facebook', 'instagram']],
      ['reel-026', 'REEL-026', 'Why I left the call button out', 'M1', ['linkedin']],
      ['poster-005', 'POSTER-005', 'Status kit: festival week', 'M4', ['whatsapp']],
    ] as const
  ).map(([key, code, title, mode, channels]): SeedBrief => ({
    key,
    code,
    kind: code.startsWith('POSTER') ? 'poster' : 'reel',
    productKey: 'live',
    ideaKey: null,
    title,
    mode,
    stage: 'live',
    hook: null,
    beats: [],
    ask: null,
    ratios: ['9:16'],
    captionLanguages: ['en'],
    channels: [...channels],
    ownerKey: 'jeeva',
    claimsApproverKey: 'liveowner',
    brandApproverKey: 'elan',
    claimFlags: passFlags,
    claims: [],
    claudeSuggestions: emptySuggestions,
    frozenDaysAgo: 35,
  })),
];

/* ---------- Review (REEL-031) ---------- */

export const REVIEW_CHECKLIST: ChecklistItem[] = [
  { key: 'claim_check', label: 'Claim check passed', done: true, auto: true, detail: null },
  {
    key: 'captions_safe_zone',
    label: 'Captions EN and TA inside the safe zone',
    done: true,
    auto: true,
    detail: null,
  },
  {
    key: 'real_screens',
    label: 'Real app screens only, no mockups',
    done: true,
    auto: false,
    detail: null,
  },
  {
    key: 'consent',
    label: 'Consent on file for every face',
    done: true,
    auto: false,
    detail: null,
  },
  {
    key: 'music_licence',
    label: 'Music licensed for commercial use',
    done: true,
    auto: false,
    detail: null,
  },
  {
    key: 'tracked_link',
    label: 'Tracked link in bio and description',
    done: true,
    auto: true,
    detail: null,
  },
  {
    key: 'ai_label',
    label: 'AI label set where people are generated',
    done: true,
    auto: true,
    detail: null,
  },
  {
    key: 'loudness',
    label: 'Loudness',
    done: false,
    auto: true,
    detail: '−11.8 LUFS (target −14)',
  },
];

export const REVIEW_COMMENTS = [
  {
    authorKey: 'tamil',
    authorLabel: 'Tamil',
    timecodeMs: 8_000,
    body: 'Cut 6 frames earlier, the hook lands faster.',
  },
  {
    authorKey: 'tester',
    authorLabel: 'Testing',
    timecodeMs: 41_000,
    body: 'Caption overlaps the Reels UI on small phones.',
  },
  {
    authorKey: 'liveowner',
    authorLabel: 'Live owner',
    timecodeMs: 52_000,
    body: 'End card should say “in Joy and Care”.',
  },
];

/* ---------- Render jobs (REEL-031) ---------- */

export const RENDER_JOBS = [
  {
    kind: 'render',
    label: 'Render 1080×1350 · 30 fps',
    tool: 'reel-studio',
    status: 'done',
    progress: 100,
  },
  {
    kind: 'voice',
    label: 'Voice · Kokoro af_heart',
    tool: 'reel-studio',
    status: 'done',
    progress: 100,
  },
  { kind: 'mix', label: 'Mix · −14 LUFS', tool: 'reel-studio', status: 'done', progress: 100 },
  {
    kind: 'cutdown',
    label: 'Cut-down 9:16 · 15 s',
    tool: 'reel-studio',
    status: 'running',
    progress: 62,
  },
] as const;

/* ---------- Channel accounts and integrations (Integrations screen) ---------- */

export const CHANNEL_ACCOUNTS: {
  key: string;
  platform: Platform;
  displayName: string;
  description: string;
  handle: string | null;
  status: 'connected' | 'needs_approval' | 'manual';
  allowedActions: ('publish' | 'insights' | 'comments' | 'messages')[];
}[] = [
  {
    key: 'instagram',
    platform: 'instagram',
    displayName: 'Instagram',
    description: 'Publish, insights, comments',
    handle: '@humini.live',
    status: 'connected',
    allowedActions: ['publish', 'insights', 'comments'],
  },
  {
    key: 'facebook',
    platform: 'facebook',
    displayName: 'Facebook Page',
    description: 'Publish, insights',
    handle: 'Humini Live',
    status: 'connected',
    allowedActions: ['publish', 'insights'],
  },
  {
    key: 'youtube',
    platform: 'youtube',
    displayName: 'YouTube',
    description: 'Shorts, long video, analytics',
    handle: '@huminilive',
    status: 'connected',
    allowedActions: ['publish', 'insights'],
  },
  {
    key: 'linkedin',
    platform: 'linkedin',
    displayName: 'LinkedIn',
    description: 'Elan + company page',
    handle: null,
    status: 'needs_approval',
    allowedActions: [],
  },
  {
    key: 'whatsapp',
    platform: 'whatsapp',
    displayName: 'WhatsApp',
    description: 'Channel by hand · Business API for opt-in',
    handle: null,
    status: 'manual',
    allowedActions: [],
  },
];

export const INTEGRATIONS: {
  key: string;
  name: string;
  description: string;
  status: IntegrationStatus;
}[] = [
  {
    key: 'claude',
    name: 'Claude',
    description: 'Ideas, briefs, captions, notes',
    status: 'connected',
  },
  {
    key: 'github',
    name: 'GitHub',
    description: 'Repos, briefs, approvals as PRs',
    status: 'connected',
  },
  {
    key: 'google-drive',
    name: 'Google Drive',
    description: 'Approved masters library',
    status: 'connected',
  },
  {
    key: 'hand-off-tools',
    name: 'Figma · CapCut · Adobe',
    description: 'Make, then hand back',
    status: 'hand_off',
  },
  {
    key: 'analytics',
    name: 'GA4 · Play · App Store',
    description: 'Visits, installs, events',
    status: 'check_first',
  },
  { key: 'hubspot', name: 'HubSpot (free)', description: 'Partner pipeline', status: 'not_set_up' },
  {
    key: 'comment-to-dm',
    name: 'Comment-to-DM tool',
    description: 'Keyword replies',
    status: 'check_first',
  },
];

/* ---------- Published posts (last 28 days) ---------- */

/**
 * Totals over 28 days. Installs add up to the Analytics screen:
 * Instagram 92, WhatsApp 61, YouTube 28, LinkedIn 22, Facebook 11 (214 in all).
 * `value` is the target value per 1,000 reach, used to size reach.
 */
export const PUBLISHED_POSTS: {
  key: string;
  briefKey: string;
  channelKey: string;
  publishedDaysAgo: number;
  installs: number;
  value: number;
  languages: Language[];
}[] = [
  {
    key: 'reel-011-ig',
    briefKey: 'reel-011',
    channelKey: 'instagram',
    publishedDaysAgo: 27,
    installs: 50,
    value: 90,
    languages: ['en', 'ta'],
  },
  {
    key: 'reel-026-li',
    briefKey: 'reel-026',
    channelKey: 'linkedin',
    publishedDaysAgo: 12,
    installs: 21,
    value: 75,
    languages: ['en'],
  },
  {
    key: 'reel-024-fb',
    briefKey: 'reel-024',
    channelKey: 'facebook',
    publishedDaysAgo: 20,
    installs: 11,
    value: 80,
    languages: ['ta'],
  },
  {
    key: 'reel-024-ig',
    briefKey: 'reel-024',
    channelKey: 'instagram',
    publishedDaysAgo: 20,
    installs: 27,
    value: 70,
    languages: ['en'],
  },
  {
    key: 'poster-005-wa',
    briefKey: 'poster-005',
    channelKey: 'whatsapp',
    publishedDaysAgo: 24,
    installs: 44,
    value: 61,
    languages: ['ta', 'en'],
  },
  {
    key: 'reel-022-wa',
    briefKey: 'reel-022',
    channelKey: 'whatsapp',
    publishedDaysAgo: 16,
    installs: 17,
    value: 55,
    languages: ['ta'],
  },
  {
    key: 'reel-020-yt',
    briefKey: 'reel-020',
    channelKey: 'youtube',
    publishedDaysAgo: 16,
    installs: 28,
    value: 60,
    languages: ['en'],
  },
  {
    key: 'reel-020-ig',
    briefKey: 'reel-020',
    channelKey: 'instagram',
    publishedDaysAgo: 16,
    installs: 5,
    value: 50,
    languages: ['en'],
  },
  {
    key: 'reel-023-ig',
    briefKey: 'reel-023',
    channelKey: 'instagram',
    publishedDaysAgo: 9,
    installs: 10,
    value: 52,
    languages: ['en'],
  },
  {
    key: 'reel-023-li',
    briefKey: 'reel-023',
    channelKey: 'linkedin',
    publishedDaysAgo: 9,
    installs: 1,
    value: 40,
    languages: ['en'],
  },
];

/** Posts going out today (Home "Going out today"), for REEL-029. Times are audience local. */
export const TODAY_POSTS: {
  key: string;
  channelKey: string;
  time: string;
  tz: string;
  format: string;
  languages: Language[];
  status: 'scheduled' | 'manual_pending';
}[] = [
  {
    key: 'reel-029-ig',
    channelKey: 'instagram',
    time: '19:30',
    tz: 'Asia/Kolkata',
    format: '9:16 · 58 s',
    languages: ['en', 'ta'],
    status: 'scheduled',
  },
  {
    key: 'reel-029-yt',
    channelKey: 'youtube',
    time: '20:00',
    tz: 'Asia/Kolkata',
    format: '9:16 · 58 s',
    languages: ['en'],
    status: 'scheduled',
  },
  {
    key: 'reel-029-ig-sg',
    channelKey: 'instagram',
    time: '20:00',
    tz: 'Asia/Singapore',
    format: '9:16 · 58 s',
    languages: ['ta'],
    status: 'scheduled',
  },
  {
    key: 'reel-029-wa',
    channelKey: 'whatsapp',
    time: '21:00',
    tz: 'Asia/Kolkata',
    format: '9:16 file',
    languages: ['ta', 'en'],
    status: 'manual_pending',
  },
];

/* ---------- Leads (Sales screen) ---------- */

export const LEADS: {
  key: string;
  productKey: string;
  organisation: string;
  stage: LeadStage;
  source: LeadSource;
  sourceText: string;
  sourcePostKey?: string;
  who: string | null;
  firstOffer: string | null;
  ownerKey: string | null;
  ownerNote: string | null;
  nextStep: string | null;
  nextStepInDays: number | null;
}[] = [
  {
    key: 'tamil-sangam',
    productKey: 'live',
    organisation: 'Tamil Sangam, Singapore',
    stage: 'new',
    source: 'keyword_reply',
    sourceText: 'Comment “CIRCLE” on Reel 11, tracked link',
    sourcePostKey: 'reel-011-ig',
    who: 'Community secretary · 400 members',
    firstOffer: 'A festival circle for members’ families',
    ownerKey: null,
    ownerNote: 'Community owner (to name)',
    nextStep: 'Intro call · Thu',
    nextStepInDays: 3,
  },
  {
    key: 'hr-chennai',
    productKey: 'pulse',
    organisation: 'HR team, Chennai',
    stage: 'new',
    source: 'dm',
    sourceText: 'LinkedIn DM to Elan',
    who: 'HR lead',
    firstOffer: 'One question a week for the whole office',
    ownerKey: 'elan',
    ownerNote: null,
    nextStep: 'Reply with a demo link',
    nextStepInDays: 1,
  },
  {
    key: 'residents-pune',
    productKey: 'live',
    organisation: 'Residents’ association, Pune',
    stage: 'new',
    source: 'tracked_link',
    sourceText: 'Tracked link · Reel 24',
    sourcePostKey: 'reel-024-ig',
    who: 'Secretary',
    firstOffer: null,
    ownerKey: null,
    ownerNote: 'Community owner (to name)',
    nextStep: null,
    nextStepInDays: null,
  },
  {
    key: 'founders-blr',
    productKey: 'pulse',
    organisation: 'Startup founders circle, Bengaluru',
    stage: 'new',
    source: 'website_form',
    sourceText: 'Website form',
    who: null,
    firstOffer: null,
    ownerKey: null,
    ownerNote: null,
    nextStep: null,
    nextStepInDays: null,
  },
  {
    key: 'alumni-cell',
    productKey: 'live',
    organisation: 'College alumni cell',
    stage: 'talking',
    source: 'keyword_reply',
    sourceText: 'Founder film reply',
    sourcePostKey: 'reel-026-li',
    who: 'Alumni coordinator',
    firstOffer: 'A batch circle for the 2016 batch',
    ownerKey: 'jeeva',
    ownerNote: null,
    nextStep: 'Share the batch circle guide',
    nextStepInDays: 2,
  },
  {
    key: 'temple-trust',
    productKey: 'live',
    organisation: 'Temple trust volunteers',
    stage: 'talking',
    source: 'manual',
    sourceText: 'Met at the Deepavali stall',
    who: 'Volunteer lead',
    firstOffer: 'A volunteers circle',
    ownerKey: 'jeeva',
    ownerNote: null,
    nextStep: 'Call · Mon',
    nextStepInDays: 6,
  },
  {
    key: 'coworking-chennai',
    productKey: 'pulse',
    organisation: 'Coworking space, Chennai',
    stage: 'talking',
    source: 'dm',
    sourceText: 'Instagram DM',
    who: 'Community manager',
    firstOffer: 'Weekly member pulse',
    ownerKey: 'elan',
    ownerNote: null,
    nextStep: 'Pilot terms',
    nextStepInDays: 4,
  },
  {
    key: 'nri-dubai',
    productKey: 'live',
    organisation: 'NRI family group, Dubai',
    stage: 'pilot',
    source: 'keyword_reply',
    sourceText: 'WhatsApp Status kit',
    sourcePostKey: 'poster-005-wa',
    who: 'Group admin · 60 families',
    firstOffer: 'Family circles across two countries',
    ownerKey: 'jeeva',
    ownerNote: null,
    nextStep: 'Pilot check-in',
    nextStepInDays: 7,
  },
  {
    key: 'wedding-planner',
    productKey: 'pulse',
    organisation: 'Wedding planner',
    stage: 'won',
    source: 'website_form',
    sourceText: 'Website form',
    who: 'Founder',
    firstOffer: 'Guest pulse after each event',
    ownerKey: 'elan',
    ownerNote: null,
    nextStep: 'Case study, with consent',
    nextStepInDays: 14,
  },
];

/* ---------- Product settings, posting slots, product channels, documents ---------- */

export const PRODUCT_SETTINGS: {
  productKey: string;
  timezone: string;
  launchDate: string | null;
  weeklyRunEnabled: boolean;
  githubRepo: string | null;
  utmCampaignPrefix: string | null;
  trackingBaseUrl: string | null;
}[] = [
  {
    productKey: 'live',
    timezone: 'Asia/Kolkata',
    launchDate: '2026-09-01',
    weeklyRunEnabled: true,
    githubRepo: 'humini-ecosystem/humini-live-app',
    utmCampaignPrefix: 'live',
    trackingBaseUrl: 'https://live.humini.app',
  },
  {
    productKey: 'pulse',
    timezone: 'Asia/Kolkata',
    launchDate: '2026-09-15',
    weeklyRunEnabled: true,
    githubRepo: 'humini-ecosystem/humini-pulse',
    utmCampaignPrefix: 'pulse',
    trackingBaseUrl: 'https://pulse.humini.app',
  },
  {
    productKey: 'proof',
    timezone: 'Asia/Kolkata',
    launchDate: null,
    weeklyRunEnabled: false,
    githubRepo: null,
    utmCampaignPrefix: 'proof',
    trackingBaseUrl: null,
  },
];

/** Weekday: 0 = Sunday ... 4 = Thursday. Times are audience local. */
export const POSTING_SLOTS: {
  productKey: string;
  platform: Platform;
  weekday: number;
  time: string;
  tz: string;
  label: string;
}[] = [
  {
    productKey: 'live',
    platform: 'instagram',
    weekday: 4,
    time: '19:30',
    tz: 'Asia/Kolkata',
    label: 'India evening',
  },
  {
    productKey: 'live',
    platform: 'instagram',
    weekday: 4,
    time: '20:00',
    tz: 'Asia/Singapore',
    label: 'Singapore evening',
  },
  {
    productKey: 'live',
    platform: 'youtube',
    weekday: 4,
    time: '20:00',
    tz: 'Asia/Kolkata',
    label: 'India evening',
  },
  {
    productKey: 'live',
    platform: 'linkedin',
    weekday: 2,
    time: '08:30',
    tz: 'Asia/Kolkata',
    label: 'India morning',
  },
  {
    productKey: 'live',
    platform: 'facebook',
    weekday: 4,
    time: '20:00',
    tz: 'Asia/Dubai',
    label: 'Gulf evening',
  },
  {
    productKey: 'live',
    platform: 'whatsapp',
    weekday: 4,
    time: '21:00',
    tz: 'Asia/Kolkata',
    label: 'India night (by hand)',
  },
  ...[1, 3, 5].flatMap((weekday) =>
    (['instagram', 'youtube'] as const).map((platform) => ({
      productKey: 'pulse',
      platform,
      weekday,
      time: '19:30',
      tz: 'Asia/Kolkata',
      label: 'India evening',
    })),
  ),
];

export const PRODUCT_CHANNELS: {
  productKey: string;
  channelKey: string;
  enabled: boolean;
  defaultLanguages: Language[];
  defaultRatio: Ratio | null;
}[] = [
  {
    productKey: 'live',
    channelKey: 'instagram',
    enabled: true,
    defaultLanguages: ['en', 'ta'],
    defaultRatio: '9:16',
  },
  {
    productKey: 'live',
    channelKey: 'youtube',
    enabled: true,
    defaultLanguages: ['en'],
    defaultRatio: '9:16',
  },
  {
    productKey: 'live',
    channelKey: 'facebook',
    enabled: true,
    defaultLanguages: ['ta'],
    defaultRatio: '9:16',
  },
  {
    productKey: 'live',
    channelKey: 'linkedin',
    enabled: true,
    defaultLanguages: ['en'],
    defaultRatio: '4:5',
  },
  {
    productKey: 'live',
    channelKey: 'whatsapp',
    enabled: true,
    defaultLanguages: ['ta', 'en'],
    defaultRatio: '9:16',
  },
  {
    productKey: 'pulse',
    channelKey: 'instagram',
    enabled: true,
    defaultLanguages: ['en'],
    defaultRatio: '9:16',
  },
  {
    productKey: 'pulse',
    channelKey: 'youtube',
    enabled: true,
    defaultLanguages: ['en'],
    defaultRatio: '9:16',
  },
];

export const PRODUCT_DOCUMENTS: {
  key: string;
  productKey: string;
  title: string;
  kind: 'repo_spec' | 'url' | 'note';
  sourceUrl: string | null;
  extractedText: string;
  summary: string;
  pinned: boolean;
}[] = [
  {
    key: 'live-spec-006',
    productKey: 'live',
    title: 'Spec 006 · Hearts and bytes',
    kind: 'repo_spec',
    sourceUrl: 'https://github.com/humini-ecosystem/humini-live-app/blob/main/docs/specs/006.md',
    extractedText:
      'A heart shows the owner how many people reacted, never who. A byte is up to 60 seconds of video or voice, replayable, and waits for the other person in their own time.',
    summary:
      'Hearts are counted, not named. Bytes are 60-second video or voice messages that wait.',
    pinned: true,
  },
  {
    key: 'live-spec-007',
    productKey: 'live',
    title: 'Spec 007 · Calls and availability',
    kind: 'repo_spec',
    sourceUrl: 'https://github.com/humini-ecosystem/humini-live-app/blob/main/docs/specs/007.md',
    extractedText:
      'A call rings only when the person has availability on. Calls are audio first. A call cannot be aimed at one named person from a post.',
    summary: 'Calls ring only with availability on, audio first, never aimed at a named person.',
    pinned: true,
  },
  {
    key: 'live-brand-note',
    productKey: 'live',
    title: 'Brand line and tone',
    kind: 'note',
    sourceUrl: null,
    extractedText:
      'Every piece ends on the brand line "Be there for your people, in Joy and Care." Warm, plain words. No fear, no guilt.',
    summary: 'End on the brand line. Warm and plain, never guilt.',
    pinned: false,
  },
];
