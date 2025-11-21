import "server-only";

import lighthouse from "@lighthouse-web3/sdk";

/**
 * Upload data to IPFS via Lighthouse Storage SDK
 */
export async function uploadToIPFS(
  data: string,
  filename: string
): Promise<string> {
  const apiKey = process.env.LIGHTHOUSE_API_KEY;

  if (!apiKey) {
    throw new Error("LIGHTHOUSE_API_KEY environment variable must be set");
  }

  try {
    // Upload text/JSON to Lighthouse using SDK
    const response = await lighthouse.uploadText(data, apiKey, filename);

    const cid = response.data?.Hash;

    if (!cid) {
      throw new Error("Failed to upload to IPFS: No CID returned");
    }

    return cid;
  } catch (error) {
    throw new Error(
      `Failed to upload to IPFS: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Retrieve data from IPFS using CID via Lighthouse Gateway
 */
export async function retrieveFromIPFS(cid: string): Promise<string> {
  const gatewayUrl = `https://gateway.lighthouse.storage/ipfs/${cid}`;

  const response = await fetch(gatewayUrl);

  if (!response.ok) {
    throw new Error(
      `Failed to retrieve data from IPFS: ${response.statusText}`
    );
  }

  return await response.text();
}

/**
 * Encrypt data using AES-GCM with a derived key from wallet address
 */
export async function encryptData(
  data: string,
  walletAddress: string
): Promise<{ encrypted: string; iv: string }> {
  // Derive key from wallet address using PBKDF2
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(walletAddress.toLowerCase().slice(0, 32).padEnd(32, "0")),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("lcai-chat-backup-salt"),
      iterations: 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"]
  );

  // Generate random IV
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Encrypt the data
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encoder.encode(data)
  );

  return {
    encrypted: Buffer.from(encrypted).toString("base64"),
    iv: Buffer.from(iv).toString("base64"),
  };
}

/**
 * Decrypt data using AES-GCM
 */
export async function decryptData(
  encryptedData: string,
  iv: string,
  walletAddress: string
): Promise<string> {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  // Derive the same key from wallet address
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(walletAddress.toLowerCase().slice(0, 32).padEnd(32, "0")),
    { name: "PBKDF2" },
    false,
    ["deriveKey"]
  );

  const key = await crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("lcai-chat-backup-salt"),
      iterations: 100_000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["decrypt"]
  );

  // Decrypt the data
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: Buffer.from(iv, "base64") },
    key,
    Buffer.from(encryptedData, "base64")
  );

  return decoder.decode(decrypted);
}
