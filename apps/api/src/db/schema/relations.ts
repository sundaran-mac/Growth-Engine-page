/**
 * Drizzle relations for `db.query.<table>.findMany({ with: ... })`. No SQL is generated from this file.
 */
import { relations } from 'drizzle-orm';
import { approvals, reviewChecklists, reviewComments } from './gates.js';
import { briefs, ideas, occasionProducts, occasions, planItems, plans } from './content.js';
import { assets, renderJobs } from './make.js';
import { productKits, productMembers, products, sessions, users } from './people.js';
import { channelAccounts, keywordEvents, keywordRules, metricSnapshots, posts } from './publish.js';
import { leadActivities, leads } from './sales.js';
import { notifications, weeklyNotes } from './system.js';
import {
  postingSlots,
  productChannels,
  productDocuments,
  productSettings,
  weeklyRuns,
} from './settings.js';

export const usersRelations = relations(users, ({ many }) => ({
  sessions: many(sessions),
  memberships: many(productMembers),
  notifications: many(notifications),
}));

export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  owner: one(users, {
    fields: [products.ownerId],
    references: [users.id],
    relationName: 'product_owner',
  }),
  backup: one(users, {
    fields: [products.backupId],
    references: [users.id],
    relationName: 'product_backup',
  }),
  kits: many(productKits),
  members: many(productMembers),
  ideas: many(ideas),
  plans: many(plans),
  briefs: many(briefs),
  leads: many(leads),
  occasions: many(occasionProducts),
}));

export const productKitsRelations = relations(productKits, ({ one }) => ({
  product: one(products, { fields: [productKits.productId], references: [products.id] }),
  signedBy: one(users, { fields: [productKits.signedById], references: [users.id] }),
}));

export const productMembersRelations = relations(productMembers, ({ one }) => ({
  product: one(products, { fields: [productMembers.productId], references: [products.id] }),
  user: one(users, { fields: [productMembers.userId], references: [users.id] }),
}));

export const occasionsRelations = relations(occasions, ({ many }) => ({
  products: many(occasionProducts),
}));

export const occasionProductsRelations = relations(occasionProducts, ({ one }) => ({
  occasion: one(occasions, { fields: [occasionProducts.occasionId], references: [occasions.id] }),
  product: one(products, { fields: [occasionProducts.productId], references: [products.id] }),
}));

export const ideasRelations = relations(ideas, ({ one, many }) => ({
  product: one(products, { fields: [ideas.productId], references: [products.id] }),
  createdBy: one(users, { fields: [ideas.createdById], references: [users.id] }),
  briefs: many(briefs),
}));

export const plansRelations = relations(plans, ({ one, many }) => ({
  product: one(products, { fields: [plans.productId], references: [products.id] }),
  frozenBy: one(users, { fields: [plans.frozenById], references: [users.id] }),
  items: many(planItems),
}));

export const planItemsRelations = relations(planItems, ({ one }) => ({
  plan: one(plans, { fields: [planItems.planId], references: [plans.id] }),
  idea: one(ideas, { fields: [planItems.ideaId], references: [ideas.id] }),
  brief: one(briefs, { fields: [planItems.briefId], references: [briefs.id] }),
  occasion: one(occasions, { fields: [planItems.occasionId], references: [occasions.id] }),
}));

export const briefsRelations = relations(briefs, ({ one, many }) => ({
  product: one(products, { fields: [briefs.productId], references: [products.id] }),
  idea: one(ideas, { fields: [briefs.ideaId], references: [ideas.id] }),
  owner: one(users, {
    fields: [briefs.ownerId],
    references: [users.id],
    relationName: 'brief_owner',
  }),
  claimsApprover: one(users, {
    fields: [briefs.claimsApproverId],
    references: [users.id],
    relationName: 'brief_claims_approver',
  }),
  brandApprover: one(users, {
    fields: [briefs.brandApproverId],
    references: [users.id],
    relationName: 'brief_brand_approver',
  }),
  assets: many(assets),
  renderJobs: many(renderJobs),
  checklists: many(reviewChecklists),
  comments: many(reviewComments),
  approvals: many(approvals),
  posts: many(posts),
}));

export const assetsRelations = relations(assets, ({ one }) => ({
  brief: one(briefs, { fields: [assets.briefId], references: [briefs.id] }),
  createdBy: one(users, { fields: [assets.createdById], references: [users.id] }),
}));

