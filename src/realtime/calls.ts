import type { Socket } from "socket.io";
import { CallStatus, MessageType, Prisma } from "@prisma/client";
import { logger } from "@/config/logger";
import { prisma } from "@/infrastructure/prisma";
import {
  chatUserSelect,
  displayNameOf,
  initialsOf,
  messageInclude,
  serializeMessage,
} from "@/shared/chat/helpers";
import { emitToUsers, isUserOnline } from "./socket";

/** A call that is not answered within this window is marked missed. */
const RING_TIMEOUT_MS = 45_000;

type LiveStatus = typeof CallStatus.RINGING | typeof CallStatus.ANSWERED;

interface ActiveCall {
  id: string;
  conversationId: string;
  callerId: string;
  calleeId: string;
  status: LiveStatus;
  startedAt: number;
  answeredAt: number | null;
  ringTimer: NodeJS.Timeout | null;
}

/** Active calls by call id and the single call each user is currently engaged in (busy tracking). */
const callsById = new Map<string, ActiveCall>();
const userCall = new Map<string, string>();

const otherParty = (call: ActiveCall, userId: string): string =>
  call.callerId === userId ? call.calleeId : call.callerId;

const isParticipant = (call: ActiveCall, userId: string): boolean =>
  call.callerId === userId || call.calleeId === userId;

const participantIdsOf = async (conversationId: string): Promise<string[]> => {
  const rows = await prisma.conversationParticipant.findMany({
    where: { conversationId },
    select: { userId: true },
  });
  return rows.map((row) => row.userId);
};

/** Records the call outcome as a CALL message so it shows inside the thread. */
const postCallMessage = async (
  call: ActiveCall,
  status: CallStatus,
  durationSec: number,
): Promise<void> => {
  try {
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          conversationId: call.conversationId,
          senderId: call.callerId,
          type: MessageType.CALL,
          body: "",
          event: {
            callId: call.id,
            status,
            durationSec,
            callerId: call.callerId,
          } as Prisma.InputJsonValue,
        },
        include: messageInclude,
      }),
      prisma.conversation.update({
        where: { id: call.conversationId },
        data: { updatedAt: new Date() },
      }),
    ]);
    emitToUsers(await participantIdsOf(call.conversationId), "message:new", {
      conversationId: call.conversationId,
      message: { ...serializeMessage(message, call.callerId), from: undefined },
    });
  } catch (err) {
    logger.warn({ err }, "Failed to post call message");
  }
};

const cleanup = (call: ActiveCall): void => {
  if (call.ringTimer) clearTimeout(call.ringTimer);
  callsById.delete(call.id);
  if (userCall.get(call.callerId) === call.id) userCall.delete(call.callerId);
  if (userCall.get(call.calleeId) === call.id) userCall.delete(call.calleeId);
};

/**
 * Terminates an active call: persists the final status + duration, records the
 * thread message and clears in-memory state. Notifications to the remaining
 * party are emitted by the caller of this helper.
 */
const finalizeCall = async (
  call: ActiveCall,
  status: CallStatus,
): Promise<number> => {
  cleanup(call);
  const endedAt = new Date();
  const durationSec =
    status === CallStatus.COMPLETED && call.answeredAt
      ? Math.max(0, Math.round((endedAt.getTime() - call.answeredAt) / 1000))
      : 0;
  try {
    await prisma.call.update({
      where: { id: call.id },
      data: {
        status,
        endedAt,
        durationSec,
        answeredAt: call.answeredAt ? new Date(call.answeredAt) : null,
      },
    });
  } catch (err) {
    logger.warn({ err, callId: call.id }, "Failed to persist call outcome");
  }
  await postCallMessage(call, status, durationSec);
  return durationSec;
};

const errorAck = (ack: unknown, code: string): void => {
  if (typeof ack === "function") ack({ error: code });
};

const callerSummary = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: chatUserSelect,
  });
  if (!user) return null;
  return {
    id: user.id,
    name: displayNameOf(user),
    avatar: user.profile?.avatarUrl ?? null,
    initials: initialsOf(user),
  };
};

