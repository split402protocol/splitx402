export class ReceiptIngestionPersistenceConflictError extends Error {
  readonly code = "receipt_ingestion_persistence_conflict";

  constructor(cause?: unknown) {
    super("receipt ingestion persistence conflict", { cause });
    this.name = "ReceiptIngestionPersistenceConflictError";
  }
}

export function isReceiptIngestionPersistenceConflict(
  error: unknown
): error is ReceiptIngestionPersistenceConflictError {
  return error instanceof ReceiptIngestionPersistenceConflictError;
}
