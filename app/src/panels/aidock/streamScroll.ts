const STREAM_BOTTOM_TOLERANCE = 32;

export interface StreamScrollSnapshot {
  atBottom: boolean;
  scrollTop: number;
  scrollHeight: number;
  clientHeight: number;
  anchorMessageId: string | null;
  anchorOffsetTop: number;
}

export function streamScrollKey(
  layout: 'dock' | 'chat',
  workspaceId: string | null | undefined,
  sessionId: string | null | undefined,
): string {
  return `${layout}:${workspaceId ?? 'global'}:${sessionId ?? 'none'}`;
}

export function isStreamAtBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= STREAM_BOTTOM_TOLERANCE;
}

export function scrollStreamToBottom(el: HTMLElement): void {
  if (typeof el.scrollTo === 'function') {
    el.scrollTo({ top: el.scrollHeight, behavior: 'instant' });
  } else {
    el.scrollTop = el.scrollHeight;
  }
}

function visibleStreamAnchor(
  stream: HTMLElement,
  messageRefs: Map<string, HTMLLIElement>,
): { messageId: string; offsetTop: number } | null {
  const streamRect = stream.getBoundingClientRect();
  if (streamRect.height <= 0 && stream.clientHeight <= 0) return null;

  for (const [messageId, node] of messageRefs) {
    const rect = node.getBoundingClientRect();
    const hasLayout =
      rect.width !== 0 || rect.height !== 0 || rect.top !== 0 || rect.bottom !== 0;
    if (!hasLayout) continue;
    if (rect.bottom < streamRect.top) continue;
    if (rect.top > streamRect.bottom) continue;
    return { messageId, offsetTop: rect.top - streamRect.top };
  }

  return null;
}

export function readStreamScrollSnapshot(
  stream: HTMLElement,
  messageRefs: Map<string, HTMLLIElement>,
): StreamScrollSnapshot {
  const anchor = visibleStreamAnchor(stream, messageRefs);
  return {
    atBottom: isStreamAtBottom(stream),
    scrollTop: stream.scrollTop,
    scrollHeight: stream.scrollHeight,
    clientHeight: stream.clientHeight,
    anchorMessageId: anchor?.messageId ?? null,
    anchorOffsetTop: anchor?.offsetTop ?? 0,
  };
}

export function restoreStreamScrollSnapshot(
  stream: HTMLElement,
  messageRefs: Map<string, HTMLLIElement>,
  snapshot: StreamScrollSnapshot | undefined,
): boolean {
  if (!snapshot || snapshot.atBottom) {
    scrollStreamToBottom(stream);
    return true;
  }

  if (snapshot.anchorMessageId) {
    const node = messageRefs.get(snapshot.anchorMessageId);
    if (!node) {
      stream.scrollTop = snapshot.scrollTop;
      return false;
    }
    const streamRect = stream.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const delta =
      nodeRect.top - streamRect.top - snapshot.anchorOffsetTop;
    if (Number.isFinite(delta) && Math.abs(delta) > 0.5) {
      stream.scrollTop += delta;
    }
    return true;
  }

  stream.scrollTop = snapshot.scrollTop;
  return true;
}