const onInitiate = async (
  userId: string,
  payload: unknown,
  ack: unknown,
): Promise<void> => {
  const { conversationId } = (payload ?? {}) as { conversationId?: unknown };
  if (typeof conversationId !== "string" || !conversationId) {
    errorAck(ack, "invalid");
    return;
  }
  if (userCall.has(userId)) {
    errorAck(ack, "in-call");
    return;
  }

  const membership = await prisma.conversationParticipant.findUnique({
    where: { conversationId_userId: { conversationId, userId } },
    include: { conversation: { select: { isGroup: true } } },
  });
  if (!membership) {
    errorAck(ack, "forbidden");
    return;
  }
  if (membership.conversation.isGroup) {
    errorAck(ack, "group-unsupported");
    return;
  }

  const others = await prisma.conversationParticipant.findMany({
    where: { conversationId, userId: { not: userId } },
    select: { userId: true },
  });
  if (others.length !== 1) {
    errorAck(ack, "not-direct");
    return;
  }
  const calleeId = others[0].userId;

  if (userCall.has(calleeId)) {
    errorAck(ack, "busy");
    return;
  }
  if (!isUserOnline(calleeId)) {
    errorAck(ack, "offline");
    return;
  }

  let created;
  try {
    created = await prisma.call.create({
      data: { conversationId, callerId: userId, calleeId, status: CallStatus.RINGING },
      select: { id: true, startedAt: true },
    });
  } catch (err) {
    logger.warn({ err }, "Failed to create call");
    errorAck(ack, "failed");
    return;
  }

  const call: ActiveCall = {
    id: created.id,
    conversationId,
    callerId: userId,
    calleeId,
    status: CallStatus.RINGING,
    startedAt: created.startedAt.getTime(),
    answeredAt: null,
    ringTimer: null,
  };
  call.ringTimer = setTimeout(() => {
    void (async () => {
      if (!callsById.has(call.id) || call.status !== CallStatus.RINGING) return;
      await finalizeCall(call, CallStatus.MISSED);
      emitToUsers([call.callerId], "call:ended", {
        callId: call.id,
        reason: "no-answer",
        durationSec: 0,
      });
      emitToUsers([call.calleeId], "call:cancelled", { callId: call.id });
    })();
  }, RING_TIMEOUT_MS);
  call.ringTimer.unref?.();

  callsById.set(call.id, call);
  userCall.set(userId, call.id);
  userCall.set(calleeId, call.id);

  const caller = await callerSummary(userId);
  emitToUsers([calleeId], "call:incoming", {
    callId: call.id,
    conversationId,
    caller,
  });
  if (typeof ack === "function") {
    ack({ callId: call.id, calleeId });
  }
};

const requireCall = (callId: unknown, userId: string): ActiveCall | null => {
  if (typeof callId !== "string") return null;
  const call = callsById.get(callId);
  if (!call || !isParticipant(call, userId)) return null;
  return call;
};

const onAccept = async (userId: string, payload: unknown): Promise<void> => {
  const { callId } = (payload ?? {}) as { callId?: unknown };
  const call = requireCall(callId, userId);
  // Only the callee can accept, and only while ringing.
  if (!call || call.calleeId !== userId || call.status !== CallStatus.RINGING) return;

  if (call.ringTimer) clearTimeout(call.ringTimer);
  call.ringTimer = null;
  call.status = CallStatus.ANSWERED;
  call.answeredAt = Date.now();
  try {
    await prisma.call.update({
      where: { id: call.id },
      data: { status: CallStatus.ANSWERED, answeredAt: new Date(call.answeredAt) },
    });
  } catch (err) {
    logger.warn({ err }, "Failed to mark call answered");
  }
  // The caller is the WebRTC offerer; tell it the callee is ready.
  emitToUsers([call.callerId], "call:accepted", { callId: call.id });
};

