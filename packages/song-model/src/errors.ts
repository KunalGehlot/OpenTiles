/** A file could not be turned into a Song. The message is shown to the user as is. */
export class ImportError extends Error {
  override name = 'ImportError';
}
