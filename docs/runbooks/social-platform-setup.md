# Runbook: social platform setup

For: Sundaran (automation admin). Last checked: 12 Oct 2026.

> **What we will do:** create one developer app per platform and copy its keys into `.env`.
> **What we get at the end:** Growth Desk can connect each channel and (after review) post to it.
> **What I must keep ready:** admin access to the Humini Facebook Page, Instagram account,
> YouTube channel, LinkedIn company page, and a public HTTPS URL for the app.

## 0. Read this first

- Every vendor fact below is **"check first, as of Oct 2026"**. Platforms change rules without notice.
- Each fact has a mark:
  - **[verified 12 Oct 2026]**: read on the vendor's own docs page on that date.
  - **[from search, not opened]**: seen in a search summary only. Open the doc and confirm.
  - **[not checked]**: from the functional doc or memory. Confirm before you rely on it.
- Until a platform approves our app, the connector shows `needs_approval` and never auto-posts.
  This is on purpose (ADR 0007).
- Never paste a secret in chat, a screenshot or git. Secrets go in `.env` only (local) or the vault (prod).

### The redirect URI rule

Every OAuth app needs a redirect URI (the page the platform sends the user back to).
Ours is:

```
<OAUTH_REDIRECT_BASE_URL>/api/v1/integrations/oauth/<platform>/callback
```

Example, if `OAUTH_REDIRECT_BASE_URL=https://growth.humini.app`:

```
https://growth.humini.app/api/v1/integrations/oauth/meta/callback
```

- The value must **match exactly** in the developer console (no extra slash).
  Meta says the dashboard may add a trailing slash, so check it **[verified 12 Oct 2026]**.
- The `<platform>` word used by the code (for example `meta`, `google`, `linkedin`) is
  **to be confirmed by the build** (PUBLISH module).
- Most platforms need HTTPS. For local tests, use a tunnel (for example `ngrok` or
  `cloudflared`) and set `OAUTH_REDIRECT_BASE_URL` to the tunnel URL. **[not checked per platform]**

### The .env keys

Key names below are **proposed, to be confirmed against `.env.example`** when the build adds it.
Only `OAUTH_REDIRECT_BASE_URL` and `ENCRYPTION_KEY` are fixed by the build plan.

