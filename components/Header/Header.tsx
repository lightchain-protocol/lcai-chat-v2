"use client";

import { useAppKit } from "@reown/appkit/react";
import { Menu, MoonIcon, SunIcon, WalletMinimal } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useTheme } from "next-themes";
import { useEffect, useRef, useState } from "react";
import { useIsClient } from "usehooks-ts";
import { useAccount } from "wagmi";
import { iconMap } from "@/lib/nav/iconMap";
import { resolveTarget } from "@/lib/nav/resolveTarget";
import type { RawNavConfig } from "@/lib/nav/types";
import { Button } from "../ui/button";
import Navbar from "./Navbar";
import PopupMobileMenu from "./PopupMobileMenu";
import type { MenuConfig } from "./types";

function resolveMenus(raw: RawNavConfig[]): MenuConfig[] {
  return raw.map((menu) => ({
    ...menu,
    columns: menu.columns.map((col) => {
      if (col.type === "cards") {
        return {
          ...col,
          items: col.items.map((item) => ({
            ...item,
            icon: iconMap[item.iconKey] ?? iconMap["default"],
            target: resolveTarget(item.href, item.target),
          })),
        };
      }
      return col;
    }),
  }));
}

export default function Header({ rawMenus }: { rawMenus: RawNavConfig[] }) {
  const menus = resolveMenus(rawMenus);
  const [isMenuActive, setIsMenuActive] = useState(false);
  const [isSticky, setIsSticky] = useState(false);
  const headerRef = useRef<HTMLElement>(null);
  const { open } = useAppKit();
  const { isConnected } = useAccount();

  const closeMenu = () => setIsMenuActive(false);
  const toggleMenu = () => setIsMenuActive((v) => !v);

  // Sticky height + drop shadow
  useEffect(() => {
    const header = headerRef.current;
    if (!header) return;
    const defaultHeight = 80;
    const minHeight = 80;
    const onScroll = () => {
      const y = window.scrollY;
      setIsSticky(y > 10);
      header.style.height = `${
        y > 10 ? minHeight : Math.max(minHeight, defaultHeight - y / 7)
      }px`;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Lock body scroll while menu open
  useEffect(() => {
    if (isMenuActive) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
    document.body.style.overflow = "";
  }, [isMenuActive]);

  // Close on ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setIsMenuActive(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { setTheme, resolvedTheme } = useTheme();
  const isClient = useIsClient();

  const toggleTheme = (event: React.MouseEvent<HTMLButtonElement>) => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)"
    ).matches;

    const currentTheme = resolvedTheme || "light";
    const newMode = currentTheme === "light" ? "dark" : "light";

    if (!document.startViewTransition || prefersReducedMotion) {
      setTheme(newMode);
      return;
    }

    const { clientX: x, clientY: y } = event;
    const root = document.documentElement;

    root.style.setProperty("--x", `${x}px`);
    root.style.setProperty("--y", `${y}px`);

    document.startViewTransition(() => {
      setTheme(newMode);
    });
  };

  return (
    <>
      <header
        className={`!h-16 md:!h-20 fixed right-0 left-0 z-50 w-full border-bdr-light border-b bg-background transition-all duration-300 ease-in-out ${isSticky ? "!border-br-light shadow-[0_24px_28px_0_rgba(0,0,0,0.06)]" : ""}`}
        ref={headerRef}
      >
        <div className="h-full px-4 sm:px-6 md:px-8 lg:px-12 xl:px-14">
          <div className="max-device-width relative mx-auto flex h-full items-center justify-between gap-2 sm:gap-4 md:gap-6 lg:gap-8">
            {/* Logo */}
            <div className="flex items-center gap-3 sm:gap-4 md:gap-5">
              <Link
                aria-label="Lightchain Home"
                className="logo flex max-w-[150px] items-center sm:max-w-[200px]"
                href="/"
              >
                <Image
                  alt="Lightchain"
                  className="dark:hidden"
                  height={39}
                  src="/images/logo/logo-dark.svg"
                  width={200}
                />
                <Image
                  alt="Lightchain"
                  className="hidden dark:block"
                  height={39}
                  src="/images/logo/logo.svg"
                  width={200}
                />
              </Link>
            </div>

            {/* Desktop nav */}
            <div className="hidden xl:block">
              <Navbar menus={menus} />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 sm:gap-3 md:gap-4">
              <Button
                className="size-10 rounded-full"
                onClick={toggleTheme}
                type="button"
                variant="outline"
              >
                <span className="sr-only">
                  {isClient
                    ? `Toggle ${resolvedTheme === "dark" ? "light" : "dark"} mode`
                    : "Toggle theme"}
                </span>
                {isClient && resolvedTheme === "dark" ? (
                  <SunIcon />
                ) : (
                  <MoonIcon />
                )}
              </Button>

              {!isConnected && (
                <Button
                  className="hidden rounded-[10px] sm:flex"
                  onClick={() => open()}
                  variant="gradient"
                >
                  <WalletMinimal />
                  Connect Wallet
                </Button>
              )}

              {/* Mobile menu trigger */}
              <div className="block h-10 xl:hidden">
                <Button
                  aria-expanded={isMenuActive}
                  aria-haspopup="dialog"
                  className="flex size-10 items-center justify-center rounded-full border border-bdr-soft bg-surface-base-subtle text-content-strong transition-all"
                  onClick={toggleMenu}
                  variant="outline"
                >
                  <Menu size={24} />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Header spacer */}
      <div className="h-16 md:h-20" />

      <PopupMobileMenu
        isActive={isMenuActive}
        menus={menus}
        onClose={closeMenu}
      />
    </>
  );
}
