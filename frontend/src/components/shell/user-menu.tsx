"use client";

import { BookOpen, LogOut, Settings } from "lucide-react";
import Link from "next/link";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/lib/auth";

function initials(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/[\s@._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts[1]?.[0] ?? "") : "")).toUpperCase() || "?";
}

export function UserMenu() {
  const { user, signOut } = useAuth();
  if (!user) return null;
  const name = user.display_name || user.email;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* Named by its content: the visible initials followed by a visually hidden description, so the
            accessible name contains the visible text (WCAG 2.5.3 Label in Name). */}
        <Button variant="ghost" size="icon" className="rounded-full">
          <Avatar className="size-7">
            <AvatarFallback className="bg-brand-subtle text-[0.6875rem] font-medium text-brand">
              {initials(user.display_name, user.email)}
            </AvatarFallback>
          </Avatar>
          <span className="sr-only">Account menu for {name}</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <span className="block truncate text-sm font-medium text-foreground">{name}</span>
          {user.display_name ? (
            <span className="block truncate text-xs text-muted-foreground">{user.email}</span>
          ) : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/app/settings">
            <Settings aria-hidden="true" /> Settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/docs">
            <BookOpen aria-hidden="true" /> Documentation
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void signOut("/")}>
          <LogOut aria-hidden="true" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
