/**
 * Minimal ABI for the AIConfig contract.
 *
 * Contains only the view function needed by the frontend for fee calculation.
 */
export const aiConfigAbi = [
  {
    inputs: [{ internalType: "bytes32", name: "modelId", type: "bytes32" }],
    name: "calculateJobFee",
    outputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
