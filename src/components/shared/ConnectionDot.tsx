import { cn } from "@/lib/utils";
type Status = "connected" | "disconnected" | "loading";
export function ConnectionDot({ status }: { status: Status }) {
  return (
    <span className={cn(
      "shrink-0 inline-block w-2 h-2 rounded-full",
      status === "connected"    && "bg-emerald-500",
      status === "disconnected" && "bg-zinc-600",
      status === "loading"      && "bg-amber-500 animate-pulse",
    )} />
  );
}
