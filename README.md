# LCAI Chat v2

A modern AI chat application built with Next.js 15, featuring Web3 wallet authentication, streaming AI responses, and real-time collaboration. Powered by vLLM and the Vercel AI SDK.

## ✨ Features

- 🤖 **AI-Powered Chat** - Streaming responses with support for reasoning and tool usage
- 🔐 **Web3 Authentication** - Sign in with Ethereum wallet using SIWE (Sign-In with Ethereum)
- 💬 **Real-time Streaming** - Resumable AI response streams with Redis support
- 🗃️ **Chat History** - Persistent chat sessions stored in PostgreSQL
- 🎨 **Modern UI** - Beautiful, responsive interface with dark mode support
- ⚡ **Type-Safe** - Full TypeScript coverage with strict mode

## 🛠️ Tech Stack

- **Framework**: [Next.js 15](https://nextjs.org) (App Router, React 19)
- **AI SDK**: [Vercel AI SDK](https://sdk.vercel.ai) v5
- **AI Provider**: vLLM (OpenAI-compatible endpoint)
- **Database**: PostgreSQL (via [Neon](https://neon.tech) or Vercel Postgres)
- **ORM**: [Drizzle ORM](https://orm.drizzle.team)
- **Authentication**: [NextAuth.js v5](https://authjs.dev) with SIWE
- **Web3**: [Wagmi](https://wagmi.sh) + [Reown AppKit](https://reown.com)
- **Storage**: [Vercel Blob](https://vercel.com/docs/storage/vercel-blob)
- **Cache** (Optional): Redis via [Upstash](https://upstash.com)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com)
- **UI Components**: [shadcn/ui](https://ui.shadcn.com) with Radix UI
- **Code Quality**: [Biome](https://biomejs.dev) (linting & formatting)

## 📋 Prerequisites

- Node.js 18+ (v22.20.0 recommended)
- pnpm, npm, or yarn
- PostgreSQL database (Neon recommended for Vercel deployments)
- vLLM endpoint or compatible AI provider
- (Optional) Redis instance for resumable streams

## 🚀 Getting Started

### 1. Clone the Repository

```bash
git clone https://github.com/lightchain-protocol/lcai-chat-v2.git
cd lcai-chat-v2
```

### 2. Install Dependencies

```bash
pnpm install
# or
npm install
```

### 3. Set Up Environment Variables

Create a `.env.local` file in the root directory:

```bash
# AI Provider Configuration
AI_PROVIDER_BASE_URL=http://localhost:8000/v1  # Your vLLM endpoint
MODEL_NAME=your-model-name                      # Model name from vLLM

# Database
POSTGRES_URL=postgresql://user:pass@host:5432/db

# Authentication
AUTH_SECRET=your-secret-here                    # Generate: openssl rand -base64 32

# Optional: Redis for resumable streams
REDIS_URL=redis://localhost:6379

# Optional: Vercel Blob (auto-configured on Vercel)
# BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
```

### 4. Set Up the Database

Generate and run migrations:

```bash
# Generate migration files (if schema changed)
pnpm run db:generate

# Run migrations
pnpm run db:migrate

# Optional: Open Drizzle Studio to view database
pnpm run db:studio
```

### 5. Run Development Server

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) to see your application.

## 📝 Available Scripts

```bash
# Development
pnpm dev              # Start development server
pnpm build            # Build for production
pnpm start            # Start production server
pnpm lint             # Run linter (uses Biome)

# Database
pnpm db:generate      # Generate migrations from schema
pnpm db:migrate       # Run migrations
pnpm db:studio        # Open Drizzle Studio
pnpm db:push          # Push schema changes directly
pnpm db:pull          # Pull schema from database
pnpm db:check         # Check migration files
pnpm db:reset         # Reset migrations

```

## 🌐 Deploying to Vercel

### Option 1: Deploy via CLI

```bash
# Link to Vercel project
vercel link

# Pull environment variables
vercel env pull .env.local

# Deploy
vercel --prod
```

### Option 2: Deploy via GitHub

1. Push your code to GitHub
2. Import project on [Vercel](https://vercel.com/new)
3. Configure environment variables in Vercel dashboard
4. Deploy automatically on push

### Required Vercel Integrations

Your project uses these services (configured via `vercel-template.json`):

1. **Neon** (PostgreSQL)

   - Go to: Settings → Integrations → Add "Neon"
   - Automatically sets `POSTGRES_URL`

2. **Upstash KV** (Optional - Redis)
   - Go to: Settings → Integrations → Add "Upstash"
   - Automatically sets Redis environment variables

### Environment Variables on Vercel

Set these in **Settings → Environment Variables**:

| Variable               | Required    | Description                                               |
| ---------------------- | ----------- | --------------------------------------------------------- |
| `POSTGRES_URL`         | ✅ Yes      | PostgreSQL connection string (from Neon)                  |
| `AUTH_SECRET`          | ✅ Yes      | NextAuth secret (generate with `openssl rand -base64 32`) |
| `AI_PROVIDER_BASE_URL` | ✅ Yes      | Your vLLM endpoint URL                                    |
| `MODEL_NAME`           | ✅ Yes      | AI model name                                             |
| `REDIS_URL`            | ⚠️ Optional | Redis connection for resumable streams                    |

## 🏗️ Project Structure

```
lcai-chat-v2/
├── app/
│   ├── (auth)/              # Authentication routes
│   │   ├── auth.ts          # NextAuth configuration
│   │   └── api/auth/        # Auth API routes
│   ├── (chat)/              # Main chat application
│   │   ├── api/             # API routes
│   │   │   ├── chat/        # AI chat endpoints
│   │   │   ├── files/       # File upload
│   │   │   ├── history/     # Chat history
│   │   │   └── vote/        # Message voting
│   │   ├── chat/[id]/       # Individual chat pages
│   │   ├── actions.ts       # Server actions
│   │   ├── layout.tsx       # Chat layout with sidebar
│   │   └── page.tsx         # New chat page
│   ├── globals.css          # Global styles
│   └── layout.tsx           # Root layout
├── components/
│   ├── elements/            # AI-specific components
│   ├── ui/                  # shadcn/ui components
│   └── ...                  # Feature components
├── lib/
│   ├── ai/                  # AI configuration
│   │   ├── models.ts        # Model definitions
│   │   ├── prompts.ts       # System prompts
│   │   └── providers.ts     # vLLM provider setup
│   ├── db/                  # Database
│   │   ├── schema.ts        # Drizzle schema
│   │   ├── queries.ts       # Database queries
│   │   └── migrations/      # Migration files
│   ├── siwe/                # Sign-In with Ethereum
│   └── ...                  # Utilities
├── hooks/                   # React hooks
├── biome.jsonc              # Biome configuration
├── drizzle.config.ts        # Drizzle ORM config
├── next.config.ts           # Next.js configuration
├── tailwind.config.ts       # Tailwind CSS config
└── vercel-template.json     # Vercel integrations
```

## 🔧 Configuration

### Biome (Linting & Formatting)

This project uses Biome instead of ESLint/Prettier. Configuration in `biome.jsonc`:

```bash
# Check for issues
npx @biomejs/biome check

# Fix issues
npx @biomejs/biome check --write
```

### Code Quality

The project follows strict code quality rules via the Ultracite preset:

- Maximum type safety
- Accessibility (a11y) best practices
- React and Next.js best practices
- No TypeScript enums or namespaces
- Consistent code style

## 📚 Documentation

### 📖 Complete Documentation Suite

We've prepared comprehensive documentation to help you understand and work with this application:

- **[🏗️ APP_FLOW.md](./docs/APP_FLOW.md)** - Detailed architecture, flows, and system design
- **[👁️ VISUAL_FLOW_DIAGRAM.md](./docs/VISUAL_FLOW_DIAGRAM.md)** - Visual diagrams and flowcharts

### External Resources

- [Next.js Documentation](https://nextjs.org/docs)
- [Vercel AI SDK](https://sdk.vercel.ai/docs)
- [Drizzle ORM](https://orm.drizzle.team/docs/overview)
- [NextAuth.js](https://authjs.dev)
- [Wagmi](https://wagmi.sh)
- [Tailwind CSS](https://tailwindcss.com/docs)

## 🤝 Contributing

Contributions are welcome! Please follow the code quality guidelines before submitting a PR.

## 📄 License

This project is part of the Lightchain AI ecosystem.