| Key | Where it comes from |
|---|---|
| `OAUTH_REDIRECT_BASE_URL` | Your public app URL (or tunnel URL locally) |
| `ENCRYPTION_KEY` | You make it: 32 random bytes, for example `openssl rand -base64 32`. Encrypts OAuth tokens at rest |
| `META_APP_ID`, `META_APP_SECRET` | Meta App Dashboard > App settings > Basic |
| `META_WEBHOOK_VERIFY_TOKEN` | You make it: any long random string. Paste the same value in Meta's webhook setup |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Cloud Console > APIs and Services > Credentials > OAuth client ID |
| `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | LinkedIn Developer Portal > My apps > your app > Auth |

---

## 1. Meta (Instagram + Facebook)

One Meta app covers both Instagram and the Facebook Page.

### 1.1 Before you start

1. The Instagram account must be a **professional account** (Business or Creator)
   **connected to a Facebook Page**. **[verified 12 Oct 2026]**
2. If the Page needs **Page Publishing Authorization (PPA)**, finish it first.
   Until then, the API cannot publish. **[verified 12 Oct 2026]**
3. You need a Meta developer account and admin rights on the Page.

### 1.2 Create the app

1. Go to the Meta App Dashboard (developers.facebook.com). Create an app, type "Business".
2. Link it to the Arus or Humini Business portfolio (Business Manager). **[not checked: exact menu names]**
3. Add products (use cases):
   - **Instagram** (content publishing, comments, insights);
   - **Facebook Login for Business** (for the Page);
   - **Webhooks** (for Instagram comments, used by keyword replies).
4. In the login settings, add the redirect URI (rule in section 0).
5. Copy App ID and App Secret into `.env`.

### 1.3 Two login paths (pick one with the PUBLISH module)

| Path | Scopes for Instagram publishing | Token |
|---|---|---|
| Instagram API with **Instagram Login** | `instagram_business_basic`, `instagram_business_content_publish` (plus `instagram_business_manage_comments` for keyword replies, `instagram_business_manage_messages` for DMs) | Instagram User token |
| Instagram API with **Facebook Login** | `instagram_basic`, `instagram_content_publish`, `pages_read_engagement` | Facebook Page token |

**[verified 12 Oct 2026]** on Meta's Content Publishing and Business Login pages.

- The old values `business_basic`, `business_content_publish` and so on were deprecated
  on 27 Jan 2025. Do not use them. **[verified 12 Oct 2026]**
- With Facebook Login, if a person got their Page role through Business Manager, Meta also
  asks for `ads_management` and `ads_read`. **[verified 12 Oct 2026]**
- Because Growth Desk also posts to the **Facebook Page**, the Facebook Login path is
  likely simpler (one token family for both). Decide with the PUBLISH module.

### 1.4 Facebook Page (Reels and posts)

Scopes: `pages_show_list`, `pages_read_engagement`, `pages_manage_posts`.
Reels go to `/{page-id}/video_reels` in three steps (start, upload, finish).
**[from search, not opened]** Meta's Reels Publishing guide.

### 1.5 Limits to know

| Limit | Value | Mark |
|---|---|---|
| Instagram API posts | 100 per 24 h moving window per account (carousel counts as 1) | [verified 12 Oct 2026] |
| Same page also says | 50 posts per 24 h in the carousel section (Meta's page is not consistent) | [verified 12 Oct 2026] |
| Carousel size | up to 10 images or videos | [verified 12 Oct 2026] |
| Image format | JPEG only | [verified 12 Oct 2026] |
| Media location | must be on a **public URL** when publishing | [verified 12 Oct 2026] |
| Facebook Reels by API | 30 per rolling 24 h per Page | [from search, not opened] |
| Facebook Reels spec | 9:16, 3 to 90 seconds | [from search, not opened] |
| Platform music | added in the app, not by API | [not checked] |
| Facebook Groups | cannot be posted to automatically | [not checked] |

The "public URL" rule matters for us: the connector must give Meta a short-lived
**presigned GET** URL from R2 (ADR 0004). MinIO on a laptop is not public, so real
publishing from local dev needs a tunnel or a real R2 bucket.

### 1.6 Webhooks (keyword replies)

1. In the app, add **Webhooks** and pick the Instagram object, field `comments`. **[not checked: exact field name]**
2. Callback URL: our public webhook route. **To be confirmed by the build** (INSIGHTS module).
3. Verify token: the value of `META_WEBHOOK_VERIFY_TOKEN`.
4. Meta signs each call with the App Secret (header `X-Hub-Signature-256`). The API must check it. **[not checked]**

### 1.7 What blocks real posting

- **Access level.** Meta says **Standard Access** is enough for professional accounts you
  **own or manage** and have **added to your app** in the dashboard. **Advanced Access**
  is needed only for accounts you do not own. **[verified 12 Oct 2026]**
  Growth Desk posts only to Humini's own accounts, so Standard Access may be enough.
  Confirm this before planning an App Review.
- **App Review.** If we need Advanced Access, each permission goes through App Review
  (screencast + use case). A developer forum thread reports people failing to get Advanced
  Access for `instagram_business_content_publish`. **[from search, not opened]**
- **Business verification** of the Meta business portfolio may be required. **[not checked]**

---

## 2. Google (YouTube)

### 2.1 Create the project

1. Google Cloud Console: create a project, for example `growth-desk`.
2. Enable **YouTube Data API v3**.
3. **OAuth consent screen**: type External (or Internal if all users are in our Google Workspace).
   Add the scopes below. Add test users while the app is in "Testing". **[not checked: Testing token expiry rules]**
4. **Credentials > Create OAuth client ID**, type "Web application".
   Add the redirect URI (section 0). Copy client ID and secret to `.env`.
5. Sign in with the Google account that owns the YouTube channel (or a manager of it).

### 2.2 Scopes

| Need | Scope | Mark |
|---|---|---|
| Upload | `https://www.googleapis.com/auth/youtube.upload` | [verified 12 Oct 2026] on the `videos.insert` page |
| Read channel analytics | `https://www.googleapis.com/auth/yt-analytics.readonly` | [not checked] |

`videos.insert` also accepts `youtube`, `youtubepartner` or `youtube.force-ssl`. Use the
smallest one (`youtube.upload`). **[verified 12 Oct 2026]**

### 2.3 Quota

- The `videos.insert` page says: **100 calls per day**, and each call costs **1 unit in the
  "Video Uploads" quota bucket**. **[verified 12 Oct 2026]**
- Older blog posts give other numbers (for example 1,600 units per upload, out of 10,000
  per day). Those look out of date. Check the real numbers in Cloud Console > Quotas.

### 2.4 What blocks real posting

