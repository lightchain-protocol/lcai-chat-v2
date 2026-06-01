/**
 * Minimal ABI for the JobRegistry contract.
 *
 * Contains only the functions and events needed by the frontend:
 *   - createSession / submitJob / claimTimeout / disputeJob (write)
 *   - getJob / getSession (view)
 *   - SessionCreated / JobSubmitted / JobCompleted / JobTimedOut / DisputeCreated (events)
 *   - InvalidDispatcherSignature / SignatureExpired / NotTimedOut / JobNotInState /
 *     DisputeWindowExpired / InsufficientDisputeBond / UnauthorizedDisputeCaller (errors)
 */
export const jobRegistryAbi = [
  {
    inputs: [
      { internalType: "bytes32", name: "modelId", type: "bytes32" },
      { internalType: "address", name: "worker", type: "address" },
      { internalType: "bytes", name: "encWorkerKey", type: "bytes" },
      { internalType: "bytes", name: "encDisputerKey", type: "bytes" },
      { internalType: "bytes", name: "dispatcherSignature", type: "bytes" },
      { internalType: "uint256", name: "expiry", type: "uint256" },
    ],
    name: "createSession",
    outputs: [{ internalType: "uint256", name: "sessionId", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  // ── Prepaid balance + delegated submission ──
  {
    inputs: [],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "delegate", type: "address" }],
    name: "depositAndAuthorize",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "amount", type: "uint256" }],
    name: "withdrawBalance",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "delegate", type: "address" },
      { internalType: "bool", name: "authorized", type: "bool" },
    ],
    name: "setDelegateAuthorization",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "delegate", type: "address" },
      { internalType: "uint256", name: "allowance", type: "uint256" },
    ],
    name: "setDelegateAllowance",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "user", type: "address" }],
    name: "prepaidBalanceOf",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "user", type: "address" },
      { internalType: "address", name: "delegate", type: "address" },
    ],
    name: "isDelegateAuthorized",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "user", type: "address" },
      { internalType: "address", name: "delegate", type: "address" },
    ],
    name: "delegateAllowance",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "sessionId", type: "uint256" },
      { internalType: "bytes32", name: "blobHash", type: "bytes32" },
    ],
    name: "submitJob",
    outputs: [{ internalType: "uint256", name: "jobId", type: "uint256" }],
    stateMutability: "payable",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "sessionId",
        type: "uint256",
      },
      { indexed: true, internalType: "address", name: "user", type: "address" },
      {
        indexed: true,
        internalType: "bytes32",
        name: "modelId",
        type: "bytes32",
      },
      {
        indexed: false,
        internalType: "address",
        name: "worker",
        type: "address",
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "encWorkerKey",
        type: "bytes",
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "encDisputerKey",
        type: "bytes",
      },
    ],
    name: "SessionCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "jobId",
        type: "uint256",
      },
      {
        indexed: true,
        internalType: "uint256",
        name: "sessionId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "address",
        name: "worker",
        type: "address",
      },
    ],
    name: "JobSubmitted",
    type: "event",
  },
  {
    inputs: [{ internalType: "uint256", name: "sessionId", type: "uint256" }],
    name: "getSession",
    outputs: [
      {
        components: [
          { internalType: "address", name: "user", type: "address" },
          { internalType: "bytes32", name: "modelId", type: "bytes32" },
          { internalType: "address", name: "worker", type: "address" },
          { internalType: "uint8", name: "status", type: "uint8" },
          { internalType: "bytes", name: "encWorkerKey", type: "bytes" },
          { internalType: "bytes", name: "encDisputerKey", type: "bytes" },
          { internalType: "uint256", name: "jobCount", type: "uint256" },
          { internalType: "uint256", name: "lastActivityAt", type: "uint256" },
          { internalType: "uint256", name: "reassignCount", type: "uint256" },
          { internalType: "uint256", name: "deposit", type: "uint256" },
        ],
        internalType: "struct IJobRegistry.Session",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "sessionId", type: "uint256" }],
    name: "reassignSession",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { internalType: "uint256", name: "sessionId", type: "uint256" },
      { internalType: "bytes", name: "encWorkerKey", type: "bytes" },
      { internalType: "bytes", name: "encDisputerKey", type: "bytes" },
    ],
    name: "updateSessionKey",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "sessionId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "address",
        name: "newWorker",
        type: "address",
      },
    ],
    name: "SessionReassigned",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      {
        indexed: true,
        internalType: "uint256",
        name: "sessionId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "encWorkerKey",
        type: "bytes",
      },
      {
        indexed: false,
        internalType: "bytes",
        name: "encDisputerKey",
        type: "bytes",
      },
    ],
    name: "SessionKeyUpdated",
    type: "event",
  },
  // ── claimTimeout ──────────────────────────────────────────────────────────
  {
    inputs: [{ internalType: "uint256", name: "jobId", type: "uint256" }],
    name: "claimTimeout",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  // ── disputeJob ────────────────────────────────────────────────────────────
  {
    inputs: [{ internalType: "uint256", name: "jobId", type: "uint256" }],
    name: "disputeJob",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  // ── getJob (view) ─────────────────────────────────────────────────────────
  {
    inputs: [{ internalType: "uint256", name: "jobId", type: "uint256" }],
    name: "getJob",
    outputs: [
      {
        components: [
          { internalType: "uint256", name: "sessionId", type: "uint256" },
          { internalType: "address", name: "worker", type: "address" },
          { internalType: "uint8", name: "state", type: "uint8" },
          { internalType: "uint256", name: "escrowedFee", type: "uint256" },
          { internalType: "bytes32", name: "promptBlobHash", type: "bytes32" },
          { internalType: "bytes32", name: "responseBlobHash", type: "bytes32" },
          { internalType: "uint256", name: "submittedAt", type: "uint256" },
          { internalType: "uint256", name: "ackTimestamp", type: "uint256" },
          { internalType: "uint256", name: "completedAt", type: "uint256" },
          { internalType: "uint256", name: "deadline", type: "uint256" },
          { internalType: "address", name: "disputeFiler", type: "address" },
          { internalType: "uint256", name: "disputeBond", type: "uint256" },
          { internalType: "bytes32", name: "reExecutionBlobHash", type: "bytes32" },
          { internalType: "uint256", name: "similarityScore", type: "uint256" },
          { internalType: "uint256", name: "disputeCreatedAt", type: "uint256" },
          { internalType: "bytes32", name: "responseCiphertextHash", type: "bytes32" },
          { internalType: "uint256", name: "submitBlockNumber", type: "uint256" },
          { internalType: "uint256", name: "completionBlockNumber", type: "uint256" },
        ],
        internalType: "struct IJobRegistry.Job",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  // ── Events ────────────────────────────────────────────────────────────────
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "jobId", type: "uint256" },
      { indexed: true, internalType: "address", name: "worker", type: "address" },
      { indexed: false, internalType: "bytes32", name: "responseBlobHash", type: "bytes32" },
      { indexed: false, internalType: "bytes32", name: "responseCiphertextHash", type: "bytes32" },
    ],
    name: "JobCompleted",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "jobId", type: "uint256" },
      { indexed: true, internalType: "address", name: "worker", type: "address" },
      { indexed: false, internalType: "uint256", name: "slashAmount", type: "uint256" },
    ],
    name: "JobTimedOut",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "jobId", type: "uint256" },
      { indexed: true, internalType: "address", name: "disputer", type: "address" },
    ],
    name: "DisputeCreated",
    type: "event",
  },
  // ── Errors ────────────────────────────────────────────────────────────────
  { inputs: [], name: "InvalidDispatcherSignature", type: "error" },
  { inputs: [], name: "ZeroDeposit", type: "error" },
  {
    inputs: [
      { internalType: "address", name: "user", type: "address" },
      { internalType: "uint256", name: "required", type: "uint256" },
      { internalType: "uint256", name: "available", type: "uint256" },
    ],
    name: "InsufficientBalance",
    type: "error",
  },
  {
    inputs: [
      { internalType: "address", name: "user", type: "address" },
      { internalType: "address", name: "delegate", type: "address" },
    ],
    name: "NotAuthorizedDelegate",
    type: "error",
  },
  {
    inputs: [
      { internalType: "uint256", name: "expiry", type: "uint256" },
      { internalType: "uint256", name: "currentTime", type: "uint256" },
    ],
    name: "SignatureExpired",
    type: "error",
  },
  {
    inputs: [
      { internalType: "uint256", name: "sessionId", type: "uint256" },
      { internalType: "uint256", name: "max", type: "uint256" },
    ],
    name: "MaxReassignmentsExceeded",
    type: "error",
  },
  {
    inputs: [
      { internalType: "uint256", name: "jobId", type: "uint256" },
      { internalType: "uint256", name: "deadline", type: "uint256" },
      { internalType: "uint256", name: "current", type: "uint256" },
    ],
    name: "NotTimedOut",
    type: "error",
  },
  {
    inputs: [
      { internalType: "uint256", name: "jobId", type: "uint256" },
      { internalType: "uint8", name: "expected", type: "uint8" },
      { internalType: "uint8", name: "actual", type: "uint8" },
    ],
    name: "JobNotInState",
    type: "error",
  },
  {
    inputs: [
      { internalType: "uint256", name: "jobId", type: "uint256" },
      { internalType: "uint256", name: "windowEnd", type: "uint256" },
      { internalType: "uint256", name: "current", type: "uint256" },
    ],
    name: "DisputeWindowExpired",
    type: "error",
  },
  {
    inputs: [
      { internalType: "uint256", name: "required", type: "uint256" },
      { internalType: "uint256", name: "provided", type: "uint256" },
    ],
    name: "InsufficientDisputeBond",
    type: "error",
  },
  {
    inputs: [
      { internalType: "uint256", name: "jobId", type: "uint256" },
      { internalType: "address", name: "caller", type: "address" },
    ],
    name: "UnauthorizedDisputeCaller",
    type: "error",
  },
] as const;