const onReject = async (userId: string, payload: unknown): Promise<void> => {
  const { callId } = (payload ?? {}) as { callId?: unknown };
  const call = requireCall(callId, userId);
  if (!call || call.calleeId !== userId || call.status !== CallStatus.RINGING) return;
  await finalizeCall(call, CallStatus.REJECTED);
  emitToUsers([call.callerId], "call:rejected", { callId: call.id });
};

const onCancel = async (userId: string, payload: unknown): Promise<void> => {
  const { callId } = (payload ?? {}) as { callId?: unknown };
  const call = requireCall(callId, userId);
  if (!call || call.callerId !== userId || call.status !== CallStatus.RINGING) return;
  await finalizeCall(call, CallStatus.CANCELLED);
  emitToUsers([call.calleeId], "call:cancelled", { callId: call.id });
};

const onEnd = async (userId: string, payload: unknown): Promise<void> => {
  const { callId } = (payload ?? {}) as { callId?: unknown };
  const call = requireCall(callId, userId);
  if (!call) return;
  const wasAnswered = call.status === CallStatus.ANSWERED;
  const status = wasAnswered
    ? CallStatus.COMPLETED
    : call.callerId === userId
      ? CallStatus.CANCELLED
      : CallStatus.REJECTED;
  const durationSec = await finalizeCall(call, status);
  emitToUsers([otherParty(call, userId)], "call:ended", {
    callId: call.id,
    reason: "ended",
    durationSec,
  });
};

/** Relays a WebRTC signaling payload to the other participant of an active call. */
const relaySignal = (userId: string, event: string, payload: unknown): void => {
  const { callId } = (payload ?? {}) as { callId?: unknown };
  const call = requireCall(callId, userId);
  if (!call) return;
  emitToUsers([otherParty(call, userId)], event, payload);
};

/**
 * Ends any active call the user was engaged in after their last socket drops
 * (tab closed, network lost) and notifies the other party.
 */
export const handleCallParticipantGone = async (userId: string): Promise<void> => {
  const callId = userCall.get(userId);
  if (!callId) return;
  const call = callsById.get(callId);
  if (!call) {
    userCall.delete(userId);
    return;
  }
  const wasAnswered = call.status === CallStatus.ANSWERED;
  const status = wasAnswered
    ? CallStatus.COMPLETED
    : call.callerId === userId
      ? CallStatus.CANCELLED
      : CallStatus.MISSED;
  const durationSec = await finalizeCall(call, status);
  const other = otherParty(call, userId);
  if (wasAnswered) {
    emitToUsers([other], "call:ended", {
      callId: call.id,
      reason: "disconnected",
      durationSec,
    });
  } else if (other === call.calleeId) {
    emitToUsers([other], "call:cancelled", { callId: call.id });
  } else {
    emitToUsers([other], "call:ended", {
      callId: call.id,
      reason: "disconnected",
      durationSec: 0,
    });
  }
};

/** Wires voice-call signaling handlers onto a freshly connected socket. */
export const registerCallHandlers = (socket: Socket, userId: string): void => {
  const guard =
    (handler: (userId: string, payload: unknown, ack: unknown) => Promise<void>) =>
    (payload: unknown, ack: unknown) => {
      handler(userId, payload, ack).catch((err) =>
        logger.warn({ err }, "Call handler failed"),
      );
    };

  socket.on("call:initiate", guard(onInitiate));
  socket.on("call:accept", guard((id, p) => onAccept(id, p)));
  socket.on("call:reject", guard((id, p) => onReject(id, p)));
  socket.on("call:cancel", guard((id, p) => onCancel(id, p)));
  socket.on("call:end", guard((id, p) => onEnd(id, p)));

  socket.on("call:offer", (payload: unknown) => relaySignal(userId, "call:offer", payload));
  socket.on("call:answer", (payload: unknown) => relaySignal(userId, "call:answer", payload));
  socket.on("call:ice", (payload: unknown) => relaySignal(userId, "call:ice", payload));
};
