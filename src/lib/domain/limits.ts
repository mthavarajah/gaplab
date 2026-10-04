// Bounded bulk requests keep the full universe practical without one request
// per ticker. At most two batches run concurrently in the browser workflow.
export const SCAN_BATCH_SIZE = 50;
