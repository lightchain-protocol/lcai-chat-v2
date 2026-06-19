/**
 * Minimal ABI for the SessionManager contract as it runs in a delegated EOA
 * under EIP-7702. Only the read surface the frontend calls directly against
 * the user's EOA address (public chain state):
 *   - getSessionKeyNonce / getRegistrationNonce (replay + registration nonces)
 *   - hasSessionKey (post-registration confirmation)
 *
 * The write surface (validateAndExecute / addSessionKeyWithSig) is never
 * called directly from the browser — the gateway relays those — so it is
 * omitted here.
 */
export const sessionManagerAbi = [
  {
    type: "function",
    name: "getSessionKeyNonce",
    stateMutability: "view",
    inputs: [{ name: "sessionKey", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "getRegistrationNonce",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "hasSessionKey",
    stateMutability: "view",
    inputs: [{ name: "sessionKey", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
