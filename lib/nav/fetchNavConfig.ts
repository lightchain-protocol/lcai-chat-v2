import type { RawNavConfig } from "./types";

const NAV_CONFIG_URL = "https://docs.lightchain.ai/nav-config.json";

export async function fetchNavConfig(): Promise<RawNavConfig[]> {
  try {
    const res = await fetch(NAV_CONFIG_URL, { next: { revalidate: 3600 } });
    if (!res.ok) {
      console.warn(`Failed to fetch nav config: ${res.status}`);
      return [];
    }
    return (await res.json()) as RawNavConfig[];
  } catch (error) {
    console.warn("Failed to fetch nav config:", error);
    return [];
  }
}
