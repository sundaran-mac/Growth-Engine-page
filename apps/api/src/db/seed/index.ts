/**
 * Loads SAMPLE DATA (data.ts) for local development. `npm run db:seed`.
 *
 * - Refuses to run when NODE_ENV=production.
 * - Idempotent: every row has a stable id made from its seed key; re-runs insert nothing new.
 *   User passwords are reset to SEED_USER_PASSWORD on every run.
 * - Dates are relative to "now" in APP_TIMEZONE on the first run (posts going out today,
 *   28 days of metrics).
 */
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { sql } from 'drizzle-orm';
import { computeValueScore } from '@growth-desk/contract';
import { env } from '../../config/env.js';
import { hashPassword } from '../../lib/crypto.js';
import { bumpBriefCodeCounter, parseBriefCode } from '../../lib/codes.js';
import {
  DAY_MS,
  HOUR_MS,
  dateKey,
  monthKey,
  weekStartKey,
  zonedTimeToUtc,
} from '../../lib/time.js';
import { closeDb, db, type Tx } from '../client.js';
import * as t from '../schema/index.js';
import * as data from './data.js';

/** Stable UUID (version 5 layout) from a seed key, so re-runs hit the same rows. */
export function seedId(key: string): string {
  const h = createHash('sha256').update(`growth-desk-seed:${key}`).digest();
  h[6] = (h[6]! & 0x0f) | 0x50;
  h[8] = (h[8]! & 0x3f) | 0x80;
  const hex = h.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const uid = (key: string) => seedId(`user:${key}`);
const pid = (key: string) => seedId(`product:${key}`);
const bid = (key: string) => seedId(`brief:${key}`);
const cid = (key: string) => seedId(`channel:${key}`);
const postId = (key: string) => seedId(`post:${key}`);

/** Splits `total` over `n` days with a decaying weight, summing exactly to `total`. */
export function spread(total: number, n: number, decay = 0.12): number[] {
  if (n <= 0) return [];
  const weights = Array.from({ length: n }, (_, i) => Math.exp(-decay * i));
  const sum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (w / sum) * total);
  const out = raw.map(Math.floor);
  let rest = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    out[i]! += 1;
    rest -= 1;
  }
  return out;
}

async function seedPeople(tx: Tx, passwordHash: string) {
  for (const u of data.USERS) {
    await tx
      .insert(t.users)
      .values({
        id: uid(u.key),
        email: data.emailFor(u.key),
        name: u.name,
        initials: u.initials,
        title: u.title,
        role: u.role,
        isBrandApprover: u.isBrandApprover,
        passwordHash,
      })
      .onConflictDoUpdate({ target: t.users.id, set: { passwordHash, isActive: true } });
  }
}

async function seedProducts(tx: Tx, now: Date) {
  for (const p of data.PRODUCTS) {
    await tx
      .insert(t.products)
      .values({
        id: pid(p.key),
        slug: p.slug,
        name: p.name,
        shortName: p.shortName,
        status: p.status,
        statusNote: p.statusNote,
        color: p.color,
        repoUrl: p.repoUrl,
        siteUrl: p.siteUrl,
        ownerId: p.ownerKey ? uid(p.ownerKey) : null,
        backupId: null,
      })
      .onConflictDoNothing();
    const k = p.kit;
    await tx
      .insert(t.productKits)
      .values({
        id: seedId(`kit:${p.key}:1`),
        productId: pid(p.key),
        version: 1,
        promise: k.promise,
        behaviours: k.behaviours,
        neverSay: k.neverSay,
        notBuilt: k.notBuilt,
        audiences: k.audiences,
        activationEvent: k.activationEvent,
        truthSources: k.truthSources,
        score: k.score,
        signedById: k.signedByKey ? uid(k.signedByKey) : null,
        signedAt: k.signedOn ? zonedTimeToUtc(k.signedOn, '10:00', env.appTimezone) : null,
      })
      .onConflictDoNothing();
    for (const m of p.members) {
      await tx
        .insert(t.productMembers)
        .values({
          id: seedId(`member:${p.key}:${m.userKey}:${m.role}`),
          productId: pid(p.key),
          userId: uid(m.userKey),
          productRole: m.role,
        })
        .onConflictDoNothing();
    }
  }
  // Keyword rule for the CIRCLE replies on Instagram.
  await tx
    .insert(t.keywordRules)
    .values({
      id: seedId('keyword:live:instagram:CIRCLE'),
      productId: pid('live'),
      platform: 'instagram',
      keyword: 'CIRCLE',
      replyText: 'Here is how to start a circle for your people:',
      link: `https://${env.trackingLinkBase}/?utm_source=instagram&utm_medium=dm&utm_campaign=live-circle&utm_content=REEL-011`,
    })
    .onConflictDoNothing();
  void now;
}

