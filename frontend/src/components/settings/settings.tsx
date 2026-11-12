"use client";

import { Cpu, Database, History, ShieldCheck, UserRound } from "lucide-react";
import { Suspense } from "react";

import { PageHeader } from "@/components/st/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUrlTab } from "@/hooks/use-url-tab";

import { AccountTab } from "./account-tab";
import { AuditTab } from "./audit-tab";
import { DataTab } from "./data-tab";
import { ProcessingTab } from "./processing-tab";
import { SecurityTab } from "./security-tab";

const TABS = ["account", "security", "data", "audit", "processing"] as const;

function SettingsInner() {
  const [tab, setTab] = useUrlTab(TABS, "account");
  return (
    <>
      <PageHeader title="Settings" description="Your profile, sign-in security, stored data, activity log and the processing versions in use." />
      <Tabs value={tab} onValueChange={setTab} className="gap-6">
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <TabsList variant="line" className="border-b pb-0 sm:w-full sm:justify-start">
            <TabsTrigger value="account" className="flex-none px-2.5">
              <UserRound aria-hidden="true" /> Account
            </TabsTrigger>
            <TabsTrigger value="security" className="flex-none px-2.5">
              <ShieldCheck aria-hidden="true" /> Security
            </TabsTrigger>
            <TabsTrigger value="data" className="flex-none px-2.5">
              <Database aria-hidden="true" /> Data
            </TabsTrigger>
            <TabsTrigger value="audit" className="flex-none px-2.5">
              <History aria-hidden="true" /> Audit
            </TabsTrigger>
            <TabsTrigger value="processing" className="flex-none px-2.5">
              <Cpu aria-hidden="true" /> Processing
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="account">
          <AccountTab />
        </TabsContent>
        <TabsContent value="security">
          <SecurityTab />
        </TabsContent>
        <TabsContent value="data">
          <DataTab />
        </TabsContent>
        <TabsContent value="audit">
          <AuditTab />
        </TabsContent>
        <TabsContent value="processing">
          <ProcessingTab />
        </TabsContent>
      </Tabs>
    </>
  );
}

export function Settings() {
  return (
    <Suspense
      fallback={
        <div role="status" aria-label="Loading settings" className="flex flex-col gap-6">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-9 w-full max-w-md" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      }
    >
      <SettingsInner />
    </Suspense>
  );
}
