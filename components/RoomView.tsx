"use client";
import { useGame } from "@/lib/client/net";
import { Lobby } from "./Lobby";
import { GameStage } from "./GameStage";

export function RoomView() {
  const phase = useGame((s) => s.room?.phase);
  if (!phase) return null;
  if (phase === "lobby") return <Lobby />;
  return <GameStage />;
}