async function seedPlanning(tx: Tx, now: Date) {
  for (const o of data.OCCASIONS) {
    await tx
      .insert(t.occasions)
      .values({
        id: seedId(`occasion:${o.key}`),
        name: o.name,
        date: o.date,
        endDate: o.endDate,
        notes: o.notes,
      })
      .onConflictDoNothing();
    for (const p of o.products) {
      await tx
        .insert(t.occasionProducts)
        .values({ occasionId: seedId(`occasion:${o.key}`), productId: pid(p) })
        .onConflictDoNothing();
    }
  }
  for (const [i, idea] of data.IDEAS.entries()) {
    await tx
      .insert(t.ideas)
      .values({
        id: seedId(`idea:${idea.key}`),
        productId: pid(idea.productKey),
        title: idea.title,
        mode: idea.mode,
        channels: idea.channels,
        fitScore: idea.fitScore,
        status: idea.status,
        source: idea.source,
        note: idea.note,
        angle: idea.angle,
        createdById: idea.source === 'human' ? uid('jeeva') : null,
        createdAt: new Date(now.getTime() - (2 * DAY_MS + i * HOUR_MS)),
      })
      .onConflictDoNothing();
  }
}

async function seedBriefs(tx: Tx, now: Date) {
  for (const b of data.BRIEFS) {
    await tx
      .insert(t.briefs)
      .values({
        id: bid(b.key),
        code: b.code,
        kind: b.kind,
        productId: pid(b.productKey),
        ideaId: b.ideaKey ? seedId(`idea:${b.ideaKey}`) : null,
        title: b.title,
        mode: b.mode,
        stage: b.stage,
        hook: b.hook,
        beats: b.beats,
        ask: b.ask,
        ratios: b.ratios,
        captionLanguages: b.captionLanguages,
        channels: b.channels,
        ownerId: uid(b.ownerKey),
        claimsApproverId: b.claimsApproverKey ? uid(b.claimsApproverKey) : null,
        brandApproverId: b.brandApproverKey ? uid(b.brandApproverKey) : null,
        version: 1,
        claimFlags: b.claimFlags,
        claims: b.claims,
        claudeSuggestions: b.claudeSuggestions,
        frozenAt:
          b.frozenDaysAgo === null ? null : new Date(now.getTime() - b.frozenDaysAgo * DAY_MS),
      })
      .onConflictDoNothing();
    const code = parseBriefCode(b.code);
    if (code) await bumpBriefCodeCounter(code.prefix, code.value, tx);
  }

  // November plan (draft).
  const planId = seedId(`plan:live:${data.PLAN_MONTH}`);
  await tx
    .insert(t.plans)
    .values({ id: planId, productId: pid('live'), month: data.PLAN_MONTH, status: 'draft' })
    .onConflictDoNothing();
  for (const [i, item] of data.PLAN_ITEMS.entries()) {
    await tx
      .insert(t.planItems)
      .values({
        id: seedId(`plan-item:${data.PLAN_MONTH}:${i}`),
        planId,
        date: item.date,
        title: item.title,
        mode: item.mode,
        channel: item.channel,
        briefId: item.briefKey ? bid(item.briefKey) : null,
        occasionId: item.occasionKey ? seedId(`occasion:${item.occasionKey}`) : null,
        needsShootSlot: item.needsShootSlot ?? false,
        position: i,
      })
      .onConflictDoNothing();
  }
}

