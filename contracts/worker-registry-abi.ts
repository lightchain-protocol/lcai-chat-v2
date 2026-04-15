/**
 * Minimal ABI for the WorkerRegistry contract.
 *
 * Contains only the read function needed for failover key retrieval.
 */
export const workerRegistryAbi = [
  {
    inputs: [{ internalType: "address", name: "worker", type: "address" }],
    name: "getWorkerEncryptionKey",
    outputs: [{ internalType: "bytes", name: "", type: "bytes" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
