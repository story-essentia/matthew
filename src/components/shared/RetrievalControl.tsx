import { useState, useEffect } from "react";
import { SlidersHorizontal, ChevronRight, ChevronLeft } from "lucide-react";

interface Props {
  topK: number;
  onChange: (topK: number) => void;
  mode: "search" | "chat";
}

export function RetrievalControl({ topK, onChange, mode }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [inputVal, setInputVal] = useState(String(topK));

  useEffect(() => {
    setInputVal(String(topK));
  }, [topK]);

  const apply = () => {
    const n = parseInt(inputVal, 10);
    const clampMax = mode === "chat" ? 50 : 100;
    
    if (!isNaN(n) && n >= 1) {
      const finalVal = Math.min(n, clampMax);
      onChange(finalVal);
      setInputVal(String(finalVal));
    } else {
      setInputVal(String(topK));
    }
    setExpanded(false);
  };

  return (
    <div className="flex items-center gap-2">
      <button 
        onClick={() => setExpanded(v => !v)} 
        className="flex items-center gap-1.5 text-sm text-white/50 hover:text-white/70 transition-colors px-2 py-1.5 rounded-md hover:bg-white/5"
      >
        <SlidersHorizontal size={14} />
        <span>{topK} results</span>
        {expanded ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
      </button>

      {expanded && (
        <>
          <input 
            type="number" 
            min={1} 
            max={mode === "chat" ? 50 : 100} 
            value={inputVal} 
            onChange={e => setInputVal(e.target.value)} 
            onBlur={apply} 
            onKeyDown={e => e.key === 'Enter' && apply()} 
            onClick={e => e.stopPropagation()}
            className="w-16 bg-white/5 border border-violet-500/30 rounded-md px-2 py-1 text-sm text-white/80 outline-none focus:border-violet-500/60 focus:bg-white/10 transition-all ml-1 text-center [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" 
            style={{ appearance: 'textfield' }}
            autoFocus
          />
          <button onMouseDown={e => e.preventDefault()} onClick={(e) => { e.stopPropagation(); const n = Math.max(1, topK - 1); onChange(n); setInputVal(String(n)); }} className="w-6 h-6 flex items-center justify-center rounded text-white/40 hover:text-white/70 hover:bg-white/10 text-sm ml-0.5">−</button>
          <button onMouseDown={e => e.preventDefault()} onClick={(e) => { e.stopPropagation(); const n = Math.min(mode === "chat" ? 50 : 100, topK + 1); onChange(n); setInputVal(String(n)); }} className="w-6 h-6 flex items-center justify-center rounded text-white/40 hover:text-white/70 hover:bg-white/10 text-sm ml-0.5">+</button>
        </>
      )}
    </div>
  );
}