async function seedMakeAndGates(tx: Tx, now: Date) {
  const reel = bid('reel-031');
  await tx
    .insert(t.assets)
    .values({
      id: seedId('asset:reel-031:master'),
      briefId: reel,
      kind: 'video',
      ratio: '9:16',
      storageKey: `briefs/${reel}/video/sample-reel-031-master-9x16.mp4`,
      fileName: 'reel-031-master-9x16.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 48_300_000,
      durationMs: 58_000,
      width: 1080,
      height: 1920,
      status: 'ready',
      licence: 'Licensed track · commercial use',
      consentOnFile: true,
      aiGenerated: false,
      briefVersion: 1,
      createdById: uid('tamil'),
    })
    .onConflictDoNothing();
  for (const [i, j] of data.RENDER_JOBS.entries()) {
    const started = new Date(now.getTime() - (5 - i) * HOUR_MS);
    await tx
      .insert(t.renderJobs)
      .values({
        id: seedId(`render:reel-031:${i}`),
        briefId: reel,
        kind: j.kind,
        label: j.label,
        tool: j.tool,
        status: j.status,
        progress: j.progress,
        startedAt: started,
        finishedAt: j.status === 'done' ? new Date(started.getTime() + 20 * 60 * 1000) : null,
      })
      .onConflictDoNothing();
  }
  await tx
    .insert(t.reviewChecklists)
    .values({
      id: seedId('checklist:reel-031:1'),
      briefId: reel,
      version: 1,
      items: data.REVIEW_CHECKLIST,
    })
    .onConflictDoNothing();
  for (const [i, c] of data.REVIEW_COMMENTS.entries()) {
    await tx
      .insert(t.reviewComments)
      .values({
        id: seedId(`comment:reel-031:${i}`),
        briefId: reel,
        version: 1,
        authorId: uid(c.authorKey),
        authorLabel: c.authorLabel,
        timecodeMs: c.timecodeMs,
        body: c.body,
      })
      .onConflictDoNothing();
  }

  // Approvals: [brief, gate, approver, hours waiting, decision].
  const approvals: [string, 'claims' | 'brand', string | null, number, 'pending' | 'approved'][] = [
    ['reel-031', 'claims', 'liveowner', 6, 'pending'],
    ['reel-031', 'brand', 'elan', 6, 'approved'],
    ['poster-008', 'claims', 'liveowner', 23, 'pending'],
    ['poster-008', 'brand', 'elan', 23, 'pending'],
    ['pulse-007', 'claims', null, 2, 'pending'],
    ['reel-029', 'claims', 'liveowner', 200, 'approved'],
    ['reel-029', 'brand', 'elan', 200, 'approved'],
  ];
  for (const [briefKey, gate, approverKey, hours, decision] of approvals) {
    const requestedAt = new Date(now.getTime() - hours * HOUR_MS);
    await tx
      .insert(t.approvals)
      .values({
        id: seedId(`approval:${briefKey}:1:${gate}`),
        briefId: bid(briefKey),
        version: 1,
        gate,
        approverId: approverKey ? uid(approverKey) : null,
        backupId: null,
        decidedById: decision === 'approved' && approverKey ? uid(approverKey) : null,
        decision,
        note: null,
        requestedAt,
        dueAt: new Date(requestedAt.getTime() + 24 * HOUR_MS),
        decidedAt: decision === 'approved' ? new Date(requestedAt.getTime() + 2 * HOUR_MS) : null,
      })
      .onConflictDoNothing();
  }
}

