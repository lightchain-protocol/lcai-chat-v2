/**
 * Minimal ABI for the WorkerRegistry contract.
 *
 * Only the read functions the chat client needs: the encryption key for
 * failover key rewrapping, and the stake behind a worker so a user can see
 * what is actually at risk if the answer they were given is wrong.
 */
export const workerRegistryAbi = [
  {
    inputs: [{ internalType: "address", name: "worker", type: "address" }],
    name: "getWorkerEncryptionKey",
    outputs: [{ internalType: "bytes", name: "", type: "bytes" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "address", name: "worker", type: "address" }],
    name: "getWorkerStake",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    // Workers currently eligible to claim a job for the given model. The length
    // of this array is the model's live worker count, which the picker reads to
    // show availability and to disable models that no worker is serving.
    inputs: [{ internalType: "bytes32", name: "modelId", type: "bytes32" }],
    name: "getEligibleWorkers",
    outputs: [{ internalType: "address[]", name: "", type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
