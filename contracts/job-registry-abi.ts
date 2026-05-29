/**
 * Minimal ABI for the JobRegistry contract.
 *
 * Contains only the functions and events needed by the frontend:
 *   - createSession / submitJob (write)
 *   - deposit / depositAndAuthorize / withdrawBalance / setDelegateAuthorization / setDelegateAllowance (prepaid balance)
 *   - prepaidBalanceOf / isDelegateAuthorized / delegateAllowance (prepaid balance reads)
 *   - SessionCreated / JobSubmitted / Deposited / Withdrew / DelegateAuthorizationSet / DelegateAllowanceSet (events)
 *   - InvalidDispatcherSignature / SignatureExpired (errors for retry detection)
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
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "newBalance",
        type: "uint256",
      },
    ],
    name: "Deposited",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "newBalance",
        type: "uint256",
      },
    ],
    name: "Withdrew",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      {
        indexed: true,
        internalType: "address",
        name: "delegate",
        type: "address",
      },
      {
        indexed: false,
        internalType: "bool",
        name: "authorized",
        type: "bool",
      },
    ],
    name: "DelegateAuthorizationSet",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      {
        indexed: true,
        internalType: "address",
        name: "delegate",
        type: "address",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "allowance",
        type: "uint256",
      },
    ],
    name: "DelegateAllowanceSet",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "address", name: "user", type: "address" },
      {
        indexed: true,
        internalType: "uint256",
        name: "jobId",
        type: "uint256",
      },
      {
        indexed: false,
        internalType: "uint256",
        name: "amount",
        type: "uint256",
      },
    ],
    name: "RefundCreditedToBalance",
    type: "event",
  },
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
] as const;
