"use client";

import Image from "next/image";
import { memo, useEffect, useState } from "react";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card";
import { $http } from "@/lib/http";
import { cn } from "@/lib/utils";

const WWW_PREFIX = /^www\./;
const DEFAULT_FAVICON = "/images/logo/favicon.png";

function getDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(WWW_PREFIX, "");
  } catch {
    return url;
  }
}

function getFaviconUrl(url: string): string {
  const domain = getDomain(url);
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
}

async function fetchMetaData(url: string): Promise<{
  title: string;
  description: string;
}> {
  try {
    const res = await $http.get(`/api/metadata?url=${encodeURIComponent(url)}`, {
      auth: false,
    });
    if (!res.ok) throw new Error("Failed to fetch metadata");
    return res.json();
  } catch {
    return { title: "Unknown Title", description: "No description available." };
  }
}

function SourceLinkPopover({
  href,
  domain,
  src,
  onFaviconError,
}: {
  href: string;
  domain: string;
  src: string;
  onFaviconError: () => void;
}) {
  const [meta, setMeta] = useState<{
    title: string;
    description: string;
  } | null>(null);

  useEffect(() => {
    fetchMetaData(href).then(setMeta);
  }, [href]);

  return (
    <a href={href} rel="noopener noreferrer" target="_blank">
      <div className="w-full min-w-0 rounded-[10px] bg-surface-soft p-3 shadow-md backdrop-blur-xl">
        <div className="mb-2 flex items-start gap-2">
          <Image
            alt={domain}
            className="rounded"
            height={20}
            onError={onFaviconError}
            src={src}
            unoptimized
            width={20}
          />
          <span className="full-url break-all font-semibold text-[11px] text-content-primary leading-[1.4]">
            {href}
          </span>
        </div>
        <p className="font-medium text-content-primary text-xs">
          {meta?.title ?? "Loading..."}
        </p>
        <p className="mt-1 line-clamp-2 text-content-secondary text-xs">
          {meta?.description ?? "Loading description..."}
        </p>
      </div>
    </a>
  );
}

type SourceLinkChipProps = {
  href: string;
  className?: string;
};

const PureSourceLinkChip = ({ href, className }: SourceLinkChipProps) => {
  const domain = getDomain(href);
  const faviconUrl = getFaviconUrl(href);
  const [src, setSrc] = useState(faviconUrl);

  return (
    <HoverCard closeDelay={0} openDelay={0}>
      <HoverCardTrigger asChild>
        <a
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full bg-surface-m-soft px-2 py-1 text-xs transition-colors hover:bg-surface-soft",
            className
          )}
          href={href}
          rel="noopener noreferrer"
          target="_blank"
        >
          <Image
            alt={domain}
            className="rounded-full"
            height={16}
            onError={() => setSrc(DEFAULT_FAVICON)}
            src={src}
            unoptimized
            width={16}
          />
          <span className="domain max-w-[100px] truncate text-content-secondary">
            {domain}
          </span>
        </a>
      </HoverCardTrigger>
      <HoverCardContent align="center" side="bottom">
        <SourceLinkPopover
          domain={domain}
          href={href}
          onFaviconError={() => setSrc(DEFAULT_FAVICON)}
          src={src}
        />
      </HoverCardContent>
    </HoverCard>
  );
};

export const SourceLinkChip = memo(PureSourceLinkChip);
SourceLinkChip.displayName = "SourceLinkChip";
