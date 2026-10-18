# Fairshare

An iPhone-first expense-sharing app for small private groups. Built with React, TypeScript, Vite, IndexedDB, and Supabase. It uses its own name and design; it is not affiliated with Splitwise.

Source: [eric2364/fairshare](https://github.com/eric2364/fairshare). The GitHub Pages deployment target is [eric2364.github.io/fairshare/](https://eric2364.github.io/fairshare/); availability follows a successful deployment workflow.

## Run locally

Use Node.js 22 or newer and npm.

```sh
npm ci
cp .env.example .env.local
npm run dev
```

Open the local URL printed by Vite. The app defaults to the connected Fairshare Supabase project. You can still use it without signing in: those groups stay in this browser and are not shared automatically. Export backups before clearing browser data or changing devices.

```sh
npm test
npm run test:db
npm run build
npm run preview
```

The production build is written to `dist/`. Changes to environment variables require restarting Vite or rebuilding the deployment.

## Supabase configuration

The default backend is the Fairshare project [`scsfgdtaqktyweyaomph`](https://supabase.com/dashboard/project/scsfgdtaqktyweyaomph), at `https://scsfgdtaqktyweyaomph.supabase.co`. Its project URL and browser-safe publishable key are in `src/lib/deployment.ts`. The initial schema has been applied; the live SQL integration checks passed and their test records were rolled back.

The publishable key is intentionally public. User authentication, group membership checks, database permissions, and row-level security protect private data. Never put a Supabase secret key, service-role key, database password, or GitHub token in frontend code or `VITE_` variables. [Supabase API key guidance](https://supabase.com/docs/guides/api/api-keys)

To use a different project:

1. Create or select a Supabase project you control.
2. Apply all SQL files in `supabase/migrations/` in filename order using the Supabase SQL editor or CLI. Read migrations before applying them to an existing project. Besides the expense-sharing schema, the helper-hardening migration revokes public execution of Supabase's internal `rls_auto_enable()` helper when it exists.
3. Set both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`. Despite the legacy variable name, use the browser-safe publishable key. Non-empty values override the bundled defaults; leaving them blank uses Fairshare's default project.
4. In Supabase Authentication, set the Site URL to `https://eric2364.github.io/fairshare/` (or your own deployment) and allow the exact local and deployed redirect URLs used for sign-in.
5. Choose the project's email-confirmation policy and configure email delivery as needed. The application follows the project's Auth settings; it does not assume confirmation is disabled or custom SMTP is configured.
6. Restart Vite or rebuild, then verify that one account can invite another, both can see their group, and an unrelated account cannot read it.

## Use it on iPhone

Deploy `dist/` to an HTTPS static host, or serve it through a trusted HTTPS development URL. Opening a plain `http://192.168…` development address is useful for layout checks but does not provide the secure context needed for reliable service-worker/PWA behavior.

On the iPhone, open the HTTPS address in Safari, use Share → Add to Home Screen, and launch Fairshare from its icon. Sign in and load the groups you need before going offline. Friends use the same deployed URL and their own accounts; a private GitHub repository alone does not make a hosted site private.

Keep the app open and connected when synchronizing. Do not assume iOS will run background sync after the app closes. Browser storage can be cleared or evicted; export backups and confirm shared changes have reached the server before relying on another device.

## Sharing and synchronization

Signed-in accounts and local mode use separate browser storage scopes. Signing in does not automatically publish local groups. Sync runs while the app is open; there is no realtime subscription or guaranteed closed-app background sync.

Invitation links expire after seven days and can be used once by a new group member. Add the person under Members, then create an invitation for their unclaimed place. When they join, their expenses and balances stay attached to that person. Any existing group member can invite others. Treat an invitation link as access to the group and share it only with the intended person.

Each local group snapshot also has a version token. Saving from an outdated tab is rejected before it can replace newer local data; reload or sync and re-enter the change. Sync requests use the access token captured for their originating account, so switching accounts cannot redirect an in-flight request into another account.

Each group has a server revision. Concurrent edits are detected rather than silently overwriting the server. A conflict preserves the local changes; export a backup before discarding the local version and loading the server version. Automatic merging of simultaneous edits is outside this initial version.

## Currencies and appearance

Choose the currencies used by a group when creating it; HKD, JPY, TWD and USD are selected by default. Use the group's Currencies button to adjust this later. The default currency and any currency already used by an expense or repayment must remain selected. Older groups without a saved selection keep all supported currencies available until configured.

Choose a currency for each expense, including when editing an existing expense. The group's currency is the default for new entries and the fallback for older expenses and repayments that have no currency field. Existing data keeps its original meaning.

Expense totals, member balances, and suggested repayments are shown separately for each currency. Recording a suggested repayment saves that currency with the payment. There is no exchange-rate conversion or combined balance across currencies. Supported currencies are HKD, JPY, TWD, USD, EUR, GBP, SGD, AUD, and CAD. JPY is entered and split in whole yen; the other currencies support two decimal places. Changing an entry's currency changes its denomination, not its exchange value.

In Settings → Appearance, choose System, Light, or Dark. System follows your device's appearance, including changes while the app is open. Your choice is saved in this browser and does not change other people's settings.

## Backups and restore

Export the current space from Settings. Restore validates the whole backup first, then asks you to review imported groups. Each restored group is a new independent copy, so it cannot overwrite a shared original. When signed in, select which member represents you in each imported group. Existing account links are removed; invite friends again for the new copies.

To resolve a sync conflict, export the affected local group first. The conflict banner offers a confirmed “Use shared version” action that discards the local copy and reloads the server version. Re-enter any changes you want to keep after reviewing the backup.

## Maintain on GitHub

Commit source, migrations, and `package-lock.json`. Keep `.env.local`, credentials, build output, and `node_modules/` out of Git. The source repository may be public; private group data stays in browser storage and the configured Supabase database, never in the repository.

The GitHub Actions workflow runs `npm ci`, unit tests, database security tests, and the production build for pushes and pull requests. Configure required status checks on the main branch. Run the same checks locally before merging changes. Apply database migrations separately from frontend deployment, and record which migrations were applied to each Supabase project.

### GitHub Pages deployment

The `pages.yml` workflow tests and builds pushes to `main`, then publishes `dist/` to GitHub Pages. It can also be started manually from Actions.

1. In repository Settings → Pages, select **GitHub Actions** as the source.
2. The default Fairshare backend requires no Actions variables. To override it, add both `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` under Settings → Secrets and variables → Actions → Variables, using your project URL and browser-safe publishable key.
3. Push to `main` or manually run **Deploy to GitHub Pages**. Check that both build and deploy jobs succeed before sharing the site.

The deployment sets `BASE_PATH=/fairshare/` so assets and the installed PWA work under the repository URL. Local development defaults to `/`. To reproduce the Pages build locally:

```sh
BASE_PATH=/fairshare/ npm run build
npm run preview
```

The app uses the bundled Fairshare backend unless non-empty Actions variables override it. After changing these variables, run a fresh deployment to embed them. A GitHub Pages deployment does not apply database migrations; apply them to Supabase separately.

## Scope and operational limits

- Expenses and repayments are bookkeeping records; the app does not move money.
- Activity shows current expenses and repayments, not an immutable audit trail of every edit.
- Repayment recording settles the displayed suggested amount; very large balances are divided into multiple recordable payments. Entering a custom partial repayment is deferred.
- The first version has no receipt scanning, currency conversion, recurring expenses, or payment integration.
- Each expense and repayment has its own currency; balances and totals remain separate with no exchange-rate conversion.
- Monetary calculations use integer minor units and deterministic rounding.
- Offline access depends on previously loaded application assets and locally stored data.
- Invitation and sync functionality require a configured Supabase project and successful authentication.

Before relying on it for a trip, test equal and unequal splits, mixed-currency balances, settlement recording, two-account sharing, interrupted sync, simultaneous edits, and backup restore on the actual iPhones you plan to use.

## Current signup configuration

Email/password signup is enabled with email confirmation disabled, as approved for this friends-only app. Email addresses are not verified. Group access is still based on authenticated account IDs and private single-use invitation links, never on an email address. Share invitations directly with the intended person. Custom SMTP is not configured; email-based recovery and confirmation must be configured before enabling those features.
