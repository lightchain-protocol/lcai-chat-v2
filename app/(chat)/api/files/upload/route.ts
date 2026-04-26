import { randomUUID } from "node:crypto";
import path from "node:path";
import { put } from "@vercel/blob";
import { NextResponse } from "next/server";
import { z } from "zod";

import { auth } from "@/app/(auth)/auth";

// Use Blob instead of File since File is not available in Node.js environment
const FileSchema = z.object({
  file: z
    .instanceof(Blob)
    .refine((file) => file.size <= 5 * 1024 * 1024, {
      message: "File size should be less than 5MB",
    })
    // Update the file type based on the kind of files you want to accept
    .refine((file) => ["image/jpeg", "image/png"].includes(file.type), {
      message: "File type should be JPEG or PNG",
    }),
});

const FILENAME_MAX_LEN = 128;
const UNSAFE_FILENAME_CHARS = /[^\w.-]/g;

function sanitizeFilename(rawFilename: string): string {
  const safe = path
    .basename(rawFilename)
    .replace(UNSAFE_FILENAME_CHARS, "_")
    .slice(0, FILENAME_MAX_LEN);
  return safe || "file";
}

export async function POST(request: Request) {
  const session = await auth();

  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (request.body === null) {
    return new Response("Request body is empty", { status: 400 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get("file") as Blob;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const validatedFile = FileSchema.safeParse({ file });

    if (!validatedFile.success) {
      const errorMessage = validatedFile.error.errors
        .map((error) => error.message)
        .join(", ");

      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    // Get filename from formData since Blob doesn't have name property
    const rawFilename = (formData.get("file") as File).name;
    const safeFilename = sanitizeFilename(rawFilename);
    // Per-user namespace + UUID — uniqueness comes from the UUID, so
    // `addRandomSuffix: false` below is intentional, not a regression.
    const blobKey = `uploads/${session.user.id}/${randomUUID()}-${safeFilename}`;
    const fileBuffer = await file.arrayBuffer();

    try {
      const data = await put(blobKey, fileBuffer, {
        access: "public",
        addRandomSuffix: false,
      });

      return NextResponse.json(data);
    } catch (_error) {
      return NextResponse.json({ error: "Upload failed" }, { status: 500 });
    }
  } catch (_error) {
    return NextResponse.json(
      { error: "Failed to process request" },
      { status: 500 }
    );
  }
}
