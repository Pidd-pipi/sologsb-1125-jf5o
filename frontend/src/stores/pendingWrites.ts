import { useSyncExternalStore } from 'react';
import type { RecordEntity } from '../db/revision';

/**
 * 写入失败（版本冲突待合并、事务异常等）时，把这次保存意图落到 localStorage，
 * 用户可在待恢复条上「重试」或「丢弃」，避免后保存静默丢失或草稿直接蒸发。
 */
const STORAGE_KEY = 'gbmeteorite:pending-writes';

/** 保存意图：携带编辑时的完整基线记录与补丁，重试时重新比对库内修订号 */
export interface PendingWrite {
  /** 本地待办 id */
  pendingId: string;
  entity: RecordEntity;
  /** 目标记录 id（已存在的记录） */
  recordId: string;
  /** 人类可读的记录名，如 MET-2024-001 */
  recordLabel: string;
  /** 打开编辑时读到的完整基线 */
  base: unknown;
  /** 本次要写入的补丁 */
  patch: Record<string, unknown>;
  /** 是否切片换绑（需要级联失效关联检测记录） */
  rebind?: boolean;
  /** 进入待办的原因说明 */
  reason: string;
  createdAt: number;
}

function readAll(): PendingWrite[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PendingWrite[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 非 React 场景直接读取待办清单（persist 服务重试时使用） */
export function readPending(): PendingWrite[] {
  return readAll();
}

function writeAll(list: PendingWrite[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  } catch {
    /* 存储不可用时静默降级 */
  }
  listeners.forEach((l) => l());
}

const listeners = new Set<() => void>();

function subscribe(l: () => void): () => void {
  listeners.add(l);
  // 跨标签页同步待办状态
  window.addEventListener('storage', l);
  return () => {
    listeners.delete(l);
    window.removeEventListener('storage', l);
  };
}

/** 存入一条待恢复写入（若同记录已有待办，替换其补丁） */
export function stashPending(write: Omit<PendingWrite, 'pendingId' | 'createdAt'>): PendingWrite {
  const list = readAll();
  const item: PendingWrite = {
    ...write,
    pendingId: `pending_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: Date.now(),
  };
  const idx = list.findIndex((w) => w.entity === item.entity && w.recordId === item.recordId);
  if (idx >= 0) list[idx] = item;
  else list.unshift(item);
  writeAll(list);
  return item;
}

export function removePending(pendingId: string): void {
  writeAll(readAll().filter((w) => w.pendingId !== pendingId));
}

export function replacePending(pendingId: string, next: Partial<PendingWrite>): void {
  const list = readAll().map((w) => (w.pendingId === pendingId ? { ...w, ...next } : w));
  writeAll(list);
}

// useSyncExternalStore 需要稳定快照，直接返回对象会触发无限渲染：用缓存快照
let cachedRaw: string | null = null;
let cachedList: PendingWrite[] = [];

export function usePendingWrites(): PendingWrite[] {
  return useSyncExternalStore(
    subscribe,
    () => {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw !== cachedRaw) {
        cachedRaw = raw;
        cachedList = raw ? (readAll() as PendingWrite[]) : [];
      }
      return cachedList;
    },
    () => cachedList,
  );
}
