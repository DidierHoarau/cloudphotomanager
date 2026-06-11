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
# Build (TypeScript compilation)
cd cloudphotomanager-server && npx tsc --noEmit

# Linter
cd cloudphotomanager-server && npx eslint src/

# Tests
cd cloudphotomanager-server && npm test
```

All three commands must pass before the task is considered complete.
