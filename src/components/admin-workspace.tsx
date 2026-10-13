import type { ReactNode } from "react";
import { Users, FileSpreadsheet, Settings2 } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function AdminWorkspace({
  children,
  reports,
  settings,
}: {
  children: ReactNode;
  reports: ReactNode;
  settings: ReactNode;
}) {
  return (
    <Tabs defaultValue="accounts" className="space-y-5">
      <TabsList
        aria-label="Administrator sections"
        className="grid h-auto w-full grid-cols-3 gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1 sm:max-w-lg"
      >
        {[
          { value: "accounts", label: "Accounts", Icon: Users },
          { value: "reports", label: "Reports", Icon: FileSpreadsheet },
          { value: "settings", label: "Settings", Icon: Settings2 },
        ].map(({ value, label, Icon }) => (
          <TabsTrigger
            key={value}
            value={value}
            className="min-h-11 gap-2 rounded-lg px-2 text-xs font-semibold data-[state=active]:bg-blue-950 data-[state=active]:text-white sm:text-sm"
          >
            <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
            {label}
          </TabsTrigger>
        ))}
      </TabsList>
      {/* Keep drafts, selection, and the one-time Chief recovery code intact across tabs. */}
      <TabsContent value="accounts" forceMount className="space-y-3 data-[state=inactive]:hidden">
        {children}
      </TabsContent>
      <TabsContent value="reports" forceMount className="data-[state=inactive]:hidden">
        {reports}
      </TabsContent>
      <TabsContent value="settings" forceMount className="data-[state=inactive]:hidden">
        <h2 className="mb-3 text-base font-semibold text-slate-900">Administrator settings</h2>
        {settings}
      </TabsContent>
    </Tabs>
  );
}
