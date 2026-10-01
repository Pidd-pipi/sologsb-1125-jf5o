import type { Table } from 'dexie';
import type { RevisionedFields } from '../types/revision';

/** 四类带修订号的记录 */
export type RecordEntity = 'sample' | 'find' | 'section' | 'analysis';

/** 保存前比对发现库内版本更新时返回的冲突信息 */
export interface RevisionConflict<T> {
  entity: RecordEntity;
  id: string;
  /** 打开编辑时读到的版本（我方基线） */
  base: T;
  /** 库内最新版本（对方已保存的内容） */
  current: T;
  /** 本次试图写入的改动（我方改动） */
  patch: Partial<T>;
  /** 编辑时基于的修订号 */
  baseRevision: number;
  /** 库内当前修订号 */
  currentRevision: number;
  /** 对方相对基线的改动（current − base） */
  theirs: Partial<T>;
}

export type RevisionUpdateResult<T> =
  | { ok: true; record: T; revision: number }
  | { ok: false; reason: 'conflict'; conflict: RevisionConflict<T> }
  | { ok: false; reason: 'missing' };

/** 浅比较，minerals 这类嵌套对象按子键比较 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as Record<string, unknown>);
    const kb = Object.keys(b as Record<string, unknown>);
    if (ka.length !== kb.length) return false;
    return ka.every((k) =>
      sameValue((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]),
    );
  }
  return false;
}

/** current 相对 base 的改动（仅保留变化键，嵌套对象只保留变化子键） */
export function computeTheirs<T extends object>(base: T, current: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(current as Record<string, unknown>)) {
    const b = (base as Record<string, unknown>)[key];
    const c = (current as Record<string, unknown>)[key];
    if (sameValue(b, c)) continue;
    if (b && c && typeof b === 'object' && typeof c === 'object' && !Array.isArray(b) && !Array.isArray(c)) {
      const sub: Record<string, unknown> = {};
      for (const subKey of Object.keys(c as Record<string, unknown>)) {
        if (!sameValue((b as Record<string, unknown>)[subKey], (c as Record<string, unknown>)[subKey])) {
          sub[subKey] = (c as Record<string, unknown>)[subKey];
        }
      }
      out[key] = sub;
    } else {
      out[key] = c;
    }
  }
  return out as Partial<T>;
}

/**
 * 带修订号的条件更新：
 *  - 库内记录不存在 → missing
 *  - 库内 revision 与编辑时基线不一致 → conflict（拒绝写入，返回双方改动）
 *  - 一致 → 写入并把 revision +1
 *
 * @param base 打开编辑时读到的完整记录（我方基线），用于列出对方改动
 */
export async function guardUpdate<T extends RevisionedFields, TKey = string>(
  table: Table<T, TKey>,
  id: string,
  base: T,
  patch: Partial<T>,
  now: number = Date.now(),
): Promise<RevisionUpdateResult<T>> {
  const current = await table.get(id as TKey);
  if (!current) return { ok: false, reason: 'missing' };
  if (current.revision !== base.revision) {
    return {
      ok: false,
      reason: 'conflict',
      conflict: {
        entity: guessEntity(table.name),
        id,
        base,
        current,
        patch,
        baseRevision: base.revision,
        currentRevision: current.revision,
        theirs: computeTheirs(base, current),
      },
    };
  }
  // 以库内值为底叠补丁；修订号与更新时间只能由这里推进
  const next = { ...current, ...patch, revision: current.revision + 1, updatedAt: now } as T;
  await table.put(next);
  return { ok: true, record: next, revision: next.revision };
}

function guessEntity(tableName: string): RecordEntity {
  if (tableName === 'samples') return 'sample';
  if (tableName === 'finds') return 'find';
  if (tableName === 'sections') return 'section';
  return 'analysis';
}
