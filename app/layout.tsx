import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import { Toaster } from "sonner";
import { ThemeProvider } from "@/components/theme-provider";

import "./globals.css";
import { headers } from "next/headers";
import { SessionProvider } from "next-auth/react";
import Web3WalletProvider from "@/components/web3-wallet-provider";

export const metadata: Metadata = {
  metadataBase: new URL("https://chat.lightchain.ai"),
  title: "Lightchain AI Chat - Web3-Powered AI Assistant",
  description:
    "Experience the future of AI conversation with Lightchain AI Chat. A decentralized AI assistant featuring Web3 wallet authentication, real-time streaming responses, and blockchain-powered chat sessions.",
  openGraph: {
    siteName: "Lightchain AI Chat - Web3-Powered AI Assistant",
    url: "https://chat.lightchain.ai",
    title: "Lightchain AI Chat - Web3-Powered AI Assistant",
    type: "website",
    description:
      "Experience the future of AI conversation with Lightchain AI Chat. A decentralized AI assistant featuring Web3 wallet authentication, real-time streaming responses, and blockchain-powered chat sessions.",
    images: [
      {
        url: "https://lightchain.ai/assets/main.png",
        width: 1200,
        height: 630,
        alt: "Lightchain AI Chat - Web3-Powered AI Assistant",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Lightchain AI Chat - Web3-Powered AI Assistant",
    description:
      "Experience the future of AI conversation with Lightchain AI Chat. A decentralized AI assistant featuring Web3 wallet authentication, real-time streaming responses, and blockchain-powered chat sessions.",
    images: ["https://lightchain.ai/assets/main.png"],
  },
};

export const viewport = {
  maximumScale: 1, // Disable auto-zoom on mobile Safari
};

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const LIGHT_THEME_COLOR = "hsl(0 0% 100%)";
const DARK_THEME_COLOR = "hsl(240deg 10% 3.92%)";
const THEME_COLOR_SCRIPT = `\
(function() {
  var html = document.documentElement;
  var meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement('meta');
    meta.setAttribute('name', 'theme-color');
    document.head.appendChild(meta);
  }
  function updateThemeColor() {
    var isDark = html.classList.contains('dark');
    meta.setAttribute('content', isDark ? '${DARK_THEME_COLOR}' : '${LIGHT_THEME_COLOR}');
  }
  var observer = new MutationObserver(updateThemeColor);
  observer.observe(html, { attributes: true, attributeFilter: ['class'] });
  updateThemeColor();
})();`;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headersData = await headers();
  const cookies = headersData.get("cookie");

  return (
    <html
      className={`${inter.variable}`}
      // `next-themes` injects an extra classname to the body element to avoid
      // visual flicker before hydration. Hence the `suppressHydrationWarning`
      // prop is necessary to avoid the React hydration mismatch warning.
      // https://github.com/pacocoursey/next-themes?tab=readme-ov-file#with-app
      lang="en"
      suppressHydrationWarning
    >
      <head>
        <script
          // biome-ignore lint/security/noDangerouslySetInnerHtml: "Required"
          dangerouslySetInnerHTML={{
            __html: THEME_COLOR_SCRIPT,
          }}
        />
      </head>
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          <Toaster position="top-right" offset={{ top: 100, right: 32 }} mobileOffset={{ top: 80, right: 16 }}/>
          <Web3WalletProvider cookies={cookies}>
            <SessionProvider>{children}</SessionProvider>
          </Web3WalletProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