- **Private uploads and audit.** Many guides say uploads from an unverified (unaudited)
  project stay **private** until the project passes a YouTube API compliance audit.
  But on 12 Oct 2026 the official `videos.insert` page says: "Videos uploaded from unverified
  API projects are not restricted to private viewing mode." It also says some uploads may
  default to private because of channel settings.
  **This is a conflict. Test with one real upload before you promise public posting.**
- **OAuth app verification.** `youtube.upload` is a sensitive or restricted scope, so the
  consent screen may need Google verification before outside users can connect. **[not checked]**
- **More quota** needs a quota extension request (an audit form). **[not checked]**

---

## 3. LinkedIn

Two different needs:

| Need | LinkedIn product | Scope | Approval |
|---|---|---|---|
| Post as **Elan** (a member) | **Share on LinkedIn** | `w_member_social` | Self-serve: add the product in the portal **[verified 12 Oct 2026]** |
| Post as the **company page** | **Community Management API** | `w_organization_social` (read: `r_organization_social`) | Apply; LinkedIn reviews **[verified 12 Oct 2026]** |

### 3.1 Create the app

1. LinkedIn Developer Portal (linkedin.com/developers): **Create app**.
2. Link it to the Humini (or Arus) **LinkedIn company page**. A page admin must confirm. **[not checked]**
3. **Auth** tab: add the redirect URI (section 0). Copy client ID and secret to `.env`.
4. **Products** tab:
   - add **Share on LinkedIn** (gives `w_member_social`);
   - request **Community Management API** (for the company page).

### 3.2 Community Management API tiers **[verified 12 Oct 2026]**

| Tier | Limits | How |
|---|---|---|
| Development (default after approval) | 500 calls per app per 24 h; 100 calls per member per 24 h; no BATCH_GET; no social-action webhooks; must finish within 12 months | Apply for Community Management API |
| Standard | no restrictions | Apply again for Standard tier |

- The member who connects must hold a **role on the company page** (for example administrator)
  to post as the page. **[verified 12 Oct 2026]**
- LinkedIn "reserves the right" to refuse even when you meet the rules. **[verified 12 Oct 2026]**
- LinkedIn Marketing API version **202510 sunsets on 15 Oct 2026**. The connector must send a
  current `LinkedIn-Version` header. **[verified 12 Oct 2026]**
- The Share on LinkedIn page still shows the older `ugcPosts` endpoint and was last updated
  in 2023. Use the current **Posts API** with a version header. **[not checked: Posts API details]**
- Share on LinkedIn rate limit: 150 requests per member per day. **[verified 12 Oct 2026]**

### 3.3 What blocks real posting

- Company page posting is blocked until **Community Management API** is approved.
  Until then the LinkedIn channel shows `needs_approval` (as in the Figma Publish screen).

---

## 4. WhatsApp

- **WhatsApp Channels: no official posting API found.** Search on 12 Oct 2026 found no
  Meta announcement. Only unofficial gateways (Whapi.Cloud, WAHA) claim it, using a linked
  phone session. **We do not use them** (terms-of-service risk, not sanctioned). **[from search, not opened]**
- So in Growth Desk WhatsApp is **reminder only**: at publish time the owner gets a reminder
  with the ready file, and posts by hand. The channel account status is `manual`.
- **Opt-in messages** (later): WhatsApp Business Platform (Cloud API). Needs a business phone
  number, message templates approved by Meta, user consent, and per-message charges. **[not checked]**
- Nothing to create in a console for v1.

---

## 5. X (Twitter)

Not in v1. Same pattern later: one connector. Added only when a product's plan asks for it.

---

## 6. After setup: a short check list

- [ ] `.env` has the keys for each platform you set up (never commit `.env`)
- [ ] Redirect URIs match exactly in each console
- [ ] In Growth Desk > Integrations, press Connect for each channel; status shows `connected` or `needs_approval`
- [ ] Post one test piece to a private or test account first
- [ ] Write the date and result of each check in this file (decision 06 in the brainstorm)

## 7. Sources checked on 12 Oct 2026

- Meta, Instagram Content Publishing: https://developers.facebook.com/docs/instagram-platform/content-publishing
- Meta, Business Login for Instagram: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/business-login
- Meta, Reels Publishing API (search summary only): https://developers.facebook.com/docs/video-api/guides/reels-publishing
- Google, YouTube `videos.insert`: https://developers.google.com/youtube/v3/docs/videos/insert
- LinkedIn, Share on LinkedIn: https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/share-on-linkedin
- LinkedIn, Increasing Access: https://learn.microsoft.com/en-us/linkedin/marketing/increasing-access
