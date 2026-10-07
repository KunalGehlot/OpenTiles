// Plain messages for errors from the vault and the sync service.
import { isVaultError } from '@opentiles/vault';

export function describeError(error: unknown): string {
  if (isVaultError(error)) {
    switch (error.code) {
      case 'wrong-secret':
        return 'That passphrase or recovery code does not open this. Check it and try again.';
      case 'corrupt':
        return 'This file is damaged or is not an OpenTiles backup.';
      case 'unsupported':
        return 'This was made by a newer version of OpenTiles. Update the app and try again.';
      case 'invalid-recovery-code':
        return `The recovery code looks mistyped: ${error.message}.`;
      case 'weak-passphrase':
        return 'The passphrase must be at least 8 characters long.';
      default:
        return error.message;
    }
  }
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'The request was cancelled.';
  }
  if (error instanceof TypeError && /fetch|network/i.test(error.message)) {
    return 'Could not reach the server. Check your connection and try again.';
  }
  return error instanceof Error ? error.message : String(error);
}
