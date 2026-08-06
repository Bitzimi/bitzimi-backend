/**
 * Auction SSE broadcaster — Phase 22.3
 *
 * In-process Server-Sent Events hub. No Redis, no external broker.
 * Each auction has its own subscriber set. When a bid is placed or
 * the auction state changes, all connected clients for that auction
 * are notified instantly.
 *
 * Event envelope: { type, data }
 *   type: "bid_placed" | "auction_updated" | "auction_ended" | "heartbeat"
 */

import { FastifyReply } from "fastify";

// ─── Types ────────────────────────────────────────────────────────────────────

export type SseEventType =
  | "bid_placed"
  | "auction_updated"
  | "auction_ended"
  | "heartbeat";

export interface AuctionSseEvent {
  type: SseEventType;
  auctionId: string;
  data: Record<string, unknown>;
}

// ─── Subscriber registry ──────────────────────────────────────────────────────

// Map<auctionId, Set<reply>>
const subscribers = new Map<string, Set<FastifyReply>>();

function getChannel(auctionId: string): Set<FastifyReply> {
  let ch = subscribers.get(auctionId);
  if (!ch) {
    ch = new Set();
    subscribers.set(auctionId, ch);
  }
  return ch;
}

/** Register a client reply as SSE subscriber for the given auction. */
export function subscribe(auctionId: string, reply: FastifyReply): void {
  getChannel(auctionId).add(reply);
}

/** Remove a subscriber (called on close / error). */
export function unsubscribe(auctionId: string, reply: FastifyReply): void {
  getChannel(auctionId).delete(reply);
  if (getChannel(auctionId).size === 0) subscribers.delete(auctionId);
}

/** Broadcast an event to all connected clients for an auction. */
export function broadcast(event: AuctionSseEvent): void {
  const ch = subscribers.get(event.auctionId);
  if (!ch || ch.size === 0) return;

  const payload = `data: ${JSON.stringify({ type: event.type, ...event.data })}\n\n`;

  for (const reply of ch) {
    try {
      (reply.raw as any).write(payload);
    } catch {
      // Client disconnected mid-write — remove silently
      ch.delete(reply);
    }
  }
}

/** Return subscriber count (for diagnostics). */
export function subscriberCount(auctionId: string): number {
  return subscribers.get(auctionId)?.size ?? 0;
}

// ─── Heartbeat (prevents proxy timeouts) ─────────────────────────────────────

// Send a heartbeat comment every 25 seconds to all connected channels.
// SSE comments (lines starting with ":") are ignored by browsers but keep the connection alive.
setInterval(() => {
  for (const [auctionId, ch] of subscribers) {
    if (ch.size === 0) { subscribers.delete(auctionId); continue; }
    const hb = `: heartbeat ${Date.now()}\n\n`;
    for (const reply of ch) {
      try { (reply.raw as any).write(hb); } catch { ch.delete(reply); }
    }
  }
}, 25_000);
