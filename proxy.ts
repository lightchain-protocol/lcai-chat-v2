import { type NextRequest, NextResponse } from "next/server";
import { getToken } from "next-auth/jwt";

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  /*
   * Playwright starts the dev server and requires a 200 status to
   * begin the tests, so this ensures that the tests can start
   */
  if (pathname.startsWith("/ping")) {
    return new Response("pong", { status: 200 });
  }

  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  // Auth.js names the session cookie `__Secure-authjs.session-token` only when
  // it was set over https; a production build served over plain http (the
  // compose devnet) sets the un-prefixed name. Detect by presence rather than
  // by NODE_ENV so `/chat/:id` does not bounce every http visitor to "/".
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: request.cookies.has("__Secure-authjs.session-token"),
  });

  // Allow unauthenticated access to home page (they'll see greeting with connect button)
  // Only protect /chat/:id and /api routes (except auth)
  if (
    !token &&
    (pathname.startsWith("/chat/") || pathname.startsWith("/api/"))
  ) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/",
    "/chat/:id",
    "/api/:path*",

    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    "/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)",
  ],
};
