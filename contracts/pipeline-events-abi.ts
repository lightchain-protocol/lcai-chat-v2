/**
 * Event fragments the pipeline timeline watches on-chain for the authoritative
 * tx hashes and worker address of one in-flight request.
 *
 * Mirrors the focused-fragment pattern of worker-registry-abi.ts: only the
 * events the client actually filters on, kept separate from the large
 * job-registry-abi so `getLogs`/`watchContractEvent` get a clean, typed item.
 *
 * These three are the events the CURRENT devnet JobRegistry (chain 48221)
 * actually emits, and every one is indexed on the identifier this client
 * already knows for a given request:
 *   - SessionCreated  → indexed `user`  (the wallet address) → sessionId + worker
 *   - JobSubmitted    → indexed `sessionId`                  → jobId
 *   - JobCompleted    → indexed `jobId`                      → responseBlobHash
 *
 * The completion tx also carries the response-blob commitment, so in this
 * deployment "response committed" and "settled" share the JobCompleted tx —
 * there is no separate ResponseSubmitted event on chain here.
 *
 * NOTE for the backend: the idealized pipeline also names SessionRequested
 * (reqId), SessionClaimed, SessionReady, JobAcknowledged and ResponseSubmitted
 * as distinct events. Those are NOT emitted by the deployed contract, so the
 * timeline drives the Requested / Acknowledged steps from the relay progress
 * signal and a getJob() read instead of a dedicated tx. If those events are
 * added later, drop their fragments here and the watcher can light those steps
 * with a real tx hash too.
 */

export const sessionCreatedEvent = {
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
} as const;

export const jobSubmittedEvent = {
  anonymous: false,
  inputs: [
    { indexed: true, internalType: "uint256", name: "jobId", type: "uint256" },
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
} as const;

export const jobCompletedEvent = {
  anonymous: false,
  inputs: [
    { indexed: true, internalType: "uint256", name: "jobId", type: "uint256" },
    { indexed: true, internalType: "address", name: "worker", type: "address" },
    {
      indexed: false,
      internalType: "bytes32",
      name: "responseBlobHash",
      type: "bytes32",
    },
    {
      indexed: false,
      internalType: "bytes32",
      name: "responseCiphertextHash",
      type: "bytes32",
    },
  ],
  name: "JobCompleted",
  type: "event",
} as const;
