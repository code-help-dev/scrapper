export enum JobStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  RETRY = 'retry',
  PAUSED = 'paused',
}

export enum JobType {
  SINGLE = 'single',
  BULK = 'bulk',
  DISCOVERY = 'discovery',
}
