import { Upload, FileText, SkipForward, CheckCircle, XCircle, Loader2, AlertTriangle, Download, ChevronDown } from "lucide-react";
import { useIngest, type FileStatus } from "@/hooks/useIngest";
import { useLibraries } from "@/hooks/useLibraries";
import { ChunkPresetSelector } from "@/components/shared/ChunkPresetSelector";
import { cn } from "@/lib/utils";
import { useState, useEffect } from "react";
import { listEmbeddingModels, downloadEmbeddingModel, initializeEmbeddingModel, getSetupStatus, onModelDownload, type ModelInfo } from '@/lib/tauri';

const phaseLabel: Record<string, string> = {
  parsing:   "Reading PDF…",
  chunking:  "Splitting into chunks…",
  embedding: "Generating embeddings…",
  storing:   "Saving to database…",
  skipped:   "Already imported, skipping…",
  done:      "Complete",
  error:     "Error",
};

export default function Import() {
  const { activeLibrary, setLibraryPreset, setLibraryModel, refreshLibraries } = useLibraries();
  const { fileStatuses, progress, isIngesting, selectFiles, selectFolder, startIngest, clearFiles } = useIngest();

  const [models, setModels] = useState<ModelInfo[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string>('BAAI/bge-m3');
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadMessage, setDownloadMessage] = useState<string>('');
  const [downloadProgress, setDownloadProgress] = useState(0); // 0-100, estimated
  const [anyModelCached, setAnyModelCached] = useState<boolean>(true); // optimistic
  const [pickerExpanded, setPickerExpanded] = useState(false);

  useEffect(() => {
    if (progress?.phase === "done" && !isIngesting) {
      refreshLibraries();
      setPickerExpanded(false); // auto-collapse when locked
    }
  }, [progress?.phase, isIngesting, refreshLibraries]);

  // Sync model selection with active library and fetch initial models
  useEffect(() => {
    listEmbeddingModels().then(setModels);
    getSetupStatus().then(result => setAnyModelCached(result.modelCached));
  }, []);

  useEffect(() => {
    if (!activeLibrary) return;

    // Reset UI state for the new library
    clearFiles();
    setPickerExpanded(false);

    // Load pinned model if it exists
    if (activeLibrary.modelId) {
      setSelectedModelId(activeLibrary.modelId);
      initializeEmbeddingModel(activeLibrary.modelId).catch(console.error);
    } else {
      setSelectedModelId('BAAI/bge-m3');
    }
  }, [activeLibrary?.id]);

  useEffect(() => {
    // Listen for background download events via the tauri.ts wrapper
    const unlistenPromise = onModelDownload((payload) => {
      const { status, message } = payload;
      if (status === 'downloading') {
        setIsDownloading(true);
        setDownloadMessage(message);
        setDownloadProgress(10); // pulse to show activity
      } else if (status === 'complete') {
        setIsDownloading(false);
        setDownloadProgress(100);
        setAnyModelCached(true);
        // Refresh model list to update cached flags
        listEmbeddingModels().then(setModels);
      } else if (status === 'error') {
        setIsDownloading(false);
        setDownloadProgress(0);
        setDownloadMessage('Download failed. Check your connection and try again.');
      }
    });

    return () => {
      unlistenPromise.then(fn => fn());
    };
  }, []);

  if (!activeLibrary) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-600 p-8">
        <Upload size={36} strokeWidth={1} />
        <p className="text-sm">Open a library first.</p>
      </div>
    );
  }

  const chunkPct = progress && progress.fileChunksTotal > 0
    ? Math.round((progress.fileChunksDone / progress.fileChunksTotal) * 100) : 0;
  const filePct  = progress
    ? Math.round((progress.currentFile / progress.totalFiles) * 100) : 0;

  const selectedModelCached = models.find(m => m.id === selectedModelId)?.cached ?? false;

  return (
    <div className="p-5 flex flex-col gap-5">
      <div>
        <h2 className="text-sm font-semibold text-zinc-200">Import Documents</h2>
        <p className="text-xs text-zinc-500 mt-0.5">Adding to: {activeLibrary.name}</p>
      </div>

      {/* Chunk preset — editable until first import, then locked */}
      <ChunkPresetSelector
        value={activeLibrary.chunkPreset}
        onChange={(preset) => setLibraryPreset(activeLibrary.id, preset)}
        locked={activeLibrary.hasBeenIngested}
      />

      {/* Drop zone */}
      {!isIngesting && fileStatuses.length === 0 && (
        <div className="border-2 border-dashed border-zinc-800 rounded-lg overflow-hidden transition-colors">
          {!selectedModelCached && (
            <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-500/10 border-b border-amber-500/20">
              <AlertTriangle size={13} className="text-amber-500 shrink-0" />
              <p className="text-xs text-amber-400/90">
                {anyModelCached ? (
                  <>Selected model not downloaded. Click <strong>Download</strong> below to enable import.</>
                ) : (
                  <>No embedding model downloaded yet. Choose a model below and click <strong>Download</strong>.</>
                )}
              </p>
            </div>
          )}
          <div 
            onClick={selectedModelCached ? selectFiles : undefined}
            className={cn(
              "p-10 flex flex-col items-center gap-3 text-zinc-600 transition-colors",
              selectedModelCached 
                ? "hover:border-zinc-700 hover:text-zinc-500 cursor-pointer" 
                : "opacity-40 cursor-not-allowed"
            )}>
            <Upload size={24} strokeWidth={1.5} />
            <p className="text-sm text-center">
              Click to choose PDFs, or{" "}
              <button 
                onClick={e => { 
                  e.stopPropagation(); 
                  if (selectedModelCached) selectFolder(); 
                }}
                className="text-indigo-500 hover:text-indigo-400 underline"
                disabled={!selectedModelCached}>
                select a folder
              </button>
            </p>
            <p className="text-xs text-zinc-700">
              Supports text-based PDFs. Scanned documents cannot be processed.
            </p>
          </div>
        </div>
      )}


      {/* Active progress */}
      {isIngesting && progress && (
        <div className="flex flex-col gap-3 p-4 rounded-lg bg-[#0f0f1a] border border-zinc-800">
          <div className="flex items-center justify-between text-xs text-zinc-400">
            <span className="font-medium">Overall</span>
            <span>{progress.currentFile} / {progress.totalFiles} files</span>
          </div>
          <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
            <div className="h-full bg-indigo-500 rounded-full transition-all" style={{ width: `${filePct}%` }} />
          </div>

          {progress.phase !== "done" && (
            <div className="flex flex-col gap-1.5 pt-1 border-t border-zinc-800">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-300 truncate max-w-[70%] font-medium">{progress.fileName}</span>
                {progress.fileChunksTotal > 0 && (
                  <span className="text-zinc-500 shrink-0 ml-2">
                    {progress.fileChunksDone} / {progress.fileChunksTotal} chunks
                  </span>
                )}
              </div>
              {progress.fileChunksTotal > 0 && (
                <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-400 rounded-full transition-all" style={{ width: `${chunkPct}%` }} />
                </div>
              )}
              <div className="flex items-center gap-1.5 text-xs text-zinc-500">
                <Loader2 size={11} className="animate-spin shrink-0" />
                <span>{phaseLabel[progress.phase] ?? progress.phase}</span>
              </div>
              {progress.imageOnlyPages > 0 && (
                <p className="text-xs text-amber-500/80">
                  ⚠ {progress.imageOnlyPages} page{progress.imageOnlyPages > 1 ? "s" : ""} had no extractable text
                </p>
              )}
            </div>
          )}

          <div className="flex gap-4 text-xs text-zinc-600 pt-1 border-t border-zinc-800">
            <span>{progress.totalChunksAdded.toLocaleString()} chunks added</span>
            {progress.totalFilesSkipped > 0 && (
              <span>{progress.totalFilesSkipped} skipped (already imported)</span>
            )}
          </div>
        </div>
      )}

      {/* Done */}
      {progress?.phase === "done" && !isIngesting && (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
          <CheckCircle size={16} className="text-emerald-500 shrink-0" />
          <p className="text-sm text-zinc-300">
            Done — {progress.totalChunksAdded.toLocaleString()} chunks added
            {progress.totalFilesSkipped > 0 &&
              `, ${progress.totalFilesSkipped} duplicate${progress.totalFilesSkipped > 1 ? "s" : ""} skipped`}
          </p>
        </div>
      )}

      {/* File list */}
      {fileStatuses.length > 0 && (
        <div className="flex flex-col gap-1 max-h-64 overflow-y-auto">
          {fileStatuses.map(f => <FileStatusRow key={f.path} file={f} />)}
        </div>
      )}

      <div className="flex gap-2">
        {!isIngesting && fileStatuses.length > 0 && progress?.phase !== "done" && (
          <>
            <button onClick={startIngest}
              className="px-3 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 text-white rounded-md transition-colors">
              Import {fileStatuses.length} file{fileStatuses.length !== 1 ? "s" : ""}
            </button>
            <button onClick={clearFiles}
              className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-300 rounded-md transition-colors">
              Clear
            </button>
          </>
        )}
        {!isIngesting && progress?.phase === "done" && (
          <button onClick={clearFiles}
            className="px-3 py-1.5 text-sm text-zinc-500 hover:text-zinc-300 rounded-md transition-colors">
            Start new import
          </button>
        )}
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 overflow-hidden">

        {/* Clickable header — toggles expand/collapse */}
        <div
          onClick={() => {
            if (!isIngesting && !activeLibrary.hasBeenIngested) {
              setPickerExpanded(p => !p);
            }
          }}
          className={cn(
            "flex items-center justify-between px-4 py-3",
            (!isIngesting && !activeLibrary.hasBeenIngested) && "cursor-pointer hover:bg-zinc-800/30 transition-colors"
          )}>
          <div>
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wider">
              Embedding model
            </p>
          </div>
          <div className="flex items-center gap-3">
            {models.find(m => m.id === selectedModelId)?.cached ? (
              <span className="flex items-center gap-1.5 text-xs text-emerald-500">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Ready
              </span>
            ) : (
              <span className="text-xs text-amber-500/80">
                Not downloaded
              </span>
            )}
            {!isIngesting && !activeLibrary.hasBeenIngested && (
              <ChevronDown
                size={14}
                className={cn(
                  "text-zinc-600 transition-transform duration-200",
                  pickerExpanded && "rotate-180"
                )}
              />
            )}
          </div>
        </div>

        {/* Selected model preview row — always visible */}
        {(() => {
          const sel = models.find(m => m.id === selectedModelId) ?? models[0];
          if (!sel) return null;
          return (
            <div className="flex items-center gap-3 px-4 pb-3 border-b border-zinc-800">
              <div className="w-3 h-3 rounded-full border-[1.5px] border-indigo-500 flex items-center justify-center shrink-0">
                <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
              </div>
              <span className="text-xs font-medium text-zinc-200">
                {sel.displayName}
              </span>
              {sel.recommended && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-400 font-medium">
                  Recommended
                </span>
              )}
              <span className="text-zinc-600 text-[10px]">·</span>
              <span className="text-[11px] text-zinc-500">
                {sel.dims} dims
              </span>
              <span className="text-zinc-600 text-[10px]">·</span>
              <span className="text-[11px] text-zinc-500">
                {sel.bestFor}
              </span>
              <span className="ml-auto">
                {sel.cached ? (
                  <div className="flex items-center gap-2">
                    {(activeLibrary.hasBeenIngested || isIngesting) && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 font-medium flex items-center gap-1">
                        <Upload size={10} className="rotate-0 text-zinc-600" />
                        LOCKED
                      </span>
                    )}
                    <span className="text-[11px] text-emerald-500/70">
                      cached
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    {(activeLibrary.hasBeenIngested || isIngesting) && (
                      <span className="text-[10px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 font-medium flex items-center gap-1">
                        <Upload size={10} className="rotate-0 text-zinc-600" />
                        LOCKED
                      </span>
                    )}
                    <span className="text-[11px] text-zinc-600">
                      {sel.sizeMb >= 1000
                        ? `${(sel.sizeMb/1000).toFixed(1)} GB`
                        : `${sel.sizeMb} MB`}
                    </span>
                  </div>
                )}
              </span>
            </div>
          );
        })()}

        {/* Expanded table */}
        {pickerExpanded && !isIngesting && (
          <>
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="w-8 pl-4"></th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-zinc-600 uppercase tracking-wider">
                    Model
                  </th>
                  <th className="px-3 py-2 text-center text-[10px] font-medium text-zinc-600 uppercase tracking-wider w-16">
                    Dims
                  </th>
                  <th className="px-3 py-2 text-left text-[10px] font-medium text-zinc-600 uppercase tracking-wider">
                    Best for
                  </th>
                  <th className="pr-4 py-2 text-right text-[10px] font-medium text-zinc-600 uppercase tracking-wider w-20">
                    Size
                  </th>
                </tr>
              </thead>
              <tbody>
                {models.map(model => (
                  <tr
                    key={model.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isDownloading || activeLibrary?.hasBeenIngested) return;
                      setSelectedModelId(model.id);
                      if (activeLibrary && !activeLibrary.hasBeenIngested && !isIngesting) {
                        setLibraryModel(activeLibrary.id, model.id)
                          .catch(console.error);
                        
                        // If it's already cached, initialize it in the engine immediately
                        if (model.cached) {
                          initializeEmbeddingModel(model.id).catch(console.error);
                        }
                      }
                    }}
                    className={cn(
                      "border-b border-zinc-800/50 last:border-0",
                      "cursor-pointer transition-colors",
                      selectedModelId === model.id
                        ? "bg-indigo-500/8"
                        : "hover:bg-zinc-800/30"
                    )}>
                    <td className="pl-4 py-2.5">
                      <div className={cn(
                        "w-3 h-3 rounded-full border-[1.5px] flex items-center justify-center transition-opacity",
                        selectedModelId === model.id
                          ? "border-indigo-500"
                          : "border-zinc-600",
                        activeLibrary.hasBeenIngested && selectedModelId !== model.id && "opacity-20"
                      )}>
                        {selectedModelId === model.id && (
                          <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className={cn(
                          "text-xs font-medium",
                          selectedModelId === model.id
                            ? "text-zinc-200"
                            : "text-zinc-400"
                        )}>
                          {model.displayName}
                        </span>
                        {model.recommended && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-400 font-medium">
                            Recommended
                          </span>
                        )}
                        {model.isNew && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 font-medium">
                            New
                          </span>
                        )}
                        {model.isFast && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-500 font-medium">
                            Fast
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-center text-[11px] text-zinc-500">
                      {model.dims}
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-zinc-500">
                      {model.bestFor}
                    </td>
                    <td className="pr-4 py-2.5 text-right">
                      {model.cached ? (
                        <div className="flex items-center gap-2 justify-end">
                          {activeLibrary.hasBeenIngested && selectedModelId === model.id && (
                            <span className="text-[10px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 font-medium">
                              LOCKED
                            </span>
                          )}
                          <span className="text-[11px] text-emerald-500/70">
                            cached
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2 justify-end">
                          {activeLibrary.hasBeenIngested && selectedModelId === model.id && (
                            <span className="text-[10px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 font-medium">
                              LOCKED
                            </span>
                          )}
                          <span className="text-[11px] text-zinc-600">
                            {model.sizeMb >= 1000
                              ? `${(model.sizeMb/1000).toFixed(1)} GB`
                              : `${model.sizeMb} MB`}
                          </span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Footer with download */}
            <div className="px-4 py-3 border-t border-zinc-800">
              {isDownloading ? (
                <div className="flex flex-col gap-2">
                  <span className="text-zinc-400 flex items-center gap-1.5 text-xs">
                    <Loader2 size={11} className="animate-spin" />
                    {downloadMessage}
                  </span>
                  <div className="w-full h-1 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                      style={{ width: `${downloadProgress}%` }}
                    />
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] text-zinc-600">
                    {(() => {
                      const sel = models.find(m => m.id === selectedModelId);
                      if (!sel) return '';
                      return sel.cached
                        ? `${sel.displayName} is ready to use`
                        : `${sel.displayName} · requires internet once`;
                    })()}
                  </p>
                  {(() => {
                    const sel = models.find(m => m.id === selectedModelId);
                    if (sel?.cached) return null;
                    return (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsDownloading(true);
                          setDownloadProgress(5);
                          downloadEmbeddingModel(selectedModelId)
                            .catch(err => {
                              setIsDownloading(false);
                              setDownloadProgress(0);
                              setDownloadMessage(String(err));
                            });
                        }}
                        disabled={isDownloading}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-indigo-600 hover:bg-indigo-500 text-white transition-colors disabled:opacity-50">
                        <Download size={11} />
                        Download
                      </button>
                    );
                  })()}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function FileStatusRow({ file }: { file: FileStatus }) {
  const icon =
    file.status === "done"       ? <CheckCircle size={12} className="text-emerald-500 shrink-0" /> :
    file.status === "skipped"    ? <SkipForward  size={12} className="text-zinc-600 shrink-0" /> :
    file.status === "error"      ? <XCircle      size={12} className="text-rose-500 shrink-0" /> :
    file.status === "processing" ? <Loader2      size={12} className="text-indigo-400 animate-spin shrink-0" /> :
                                   <FileText     size={12} className="text-zinc-600 shrink-0" />;
  return (
    <div className={cn(
      "flex items-center gap-2 px-2 py-1.5 rounded text-xs",
      file.status === "processing" && "bg-zinc-800/60",
      file.status === "error"      && "bg-rose-500/5",
      file.status === "skipped"    && "opacity-50",
    )}>
      {icon}
      <span className={cn("truncate flex-1",
        file.status === "processing" ? "text-zinc-200" :
        file.status === "skipped"    ? "text-zinc-600" :
        file.status === "error"      ? "text-rose-400" : "text-zinc-400"
      )}>
        {file.name}
      </span>
      {file.status === "done" && file.chunks !== undefined && (
        <span className="text-zinc-600 shrink-0">{file.chunks.toLocaleString()} chunks</span>
      )}
      {file.status === "skipped" && <span className="text-zinc-700 shrink-0">already imported</span>}
      {file.status === "error" && file.error && (
        <span className="text-rose-500 text-[11px] leading-normal flex-1 text-right" title={file.error}>{file.error}</span>
      )}
    </div>
  );
}
