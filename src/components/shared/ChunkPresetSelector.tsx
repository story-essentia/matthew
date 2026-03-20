import { cn } from "@/lib/utils";
import { Upload } from "lucide-react";
export type ChunkPreset = "precise" | "balanced" | "contextual";

const PRESETS = [
  { key: "precise"    as ChunkPreset, label: "Precise",    description: "Short, focused chunks",  detail: "Best for FAQs, manuals, short self-contained entries" },
  { key: "balanced"   as ChunkPreset, label: "Balanced",   description: "General purpose",         detail: "Works well for most documents — recommended default" },
  { key: "contextual" as ChunkPreset, label: "Contextual", description: "Long, rich chunks",       detail: "Best for research papers, books, legal documents" },
];

interface Props {
  value: ChunkPreset;
  onChange: (v: ChunkPreset) => void;
  locked?: boolean;
}

export function ChunkPresetSelector({ value, onChange, locked = false }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-zinc-400">Chunk size</label>
      </div>
      <div className="flex gap-2">
        {PRESETS.map(p => (
          <button key={p.key} disabled={locked} onClick={() => !locked && onChange(p.key)}
            title={p.detail}
            className={cn(
              "flex-1 flex flex-col gap-0.5 p-2.5 rounded-lg border text-left transition-colors",
              locked ? "opacity-50 cursor-default" : "cursor-pointer",
              value === p.key
                ? "border-indigo-500/50 bg-indigo-500/10"
                : "border-zinc-800 hover:border-zinc-700 bg-zinc-900"
            )}>
            <div className="flex items-center justify-between gap-1">
              <span className={cn("text-xs font-medium", value === p.key ? "text-indigo-300" : "text-zinc-300")}>
                {p.label}
              </span>
              {locked && value === p.key && (
                 <span className="text-[10px] px-1 py-0.5 rounded bg-zinc-800 text-zinc-500 font-medium flex items-center gap-1">
                    <Upload size={10} className="rotate-0 text-zinc-600" />
                    LOCKED
                 </span>
              )}
            </div>
            <span className="text-xs text-zinc-600">{p.description}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-zinc-600 leading-relaxed">
        {PRESETS.find(p => p.key === value)?.detail}
      </p>
    </div>
  );
}
