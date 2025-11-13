# Lightchain AI Chat - Visual Flow Diagrams

## 🎯 Quick Reference: Complete User Journey

```
┌──────────────────────────────────────────────────────────────────────────┐
│                         USER JOURNEY FLOWCHART                           │
└──────────────────────────────────────────────────────────────────────────┘

        👤 User visits chat.lightchain.ai
                      │
                      ▼
        ┌─────────────────────────┐
        │   Landing Page (/)      │
        │   - Greeting displayed  │
        │   - No auth required    │
        └────────┬────────────────┘
                 │
                 ▼
        ┌────────────────────┐
        │  Connect Wallet?   │◄───────┐
        └────────┬───────────┘        │
                 │                     │
          ┌──────┴──────┐             │
          │             │             │
         YES           NO              │
          │             │             │
          │             └─────────────┘
          │
          ▼
┌─────────────────────────┐
│  Reown AppKit Modal     │
│  - Select wallet        │
│  - MetaMask, WC, etc.   │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────┐
│  Sign SIWE Message      │
│  "Sign to authenticate" │
└────────┬────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Authentication Processing      │
│  ✓ Verify signature             │
│  ✓ Create/fetch user from DB    │
│  ✓ Create NextAuth session      │
└────────┬────────────────────────┘
         │
         ▼
┌─────────────────────────────────┐
│  Chat Interface Unlocked        │
│  ✓ Can send messages            │
│  ✓ Can view history             │
│  ✓ Can manage chats             │
└────────┬────────────────────────┘
         │
         ├──────────────┬──────────────┬──────────────┐
         │              │              │              │
         ▼              ▼              ▼              ▼
    ┌────────┐    ┌─────────┐    ┌─────────┐   ┌──────────┐
    │ Send   │    │ View    │    │ Upgrade │   │ Manage   │
    │ Message│    │ History │    │ Plan    │   │ Settings │
    └────────┘    └─────────┘    └─────────┘   └──────────┘
```

---

## 🔐 Authentication Flow (Detailed)

```
┌─────────────────────────────────────────────────────────────────────┐
│                    WEB3 AUTHENTICATION FLOW                         │
└─────────────────────────────────────────────────────────────────────┘

   Browser                 Next.js Server           Database        Blockchain
      │                          │                      │                │
      │  1. Visit website        │                      │                │
      ├─────────────────────────>│                      │                │
      │                          │                      │                │
      │  2. Load Web3Provider    │                      │                │
      │<─────────────────────────┤                      │                │
      │                          │                      │                │
      │  3. Click "Connect"      │                      │                │
      ├──────────────────────────┼──────────────────────┼───────────────>│
      │                          │                      │                │
      │  4. Select Wallet        │                      │                │
      │<─────────────────────────┼──────────────────────┼────────────────┤
      │                          │                      │                │
      │  5. Request Connection   │                      │                │
      ├──────────────────────────┼──────────────────────┼───────────────>│
      │                          │                      │                │
      │  6. Wallet Connected     │                      │                │
      │<─────────────────────────┼──────────────────────┼────────────────┤
      │                          │                      │                │
      │  7. Generate SIWE msg    │                      │                │
      ├─────────────────────────>│                      │                │
      │                          │                      │                │
      │  8. Return message       │                      │                │
      │<─────────────────────────┤                      │                │
      │                          │                      │                │
      │  9. Sign message         │                      │                │
      ├──────────────────────────┼──────────────────────┼───────────────>│
      │                          │                      │                │
      │  10. Return signature    │                      │                │
      │<─────────────────────────┼──────────────────────┼────────────────┤
      │                          │                      │                │
      │  11. POST /api/auth      │                      │                │
      │     { message, sig }     │                      │                │
      ├─────────────────────────>│                      │                │
      │                          │                      │                │
      │                          │  12. Verify SIWE     │                │
      │                          │      signature       │                │
      │                          │                      │                │
      │                          │  13. Get/Create User │                │
      │                          ├─────────────────────>│                │
      │                          │                      │                │
      │                          │  14. Return User     │                │
      │                          │<─────────────────────┤                │
      │                          │                      │                │
      │                          │  15. Create Session  │                │
      │                          │      (JWT token)     │                │
      │                          │                      │                │
      │  16. Set Cookie          │                      │                │
      │<─────────────────────────┤                      │                │
      │                          │                      │                │
      │  ✅ AUTHENTICATED         │                      │                │
      │                          │                      │                │

SIWE Message Example:
┌─────────────────────────────────────────────────────────────┐
│ chat.lightchain.ai wants you to sign in with your          │
│ Ethereum account:                                           │
│ 0x1234...5678                                              │
│                                                            │
│ Sign in to Lightchain AI Chat                             │
│                                                            │
│ URI: https://chat.lightchain.ai                           │
│ Version: 1                                                │
│ Chain ID: 1                                               │
│ Nonce: a1b2c3d4e5                                        │
│ Issued At: 2024-01-15T10:30:00Z                          │
└─────────────────────────────────────────────────────────────┘
```

