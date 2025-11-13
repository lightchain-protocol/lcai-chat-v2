# Lightchain AI Chat - Application Flow Documentation

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Authentication Flow](#authentication-flow)
3. [Chat Flow](#chat-flow)
4. [Subscription Management](#subscription-management)
5. [Database Schema](#database-schema)
6. [API Routes](#api-routes)
7. [Component Hierarchy](#component-hierarchy)
8. [State Management](#state-management)

---

## Architecture Overview

### Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Authentication**: NextAuth.js with SIWE (Sign-In with Ethereum)
- **Web3**: Wagmi + Viem + Reown AppKit
- **AI**: Vercel AI SDK
- **Database**: PostgreSQL with Drizzle ORM
- **State Management**: Zustand + SWR
- **Styling**: Tailwind CSS + shadcn/ui

### Key Features

- Web3 wallet authentication (SIWE)
- AI chat with streaming responses
- Blockchain-based subscriptions
- Multi-model support
- Usage tracking and entitlements
- Real-time message history

---

## Authentication Flow

### 1. Initial Page Load

```
User visits /
    ↓
app/layout.tsx (Root Layout)
    ├── ThemeProvider
    ├── Web3WalletProvider (Wagmi + Reown AppKit)
    │   └── SessionProvider (NextAuth)
    └── Children
```

### 2. Web3 Wallet Connection

```
User clicks "Connect Wallet"
    ↓
Reown AppKit Modal Opens
    ↓
User selects wallet (MetaMask, WalletConnect, etc.)
    ↓
Wallet connection established
    ↓
SIWE message generated
    ↓
User signs message in wallet
    ↓
POST /api/auth/callback/credentials
    ↓
app/(auth)/auth.ts - authorize() function
    ├── Verify SIWE signature
    ├── Extract wallet address
    ├── Check if user exists in DB
    │   ├── If exists: return user
    │   └── If not: create new user
    └── Create NextAuth session
```

**File**: `app/(auth)/auth.ts`

```typescript
// Key Flow
1. User signs SIWE message
2. SiweMessage.verify() validates signature
3. getUserByWallet() or createUser() in database
4. Session created with user ID and type
5. JWT token includes user.id and user.type
```

### 3. Middleware Protection

**File**: `middleware.ts`

```
Every request
    ↓
middleware.ts checks:
    ├── /ping → Allow (for health checks)
    ├── /api/auth/* → Allow
    ├── / (home) → Allow (shows greeting)
    ├── /chat/:id → Require auth or redirect to /
    └── /api/* → Require auth or redirect to /
```

---

## Chat Flow

### 1. Chat Page Initialization

```
User authenticated & visits /
    ↓
app/(chat)/page.tsx
    ├── Generate new chat UUID
    ├── Get model from cookie (or use default)
    └── Render <Chat /> component
```

### 2. Sending a Message

```
User types message in MultimodalInput
    ↓
User presses Enter or clicks Send
    ↓
components/chat.tsx - sendMessage()
    ├── Validate message
    ├── Check authentication
    ├── Add message to local state
    └── POST /api/chat
```

### 3. API Chat Route Processing

**File**: `app/(chat)/api/chat/route.ts`

```
POST /api/chat
    ↓
1. Parse request body (validate schema)
    ↓
2. Authenticate user (session check)
    ↓
3. Check rate limits
    ├── getMessageCountByUserId()
    └── Compare with entitlementsByUserType[userType].maxMessagesPerDay
    ↓
4. Get or create chat
    ├── getChatById()
    ├── If exists: verify ownership
    └── If new: saveChat() with generated title
    ↓
5. Save user message to database
    └── saveMessages()
    ↓
6. Create streaming response
    ├── createUIMessageStream()
    ├── streamText() from AI SDK
    │   ├── myProvider.languageModel(selectedChatModel)
    │   ├── systemPrompt()
    │   ├── convertToModelMessages()
    │   ├── maxOutputTokens from entitlements
    │   └── onFinish: calculate usage with TokenLens
    └── Return SSE stream
    ↓
7. On completion
    ├── Save AI response messages
    ├── Update chat.lastContext with usage
    └── Client refetches chat history
```

### 4. Client-Side Stream Handling

```
Response stream received
    ↓
components/chat.tsx - useChat hook
    ├── onData: process stream chunks
    │   ├── Text chunks → append to message
    │   ├── data-usage → update usage state
    │   └── Store in dataStream context
    ├── onFinish: mutate SWR cache
    └── onError: show toast notification
    ↓
Messages component re-renders with new data
```

### 5. Message Display

```
components/messages.tsx
    ↓
Maps over messages array
    ↓
For each message:
    └── components/message.tsx
        ├── Parse message parts
        ├── components/elements/conversation.tsx
        │   └── Render text, code, images, etc.
        ├── Show voting buttons
        ├── Show usage stats (tokens, cost)
        └── Message actions (copy, edit, etc.)
```

---

## Subscription Management

### 1. Subscription Check Flow

```
User connects wallet
    ↓
hooks/use-subscription.ts initializes
    ↓
Query blockchain contract
    ├── hasActiveSubscription()
    └── getSubscription() (tier, expiry, expired)
    ↓
Store in Wagmi query cache
```

### 2. Subscription Purchase Flow

```
User clicks "Upgrade" or visits pricing
    ↓
components/subscription-dialog.tsx opens
    ├── Display tier options from config/subscription.ts
    ├── Show monthly/yearly toggle
    └── Display features and prices
    ↓
User selects tier and clicks "Subscribe"
    ↓
hooks/use-subscription.ts - subscribe()
    ├── 1. Check wallet balance
    ├── 2. Parse price to Wei (parseEther)
    ├── 3. Simulate transaction
    │   └── contract.simulate.subscribe([tier, yearly])
    ├── 4. Send transaction
    │   └── walletClient.writeContract()
    ├── 5. Wait for confirmation
    │   └── publicClient.waitForTransactionReceipt()
    └── 6. Refetch subscription status
```

### 3. Smart Contract Integration

**File**: `hooks/use-subscription.ts`

```typescript
Key Functions:
1. contract.read.hasActiveSubscription([address])
   - Returns boolean

2. contract.read.getSubscription([address])
   - Returns [tier, expiryTimestamp, expired]

3. contract.write.subscribe([tier, yearly], { value })
   - Processes subscription payment
```

### 4. Entitlements System

**File**: `lib/ai/entitlements.ts`

```typescript
entitlementsByUserType = {
  regular: {
    maxMessagesPerDay: 100,
    availableChatModelIds: ["chat-model"],
    maxTokens: 4096,
  },
  // Future: Add premium tiers
};
```

**Usage in API**:

- Checked on every message send
- Limits max output tokens
- Controls available models
- Rate limiting per 24 hours

---

## Database Schema

### Entity Relationship Diagram

```
┌─────────────┐
│    User     │
├─────────────┤
│ id (PK)     │
│ wallet_addr │ (unique)
│ username    │
└──────┬──────┘
       │
       │ 1:N
       │
┌──────▼──────┐
│    Chat     │
├─────────────┤
│ id (PK)     │
│ userId (FK) │
│ title       │
│ visibility  │ (public/private)
│ lastContext │ (usage stats)
│ createdAt   │
└──────┬──────┘
       │
       │ 1:N
       │
┌──────▼──────────┐
│    Message      │
├─────────────────┤
│ id (PK)         │
│ chatId (FK)     │
│ role            │ (user/assistant)
│ parts           │ (JSON: text, code, etc.)
│ attachments     │
│ createdAt       │
└──────┬──────────┘
       │
       │ 1:1
       │
┌──────▼──────────┐
│      Vote       │
├─────────────────┤
│ chatId (FK)     │ (PK)
│ messageId (FK)  │ (PK)
│ isUpvoted       │
└─────────────────┘

┌─────────────────┐
│     Stream      │
├─────────────────┤
│ id (PK)         │
│ chatId (FK)     │
│ createdAt       │
└─────────────────┘
```

### Key Queries

**File**: `lib/db/queries.ts`

```typescript
// User operations
- getUserByWallet(address)
- createUser(address)

// Chat operations
- getChatById(id)
- getChatsByUserId(userId)
- saveChat(id, userId, title, visibility)
- deleteChatById(id)
- updateChatLastContextById(chatId, context)

// Message operations
- getMessagesByChatId(chatId)
- saveMessages(messages[])
- getMessageCountByUserId(userId, differenceInHours)

// Vote operations
- getVotesByChatId(chatId)
- voteMessage(chatId, messageId, isUpvoted)
```

---

## API Routes

### Authentication Routes

```
POST /api/auth/callback/credentials
  - SIWE authentication
  - Handled by NextAuth

POST /api/auth/signout
  - Sign out user
  - Clear session
```

### Chat Routes

```
POST /api/chat
  ├── Body: { id, message, selectedChatModel, selectedVisibilityType }
  ├── Auth: Required
  ├── Returns: SSE stream
  └── Rate limited by user type

DELETE /api/chat?id={chatId}
  ├── Auth: Required
  ├── Ownership check
  └── Returns: Deleted chat object

GET /api/chat/{id}/stream (future endpoint)
  └── Resume interrupted streams
```

### History Routes

```
GET /api/history
  ├── Auth: Required
  ├── Returns: User's chat list
  └── Paginated results
```

### Vote Routes

```
POST /api/vote
  ├── Body: { chatId, messageId, isUpvoted }
  ├── Auth: Required
  └── Returns: Vote object

GET /api/vote?chatId={chatId}
  ├── Auth: Required
  └── Returns: All votes for chat
```

---

## Component Hierarchy

### Layout Structure

```
app/layout.tsx (Root)
├── ThemeProvider
├── Web3WalletProvider
│   └── SessionProvider
│       └── Toaster (notifications)
│           └── Children
│
app/(chat)/layout.tsx
├── Pyodide Script (for code execution)
└── DataStreamProvider
    └── SidebarProvider
        ├── AppSidebar
        │   ├── SidebarHeader
        │   ├── SidebarHistory (chat list)
        │   │   └── SidebarHistoryItem[]
        │   └── SidebarUserNav
        │       └── ConnectWalletButton
        └── SidebarInset
            └── Children (chat pages)
```

### Chat Page Component Tree

```
app/(chat)/page.tsx
└── Chat
    ├── ChatHeader
    │   ├── ModelSelector
    │   ├── VisibilitySelector
    │   └── SidebarToggle
    │
    ├── Messages
    │   ├── Greeting (when no messages)
    │   │   └── ConnectWalletButton
    │   │
    │   └── Message[] (when messages exist)
    │       ├── MessageReasonning
    │       ├── elements/Conversation
    │       │   ├── elements/Context
    │       │   ├── elements/Response
    │       │   ├── elements/CodeBlock
    │       │   ├── elements/Image
    │       │   └── elements/Tool
    │       │
    │       └── MessageActions
    │           ├── Copy button
    │           ├── Edit button
    │           └── Vote buttons
    │
    ├── MultimodalInput
    │   ├── ModelSelector
    │   ├── Textarea (prompt)
    │   ├── PreviewAttachment[]
    │   ├── SubmitButton
    │   └── Usage Display
    │
    ├── SubscriptionDialog
    │   └── Pricing tiers
    │
    └── DataStreamHandler
```

---

## State Management

### 1. Global State (Zustand)

**File**: `store/index.ts`

```typescript
useAppStore: -isSubscriptionDialogOpen - setIsSubscriptionDialogOpen;
```

### 2. Server State (SWR)

```typescript
// Chat history
useSWR('/api/history', fetcher)
  - Cached list of user's chats
  - Revalidated on focus
  - Mutated after new message

// Votes
useSWR(`/api/vote?chatId=${id}`, fetcher)
  - Vote data for current chat
  - Revalidated after vote action
```

### 3. Blockchain State (Wagmi Query)

```typescript
// Subscription status
useQuery(['hasActiveSubscription', address])
  - Boolean: has active subscription
  - Refetched after subscription purchase

useQuery(['activeSubscription', address])
  - Tier, expiry timestamp, expired status
  - Transformed to readable format
```

### 4. AI Chat State (AI SDK)

```typescript
useChat({
  id,
  messages,
  onData,
  onFinish,
  onError
})
  - messages: Message[]
  - status: 'idle' | 'streaming' | 'error'
  - sendMessage()
  - regenerate()
  - stop()
  - resumeStream()
```

### 5. Form State (React State)

```typescript
// In Chat component
const [input, setInput] = useState("");
const [attachments, setAttachments] = useState([]);
const [usage, setUsage] = useState();
const [currentModelId, setCurrentModelId] = useState();
```

### 6. Data Stream Context

**File**: `components/data-stream-provider.tsx`

```typescript
DataStreamContext:
  - dataStream: StreamPart[]
  - setDataStream

Used for:
  - Receiving AI response chunks
  - Usage data
  - Tool call results
  - Custom data types
```

---

## Data Flow Diagram

### Complete Message Send Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER INTERACTION                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │ MultimodalInput│
                    │  - User types  │
                    │  - Clicks send │
                    └────────┬───────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  useChat hook  │
                    │  - sendMessage │
                    └────────┬───────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│                      CLIENT-SIDE PROCESSING                     │
├─────────────────────────────────────────────────────────────────┤
│ 1. Validate message                                             │
│ 2. Add to local state (optimistic update)                       │
│ 3. Prepare request body                                         │
│    - id, message, selectedChatModel, selectedVisibilityType     │
│ 4. POST /api/chat                                               │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                      NETWORK REQUEST                            │
│  POST /api/chat                                                 │
│  Headers: Cookie (session)                                      │
│  Body: { id, message, selectedChatModel, ... }                  │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SERVER-SIDE PROCESSING                       │
│  app/(chat)/api/chat/route.ts                                   │
├─────────────────────────────────────────────────────────────────┤
│ 1. Parse & validate request                                     │
│ 2. auth() - Get session                                         │
│ 3. Check entitlements                                           │
│    ├── getMessageCountByUserId()                                │
│    └── Compare with maxMessagesPerDay                           │
│ 4. Get or create chat                                           │
│    ├── getChatById()                                            │
│    └── saveChat() if new                                        │
│ 5. saveMessages() - user message                                │
│ 6. createStreamId()                                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     AI PROCESSING                               │
├─────────────────────────────────────────────────────────────────┤
│ createUIMessageStream({                                         │
│   execute: streamText({                                         │
│     model: myProvider.languageModel(modelId)                    │
│     system: systemPrompt()                                      │
│     messages: convertToModelMessages()                          │
│     maxOutputTokens: from entitlements                          │
│     onFinish: calculate usage                                   │
│   })                                                            │
│ })                                                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                    STREAMING RESPONSE                           │
│  SSE (Server-Sent Events)                                       │
├─────────────────────────────────────────────────────────────────┤
│ Chunk 1: { type: 'text', text: 'Hello' }                        │
│ Chunk 2: { type: 'text', text: ' world' }                       │
│ Chunk 3: { type: 'text', text: '!' }                            │
│ Chunk N: { type: 'data-usage', data: {...} }                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                  CLIENT STREAM HANDLING                         │
│  components/chat.tsx                                            │
├─────────────────────────────────────────────────────────────────┤
│ useChat({ onData: (chunk) => {                                 │
│   if (chunk.type === 'text') {                                  │
│     - Append to message                                         │
│     - Re-render Messages component                              │
│   }                                                             │
│   if (chunk.type === 'data-usage') {                            │
│     - setUsage(chunk.data)                                      │
│     - Display token count, cost                                 │
│   }                                                             │
│ }})                                                             │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                     STREAM COMPLETION                           │
├─────────────────────────────────────────────────────────────────┤
│ SERVER:                                                         │
│ - saveMessages() - AI response                                  │
│ - updateChatLastContextById() - usage stats                     │
│                                                                 │
│ CLIENT:                                                         │
│ - onFinish() callback                                           │
│ - mutate(historyKey) - refresh sidebar                          │
│ - Display complete message                                      │
└─────────────────────────────────────────────────────────────────┘
```

---

## Security & Authorization

### 1. Authentication Layers

```
Layer 1: NextAuth Session
  - JWT token in HTTP-only cookie
  - Contains user.id and user.type
  - Validated on every API request

Layer 2: Middleware
  - Protects /chat/:id and /api/* routes
  - Redirects unauthenticated users to /
  - Allows /api/auth/* always

Layer 3: API Route Guards
  - Each route calls auth()
  - Checks session existence
  - Returns 401 if unauthorized

Layer 4: Resource Ownership
  - Verifies userId matches resource owner
  - Returns 403 if forbidden
  - Prevents cross-user data access
```

### 2. Web3 Security

```
SIWE (Sign-In with Ethereum):
  1. Nonce generated server-side
  2. Message includes domain, address, nonce
  3. User signs with private key
  4. Server verifies signature cryptographically
  5. No password storage needed
  6. Non-repudiable authentication
```

### 3. Rate Limiting

```
Per-user message limits:
  - Checked in API route
  - getMessageCountByUserId(differenceInHours: 24)
  - Compare with entitlementsByUserType
  - Return 429 if exceeded
```

### 4. Input Validation

```
Zod schemas:
  - postRequestBodySchema (chat API)
  - Validates all input fields
  - Type-safe with TypeScript
  - Returns 400 on validation failure
```

---

## Key Hooks

### 1. useChat (AI SDK)

- Manages chat messages and streaming
- Handles optimistic updates
- Provides sendMessage, regenerate, stop functions

### 2. useSubscription

- Queries blockchain for subscription status
- Provides subscribe() function
- Auto-refetches after purchase

### 3. useAutoResume

- Resumes interrupted streams on page load
- Checks for incomplete messages
- Calls resumeStream() if needed

### 4. useChatVisibility

- Manages public/private chat visibility
- Syncs with server
- Updates in real-time

### 5. useWeb3Clients

- Provides publicClient (read blockchain)
- Provides walletClient (write transactions)
- Connected to current chain

### 6. useCurrentChain

- Returns current blockchain network
- Used for contract addresses
- Handles network switching

---

## Error Handling

### Custom Error Classes

**File**: `lib/errors.ts`

```typescript
ChatSDKError:
  Types:
    - unauthorized:chat
    - forbidden:chat
    - rate_limit:chat
    - bad_request:api
    - offline:chat

  Methods:
    - toResponse() - Returns Response object
    - Includes status code and error message
```

### Error Flow

```
Error occurs in API
    ↓
new ChatSDKError(type).toResponse()
    ↓
Response with status and JSON body
    ↓
Client fetchWithErrorHandlers catches
    ↓
useChat onError callback
    ↓
toast({ type: 'error', description })
    ↓
User sees notification
```

### Subscription Error Handling

```
Insufficient balance
  → "Insufficient balance" error
  → Show toast with message

Transaction rejected
  → Wallet rejects transaction
  → Show toast notification

Transaction failed
  → waitForTransactionReceipt() throws
  → Catch and display error
```

---

## Performance Optimizations

### 1. Server-Side Rendering (SSR)

- Initial page loads are server-rendered
- Faster first contentful paint
- SEO-friendly

### 2. Streaming Responses

- AI responses stream token-by-token
- User sees output immediately
- Lower perceived latency

### 3. Optimistic Updates

- Messages appear instantly in UI
- Rollback on error
- Better user experience

### 4. SWR Caching

- Chat history cached client-side
- Revalidate on focus
- Deduplicate requests

### 5. React Query (Wagmi)

- Blockchain data cached
- Automatic refetching
- Background updates

### 6. Code Splitting

- Dynamic imports for large components
- Lazy load Pyodide script
- Reduced initial bundle size

### 7. Debouncing & Throttling

- Message streaming throttled (100ms)
- Input debounced
- Reduces re-renders

---

## Environment Variables

### Required Variables

```bash
# Database
DATABASE_URL="postgresql://..."

# Authentication
AUTH_SECRET="random-secret-key"
NEXTAUTH_URL="https://chat.lightchain.ai"

# Web3
NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID="..."
NEXT_PUBLIC_SUBSCRIPTION_CONTRACT_ADDRESS="0x..."

# AI Provider
OPENROUTER_API_KEY="sk-..."

# Optional
NODE_ENV="production"
VERCEL_URL="..."
```

---

## Deployment Flow

### 1. Build Process

```bash
npm run build
  ↓
- Next.js optimizes pages
- Generates static assets
- Creates server bundles
- Type-checks with TypeScript
- Runs database migrations (if configured)
```

### 2. Database Migrations

```bash
npm run db:migrate
  ↓
- Reads migrations from lib/db/migrations/
- Executes SQL in order
- Updates _journal.json
- Creates tables if not exist
```

### 3. Production Deployment

```
Push to main branch
  ↓
Vercel/hosting platform detects change
  ↓
Install dependencies
  ↓
Run build command
  ↓
Deploy to production
  ↓
Update environment variables
  ↓
Health check (/ping)
  ↓
Live ✅
```

---

### Technical Improvements

1. Add Redis for rate limiting
2. Implement WebSocket for real-time updates
3. Add search functionality
4. Improve caching strategy
5. Add telemetry and monitoring
6. Add comprehensive logging
7. Optimize bundle size further

---

## Debugging Tips

### 1. Check Authentication

```typescript
// In any server component or API route
const session = await auth();
console.log("Session:", session);
```

### 2. Monitor Streaming

```typescript
// In components/chat.tsx
onData: (chunk) => {
  console.log("Stream chunk:", chunk);
};
```

### 3. Check Subscription Status

```typescript
// In component with wallet
const { hasActiveSubscription } = useSubscription();
console.log("Has subscription:", hasActiveSubscription.data);
```

### 4. Database Queries

```typescript
// Enable query logging
import { drizzle } from "drizzle-orm/node-postgres";
const db = drizzle(pool, { logger: true });
```

### 5. Network Requests

- Open DevTools Network tab
- Filter by "fetch/xhr"
- Check request/response payloads
- Look for SSE streams

---

## Common Issues & Solutions

### Issue: "Unauthorized" when sending message

**Solution**: Check if user is authenticated, session is valid

### Issue: Subscription not detected

**Solution**: Verify contract address, check wallet network

### Issue: Messages not streaming

**Solution**: Check API route, verify AI provider API key

### Issue: Chat history not loading

**Solution**: Check database connection, verify user ID

### Issue: Rate limit exceeded

**Solution**: Check entitlements, verify message count query

---

## Conclusion

This application demonstrates a modern, full-stack Web3-enabled AI chat platform with:

- ✅ Decentralized authentication (SIWE)
- ✅ Blockchain-based subscriptions
- ✅ Real-time AI streaming
- ✅ Comprehensive state management
- ✅ Production-ready architecture
- ✅ Type-safe implementation
- ✅ Excellent user experience

The architecture is modular, scalable, and maintainable, with clear separation of concerns and well-defined data flows.
