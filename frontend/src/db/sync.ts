/**
 * 多标签页数据变更广播：一个标签页成功写入后通知其他标签页重新拉取，
 * 尽量缩短「拿着旧修订号编辑」的窗口。真正的并发安全仍由修订号乐观锁兜底。
 */
const CHANNEL_NAME = 'gbmeteorite-db-sync';

export type SyncMessage =
  | { type: 'changed'; at: number }
  | { type: 'reload-request'; at: number };

type Listener = (msg: SyncMessage) => void;

let channel: BroadcastChannel | null = null;
const listeners = new Set<Listener>();

function ensureChannel(): BroadcastChannel | null {
  if (channel) return channel;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
    channel.onmessage = (ev: MessageEvent<SyncMessage>) => {
      listeners.forEach((l) => l(ev.data));
    };
  } catch {
    // 隐私模式或旧浏览器没有 BroadcastChannel，静默降级（乐观锁仍然生效）
    channel = null;
  }
  return channel;
}

/** 订阅其他标签页的变更消息，返回取消订阅函数 */
export function subscribeSync(listener: Listener): () => void {
  ensureChannel();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 本标签页写入成功后广播，其他标签页据此刷新内存数据 */
export function broadcastChanged(): void {
  const ch = ensureChannel();
  if (ch) {
    try {
      ch.postMessage({ type: 'changed', at: Date.now() } satisfies SyncMessage);
    } catch {
      /* 忽略跨通道异常 */
    }
  }
}
