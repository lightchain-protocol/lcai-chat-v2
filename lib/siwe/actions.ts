"use server";

import { SiweMessage } from "siwe";
import { auth } from "@/app/(auth)/auth";
import config from "@/config";
import { createUser, getUserByWallet } from "@/lib/db/queries";

/**
 * Verify SIWE message and signature
 */
export async function verifySIWEMessage(message: string, signature: string) {
  try {
    const siweMessage = new SiweMessage(message);
    const fields = await siweMessage.verify({ signature });

    if (!fields.success) {
      return {
        success: false,
        error: "Invalid signature",
      };
    }

    const { address, chainId } = fields.data;

    // Get or create user
    const [existingUser] = await getUserByWallet(address);

    if (!existingUser) {
      // Create new user with wallet address
      const [newUser] = await createUser(address);
      return {
        success: true,
        address,
        chainId,
        userId: newUser.id,
      };
    }

    return {
      success: true,
      address,
      chainId,
      userId: existingUser.id,
    };
  } catch (error) {
    console.error("Error verifying SIWE message:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Verification failed",
    };
  }
}

/**
 * Get current SIWE session
 */
export async function getSIWESession() {
  try {
    const session = await auth();

    if (!session?.user) {
      return null;
    }

    return {
      address: session.user.id,
      chainId: config.chains[0].id,
    };
  } catch (error) {
    console.error("Error getting SIWE session:", error);
    return null;
  }
}

/**
 * Generate nonce for SIWE
 */
export function generateSIWENonce() {
  // Generate a random nonce
  const nonce = Math.random().toString(36).substring(2, 15);
  return nonce;
}
