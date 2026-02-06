/** biome-ignore-all lint/performance/useTopLevelRegex: this */
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  if (!url) return NextResponse.json({ error: "Missing URL" }, { status: 400 });

  try {
    const res = await fetch(url);
    const html = await res.text();

    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    const descMatch = html.match(/<meta name="description" content="(.*?)"/i);

    const title = titleMatch ? titleMatch[1] : "No title found";
    const description = descMatch ? descMatch[1] : "No description available.";

    return NextResponse.json({ title, description });
  } catch {
    return NextResponse.json({
      title: "Unknown",
      description: "Unable to fetch metadata",
    });
  }
}
