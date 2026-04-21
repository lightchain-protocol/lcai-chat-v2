/**
 * Minimal ABI for the JobRegistry contract.
 *
 * Contains only the functions and events needed by the frontend:
 *   - createSession / submitJob (write)
 *   - SessionCreated / JobSubmitted (events)
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
      { indexed: true, internalType: "uint256", name: "sessionId", type: "uint256" },
      { indexed: true, internalType: "address", name: "user", type: "address" },
      { indexed: true, internalType: "bytes32", name: "modelId", type: "bytes32" },
      { indexed: false, internalType: "address", name: "worker", type: "address" },
      { indexed: false, internalType: "bytes", name: "encWorkerKey", type: "bytes" },
      { indexed: false, internalType: "bytes", name: "encDisputerKey", type: "bytes" },
    ],
    name: "SessionCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "jobId", type: "uint256" },
      { indexed: true, internalType: "uint256", name: "sessionId", type: "uint256" },
      { indexed: false, internalType: "address", name: "worker", type: "address" },
    ],
    name: "JobSubmitted",
    type: "event",
  },
  {
    inputs: [
      { internalType: "uint256", name: "sessionId", type: "uint256" },
    ],
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
    inputs: [
      { internalType: "uint256", name: "sessionId", type: "uint256" },
    ],
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
      { indexed: true, internalType: "uint256", name: "sessionId", type: "uint256" },
      { indexed: false, internalType: "address", name: "newWorker", type: "address" },
    ],
    name: "SessionReassigned",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: "uint256", name: "sessionId", type: "uint256" },
      { indexed: false, internalType: "bytes", name: "encWorkerKey", type: "bytes" },
      { indexed: false, internalType: "bytes", name: "encDisputerKey", type: "bytes" },
    ],
    name: "SessionKeyUpdated",
    type: "event",
  },
  { inputs: [], name: "InvalidDispatcherSignature", type: "error" },
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
