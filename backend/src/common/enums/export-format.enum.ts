export enum ExportFormat {
  CSV = 'csv',
  XLSX = 'xlsx',
  JSON = 'json',
  SHOPIFY_CSV = 'shopify_csv',
  WOOCOMMERCE_XML = 'woocommerce_xml',
}

export enum ExportStatus {
  QUEUED = 'queued',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}
