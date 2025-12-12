import { LucideIcon } from "lucide-react";

export type NavCardItem = {
  label: string;
  desc?: string;
  href: string;
  icon?: LucideIcon;
  target?: "_blank";
  badge?: string;
  active?: boolean;
};

export type MegaCol =
  | { type: "title"; title: string }
  | { type: "cards"; items: NavCardItem[] }
  | {
      type: "imageCard";
      href: string;
      img: string;
      badge?: string;
      title: string;
      meta?: string;
    }
  | { type: "spacer" };

export type MenuConfig = {
  label: string;
  align?: "left" | "right";
  width?: "small" | "wide" | "xwide";
  columns: MegaCol[];
};