---

## 💬 Chat Message Flow (Detailed)

```
┌──────────────────────────────────────────────────────────────────────┐
│                      CHAT MESSAGE LIFECYCLE                          │
└──────────────────────────────────────────────────────────────────────┘

   User Input          Frontend           API Route          AI Provider      Database
       │                   │                   │                   │              │
       │  1. Type message  │                   │                   │              │
       ├──────────────────>│                   │                   │              │
       │                   │                   │                   │              │
       │  2. Press Enter   │                   │                   │              │
       ├──────────────────>│                   │                   │              │
       │                   │                   │                   │              │
       │                   │  3. Optimistic    │                   │              │
       │                   │     Update UI     │                   │              │
       │                   │                   │                   │              │
       │                   │  4. POST /api/chat│                   │              │
       │                   ├──────────────────>│                   │              │
       │                   │                   │                   │              │
       │                   │                   │  5. Auth check    │              │
       │                   │                   │                   │              │
       │                   │                   │  6. Rate limit    │              │
       │                   │                   │                   │              │
       │                   │                   │  7. Save user msg │              │
       │                   │                   ├──────────────────────────────────>│
       │                   │                   │                   │              │
       │                   │                   │  8. Build prompt  │              │
       │                   │                   │                   │              │
       │                   │                   │  9. Call AI API   │              │
       │                   │                   ├──────────────────>│              │
       │                   │                   │                   │              │
       │                   │                   │  10. Stream start │              │
       │                   │                   │<──────────────────┤              │
       │                   │                   │                   │              │
       │  ┌─ STREAMING ────│───────────────────│───────────────────│───────────┐  │
       │  │                │                   │                   │           │  │
       │  │ 11. Chunk 1    │                   │  "Hello"          │           │  │
       │  │<───────────────┼───────────────────┤<──────────────────┤           │  │
       │  │                │                   │                   │           │  │
       │  │ 12. Chunk 2    │                   │  " world"         │           │  │
       │  │<───────────────┼───────────────────┤<──────────────────┤           │  │
       │  │                │                   │                   │           │  │
       │  │ 13. Chunk N    │                   │  "!"              │           │  │
       │  │<───────────────┼───────────────────┤<──────────────────┤           │  │
       │  │                │                   │                   │           │  │
       │  └────────────────│───────────────────│───────────────────│───────────┘  │
       │                   │                   │                   │              │
       │                   │                   │  14. Stream end   │              │
       │                   │                   │<──────────────────┤              │
       │                   │                   │                   │              │
       │                   │                   │  15. Calculate    │              │
       │                   │                   │      usage        │              │
       │                   │                   │                   │              │
       │  16. Usage data   │                   │                   │              │
       │<──────────────────┼───────────────────┤                   │              │
       │                   │                   │                   │              │
       │                   │                   │  17. Save AI msg  │              │
       │                   │                   ├──────────────────────────────────>│
       │                   │                   │                   │              │
       │                   │                   │  18. Update usage │              │
       │                   │                   ├──────────────────────────────────>│
       │                   │                   │                   │              │
       │  19. ✅ Complete   │                   │                   │              │
       │<──────────────────┼───────────────────┤                   │              │
       │                   │                   │                   │              │
       │                   │  20. Refresh      │                   │              │
       │                   │      history      │                   │              │
       │                   │                   │                   │              │


Message Format (JSON):
┌──────────────────────────────────────────────┐
│ {                                            │
│   "id": "uuid-1234",                         │
│   "role": "user",                            │
│   "parts": [                                 │
│     {                                        │
│       "type": "text",                        │
│       "text": "What is AI?"                  │
│     }                                        │
│   ],                                         │
│   "createdAt": "2024-01-15T10:30:00Z"       │
│ }                                            │
└──────────────────────────────────────────────┘

Stream Response Format (SSE):
┌──────────────────────────────────────────────┐
│ data: {"type":"text","text":"AI"}            │
│                                              │
│ data: {"type":"text","text":" is"}          │
│                                              │
│ data: {"type":"text","text":"..."}          │
│                                              │
│ data: {"type":"data-usage","data":{...}}    │
└──────────────────────────────────────────────┘
```

