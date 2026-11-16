export enum ExtractionStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

// Products scoring below this are flagged for manual review (Product.isFlagged).
export const FLAG_CONFIDENCE_THRESHOLD = 70;
