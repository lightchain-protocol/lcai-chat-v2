import type { NextRequest } from "next/server";
import { auth } from "@/app/(auth)/auth";
import { searchMessages } from "@/lib/db/queries";
import { ChatSDKError } from "@/lib/errors";

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user) {
    return new ChatSDKError("unauthorized:chat").toResponse();
  }

  const { searchParams } = request.nextUrl;
  const query = searchParams.get("q") || searchParams.get("query") || "";
  const limit = Number.parseInt(searchParams.get("limit") || "20", 10);

  if (!query || query.trim().length === 0) {
    return Response.json({ results: [], query: "" });
  }

  if (query.length < 2) {
    return new ChatSDKError(
      "bad_request:api",
      "Search query must be at least 2 characters long"
    ).toResponse();
  }

  if (limit < 1 || limit > 100) {
    return new ChatSDKError(
      "bad_request:api",
      "Limit must be between 1 and 100"
    ).toResponse();
  }

  try {
    const results = await searchMessages({
      userId: session.user.id,
      query,
      limit,
    });

    return Response.json({
      results,
      query,
      count: results.length,
    });
  } catch (error) {
    console.error("Search API error:", error);

    if (error instanceof ChatSDKError) {
      return error.toResponse();
    }

    return new ChatSDKError(
      "internal:database",
      "An error occurred while searching messages"
    ).toResponse();
  }
}