---

## 💳 Subscription Flow (Detailed)

```
┌──────────────────────────────────────────────────────────────────────┐
│                      SUBSCRIPTION LIFECYCLE                          │
└──────────────────────────────────────────────────────────────────────┘

   User              Frontend          Smart Contract        Database
    │                    │                     │                 │
    │  1. Open pricing   │                     │                 │
    ├───────────────────>│                     │                 │
    │                    │                     │                 │
    │                    │  2. Load current    │                 │
    │                    │     subscription    │                 │
    │                    ├────────────────────>│                 │
    │                    │                     │                 │
    │                    │  3. Return status   │                 │
    │                    │<────────────────────┤                 │
    │                    │                     │                 │
    │  4. Display tiers  │                     │                 │
    │<───────────────────┤                     │                 │
    │                    │                     │                 │
    │  5. Select tier    │                     │                 │
    │  (Pro, Monthly)    │                     │                 │
    ├───────────────────>│                     │                 │
    │                    │                     │                 │
    │  6. Click Subscribe│                     │                 │
    ├───────────────────>│                     │                 │
    │                    │                     │                 │
    │                    │  7. Check balance   │                 │
    │                    ├────────────────────>│                 │
    │                    │                     │                 │
    │                    │  8. Balance OK      │                 │
    │                    │<────────────────────┤                 │
    │                    │                     │                 │
    │                    │  9. Simulate tx     │                 │
    │                    ├────────────────────>│                 │
    │                    │                     │                 │
    │                    │  10. Simulation OK  │                 │
    │                    │<────────────────────┤                 │
    │                    │                     │                 │
    │  11. Wallet popup  │                     │                 │
    │  "Confirm tx"      │                     │                 │
    │<───────────────────┤                     │                 │
    │                    │                     │                 │
    │  12. User confirms │                     │                 │
    ├───────────────────>│                     │                 │
    │                    │                     │                 │
    │                    │  13. Send tx        │                 │
    │                    ├────────────────────>│                 │
    │                    │                     │                 │
    │                    │  14. Tx hash        │                 │
    │                    │<────────────────────┤                 │
    │                    │                     │                 │
    │  15. "Processing"  │                     │                 │
    │<───────────────────┤                     │                 │
    │                    │                     │                 │
    │                    │  16. Wait for       │                 │
    │                    │      confirmation   │                 │
    │                    ├────────────────────>│                 │
    │                    │                     │                 │
    │                    │     ⏳ Mining...     │                 │
    │                    │                     │                 │
    │                    │  17. Confirmed!     │                 │
    │                    │<────────────────────┤                 │
    │                    │                     │                 │
    │                    │  18. Update cache   │                 │
    │                    │                     │                 │
    │  19. ✅ Success!    │                     │                 │
    │  "Subscribed"      │                     │                 │
    │<───────────────────┤                     │                 │
    │                    │                     │                 │
    │                    │  20. Refetch status │                 │
    │                    ├────────────────────>│                 │
    │                    │                     │                 │
    │                    │  21. New tier data  │                 │
    │                    │<────────────────────┤                 │
    │                    │                     │                 │

Smart Contract Methods:
┌────────────────────────────────────────────────────┐
│ hasActiveSubscription(address) → bool              │
│ getSubscription(address) → (tier, expiry, expired) │
│ subscribe(tier, yearly) payable                    │
└────────────────────────────────────────────────────┘

Subscription Tiers:
┌────────┬──────────┬──────────┬─────────────────────┐
│ Tier   │ Monthly  │ Yearly   │ Features            │
├────────┼──────────┼──────────┼─────────────────────┤
│ Basic  │ 2 ETH    │ 20 ETH   │ 100 msg/mo          │
│ Pro    │ 5 ETH    │ 50 ETH   │ Unlimited           │
│ Enter. │ 10 ETH   │ 100 ETH  │ Everything          │
└────────┴──────────┴──────────┴─────────────────────┘
```