async function seedChannelsAndPosts(tx: Tx, now: Date) {
  for (const c of data.CHANNEL_ACCOUNTS) {
    await tx
      .insert(t.channelAccounts)
      .values({
        id: cid(c.key),
        platform: c.platform,
        displayName: c.displayName,
        description: c.description,
        handle: c.handle,
        productId: null,
        externalAccountId: `sample-${c.key}`,
        status: c.status,
        allowedActions: c.allowedActions,
        connectedById: c.status === 'connected' ? uid('sundaran') : null,
        connectedAt: c.status === 'connected' ? new Date(now.getTime() - 30 * DAY_MS) : null,
      })
      .onConflictDoNothing();
  }
  for (const i of data.INTEGRATIONS) {
    await tx
      .insert(t.integrations)
      .values({ id: seedId(`integration:${i.key}`), ...i })
      .onConflictDoNothing();
  }

  const briefCode = new Map(data.BRIEFS.map((b) => [b.key, b.code]));
  const channelPlatform = new Map(data.CHANNEL_ACCOUNTS.map((c) => [c.key, c.platform]));
  const tracked = (platform: string, code: string) =>
    `https://${env.trackingLinkBase}/?utm_source=${platform}&utm_medium=reel&utm_campaign=live-sample&utm_content=${code}`;

  // Going out today (REEL-029).
  const today = dateKey(now, env.appTimezone);
  for (const p of data.TODAY_POSTS) {
    const platform = channelPlatform.get(p.channelKey)!;
    await tx
      .insert(t.posts)
      .values({
        id: postId(p.key),
        briefId: bid('reel-029'),
        briefVersion: 1,
        channelAccountId: cid(p.channelKey),
        format: p.format,
        caption: 'It is 2 am for them. Your byte can wait. Send one that waits for their morning.',
        languages: p.languages,
        scheduledAt: zonedTimeToUtc(today, p.time, p.tz),
        audienceTz: p.tz,
        status: p.status,
        trackedUrl: tracked(platform, 'REEL-029'),
      })
      .onConflictDoNothing();
  }

  // Published posts with 28 days of daily metric snapshots.
  for (const p of data.PUBLISHED_POSTS) {
    const platform = channelPlatform.get(p.channelKey)!;
    const code = briefCode.get(p.briefKey)!;
    const publishedAt = new Date(now.getTime() - p.publishedDaysAgo * DAY_MS);
    const id = postId(p.key);
    await tx
      .insert(t.posts)
      .values({
        id,
        briefId: bid(p.briefKey),
        briefVersion: 1,
        channelAccountId: cid(p.channelKey),
        format: '9:16',
        caption: null,
        languages: p.languages,
        scheduledAt: publishedAt,
        audienceTz: 'Asia/Kolkata',
        status: 'published',
        externalId: `sample-${p.key}`,
        liveUrl: null,
        trackedUrl: tracked(platform, code),
        publishedAt,
      })
      .onConflictDoNothing();

    // Ladder shape per install: 3 saves, 2 shares, 4 clicks, 0.4 activations (73 points),
    // and reach sized so the value per 1,000 reach lands on `value`.
    const days = p.publishedDaysAgo;
    const I = p.installs;
    const totals = {
      installs: I,
      saves: 3 * I,
      shares: 2 * I,
      clicks: 4 * I,
      activations: Math.round(0.4 * I),
      comments: Math.round(1.5 * I),
    };
    const points =
      totals.saves * 3 +
      totals.shares * 4 +
      totals.clicks * 5 +
      totals.installs * 20 +
      totals.activations * 40;
    const reachTotal = Math.round((points * 1000) / p.value);
    const split = {
      reach: spread(reachTotal, days),
      saves: spread(totals.saves, days),
      shares: spread(totals.shares, days),
      clicks: spread(totals.clicks, days),
      installs: spread(totals.installs, days),
      activations: spread(totals.activations, days),
      comments: spread(totals.comments, days),
    };
    for (let d = 0; d < days; d++) {
      const date = dateKey(new Date(publishedAt.getTime() + d * DAY_MS), env.appTimezone);
      const m = {
        reach: split.reach[d]!,
        saves: split.saves[d]!,
        shares: split.shares[d]!,
        comments: split.comments[d]!,
        clicks: split.clicks[d]!,
        installs: split.installs[d]!,
        activations: split.activations[d]!,
      };
      await tx
        .insert(t.metricSnapshots)
        .values({
          id: seedId(`metric:${p.key}:${d}`),
          postId: id,
          date,
          ...m,
          valueScore: computeValueScore(m),
        })
        .onConflictDoNothing();
    }
  }

  // Six comments asked for the link on Reel 11 (keyword CIRCLE), replies queued.
  for (let i = 0; i < 6; i++) {
    await tx
      .insert(t.keywordEvents)
      .values({
        id: seedId(`keyword-event:${i}`),
        ruleId: seedId('keyword:live:instagram:CIRCLE'),
        postId: postId('reel-011-ig'),
        platform: 'instagram',
        externalCommentId: `sample-comment-${i}`,
        authorHandle: `@sample_user_${i + 1}`,
        commentText: 'CIRCLE',
        replyStatus: 'queued',
      })
      .onConflictDoNothing();
  }
}