export const renderJobsRelations = relations(renderJobs, ({ one }) => ({
  brief: one(briefs, { fields: [renderJobs.briefId], references: [briefs.id] }),
  asset: one(assets, { fields: [renderJobs.assetId], references: [assets.id] }),
}));

export const reviewChecklistsRelations = relations(reviewChecklists, ({ one }) => ({
  brief: one(briefs, { fields: [reviewChecklists.briefId], references: [briefs.id] }),
}));

export const reviewCommentsRelations = relations(reviewComments, ({ one }) => ({
  brief: one(briefs, { fields: [reviewComments.briefId], references: [briefs.id] }),
  author: one(users, { fields: [reviewComments.authorId], references: [users.id] }),
}));

export const approvalsRelations = relations(approvals, ({ one }) => ({
  brief: one(briefs, { fields: [approvals.briefId], references: [briefs.id] }),
  approver: one(users, {
    fields: [approvals.approverId],
    references: [users.id],
    relationName: 'approval_approver',
  }),
  backup: one(users, {
    fields: [approvals.backupId],
    references: [users.id],
    relationName: 'approval_backup',
  }),
  decidedBy: one(users, {
    fields: [approvals.decidedById],
    references: [users.id],
    relationName: 'approval_decided_by',
  }),
}));

export const channelAccountsRelations = relations(channelAccounts, ({ one, many }) => ({
  product: one(products, { fields: [channelAccounts.productId], references: [products.id] }),
  posts: many(posts),
}));

export const postsRelations = relations(posts, ({ one, many }) => ({
  brief: one(briefs, { fields: [posts.briefId], references: [briefs.id] }),
  channelAccount: one(channelAccounts, {
    fields: [posts.channelAccountId],
    references: [channelAccounts.id],
  }),
  asset: one(assets, { fields: [posts.assetId], references: [assets.id] }),
  metrics: many(metricSnapshots),
}));

export const metricSnapshotsRelations = relations(metricSnapshots, ({ one }) => ({
  post: one(posts, { fields: [metricSnapshots.postId], references: [posts.id] }),
}));

export const keywordRulesRelations = relations(keywordRules, ({ one, many }) => ({
  product: one(products, { fields: [keywordRules.productId], references: [products.id] }),
  events: many(keywordEvents),
}));

export const keywordEventsRelations = relations(keywordEvents, ({ one }) => ({
  rule: one(keywordRules, { fields: [keywordEvents.ruleId], references: [keywordRules.id] }),
  post: one(posts, { fields: [keywordEvents.postId], references: [posts.id] }),
  lead: one(leads, { fields: [keywordEvents.leadId], references: [leads.id] }),
}));

export const leadsRelations = relations(leads, ({ one, many }) => ({
  product: one(products, { fields: [leads.productId], references: [products.id] }),
  sourcePost: one(posts, { fields: [leads.sourcePostId], references: [posts.id] }),
  owner: one(users, { fields: [leads.ownerId], references: [users.id] }),
  activities: many(leadActivities),
}));

export const leadActivitiesRelations = relations(leadActivities, ({ one }) => ({
  lead: one(leads, { fields: [leadActivities.leadId], references: [leads.id] }),
  actor: one(users, { fields: [leadActivities.actorId], references: [users.id] }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  user: one(users, { fields: [notifications.userId], references: [users.id] }),
}));

export const productSettingsRelations = relations(productSettings, ({ one }) => ({
  product: one(products, { fields: [productSettings.productId], references: [products.id] }),
}));

export const postingSlotsRelations = relations(postingSlots, ({ one }) => ({
  product: one(products, { fields: [postingSlots.productId], references: [products.id] }),
}));

export const productChannelsRelations = relations(productChannels, ({ one }) => ({
  product: one(products, { fields: [productChannels.productId], references: [products.id] }),
  channelAccount: one(channelAccounts, {
    fields: [productChannels.channelAccountId],
    references: [channelAccounts.id],
  }),
}));

export const productDocumentsRelations = relations(productDocuments, ({ one }) => ({
  product: one(products, { fields: [productDocuments.productId], references: [products.id] }),
  uploadedBy: one(users, { fields: [productDocuments.uploadedById], references: [users.id] }),
}));

export const weeklyRunsRelations = relations(weeklyRuns, ({ one }) => ({
  product: one(products, { fields: [weeklyRuns.productId], references: [products.id] }),
  note: one(weeklyNotes, { fields: [weeklyRuns.noteId], references: [weeklyNotes.id] }),
  triggeredByUser: one(users, { fields: [weeklyRuns.triggeredByUserId], references: [users.id] }),
}));