---

## 🗂️ Component Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                      COMPONENT TREE                               │
└───────────────────────────────────────────────────────────────────┘

app/layout.tsx (Root Layout)
│
├─ ThemeProvider
│  └─ Dark/Light mode management
│
├─ Web3WalletProvider
│  ├─ Wagmi configuration
│  ├─ Reown AppKit setup
│  └─ QueryClient for blockchain queries
│
├─ SessionProvider (NextAuth)
│  └─ Authentication state
│
└─ Toaster
   └─ Toast notifications

app/(chat)/layout.tsx (Chat Layout)
│
├─ Pyodide Script
│  └─ Python code execution
│
├─ DataStreamProvider
│  └─ AI streaming context
│
└─ SidebarProvider
   │
   ├─ AppSidebar
   │  │
   │  ├─ SidebarHeader
   │  │  └─ Logo
   │  │
   │  ├─ SidebarHistory
   │  │  └─ SidebarHistoryItem[]
   │  │     ├─ Chat title
   │  │     ├─ Timestamp
   │  │     └─ Delete button
   │  │
   │  └─ SidebarUserNav
   │     ├─ ConnectWalletButton
   │     ├─ Account dropdown
   │     └─ SignOutForm
   │
   └─ SidebarInset
      └─ Chat Page Content

app/(chat)/page.tsx (Main Chat)
│
└─ Chat Component
   │
   ├─ ChatHeader
   │  ├─ SidebarToggle
   │  ├─ ModelSelector
   │  │  └─ Dropdown with available models
   │  └─ VisibilitySelector
   │     └─ Public/Private toggle
   │
   ├─ Messages
   │  │
   │  ├─ Greeting (if no messages)
   │  │  ├─ Welcome text
   │  │  └─ ConnectWalletButton
   │  │
   │  └─ Message[] (if messages exist)
   │     │
   │     ├─ MessageReasoning
   │     │  └─ AI thinking process
   │     │
   │     ├─ elements/Conversation
   │     │  │
   │     │  ├─ elements/Context
   │     │  │  └─ System/context messages
   │     │  │
   │     │  ├─ elements/Response
   │     │  │  └─ AI response text
   │     │  │
   │     │  ├─ elements/CodeBlock
   │     │  │  ├─ Syntax highlighting
   │     │  │  ├─ Copy button
   │     │  │  └─ Language badge
   │     │  │
   │     │  ├─ elements/Image
   │     │  │  └─ Image display
   │     │  │
   │     │  ├─ elements/Tool
   │     │  │  └─ Tool execution results
   │     │  │
   │     │  └─ elements/InlineCitation
   │     │     └─ Sources/references
   │     │
   │     └─ MessageActions
   │        ├─ Copy button
   │        ├─ Edit button (user messages)
   │        ├─ Regenerate (AI messages)
   │        └─ Vote buttons (up/down)
   │
   ├─ MultimodalInput
   │  │
   │  ├─ ModelSelector
   │  │  └─ Quick model switch
   │  │
   │  ├─ Textarea
   │  │  ├─ Auto-resize
   │  │  ├─ Placeholder
   │  │  └─ Keyboard shortcuts
   │  │
   │  ├─ PreviewAttachment[]
   │  │  ├─ File name
   │  │  ├─ File size
   │  │  └─ Remove button
   │  │
   │  ├─ AttachmentButton
   │  │  └─ File upload trigger
   │  │
   │  ├─ SubmitButton
   │  │  ├─ Send icon
   │  │  └─ Loading state
   │  │
   │  └─ UsageDisplay
   │     ├─ Token count
   │     ├─ Cost estimate
   │     └─ Model info
   │
   ├─ SubscriptionDialog
   │  ├─ Tier cards
   │  │  ├─ Name
   │  │  ├─ Price
   │  │  ├─ Features list
   │  │  └─ Subscribe button
   │  │
   │  ├─ Monthly/Yearly toggle
   │  └─ Current subscription badge
   │
   └─ DataStreamHandler
      └─ Process incoming stream data
