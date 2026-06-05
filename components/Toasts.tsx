"use client";
import { useGame } from "@/lib/client/net";

export function Toasts() {
  const toasts = useGame((s) => s.toasts);
  return (
    <div className="toast-wrap">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
