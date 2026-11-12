import {
  Activity,
  Camera,
  FileText,
  FolderSearch,
  GitCompareArrows,
  LayoutDashboard,
  Settings,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Other path prefixes that should highlight this item. */
  match?: string[];
}

/** Sidebar navigation for the authenticated app, in display order. */
export const APP_NAV: { label: string; items: NavItem[] }[] = [
  {
    label: "Workspace",
    items: [
      { href: "/app", label: "Dashboard", icon: LayoutDashboard },
      { href: "/app/cameras", label: "Cameras", icon: Camera, match: ["/app/sensors"] },
      { href: "/app/investigations", label: "Investigations", icon: FolderSearch },
      { href: "/app/compare", label: "Compare", icon: GitCompareArrows, match: ["/app/analyses"] },
    ],
  },
  {
    label: "Records",
    items: [
      { href: "/app/reports", label: "Reports", icon: FileText },
      { href: "/app/jobs", label: "Jobs", icon: Activity },
    ],
  },
  {
    label: "Account",
    items: [{ href: "/app/settings", label: "Settings", icon: Settings }],
  },
];

export function isNavActive(item: NavItem, pathname: string): boolean {
  if (item.href === "/app") return pathname === "/app";
  return [item.href, ...(item.match ?? [])].some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Static top-bar trail derived from the URL. Dynamic names come from PageHeader / useBreadcrumbLabel. */
const SECTION: Record<string, { label: string; href: string; leaf?: string }> = {
  cameras: { label: "Cameras", href: "/app/cameras", leaf: "Camera" },
  sensors: { label: "Cameras", href: "/app/cameras", leaf: "Sensor" },
  investigations: { label: "Investigations", href: "/app/investigations", leaf: "Investigation" },
  compare: { label: "Compare", href: "/app/compare" },
  analyses: { label: "Compare", href: "/app/compare", leaf: "Analysis" },
  reports: { label: "Reports", href: "/app/reports" },
  jobs: { label: "Jobs", href: "/app/jobs" },
  settings: { label: "Settings", href: "/app/settings" },
  onboarding: { label: "Getting started", href: "/app/onboarding" },
};

export function trailFor(pathname: string): { label: string; href?: string }[] {
  const [, , section, id] = pathname.split("/");
  if (!section) return [{ label: "Dashboard" }];
  const s = SECTION[section];
  if (!s) return [{ label: "Dashboard", href: "/app" }];
  if (id && s.leaf) return [{ label: s.label, href: s.href }, { label: s.leaf }];
  return [{ label: s.label }];
}

export const MARKETING_NAV = [
  { href: "/product", label: "Product" },
  { href: "/methodology", label: "Methodology" },
  { href: "/docs", label: "Docs" },
  { href: "/privacy", label: "Privacy" },
] as const;
