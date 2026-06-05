"use client";
import { useEffect, useState } from "react";
import { audio } from "@/lib/client/audio";

export function MuteButton() {
  const [muted, setMuted] = useState(false);
  useEffect(() => {
    audio.init();
    setMuted(audio.muted);
  }, []);
  return (
    <button
      className="pill"
      onClick={() => {
        const m = !muted;
        audio.setMuted(m);
        setMuted(m);
        if (!m) audio.sfx("blip");
      }}
      title={muted ? "Unmute" : "Mute"}
    >
      {muted ? "🔇" : "🔊"}
    </button>
  );
}
