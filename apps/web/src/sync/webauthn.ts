// Passkeys for sync sign-in. The service speaks WebAuthn JSON (base64url strings); the browser API
// wants ArrayBuffers. Newer browsers convert both ways themselves (parse…FromJSON, toJSON); these
// helpers do it by hand for the rest (Safari before 18).
import { fromBase64Url, toBase64Url } from '@opentiles/vault';
import type { WebAuthnJson } from '@opentiles/sync-client';

function b64(value: unknown): ArrayBuffer {
  if (typeof value !== 'string') throw new Error('Unexpected passkey options from the server');
  return fromBase64Url(value).buffer;
}

function enc(value: ArrayBuffer | ArrayBufferView | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const bytes =
    value instanceof ArrayBuffer
      ? new Uint8Array(value)
      : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return toBase64Url(bytes);
}

type Descriptor = { id: string; type?: string; transports?: string[] };

function descriptors(list: unknown): PublicKeyCredentialDescriptor[] | undefined {
  if (!Array.isArray(list)) return undefined;
  return (list as Descriptor[]).map((d) => ({
    type: 'public-key',
    id: b64(d.id),
    ...(d.transports ? { transports: d.transports as AuthenticatorTransport[] } : {}),
  }));
}

export function requestOptionsFromJson(json: WebAuthnJson): PublicKeyCredentialRequestOptions {
  const { challenge, allowCredentials, ...rest } = json as Record<string, unknown>;
  const out = { ...rest, challenge: b64(challenge) } as PublicKeyCredentialRequestOptions;
  const allow = descriptors(allowCredentials);
  if (allow) out.allowCredentials = allow;
  return out;
}

export function creationOptionsFromJson(json: WebAuthnJson): PublicKeyCredentialCreationOptions {
  const { challenge, user, excludeCredentials, ...rest } = json as Record<string, unknown>;
  const u = user as { id: string; name: string; displayName: string };
  const out = {
    ...rest,
    challenge: b64(challenge),
    user: { ...u, id: b64(u.id) },
  } as PublicKeyCredentialCreationOptions;
  const exclude = descriptors(excludeCredentials);
  if (exclude) out.excludeCredentials = exclude;
  return out;
}

interface CredentialLike {
  id: string;
  rawId: ArrayBuffer;
  type: string;
  authenticatorAttachment?: string | null;
  getClientExtensionResults?: () => AuthenticationExtensionsClientOutputs;
  response: {
    clientDataJSON: ArrayBuffer;
    authenticatorData?: ArrayBuffer;
    signature?: ArrayBuffer;
    userHandle?: ArrayBuffer | null;
    attestationObject?: ArrayBuffer;
    getTransports?: () => string[];
  };
}

/** The credential as WebAuthn JSON (what `PublicKeyCredential.toJSON()` returns). */
export function credentialToJson(cred: CredentialLike): WebAuthnJson {
  const r = cred.response;
  const response: Record<string, unknown> = { clientDataJSON: enc(r.clientDataJSON) };
  if (r.attestationObject) {
    response.attestationObject = enc(r.attestationObject);
    response.transports = r.getTransports?.() ?? [];
  } else {
    response.authenticatorData = enc(r.authenticatorData);
    response.signature = enc(r.signature);
    const handle = enc(r.userHandle);
    if (handle !== undefined) response.userHandle = handle;
  }
  return {
    id: cred.id,
    rawId: enc(cred.rawId),
    type: cred.type,
    response,
    clientExtensionResults: cred.getClientExtensionResults?.() ?? {},
    ...(cred.authenticatorAttachment
      ? { authenticatorAttachment: cred.authenticatorAttachment }
      : {}),
  };
}

export function passkeysSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
}

export async function getPasskey(options: WebAuthnJson): Promise<WebAuthnJson> {
  const cred = (await navigator.credentials.get({
    publicKey: requestOptionsFromJson(options),
  })) as unknown as CredentialLike | null;
  if (!cred) throw new Error('No passkey was chosen.');
  return credentialToJson(cred);
}

export async function createPasskey(options: WebAuthnJson): Promise<WebAuthnJson> {
  const cred = (await navigator.credentials.create({
    publicKey: creationOptionsFromJson(options),
  })) as unknown as CredentialLike | null;
  if (!cred) throw new Error('No passkey was created.');
  return credentialToJson(cred);
}
