/**
 * The dispute window, for UI copy.
 *
 * The authoritative value lives on chain (AIConfig.getDisputeWindow) and is
 * read live before a dispute is filed (message-job-actions). This constant
 * exists so user-facing copy can state the window consistently; it mirrors
 * provisioning/tier-catalog.json conventions.disputeWindowSeconds and is
 * uniform across models — never per-model in the frontend.
 */
export const DISPUTE_WINDOW_SECONDS = 1800;

export const DISPUTE_WINDOW_LABEL = "30 minutes";
