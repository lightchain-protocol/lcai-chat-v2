/**
 * Minimal ABI for the AIConfig contract.
 *
 * Contains only the view functions needed by the frontend:
 *   - calculateJobFee (fee estimation)
 *   - getDisputeWindow / getDisputeBondMultiplier (dispute UX)
 */
export const aiConfigAbi = [
  {
    inputs: [{ internalType: "bytes32", name: "modelId", type: "bytes32" }],
    name: "calculateJobFee",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getDisputeWindow",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [],
    name: "getDisputeBondMultiplier",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