```

---

## 🔄 State Management Flow

```
┌───────────────────────────────────────────────────────────────────┐
│                      STATE MANAGEMENT                             │
└───────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      GLOBAL STATE (Zustand)                     │
├─────────────────────────────────────────────────────────────────┤
│ useAppStore:                                                    │
│   - isSubscriptionDialogOpen: boolean                           │
│   - setIsSubscriptionDialogOpen: (open) => void                 │
│                                                                 │
│ Usage:                                                          │
│   const { setIsSubscriptionDialogOpen } = useAppStore()        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    SERVER STATE (SWR)                           │
├─────────────────────────────────────────────────────────────────┤
│ Chat History:                                                   │
│   useSWR('/api/history', fetcher)                               │
│   - Returns: Chat[]                                             │
│   - Revalidate: On focus                                        │
│   - Mutate: After new message                                   │
│                                                                 │
│ Votes:                                                          │
│   useSWR(`/api/vote?chatId=${id}`, fetcher)                     │
│   - Returns: Vote[]                                             │
│   - Revalidate: After vote                                      │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                  BLOCKCHAIN STATE (Wagmi)                       │
├─────────────────────────────────────────────────────────────────┤
│ Subscription Status:                                            │
│   useQuery(['hasActiveSubscription', address])                  │
│   - Returns: boolean                                            │
│   - Refetch: After purchase                                     │
│                                                                 │
│ Subscription Details:                                           │
│   useQuery(['activeSubscription', address])                     │
│   - Returns: { tier, expiryTimestamp, expired }                 │
│   - Transform: Map tier ID to name                              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                      AI CHAT STATE                              │
├─────────────────────────────────────────────────────────────────┤
│ useChat (AI SDK):                                               │
│   - messages: Message[]                                         │
│   - status: 'idle' | 'streaming' | 'error'                      │
│   - sendMessage(message)                                        │
│   - regenerate(messageId)                                       │
│   - stop()                                                      │
│   - resumeStream()                                              │
│                                                                 │
│ Message Flow:                                                   │
│   User input → Optimistic update → API call → Stream response  │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                       LOCAL STATE                               │
├─────────────────────────────────────────────────────────────────┤
│ Chat Component:                                                 │
│   const [input, setInput] = useState('')                        │
│   const [attachments, setAttachments] = useState([])            │
│   const [usage, setUsage] = useState()                          │
│   const [currentModelId, setCurrentModelId] = useState()        │
│                                                                 │
│ Message Component:                                              │
│   const [isEditing, setIsEditing] = useState(false)             │
│   const [editedContent, setEditedContent] = useState('')        │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                     CONTEXT STATE                               │
├─────────────────────────────────────────────────────────────────┤
│ DataStreamContext:                                              │
│   - dataStream: StreamPart[]                                    │
│   - setDataStream: (parts) => void                              │
│                                                                 │
│ Usage:                                                          │
│   - Store streaming chunks                                      │
│   - Process usage data                                          │
│   - Handle tool results                                         │
└─────────────────────────────────────────────────────────────────┘

State Update Flow:
┌─────────┐    ┌──────────┐    ┌────────────┐    ┌──────────┐
│ User    │───>│ Local    │───>│ Optimistic │───>│ Server   │
│ Action  │    │ State    │    │ Update     │    │ Request  │
└─────────┘    └──────────┘    └────────────┘    └─────┬────┘
                                                        │
                                                        ▼
