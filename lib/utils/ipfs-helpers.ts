import "server-only";

/**
 * Upload data to IPFS via Lighthouse Storage API
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
    // Create a Buffer from the string data for Node.js environment
    const buffer = Buffer.from(data, "utf-8");

    // Create a Blob from the buffer
    const blob = new Blob([buffer], { type: "application/json" });

    // Create FormData and append the file with explicit filename
    const formData = new FormData();
    formData.append("file", blob, filename);

    // Upload to Lighthouse API
    const response = await fetch(
      "https://upload.lighthouse.storage/api/v0/add",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
        },
        body: formData,
      }
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Lighthouse API error (${response.status}): ${errorText}`
      );
    }

    const result = await response.json();

    // Lighthouse API returns { Name, Hash, Size } directly
    const cid = result.Hash;

    if (!cid) {
      throw new Error(
        `Failed to upload to IPFS: No CID returned. Response: ${JSON.stringify(result)}`
      );
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
