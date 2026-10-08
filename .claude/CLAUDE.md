# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Next.js 15 AI chat application built with React 19, using the Vercel AI SDK for streaming chat responses. The application connects to AI models via vLLM (OpenAI-compatible endpoint) and features a rich component library with AI-specific elements.

## Development Commands

### Essential Commands

- `npm run dev` - Start development server (http://localhost:3000)
- `npm run build` - Build production bundle
- `npm start` - Start production server
- `npm run lint` - Run ESLint (configured but uses Biome for actual linting)

### Database Commands

- `npx drizzle-kit generate` - Generate database migrations
- `npx drizzle-kit migrate` - Run database migrations
- `npx drizzle-kit studio` - Launch Drizzle Studio (database GUI)
- `npx tsx lib/db/migrate.ts` - Run migrations programmatically

### Linting

This project uses **Biome** (not ESLint) for linting and formatting, configured via `biome.jsonc`. The Biome config extends the "ultracite" preset with custom overrides:

- Excludes `components/ui`, `lib/utils.ts`, and `hooks/use-mobile.ts` from linting
- Console statements allowed for debugging
- Magic numbers and nested ternaries permitted
- Explicit `any` types allowed (but minimize usage)

To lint with Biome: `npx @biomejs/biome check` or use the Biome VS Code extension

## Architecture

### Tech Stack

- **Framework**: Next.js 15 (App Router, Partial Prerendering enabled)
- **React**: v19.0.0-rc (with React Server Components)
- **AI SDK**: Vercel AI SDK v5 (`ai` package) + `@ai-sdk/react`
- **AI Provider**: vLLM via OpenAI-compatible endpoint (`@ai-sdk/openai-compatible`)
- **Database**: PostgreSQL via Vercel Postgres + Drizzle ORM
- **Authentication**: NextAuth.js v5 (with guest and credential providers)
- **Styling**: Tailwind CSS v4 with custom design system
- **UI Components**: shadcn/ui with Radix UI primitives
- **Testing**: Playwright for E2E and API testing
- **Type Safety**: TypeScript with strict mode

### Key Environment Variables

Create a `.env.local` file with:

```
# AI Provider Configuration
AI_PROVIDER_BASE_URL=       # vLLM endpoint URL (e.g., http://localhost:8000/v1)
MODEL_NAME=                 # Model name from vLLM

# Database
POSTGRES_URL=               # PostgreSQL connection string

# Authentication
AUTH_SECRET=                # NextAuth secret (generate with: openssl rand -base64 32)

# Optional: Redis for resumable streams
REDIS_URL=                  # Redis connection string (optional)
```

### Project Structure

````
/app
  /(auth)                   - Authentication routes (login, register, guest)
    auth.ts                 - NextAuth configuration
    auth.config.ts          - NextAuth route/callback config
  /(chat)                   - Main chat application
    /api/chat/route.ts      - AI chat streaming endpoint
    /api/chat/[id]/stream/  - Stream resume endpoint
    /api/document/          - Document CRUD operations
    /api/files/upload/      - File upload handling
    /api/history/           - Chat history API
    /api/suggestions/       - Document suggestions API
    /api/vote/              - Message voting API
    /chat/[id]/page.tsx     - Individual chat page
    page.tsx                - New chat page
    layout.tsx              - Chat layout with sidebar
    actions.ts              - Server actions (e.g. selected-model cookie)
  layout.tsx                - Root layout with fonts, theme provider
  globals.css               - Tailwind styles and CSS variables

/components
  /ui                       - shadcn/ui base components (button, dialog, etc.)
  /elements                 - AI chat elements (message, conversation, code-block, etc.)
  chat.tsx                  - Main chat component with useChat hook
  messages.tsx              - Message list renderer
  multimodal-input.tsx      - Chat input with file upload support
  app-sidebar.tsx           - Main navigation sidebar

/lib
  /ai
    models.ts               - Model definitions
    providers.ts            - AI provider configuration (vLLM)
    prompts.ts              - System prompts
    /tools                  - AI tools (create-document, get-weather, etc.)
  /db
    schema.ts               - Drizzle database schema
    queries.ts              - Database query functions
    migrate.ts              - Migration runner
    /migrations             - SQL migration files
  types.ts                  - Shared TypeScript types
  utils.ts                  - Utility functions
  constants.ts              - App constants
  errors.ts                 - Error classes


## Key Architectural Patterns

### AI Chat Flow

**Server Side** (`app/(chat)/api/chat/route.ts`):

1. Request validation using Zod schema (`postRequestBodySchema`)
2. Authentication check via NextAuth
3. Rate limiting based on user type (guest vs. regular)
4. Chat ownership verification or creation
5. Message streaming via `streamText` from AI SDK
6. Usage tracking with TokenLens for token counting and cost estimation
7. Message persistence to PostgreSQL via Drizzle
8. Support for resumable streams (if Redis is configured)

**Client Side** (`components/chat.tsx`):

- Uses `useChat` hook from `@ai-sdk/react`
- Custom transport layer with error handling
- Real-time message rendering with auto-scroll
- File attachment support
- Message regeneration and editing
- Vote tracking per message

### AI Provider Configuration

The app uses a custom provider setup in `lib/ai/providers.ts`:

- **Production**: vLLM with OpenAI-compatible endpoint
- **Testing**: Mock models for Playwright tests
- Models are referenced by ID: `"chat-model"`, `"title-model"`

To change the AI provider:
1. Update `lib/ai/providers.ts` with new provider configuration
2. Update environment variables in `.env.local`
3. Update model IDs in `lib/ai/models.ts` if needed

### Database Schema

**Core Tables**:
- `User` - User accounts (email, password)
- `Chat` - Chat sessions (title, visibility, userId, lastContext for usage)
- `Message_v2` - Chat messages with parts (text, image, tool-call, etc.)
- `Vote_v2` - Message upvote/downvote tracking
- `Document` - Document storage (text, code, image, sheet)
- `Suggestion` - Document edit suggestions
- `Stream` - Resumable stream tracking

**Schema Migration Pattern**:
- Legacy tables (`Message`, `Vote`) are deprecated but retained
- New tables use `_v2` suffix
- Migration guide: https://chat-sdk.dev/docs/migration-guides/message-parts

### Authentication System

Uses NextAuth v5 with two providers:

1. **Credentials Provider** - Email/password authentication
   - Password hashing with `bcrypt-ts`
   - Timing-safe comparison with dummy password for non-existent users

2. **Guest Provider** - Anonymous access
   - Auto-creates guest users with pattern `guest-{timestamp}`
   - Guest users have lower rate limits

**Session Management**:
- JWT-based sessions
- Custom session fields: `user.id`, `user.type` (guest/regular)
- Middleware protects all routes except auth endpoints

### Message Parts System

Messages use a "parts" architecture (not simple `content` strings):

```typescript
type MessagePart =
  | { type: "text", text: string }
  | { type: "image", image: string | URL }
  | { type: "file", ... }
  | { type: "tool-call", ... }
  | { type: "tool-result", ... }
  | { type: "reasoning", ... }
````

This allows rich message composition with multiple content types.

### Component Patterns

**AI Elements** (`components/elements/`):

- Pre-built components for AI chat interfaces
- Use compound component pattern (e.g., `Conversation` + `ConversationContent`)
- Support variant-based styling via `class-variance-authority`
- Integrate with AI SDK hooks

**shadcn/ui Integration** (`components/ui/`):

- Base components from shadcn/ui
- Customizable in place (they're meant to be modified)
- Excluded from Biome linting
- Use Radix UI primitives under the hood

## Common Development Patterns

### Adding a New AI Tool

1. Create tool file in `lib/ai/tools/my-tool.ts`:

```typescript
import { tool } from "ai";
import { z } from "zod";

export const myTool = tool({
  description: "Description for the AI model",
  parameters: z.object({
    param: z.string(),
  }),
  execute: async ({ param }) => {
    // Tool implementation
    return result;
  },
});
```

2. Import and add to `streamText` call in `app/(chat)/api/chat/route.ts`:

```typescript
import { myTool } from "@/lib/ai/tools/my-tool";

streamText({
  tools: { myTool },
  // ...
});
```

### Adding a New API Route

1. Create route file: `app/(chat)/api/my-route/route.ts`
2. Export HTTP method handlers: `GET`, `POST`, `DELETE`, etc.
3. Use `auth()` for authentication checks
4. Use error classes from `lib/errors.ts` for consistent error responses
5. Add tests in `tests/routes/my-route.test.ts`

### Working with the Database

1. Update schema in `lib/db/schema.ts`
2. Generate migration: `npx drizzle-kit generate`
3. Review generated SQL in `lib/db/migrations/`
4. Run migration: `npx tsx lib/db/migrate.ts`
5. Update queries in `lib/db/queries.ts`

### Running Tests

Tests use Playwright with custom fixtures:

- `tests/fixtures.ts` - Custom test fixtures (authenticated page, etc.)
- `tests/pages/` - Page object models
- `tests/e2e/` - User flow tests
- `tests/routes/` - API endpoint tests

Tests run against mock models (see `lib/ai/models.mock.ts`) to avoid external dependencies.

## Important Configuration Notes

- **Partial Prerendering**: Enabled via `experimental.ppr: true` in `next.config.ts`
- **Webpack Externals**: Several packages are externalized to reduce bundle size
- **Image Optimization**: Configured for `avatar.vercel.sh` domain
- **Theme**: System theme by default, with light/dark mode support via `next-themes`
- **Fonts**: Geist and Geist Mono from `next/font/google`
- **Strict Type Checking**: Enabled in `tsconfig.json`
- **Path Aliases**: Use `@/` prefix for imports (e.g., `@/components/ui/button`)

## Middleware Behavior

`middleware.ts` handles:

- Authentication enforcement (redirects to guest auth if no session)
- Redirect authenticated users away from login/register pages
- `/ping` endpoint for Playwright health checks
- Bypasses auth routes to prevent loops

## Rate Limiting

Implemented in `lib/ai/entitlements.ts` based on user type:

- Guest users: Lower message limit per day
- Regular users: Higher message limit per day
- Enforced in `app/(chat)/api/chat/route.ts`

## Resumable Streams

Optional Redis-based stream resumption:

- Requires `REDIS_URL` environment variable
- Allows clients to resume interrupted streams
- Implemented in `app/(chat)/api/chat/[id]/stream/route.ts`
- Falls back gracefully if Redis is not configured

## Styling Conventions

- **Tailwind v4** with PostCSS
- **CSS Variables** for theming in `app/globals.css`
- **Dark Mode**: Uses `class` strategy via `next-themes`
- **Utility-first**: Use Tailwind utilities, combine with `cn()` helper
- **Component Variants**: Use `class-variance-authority` for variant props

## Code Quality

This project follows the **Ultracite** ruleset. Key practices:

- Use TypeScript types, avoid `any` when possible
- Prefer `const` for variables only assigned once
- Use arrow functions over function expressions
- Use template literals over string concatenation
- Use `===` and `!==` (not `==` and `!=`)
- Use Next.js `<Image>` component for images
- No async client components (use Server Components)
- Specify all React hook dependencies correctly
- Use semantic HTML over ARIA roles when possible
- Provide meaningful alt text for images