┌─────────┐    ┌──────────┐    ┌────────────┐    ┌──────────┐
│ UI      │<───│ Rerender │<───│ Cache      │<───│ Server   │
│ Update  │    │          │    │ Update     │    │ Response │
└─────────┘    └──────────┘    └────────────┘    └──────────┘
```

---

## 🛣️ API Routes Map

```
┌───────────────────────────────────────────────────────────────────┐
│                        API ROUTES                                 │
└───────────────────────────────────────────────────────────────────┘

/api
│
├─ /auth
│  ├─ GET  /api/auth/callback/credentials  (SIWE authentication)
│  ├─ POST /api/auth/signout              (Sign out)
│  └─ GET  /api/auth/session              (Get current session)
│
├─ /chat
│  ├─ POST   /api/chat                    (Send message, get stream)
│  │  ├─ Auth: Required
│  │  ├─ Body: { id, message, model, visibility }
│  │  ├─ Rate limit: Check entitlements
│  │  └─ Returns: SSE stream
│  │
│  └─ DELETE /api/chat?id={chatId}        (Delete chat)
│     ├─ Auth: Required
│     ├─ Ownership: Check userId
│     └─ Returns: Deleted chat
│
├─ /history
│  └─ GET /api/history                    (Get user's chats)
│     ├─ Auth: Required
│     ├─ Query: ?cursor={cursor}
│     └─ Returns: { chats[], nextCursor }
│
├─ /vote
│  ├─ POST /api/vote                      (Vote on message)
│  │  ├─ Auth: Required
│  │  ├─ Body: { chatId, messageId, isUpvoted }
│  │  └─ Returns: Vote object
│  │
│  └─ GET /api/vote?chatId={chatId}       (Get chat votes)
│     ├─ Auth: Required
│     └─ Returns: Vote[]
│
└─ /files
   └─ POST /api/files/upload              (Upload file)
      ├─ Auth: Required
      ├─ Body: FormData
      ├─ Validation: Type, size
      └─ Returns: { url }

Response Codes:
┌──────┬──────────────────────────────────────┐
│ 200  │ Success                              │
│ 400  │ Bad Request (validation failed)      │
│ 401  │ Unauthorized (not authenticated)     │
│ 403  │ Forbidden (not owner)                │
│ 429  │ Rate Limit Exceeded                  │
│ 500  │ Internal Server Error                │
└──────┴──────────────────────────────────────┘
```

---

## 📊 Database Relationships

```
┌───────────────────────────────────────────────────────────────────┐
│                    DATABASE SCHEMA                                │
└───────────────────────────────────────────────────────────────────┘

┌─────────────────────────┐
│         User            │
├─────────────────────────┤
│ id (PK)          UUID   │
│ wallet_address   STRING │──┐
│ username         STRING │  │
│ created_at       TIME   │  │
└─────────────────────────┘  │
                             │
                             │ 1:N
                             │
                        ┌────▼────────────────────┐
                        │        Chat             │
                        ├─────────────────────────┤
                        │ id (PK)          UUID   │
                        │ user_id (FK)     UUID   │──┐
                        │ title            STRING │  │
                        │ visibility       ENUM   │  │
                        │ last_context     JSON   │  │
                        │ created_at       TIME   │  │
                        └─────────────────────────┘  │
                                                     │
                                                     │ 1:N
                                                     │
                                    ┌────────────────▼────────────────┐
                                    │          Message                │
                                    ├─────────────────────────────────┤
                                    │ id (PK)           UUID          │
                                    │ chat_id (FK)      UUID          │──┐
                                    │ role              STRING         │  │
                                    │ parts             JSON           │  │
                                    │ attachments       JSON           │  │
                                    │ created_at        TIME           │  │
                                    └─────────────────────────────────┘  │
                                                                         │
                                                                         │ 1:1
                                                                         │
                                    ┌────────────────────────────────────▼──┐
                                    │             Vote                      │
                                    ├───────────────────────────────────────┤
                                    │ chat_id (PK, FK)      UUID            │
                                    │ message_id (PK, FK)   UUID            │
                                    │ is_upvoted            BOOLEAN         │
                                    └───────────────────────────────────────┘

┌─────────────────────────┐
│        Stream           │
├─────────────────────────┤
│ id (PK)          UUID   │
│ chat_id (FK)     UUID   │──► References Chat.id
│ created_at       TIME   │
└─────────────────────────┘

Indexes:
  - user.wallet_address (UNIQUE)
  - chat.user_id
  - message.chat_id
  - message.created_at
  - stream.chat_id

Constraints:
  - ON DELETE CASCADE for foreign keys
  - NOT NULL for required fields
  - ENUM for visibility (public, private)
```

---

## ⚡ Performance Optimizations

```
┌───────────────────────────────────────────────────────────────────┐
│                  PERFORMANCE STRATEGIES                           │
└───────────────────────────────────────────────────────────────────┘

1. Server-Side Rendering (SSR)
   ┌────────────────────────────────────────┐
   │ Initial Load                           │
   ├────────────────────────────────────────┤
   │ ✓ Page rendered on server              │
   │ ✓ HTML sent to browser                 │
   │ ✓ Fast First Contentful Paint (FCP)    │
   │ ✓ SEO-friendly                         │
   └────────────────────────────────────────┘

2. Streaming Responses
   ┌────────────────────────────────────────┐
   │ AI Response Streaming                  │
   ├────────────────────────────────────────┤
   │ ✓ Token-by-token delivery              │
   │ ✓ Lower Time To First Token (TTFT)     │
   │ ✓ Progressive rendering                │
   │ ✓ Better perceived performance         │
   └────────────────────────────────────────┘

3. Optimistic Updates
   ┌────────────────────────────────────────┐
   │ User Action                            │
   ├────────────────────────────────────────┤
   │ 1. Update UI immediately               │
   │ 2. Send request to server              │
   │ 3. Rollback if error                   │
   │ ✓ Instant feedback                     │
   └────────────────────────────────────────┘

4. SWR Caching
   ┌────────────────────────────────────────┐
   │ Data Fetching                          │
   ├────────────────────────────────────────┤
   │ ✓ Stale-While-Revalidate strategy      │
   │ ✓ Automatic refetching                 │
   │ ✓ Deduplication                        │
   │ ✓ Background updates                   │
   └────────────────────────────────────────┘

5. Code Splitting
   ┌────────────────────────────────────────┐
   │ Bundle Optimization                    │
   ├────────────────────────────────────────┤
   │ ✓ Route-based splitting                │
   │ ✓ Dynamic imports                      │
   │ ✓ Lazy loading components              │
   │ ✓ Smaller initial bundle               │
   └────────────────────────────────────────┘

6. Database Optimization
   ┌────────────────────────────────────────┐
   │ Query Performance                      │
   ├────────────────────────────────────────┤
   │ ✓ Indexed columns                      │
   │ ✓ Efficient joins                      │
   │ ✓ Query result caching                 │
   │ ✓ Connection pooling                   │
   └────────────────────────────────────────┘
```

---

## 🔐 Security Architecture

```
┌───────────────────────────────────────────────────────────────────┐
│                     SECURITY LAYERS                               │
└───────────────────────────────────────────────────────────────────┘

Layer 1: Network Security
┌─────────────────────────────────────────┐
│ ✓ HTTPS only (TLS 1.3)                  │
│ ✓ CORS policies                         │
│ ✓ Rate limiting                         │
│ ✓ DDoS protection                       │
└─────────────────────────────────────────┘

Layer 2: Authentication
┌─────────────────────────────────────────┐
│ ✓ SIWE (Sign-In with Ethereum)          │
│ ✓ Cryptographic signature verification  │
│ ✓ NextAuth session management           │
│ ✓ HTTP-only cookies                     │
│ ✓ JWT tokens with expiration            │
└─────────────────────────────────────────┘

Layer 3: Authorization
┌─────────────────────────────────────────┐
│ ✓ Middleware route protection           │
│ ✓ API route guards                      │
│ ✓ Resource ownership checks             │
│ ✓ Role-based access (future)            │
└─────────────────────────────────────────┘

Layer 4: Input Validation
┌─────────────────────────────────────────┐
│ ✓ Zod schema validation                 │
│ ✓ Type checking (TypeScript)            │
│ ✓ Sanitization                          │
│ ✓ XSS prevention                        │
└─────────────────────────────────────────┘

Layer 5: Database Security
┌─────────────────────────────────────────┐
│ ✓ Parameterized queries (Drizzle ORM)   │
│ ✓ SQL injection prevention              │
│ ✓ Encrypted connections                 │
│ ✓ Access control                        │
└─────────────────────────────────────────┘

Layer 6: Smart Contract Security
┌─────────────────────────────────────────┐
│ ✓ Transaction simulation before send    │
│ ✓ Balance checks                        │
│ ✓ Gas estimation                        │
│ ✓ User confirmation required            │
└─────────────────────────────────────────┘
```

---

## 🚀 Deployment Flow

```
┌───────────────────────────────────────────────────────────────────┐
│                    CI/CD PIPELINE                                 │
└───────────────────────────────────────────────────────────────────┘

Developer           GitHub            Vercel            Production
    │                  │                 │                   │
    │  1. git push     │                 │                   │
    ├─────────────────>│                 │                   │
    │                  │                 │                   │
    │                  │  2. Webhook     │                   │
    │                  ├────────────────>│                   │
    │                  │                 │                   │
    │                  │                 │  3. Clone repo    │
    │                  │                 │                   │
    │                  │                 │  4. Install deps  │
    │                  │                 │     npm install   │
    │                  │                 │                   │
    │                  │                 │  5. Type check    │
    │                  │                 │     tsc --noEmit  │
    │                  │                 │                   │
    │                  │                 │  6. Lint          │
    │                  │                 │     biome check   │
    │                  │                 │                   │
    │                  │                 │  7. Build         │
    │                  │                 │     next build    │
    │                  │                 │                   │
    │                  │                 │  8. Run tests     │
    │                  │                 │     npm test      │
    │                  │                 │                   │
    │                  │                 │  9. Deploy        │
    │                  │                 ├──────────────────>│
    │                  │                 │                   │
    │                  │                 │  10. Health check │
    │                  │                 │      /ping        │
    │                  │                 │                   │
    │  11. Deploy URL  │                 │                   │
    │<─────────────────┼─────────────────┤                   │
    │                  │                 │                   │
    │  12. Test live   │                 │                   │
    ├──────────────────┼─────────────────┼──────────────────>│
    │                  │                 │                   │

Build Optimizations:
┌─────────────────────────────────────────┐
│ ✓ Static generation where possible      │
│ ✓ Incremental Static Regeneration (ISR) │
│ ✓ Image optimization                    │
│ ✓ Bundle analysis                       │
│ ✓ Tree shaking                          │
│ ✓ Minification                          │
└─────────────────────────────────────────┘
```

---

## 📱 Responsive Design

```
┌───────────────────────────────────────────────────────────────────┐
│                    RESPONSIVE BREAKPOINTS                         │
└───────────────────────────────────────────────────────────────────┘

Mobile (< 768px)
┌──────────────────────┐
│  [≡] Sidebar Hidden  │
│                      │
│  💬 Chat Messages    │
│  💬 Chat Messages    │
│  💬 Chat Messages    │
│                      │
│  [────────────]      │
│  [   Input   ] [>]   │
│  [────────────]      │
└──────────────────────┘

Tablet (768px - 1024px)
┌─────────┬─────────────────────┐
│ [≡]     │  💬 Chat Messages   │
│ Chats   │  💬 Chat Messages   │
│ • Chat1 │  💬 Chat Messages   │
│ • Chat2 │                     │
│ • Chat3 │  [──────────────]   │
│         │  [    Input    ] [>]│
│         │  [──────────────]   │
└─────────┴─────────────────────┘

Desktop (> 1024px)
┌───────────┬────────────────────────────┐
│ [≡] Sidebar│    💬 Chat Messages       │
│           │    💬 Chat Messages        │
│ 💬 Chats  │    💬 Chat Messages        │
│ • Chat 1  │                            │
│ • Chat 2  │    [──────────────────]    │
│ • Chat 3  │    [     Input      ] [>]  │
│ • Chat 4  │    [──────────────────]    │
│           │                            │
│ [Profile] │    Tokens: 150 | $0.001    │
└───────────┴────────────────────────────┘
```

---

This visual documentation should give you a clear understanding of how the Lightchain AI Chat application works, from user interactions to backend processing to blockchain integrations!
