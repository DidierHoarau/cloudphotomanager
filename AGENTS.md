# AGENTS.md

This file provides context for AI coding agents working on this repository.

## Repository Overview

`cloudphotomanager` is a photo management application with four sub-projects:

- **cloudphotomanager-server** — Node.js/TypeScript backend (Fastify, SQLite/PostgreSQL, OpenTelemetry)
- **cloudphotomanager-web** — Nuxt 4 / Vue 3 frontend (Pico CSS, Pinia, axios)
- **cloudphotomanager-proxy** — Reverse proxy configuration
- **cloudphotomanager-tools** — Shell scripts for image/video processing

## Architecture

```
cloudphotomanager-server/src/   # Backend API server
cloudphotomanager-web/          # Frontend SPA (Nuxt 4)
cloudphotomanager-proxy/        # Nginx/Caddy proxy config
cloudphotomanager-tools/        # Processing scripts (ffmpeg, ImageMagick)
```

## Key Conventions

### Sessions

`JWT_VALIDITY_DURATION` is 30 days (literal `2592000`, re-registered with
`addConfigField` so it survives `reload()`). The app has no absolute cap: the
custom `users/Auth.ts` signs `exp = now + JWT_VALIDITY_DURATION`, slides the
httpOnly cookie server-side at half-life and never enforces the inherited
`JWT_SESSION_MAX_DURATION` field. Keep the deviation in sync with the
[session policy](https://github.com/devopsplaybook-io/common-utils/blob/main/docs/auth-session-policy.md)
and the literal assertions in `Config.spec.ts`. common-utils is on `^2.12.0`
for the cross-device login-code toolkit (`LoginCodesRoutes`,
`createLoginCodesStoreCommonUtils`, the `LOGIN_CODE_*` config fields); the
session deviation above is still intentional and unchanged.

### Login with a code

The cross-device "login with a code" routes are mounted at
`/api/users/login-codes` only when `LOGIN_CODE_ENABLED` is true at boot
(`cloudphotomanager-server/src/users/LoginCodes.ts`). The approved `POST /poll`
response keeps the JWT out of the JSON body: a scoped `onSend` hook writes it
to the same signed httpOnly `token` cookie the password login uses and leaves a
constant sentinel in the body. The web never reads or stores a token for this
flow — after approval it reloads the session from the cookie.


### CSS Centralization (cloudphotomanager-web)

CSS design tokens are centralized in `cloudphotomanager-web/assets/css/variables.css`. All components and CSS files must use these variables instead of hardcoded values.

Token categories:

- `--color-*` — Color tokens (primary, text, border, background, status, accent)
- `--space-*` — Spacing tokens (em-based: xs, sm, md, base, xl, 2xl, 3xl)
- `--font-*` — Font size tokens (em-based: xs, sm, base, body, lg, xl)
- `--radius-*` — Border radius tokens (px-based: sm, md, lg, full)

Import chain:

1. `main.css` — Root import file, loads all CSS in order
2. `variables.css` — Design tokens (always after framework imports)
3. `shared.css` — Shared component styles using variables
4. `dialog.css` — Dialog component styles using variables

Dark mode is handled via `@media (prefers-color-scheme: dark)` in `variables.css` — only color tokens are overridden.

Never redefine Pico CSS framework variables (e.g. `--pico-*`). Custom variables fill gaps the framework doesn't cover.

### Build and Verification

After every code change, the LLM must verify that all three pass with 0 errors:

```bash
# Build (TypeScript compile, then type-check of the spec files)
cd cloudphotomanager-server && npm run build

# Linter (oxlint, default recommended preset)
cd cloudphotomanager-server && npx oxlint src/

# Tests (Jest with @swc/jest transform and v8 coverage)
cd cloudphotomanager-server && npm test
```

All three commands must pass before the task is considered complete.

After any dependency change, run `npm audit --omit=dev` in `cloudphotomanager-server`, `cloudphotomanager-web` and the root, and confirm no new advisories appear (accepted risks are recorded in the README "Dependency security notes" section).