async function seedSalesAndSystem(tx: Tx, now: Date) {
  for (const l of data.LEADS) {
    await tx
      .insert(t.leads)
      .values({
        id: seedId(`lead:${l.key}`),
        productId: pid(l.productKey),
        organisation: l.organisation,
        source: l.source,
        sourcePostId: l.sourcePostKey ? postId(l.sourcePostKey) : null,
        sourceText: l.sourceText,
        who: l.who,
        firstOffer: l.firstOffer,
        ownerId: l.ownerKey ? uid(l.ownerKey) : null,
        ownerNote: l.ownerNote,
        stage: l.stage,
        nextStep: l.nextStep,
        nextStepAt:
          l.nextStepInDays === null ? null : new Date(now.getTime() + l.nextStepInDays * DAY_MS),
      })
      .onConflictDoNothing();
    await tx
      .insert(t.leadActivities)
      .values({
        id: seedId(`lead-activity:${l.key}:created`),
        leadId: seedId(`lead:${l.key}`),
        actorId: null,
        kind: 'note',
        body: `Lead created from: ${l.sourceText}`,
      })
      .onConflictDoNothing();
  }

  const lastMonday = weekStartKey(now, env.appTimezone);
  await tx
    .insert(t.weeklyNotes)
    .values({
      id: seedId(`note:${lastMonday}`),
      productId: null,
      weekStart: lastMonday,
      body: '16 new ideas drafted: 10 for Live, 6 for Pulse. Founder films had the best value per reach three weeks running.',
      doMore: 'Founder films on Instagram.',
      stopDoing: 'Long motion explainers on Instagram.',
    })
    .onConflictDoNothing();

  await tx
    .insert(t.claudeUsage)
    .values({
      id: seedId(`claude-usage:live:${monthKey(now, env.appTimezone)}`),
      productId: pid('live'),
      month: monthKey(now, env.appTimezone),
      inputTokens: 184_000,
      outputTokens: 41_000,
      capTokens: env.claudeMonthlyTokenCap,
      requestCount: 37,
    })
    .onConflictDoNothing();

  const notes: [string, 'approval_requested' | 'plan_to_freeze' | 'ideas_ready', string, string][] =
    [
      [
        'liveowner',
        'approval_requested',
        'Approve claims · REEL-031 “60 seconds with Elan”',
        `/approvals`,
      ],
      ['jeeva', 'plan_to_freeze', 'Freeze the November plan', '/plan'],
      ['jeeva', 'ideas_ready', '16 new ideas from Claude', '/ideas'],
    ];
  for (const [i, [userKey, kind, title, link]] of notes.entries()) {
    await tx
      .insert(t.notifications)
      .values({ id: seedId(`notification:${i}`), userId: uid(userKey), kind, title, link })
      .onConflictDoNothing();
  }
}

async function seedSettings(tx: Tx) {
  for (const s of data.PRODUCT_SETTINGS) {
    await tx
      .insert(t.productSettings)
      .values({
        productId: pid(s.productKey),
        timezone: s.timezone,
        launchDate: s.launchDate,
        weeklyRunEnabled: s.weeklyRunEnabled,
        githubRepo: s.githubRepo,
        utmCampaignPrefix: s.utmCampaignPrefix,
        trackingBaseUrl: s.trackingBaseUrl,
      })
      .onConflictDoNothing();
  }
  for (const [i, slot] of data.POSTING_SLOTS.entries()) {
    await tx
      .insert(t.postingSlots)
      .values({
        id: seedId(
          `slot:${slot.productKey}:${slot.platform}:${slot.weekday}:${slot.time}:${slot.tz}`,
        ),
        productId: pid(slot.productKey),
        platform: slot.platform,
        weekday: slot.weekday,
        localTime: slot.time,
        audienceTimezone: slot.tz,
        label: slot.label,
        sort: i,
      })
      .onConflictDoNothing();
  }
  for (const c of data.PRODUCT_CHANNELS) {
    await tx
      .insert(t.productChannels)
      .values({
        productId: pid(c.productKey),
        channelAccountId: cid(c.channelKey),
        enabled: c.enabled,
        defaultLanguages: c.defaultLanguages,
        defaultRatio: c.defaultRatio,
      })
      .onConflictDoNothing();
  }
  for (const d of data.PRODUCT_DOCUMENTS) {
    await tx
      .insert(t.productDocuments)
      .values({
        id: seedId(`document:${d.key}`),
        productId: pid(d.productKey),
        title: d.title,
        kind: d.kind,
        sourceUrl: d.sourceUrl,
        mimeType: 'text/markdown',
        status: 'ready',
        extractedText: d.extractedText,
        summary: d.summary,
        tokenEstimate: Math.ceil(d.extractedText.length / 4),
        pinned: d.pinned,
        uploadedById: uid('jeeva'),
      })
      .onConflictDoNothing();
  }
}

export async function runSeed(): Promise<void> {
  if (env.isProduction) throw new Error('The seed never runs in production (NODE_ENV=production).');
  const now = new Date();
  const passwordHash = await hashPassword(env.seedUserPassword);
  await db.transaction(async (tx) => {
    // One seed at a time, even if two processes start together.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('growth-desk-seed'))`);
    await seedPeople(tx, passwordHash);
    await seedProducts(tx, now);
    await seedPlanning(tx, now);
    await seedBriefs(tx, now);
    await seedMakeAndGates(tx, now);
    await seedChannelsAndPosts(tx, now);
    await seedSalesAndSystem(tx, now);
    await seedSettings(tx);
  });
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? '').href;
if (isMain) {
  try {
    await runSeed();
    console.log('Sample data loaded (development only).');
    console.log('Sign in with any of these users:');
    for (const u of data.USERS)
      console.log(`  ${data.emailFor(u.key).padEnd(24)} ${u.name} (${u.role})`);
    console.log(`Password for every sample user: ${env.seedUserPassword}`);
  } catch (err) {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}
