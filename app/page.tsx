"use client";
import { useEffect } from "react";
import { useGame, net } from "@/lib/client/net";
import { audio } from "@/lib/client/audio";
import { Landing } from "@/components/Landing";
import { RoomView } from "@/components/RoomView";
import { Toasts } from "@/components/Toasts";

export default function Home() {
  const room = useGame((s) => s.room);

  useEffect(() => {
    net.ensure();
    const wake = () => audio.resume();
    window.addEventListener("pointerdown", wake);
    window.addEventListener("keydown", wake);
    return () => {
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
    };
  }, []);

  return (
    <>
      <Toasts />
      {room ? <RoomView /> : <Landing />}
    </>
  );
}
