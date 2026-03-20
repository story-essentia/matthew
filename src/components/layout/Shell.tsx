import { useState } from "react";
import { Database, Upload, Search, Settings } from "lucide-react";
import Libraries   from "@/tabs/Libraries";
import Import      from "@/tabs/Import";
import Explore, { type PendingSources } from "@/tabs/Explore";
import SettingsTab from "@/tabs/Settings";
import { cn } from "@/lib/utils";
import { ConnectionDot } from "@/components/shared/ConnectionDot";
import { useLibraries } from "@/hooks/useLibraries";
import type { SearchResult, ChatMessage } from "@/types";

const TABS = [
  { key: "libraries", label: "Libraries", icon: Database },
  { key: "import",    label: "Import",    icon: Upload   },
  { key: "explore",   label: "Explore",   icon: Search   },
] as const;
type TabKey = (typeof TABS)[number]["key"] | "settings";

export default function Shell() {
  const [active, setActive] = useState<TabKey>("libraries");
  const { activeLibrary } = useLibraries();

  // ── Explore persistent state ───────────────────────────────────────────────
  const [exploreSearchQuery, setExploreSearchQuery] = useState("");
  const [exploreChatQuery,   setExploreChatQuery]   = useState("");
  const [exploreResults,     setExploreResults]     = useState<SearchResult[]>([]);
  const [exploreChatHistory, setExploreChatHistory] = useState<ChatMessage[]>([]);
  const [exploreMode,        setExploreMode]        = useState<"search" | "chat">("search");
  const [exploreTopK,        setExploreTopK]        = useState(10);
  const [pendingSources,     setPendingSources]     = useState<PendingSources | null>(null);

  const handleViewSources = (query: string, results: SearchResult[]) => {
    setPendingSources({ query, results });
    setActive("explore");
  };

  return (
    <div className="flex h-screen bg-[#0f0f1a] text-zinc-100 overflow-hidden">
      <aside className="w-44 shrink-0 flex flex-col border-r border-white/5 bg-[#0c0c16]">
        <div className="flex items-center justify-center py-6 border-b border-white/5 mb-4">
          <span className="text-xs font-medium tracking-[0.25em] text-white/40 uppercase">Matthew</span>
        </div>

        {/* Main nav */}
        <nav className="flex flex-col gap-0.5 p-2 flex-1">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button key={key} onClick={() => setActive(key)}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2.5 mx-2 rounded-lg text-sm text-left transition-colors",
                active === key
                  ? "bg-violet-500/15 text-violet-400 font-medium"
                  : "text-white/50 hover:text-white/70 hover:bg-white/5"
              )}>
              <Icon size={14} />{label}
            </button>
          ))}
        </nav>

        {/* Bottom: settings gear + connection dot */}
        <div className="flex flex-col">
          <button
            onClick={() => setActive("settings")}
            className={cn(
              "flex items-center gap-2.5 px-3 py-2.5 mx-2 rounded-lg text-sm text-left transition-colors mb-2",
              active === "settings"
                ? "text-violet-400 bg-violet-500/15 font-medium"
                : "text-white/50 hover:text-white/70 hover:bg-white/5"
            )}
          >
            <Settings size={14} /> Settings
          </button>
          <div className="px-5 pb-4 flex items-center gap-2">
            <div className={cn("w-2 h-2 rounded-full shrink-0", activeLibrary ? "bg-emerald-400" : "bg-zinc-600")} />
            <span className="text-xs text-white/30 truncate">
              {activeLibrary ? activeLibrary.name : "No library"}
            </span>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        {active === "libraries" && <Libraries />}
        {active === "settings"  && <SettingsTab />}
        {/* Import stays mounted so ingestion progress survives tab switches */}
        <div className={active === "import" ? "h-full" : "hidden"}>
          <Import />
        </div>
        {/* Explore stays mounted to preserve search/chat state */}
        <div className={active === "explore" ? "h-full" : "hidden"}>
          <Explore
            libraryPath={activeLibrary?.path ?? null}
            searchQuery={exploreSearchQuery} setSearchQuery={setExploreSearchQuery}
            chatQuery={exploreChatQuery}     setChatQuery={setExploreChatQuery}
            results={exploreResults}       setResults={setExploreResults}
            chatHistory={exploreChatHistory} setChatHistory={setExploreChatHistory}
            mode={exploreMode}             setMode={setExploreMode}
            topK={exploreTopK}             setTopK={setExploreTopK}
            pendingSources={pendingSources}
            onClearSources={() => setPendingSources(null)}
            onViewSources={handleViewSources}
          />
        </div>
      </main>
    </div>
  );
}
