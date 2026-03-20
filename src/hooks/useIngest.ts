import { useState, useEffect, useRef } from "react";
import * as api from "@/lib/tauri";
import type { IngestProgress, UnlistenFn } from "@/types";

export type FileStatus = {
  path:    string;
  name:    string;
  status:  "pending" | "processing" | "done" | "skipped" | "error";
  chunks?: number;
  error?:  string;
};

export function useIngest() {
  const [fileStatuses, setFileStatuses] = useState<FileStatus[]>([]);
  const [progress, setProgress]         = useState<IngestProgress | null>(null);
  const [isIngesting, setIsIngesting]   = useState(false);
  const unlistenRef = useRef<UnlistenFn | null>(null);

  // Clean up listener on unmount.
  useEffect(() => {
    return () => { unlistenRef.current?.(); };
  }, []);

  const selectFiles = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const selected = await open({
      multiple: true,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!selected) return;
    const paths = Array.isArray(selected) ? selected : [selected];
    addFiles(paths);
  };

  const selectFolder = async () => {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const folder = await open({ directory: true });
    if (!folder || typeof folder !== "string") return;
    const paths = await api.listPdfsInFolder(folder);
    addFiles(paths);
  };

  const addFiles = (paths: string[]) => {
    setFileStatuses((prev) => {
      const existing = new Set(prev.map((f) => f.path));
      const newFiles: FileStatus[] = paths
        .filter((p) => !existing.has(p))
        .map((p) => ({
          path:   p,
          name:   p.split("/").pop() ?? p,
          status: "pending",
        }));
      return [...prev, ...newFiles];
    });
  };

  const clearFiles = () => {
    setFileStatuses([]);
    setProgress(null);
    setIsIngesting(false);
    unlistenRef.current?.();
    unlistenRef.current = null;
  };

  const startIngest = async () => {
    if (fileStatuses.length === 0 || isIngesting) return;
    setIsIngesting(true);

    // Subscribe to progress events.
    unlistenRef.current = await api.onIngestProgress((p) => {
      setProgress(p);

      // Mirror phase into the per-file status list.
      setFileStatuses((prev) => {
        // "done" means the whole batch is finished — resolve any file
        // still showing as "processing" (the final file doesn't always get
        // an individual completion event before the batch-done event).
        if (p.phase === "done") {
          return prev.map((f) =>
            f.status === "processing" ? { ...f, status: "done" as const } : f
          );
        }

        return prev.map((f) => {
          if (f.name !== p.fileName) return f;
          if (p.phase === "skipped" || p.phase === "error") {
            return {
              ...f,
              status: p.phase === "skipped" ? "skipped" as const : "error" as const,
              chunks: p.fileChunksDone,
              error:  p.error ?? undefined,
            };
          }
          return { ...f, status: "processing" as const };
        });
      });

      if (p.phase === "done") {
        setIsIngesting(false);
        unlistenRef.current?.();
        unlistenRef.current = null;
      }
    });

    try {
      await api.ingestPdfs(fileStatuses.map((f) => f.path));
    } catch (err) {
      // Top-level error (e.g. no library open) — show in console for now.
      console.error("ingest_pdfs failed:", err);
      setIsIngesting(false);
      unlistenRef.current?.();
      unlistenRef.current = null;
    }
  };

  return { fileStatuses, progress, isIngesting, selectFiles, selectFolder, startIngest, clearFiles };
}
