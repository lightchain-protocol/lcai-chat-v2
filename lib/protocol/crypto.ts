/**
 * Browser-side E2E encryption for the LightChain protocol.
 *
 * Wire-compatible with Go pkg/crypto — uses ECDH P-256 for key exchange
 * and AES-256-GCM for symmetric encryption. No HKDF — raw ECDH output
 * is used directly as the AES key, matching the Go implementation.
 *
 * Formats:
 *   AES-GCM ciphertext: nonce(12) || ciphertext || tag(16)
 *   Encrypted session key: ephemeralPub(65) || nonce(12) || ciphertext || tag(16)
 */

const AES_KEY_BYTES = 32;
const GCM_NONCE_BYTES = 12;
const P256_UNCOMPRESSED_KEY_BYTES = 65;
const SESSION_KEY_BYTES = 32;

/**
 * Generates a random 32-byte session key.
 */
export async function generateSessionKey(): Promise<Uint8Array> {
  const key = new Uint8Array(SESSION_KEY_BYTES);
  crypto.getRandomValues(key);
  return key;
}

/**
 * Generates an ECDH P-256 key pair for session key exchange.
 */
export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
}

/**
 * Exports a CryptoKey public key to its raw uncompressed P-256 encoding (65 bytes).
 */
export async function exportPublicKey(key: CryptoKey): Promise<Uint8Array> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return new Uint8Array(raw);
}

/**
 * Imports a raw uncompressed P-256 public key (65 bytes) into a CryptoKey.
 */
export async function importPublicKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "ECDH", namedCurve: "P-256" },
    true,
    [],
  );
}

/**
 * Derives a 32-byte shared secret from a local ECDH private key and a remote
 * public key. Returns the raw x-coordinate — no HKDF, matching Go's
 * priv.ECDH(remotePub) output.
 */
export async function deriveSharedSecret(
  privateKey: CryptoKey,
  remotePublicKey: CryptoKey,
): Promise<Uint8Array> {
  const bits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: remotePublicKey },
    privateKey,
    256,
  );
  return new Uint8Array(bits);
}

/**
 * Encrypts plaintext using AES-256-GCM with a 32-byte key.
 *
 * Output format: nonce(12) || ciphertext || tag(16)
 * Matches Go's gcm.Seal(nonce, nonce, plaintext, nil).
 */
export async function encrypt(
  key: Uint8Array,
  plaintext: Uint8Array,
): Promise<Uint8Array> {
  if (key.length !== AES_KEY_BYTES) {
    throw new Error(
      `invalid key length: must be ${AES_KEY_BYTES} bytes for AES-256`,
    );
  }

  const aesKey = await crypto.subtle.importKey(
    "raw",
    key,
    "AES-GCM",
    false,
    ["encrypt"],
  );

  const nonce = new Uint8Array(GCM_NONCE_BYTES);
  crypto.getRandomValues(nonce);

  // Web Crypto returns ciphertext || tag(16)
  const ciphertextWithTag = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    aesKey,
    plaintext,
  );

  // Prepend nonce to match Go format: nonce(12) || ciphertext || tag(16)
  const result = new Uint8Array(
    GCM_NONCE_BYTES + ciphertextWithTag.byteLength,
  );
  result.set(nonce, 0);
  result.set(new Uint8Array(ciphertextWithTag), GCM_NONCE_BYTES);
  return result;
}

/**
 * Decrypts AES-256-GCM ciphertext with the given 32-byte key.
 *
 * Input format: nonce(12) || ciphertext || tag(16)
 * Matches Go's Decrypt output.
 */
export async function decrypt(
  key: Uint8Array,
  ciphertext: Uint8Array,
): Promise<Uint8Array> {
  if (key.length !== AES_KEY_BYTES) {
    throw new Error(
      `invalid key length: must be ${AES_KEY_BYTES} bytes for AES-256`,
    );
  }
  if (ciphertext.length < GCM_NONCE_BYTES) {
    throw new Error("ciphertext too short");
  }

  const nonce = ciphertext.slice(0, GCM_NONCE_BYTES);
  const ciphertextBody = ciphertext.slice(GCM_NONCE_BYTES);

  const aesKey = await crypto.subtle.importKey(
    "raw",
    key,
    "AES-GCM",
    false,
    ["decrypt"],
  );

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce },
    aesKey,
    ciphertextBody,
  );

  return new Uint8Array(plaintext);
}

/**
 * Encrypts a 32-byte session key for delivery to a remote party (the worker).
 *
 * Generates an ephemeral ECDH P-256 key pair, derives a shared secret with
 * the worker's public key, and encrypts the session key with AES-256-GCM.
 *
 * Output format: ephemeralPub(65) || nonce(12) || AES-GCM(sharedSecret, sessionKey)
 * Matches Go's EncryptSessionKey output.
 */
export async function encryptSessionKey(
  sessionKey: Uint8Array,
  workerPublicKey: CryptoKey,
): Promise<Uint8Array> {
  if (sessionKey.length !== SESSION_KEY_BYTES) {
    throw new Error(
      `session key must be exactly ${SESSION_KEY_BYTES} bytes`,
    );
  }

  const ephemeral = await generateKeyPair();
  const sharedSecret = await deriveSharedSecret(
    ephemeral.privateKey,
    workerPublicKey,
  );

  const ciphertext = await encrypt(sharedSecret, sessionKey);
  const ephemeralPubRaw = await exportPublicKey(ephemeral.publicKey);

  const result = new Uint8Array(ephemeralPubRaw.length + ciphertext.length);
  result.set(ephemeralPubRaw, 0);
  result.set(ciphertext, ephemeralPubRaw.length);
  return result;
}

/**
 * Decrypts an encrypted session key using the local ECDH private key.
 *
 * Input format: ephemeralPub(65) || nonce(12) || AES-GCM(sharedSecret, sessionKey)
 * Matches Go's DecryptSessionKey input.
 */
export async function decryptSessionKey(
  encWorkerKey: Uint8Array,
  privateKey: CryptoKey,
): Promise<Uint8Array> {
  if (encWorkerKey.length < P256_UNCOMPRESSED_KEY_BYTES) {
    throw new Error(
      `encrypted worker key too short: must be at least ${P256_UNCOMPRESSED_KEY_BYTES} bytes`,
    );
  }

  const ephemeralPubRaw = encWorkerKey.slice(0, P256_UNCOMPRESSED_KEY_BYTES);
  const ciphertext = encWorkerKey.slice(P256_UNCOMPRESSED_KEY_BYTES);

  const ephemeralPub = await importPublicKey(ephemeralPubRaw);
  const sharedSecret = await deriveSharedSecret(privateKey, ephemeralPub);

  const sessionKey = await decrypt(sharedSecret, ciphertext);
  if (sessionKey.length !== SESSION_KEY_BYTES) {
    throw new Error(
      `session key must be exactly ${SESSION_KEY_BYTES} bytes (got ${sessionKey.length})`,
    );
  }

  return sessionKey;
}
