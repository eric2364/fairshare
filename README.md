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

Open the local URL printed by Vite. With Supabase variables left empty, use local mode to try the app. Local data is stored in this browser, not automatically shared with other devices. Export backups before clearing browser data or changing devices.

```sh
npm test
npm run test:db
npm run build
npm run preview
```

The production build is written to `dist/`. Changes to environment variables require restarting Vite or rebuilding the deployment.

## Connect your Supabase project

1. Create or select a Supabase project you control.
2. Apply the SQL files in `supabase/migrations/` in filename order using the Supabase SQL editor or CLI. Read the migrations before applying them to an existing project.
3. Copy the project URL and browser-safe publishable/anon key into `.env.local` using the names in `.env.example`.
4. In Supabase Authentication, set the Site URL to `https://eric2364.github.io/fairshare/` and allow the exact local and deployed redirect URLs used for sign-in.
5. Configure email delivery for your invited users and test sign-in with separate accounts.
6. Rebuild the app and verify that one account can invite another, both can see their group, and an unrelated account cannot read it.

Only browser-safe project credentials belong in `VITE_` variables: Vite embeds them in the public JavaScript bundle. Never put a Supabase service-role key, secret API key, database password, or GitHub token in frontend configuration. Group access must be enforced by database policies and authenticated functions, not by hiding controls in the interface.

## Use it on iPhone

Deploy `dist/` to an HTTPS static host, or serve it through a trusted HTTPS development URL. Opening a plain `http://192.168…` development address is useful for layout checks but does not provide the secure context needed for reliable service-worker/PWA behavior.

On the iPhone, open the HTTPS address in Safari, use Share → Add to Home Screen, and launch Fairshare from its icon. Sign in and load the groups you need before going offline. Friends use the same deployed URL and their own accounts; a private GitHub repository alone does not make a hosted site private.

Keep the app open and connected when synchronizing. Do not assume iOS will run background sync after the app closes. Browser storage can be cleared or evicted; export backups and confirm shared changes have reached the server before relying on another device.

## Sharing and synchronization

Signed-in accounts and local mode use separate browser storage scopes. Signing in does not automatically publish local groups. Sync runs while the app is open; there is no realtime subscription or guaranteed closed-app background sync.

Invitation links expire after seven days and can be used once by a new group member. Add the person under Members, then create an invitation for their unclaimed place. When they join, their expenses and balances stay attached to that person. Any existing group member can invite others. Treat an invitation link as access to the group and share it only with the intended person.

Each group has a server revision. Concurrent edits are detected rather than silently overwriting the server. A conflict preserves the local changes; export a backup before discarding the local version and loading the server version. Automatic merging of simultaneous edits is outside this initial version.

## Backups and restore

Export the current space from Settings. Restore validates the whole backup first, then asks you to review imported groups. Each restored group is a new independent copy, so it cannot overwrite a shared original. When signed in, select which member represents you in each imported group. Existing account links are removed; invite friends again for the new copies.

To resolve a sync conflict, export the affected local group first. The conflict banner offers a confirmed “Use shared version” action that discards the local copy and reloads the server version. Re-enter any changes you want to keep after reviewing the backup.

## Maintain on GitHub

Commit source, migrations, and `package-lock.json`. Keep `.env.local`, credentials, build output, and `node_modules/` out of Git. The source repository may be public; private group data stays in browser storage and the configured Supabase database, never in the repository.

The GitHub Actions workflow runs `npm ci`, unit tests, database security tests, and the production build for pushes and pull requests. Configure required status checks on the main branch. Run the same checks locally before merging changes. Apply database migrations separately from frontend deployment, and record which migrations were applied to each Supabase project.

### GitHub Pages deployment

The `pages.yml` workflow tests and builds pushes to `main`, then publishes `dist/` to GitHub Pages. It can also be started manually from Actions.

1. In repository Settings → Pages, select **GitHub Actions** as the source.
2. In Settings → Secrets and variables → Actions → Variables, add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` with your project URL and browser-safe publishable/anon key.
3. Push to `main` or manually run **Deploy to GitHub Pages**. Check that both build and deploy jobs succeed before sharing the site.

The deployment sets `BASE_PATH=/fairshare/` so assets and the installed PWA work under the repository URL. Local development defaults to `/`. To reproduce the Pages build locally:

```sh
BASE_PATH=/fairshare/ npm run build
npm run preview
```

The app operates in local mode until the Supabase variables are supplied. After changing Actions variables, run a fresh deployment to embed them. A GitHub Pages deployment does not apply database migrations; apply them to Supabase separately.

## Scope and operational limits

- Expenses and repayments are bookkeeping records; the app does not move money.
- Activity shows current expenses and repayments, not an immutable audit trail of every edit.
- Repayment recording currently settles a suggested full balance; entering partial repayments is deferred.
- The first version has no receipt scanning, currency conversion, recurring expenses, or payment integration.
- Use one currency per group. Balances in different currencies must not be added together without explicit conversion.
- Monetary calculations use integer minor units and deterministic rounding.
- Offline access depends on previously loaded application assets and locally stored data.
- Invitation and sync functionality require a configured Supabase project and successful authentication.

Before relying on it for a trip, test equal and unequal splits, settlement recording, two-account sharing, interrupted sync, simultaneous edits, and backup restore on the actual iPhones you plan to use.
