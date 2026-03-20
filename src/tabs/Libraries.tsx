import { useState, useCallback } from "react";
import { Database, Plus, ChevronRight, ChevronDown, Trash2, FolderOpen, FileText } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { useLibraries } from "@/hooks/useLibraries";
import { ConnectionDot } from "@/components/shared/ConnectionDot";
import { cn } from "@/lib/utils";
import * as api from "@/lib/tauri";
import type { IngestedFile } from "@/types";

type FormMode = "none" | "create" | "open-existing";

const MAX_VISIBLE = 20;

// ── Expandable document list for the active library ───────────────────────────

function IngestedDocsList({ libraryId }: { libraryId: string }) {
  const [expanded, setExpanded]       = useState(false);
  const [showAll, setShowAll]         = useState(false);
  const [loading, setLoading]         = useState(false);
  const [files, setFiles]             = useState<IngestedFile[] | null>(null);

  const toggle = useCallback(async () => {
    if (!expanded && files === null) {
      setLoading(true);
      try {
        const result = await api.listIngestedFiles(libraryId);
        setFiles(result);
      } finally {
        setLoading(false);
      }
    }
    setExpanded(v => !v);
  }, [expanded, files, libraryId]);

  const count = files?.length ?? 0;
  const visible = showAll ? (files ?? []) : (files ?? []).slice(0, MAX_VISIBLE);

  return (
    <div className="border-t border-zinc-800/60 mt-0.5">
      <button
        onClick={toggle}
        className="flex items-center gap-2 w-full px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
      >
        {expanded
          ? <ChevronDown size={11} className="shrink-0" />
          : <ChevronRight size={11} className="shrink-0" />}
        {loading ? "Loading…" : files === null ? "Documents" : `${count} document${count !== 1 ? "s" : ""}`}
      </button>

      {expanded && (
        <div className="pb-2 px-3 flex flex-col gap-0.5">
          {files !== null && files.length === 0 && (
            <p className="text-xs text-zinc-700 py-1">No documents imported yet</p>
          )}
          {visible.map(f => (
            <div key={f.sourceFile}
              className="flex items-center gap-2 py-1 text-xs">
              <FileText size={11} className="shrink-0 text-zinc-700" />
              <span className="truncate text-zinc-400 flex-1">{f.sourceFile}</span>
              <span className="shrink-0 text-zinc-700">{f.chunkCount.toLocaleString()} chunks</span>
            </div>
          ))}
          {!showAll && files !== null && files.length > MAX_VISIBLE && (
            <button
              onClick={() => setShowAll(true)}
              className="text-xs text-indigo-500 hover:text-indigo-400 text-left py-1 transition-colors"
            >
              Show all {files.length} documents
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main tab ──────────────────────────────────────────────────────────────────

export default function Libraries() {
  const { libraries, activeLibrary, openLibrary, createLibrary, deleteLibrary, openExistingLibrary } = useLibraries();
  const [mode, setMode]       = useState<FormMode>("none");
  const [newName, setNewName] = useState("");
  // open-existing state
  const [existingPath, setExistingPath]   = useState<string | null>(null);
  const [existingError, setExistingError] = useState<string | null>(null);

  const resetForm = () => {
    setMode("none");
    setNewName("");
    setExistingPath(null);
    setExistingError(null);
  };

  const handleCreate = async () => {
    const folder = await open({ directory: true, title: "Choose folder for new library" });
    if (!folder || !newName.trim()) return;
    await createLibrary(newName.trim(), folder as string, "balanced");
    resetForm();
  };

  const handlePickExisting = async () => {
    setExistingError(null);
    const folder = await open({ directory: true, title: "Select existing Matthew library folder" });
    if (!folder) return;
    setExistingPath(folder as string);
  };

  const handleOpenExisting = async () => {
    if (!existingPath || !newName.trim()) return;
    setExistingError(null);
    try {
      await openExistingLibrary(newName.trim(), existingPath, "balanced");
      resetForm();
    } catch (err: unknown) {
      const msg = (err as { message?: string })?.message ?? String(err);
      setExistingError(msg);
    }
  };

  const creating = mode !== "none";

  if (libraries.length === 0 && !creating) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-zinc-600 p-8">
        <Database size={40} strokeWidth={1} className="text-zinc-700" />
        <p className="text-sm text-center">No libraries yet.<br />Create one to get started.</p>
        <div className="flex gap-2">
          <button onClick={() => setMode("create")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-zinc-700 rounded-md text-zinc-300 hover:bg-zinc-800 transition-colors">
            <Plus size={14} /> New Library
          </button>
          <button onClick={() => setMode("open-existing")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-zinc-700 rounded-md text-zinc-300 hover:bg-zinc-800 transition-colors">
            <FolderOpen size={14} /> Open existing
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-5 flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-200">Libraries</h2>
        <div className="flex items-center gap-1">
          <button onClick={() => setMode("create")}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded transition-colors hover:bg-zinc-800">
            <Plus size={13} /> New
          </button>
          <button onClick={() => setMode("open-existing")}
            className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded transition-colors hover:bg-zinc-800">
            <FolderOpen size={13} /> Open existing
          </button>
        </div>
      </div>

      {/* Create new library form */}
      {mode === "create" && (
        <div className="flex flex-col gap-3 p-4 rounded-lg border border-indigo-500/30 bg-indigo-500/5">
          <input
            autoFocus value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="Library name…"
            className="bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
            onKeyDown={e => { if (e.key === "Escape") resetForm(); }}
          />
          <div className="flex gap-2 pt-1">
            <button 
              onClick={handleCreate} 
              disabled={newName.trim() === ''}
              className={cn(
                "text-xs text-indigo-400 transition-colors",
                newName.trim() === '' 
                  ? "opacity-30 cursor-not-allowed pointer-events-none" 
                  : "hover:text-indigo-300"
              )}
            >
              Choose folder & create →
            </button>
            <button onClick={resetForm} className="text-xs text-zinc-600 hover:text-zinc-400 ml-auto">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Open existing library form */}
      {mode === "open-existing" && (
        <div className="flex flex-col gap-3 p-4 rounded-lg border border-zinc-700/50 bg-[#0f0f1a]">
          <input
            autoFocus value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="Give this library a name…"
            className="bg-transparent text-sm text-zinc-200 outline-none placeholder:text-zinc-600"
            onKeyDown={e => { if (e.key === "Escape") resetForm(); }}
          />
          <button
            onClick={handlePickExisting}
            className="flex items-center gap-2 px-3 py-2 rounded-md border border-zinc-700 hover:border-zinc-600 text-xs text-zinc-400 hover:text-zinc-200 transition-colors text-left"
          >
            <FolderOpen size={13} />
            {existingPath
              ? <span className="truncate text-zinc-200">{existingPath}</span>
              : <span>Choose library folder…</span>}
          </button>
          {existingPath && (
            <p className="text-xs text-zinc-600">
              Folder must contain a <code className="text-zinc-500">chunks.lance</code> subfolder.
            </p>
          )}
          {existingError && (
            <p className="text-xs text-rose-400">{existingError}</p>
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleOpenExisting}
              disabled={!existingPath || !newName.trim()}
              className="text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-40 disabled:cursor-default"
            >
              Add to list →
            </button>
            <button onClick={resetForm} className="text-xs text-zinc-600 hover:text-zinc-400 ml-auto">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Library list */}
      <div className="flex flex-col gap-2">
        {libraries.map(lib => {
          const isActive = activeLibrary?.id === lib.id;
          return (
            <div key={lib.id}
              className={cn(
                "rounded-lg border transition-colors",
                isActive
                  ? "border-indigo-500/40 bg-indigo-500/5"
                  : "border-zinc-800"
              )}>
              {/* Row header — click to open */}
              <div
                onClick={() => openLibrary(lib)}
                className={cn(
                  "group flex items-center justify-between p-3 cursor-pointer",
                  !isActive && "hover:bg-zinc-800/40 rounded-lg transition-colors"
                )}>
                <div className="flex items-center gap-3 min-w-0">
                  <ConnectionDot status={isActive ? "connected" : "disconnected"} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-zinc-200 truncate">{lib.name}</p>
                    <p className="text-xs text-zinc-600 truncate">
                      {lib.chunkCount.toLocaleString()} chunks · {lib.chunkPreset} · {lib.path}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0 ml-2">
                  <button
                    onClick={e => { e.stopPropagation(); deleteLibrary(lib.id); }}
                    title="Remove from list"
                    className="opacity-0 group-hover:opacity-100 p-1 rounded text-zinc-600 hover:text-rose-400 hover:bg-rose-500/10 transition-all"
                  >
                    <Trash2 size={13} />
                  </button>
                  <ChevronRight size={13} className="text-zinc-700" />
                </div>
              </div>

              {/* Expandable document list — only for the active library */}
              {isActive && <IngestedDocsList libraryId={lib.id} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
