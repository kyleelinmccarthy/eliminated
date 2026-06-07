// Mingle layout: a central spinning platform where everyone starts (while the
// music plays), ringed by evenly-spaced circular "rooms". When the music stops a
// number is called and players must cram into a ring room in groups of exactly
// that size — the platform itself is NOT a room, so dawdling on it is fatal.
//
// Geometry lives here (pure, testable) so the server (Mingle.ts) and the client
// renderer agree on where the rooms and platform sit.

import { ARENA_W, ARENA_H } from "./constants";

export interface MingleRoom {
  x: number;
  y: number;
  r: number;
}

export const MINGLE_PLATFORM = { x: ARENA_W / 2, y: ARENA_H / 2, r: 112 };
export const MINGLE_ROOM_COUNT = 6;
export const MINGLE_RING_RADIUS = 252; // center → room-center distance
export const MINGLE_ROOM_RADIUS = 84;

// Circles arranged evenly in a ring around the central platform (first room at
// the top, going clockwise). Returns fresh objects each call.
export function mingleRooms(
  count = MINGLE_ROOM_COUNT,
  ring = MINGLE_RING_RADIUS,
  roomR = MINGLE_ROOM_RADIUS,
  cx = MINGLE_PLATFORM.x,
  cy = MINGLE_PLATFORM.y,
): MingleRoom[] {
  const rooms: MingleRoom[] = [];
  for (let i = 0; i < count; i++) {
    const ang = -Math.PI / 2 + (i / count) * Math.PI * 2;
    rooms.push({ x: cx + Math.cos(ang) * ring, y: cy + Math.sin(ang) * ring, r: roomR });
  }
  return rooms;
}
