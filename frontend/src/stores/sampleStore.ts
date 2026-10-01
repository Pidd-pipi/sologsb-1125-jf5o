import { create } from 'zustand';
import type { Table } from 'dexie';
import { db, makeId, seedIfEmpty } from '../db';
import type { AnalysisRecord } from '../types/analysis';
import type { FindRecord } from '../types/find';
import type { MeteoriteSample } from '../types/sample';
import type { ThinSection } from '../types/section';
import type { RecordKind, RevisionConflict, PendingWrite } from '../types/conflict';
import { diffRecords, deepEqual, nextRevision, recordLabel, REVISION_FIELD } from '../utils/revision';

const PENDING_WRITES_KEY = 'gbmeteorite:pending-writes';

export interface SampleState {
  samples: MeteoriteSample[];
  finds: FindRecord[];
  sections: ThinSection[];
  analysis: AnalysisRecord[];
  loading: boolean;
  loaded: boolean;
  /** 当前待处理的修订号冲突（全局只展示一个合并对话框） */
  conflict: RevisionConflict | null;
  /** 写入失败 / 冲突未决、待重试的挂起写入 */
  pendingWrites: PendingWrite[];
  loadAll: () => Promise<void>;
  addSample: (input: Omit<MeteoriteSample, 'id' | 'createdAt' | 'updatedAt' | 'revision'>) => Promise<string>;
  updateSample: (base: MeteoriteSample, patch: Partial<MeteoriteSample>) => Promise<void>;
  removeSample: (id: string) => Promise<void>;
  addFind: (input: Omit<FindRecord, 'id' | 'createdAt' | 'revision'>) => Promise<string>;
  updateFind: (base: FindRecord, patch: Partial<FindRecord>) => Promise<void>;
  addSection: (input: Omit<ThinSection, 'id' | 'createdAt' | 'revision'>) => Promise<string>;
  updateSection: (base: ThinSection, patch: Partial<ThinSection>) => Promise<void>;
  addAnalysis: (input: Omit<AnalysisRecord, 'id' | 'createdAt' | 'revision'>) => Promise<string>;
  updateAnalysis: (base: AnalysisRecord, patch: Partial<AnalysisRecord>) => Promise<void>;
  /** 切片换绑后，用户确认检测记录仍有效（清除 needsReconfirm 标记） */
  reconfirmAnalysis: (base: AnalysisRecord) => Promise<void>;
  /** 冲突合并完成后，以合并结果入库 */
  resolveConflict: (kind: RecordKind, merged: Record<string, unknown>) => Promise<void>;
  /** 关闭冲突对话框；discard=true 表示放弃本地改动（不挂起），false 表示挂起稍后重试 */
  discardConflict: (discard?: boolean) => void;
  retryPendingWrite: (id: string) => Promise<void>;
  discardPendingWrite: (id: string) => void;
  nextSampleSeq: () => number;
}

type SetState = (partial: Partial<SampleState> | ((state: SampleState) => Partial<SampleState>)) => void;
type GetState = () => SampleState;

function tableFor(kind: RecordKind): Table<Record<string, unknown>, string> {
  switch (kind) {
    case 'sample':
      return db.samples as unknown as Table<Record<string, unknown>, string>;
    case 'find':
      return db.finds as unknown as Table<Record<string, unknown>, string>;
    case 'section':
      return db.sections as unknown as Table<Record<string, unknown>, string>;
    case 'analysis':
      return db.analysis as unknown as Table<Record<string, unknown>, string>;
  }
}

function collectionKey(kind: RecordKind): 'samples' | 'finds' | 'sections' | 'analysis' {
  switch (kind) {
    case 'sample':
      return 'samples';
    case 'find':
      return 'finds';
    case 'section':
      return 'sections';
    case 'analysis':
      return 'analysis';
  }
}

function loadPendingWrites(): PendingWrite[] {
  try {
    const raw = localStorage.getItem(PENDING_WRITES_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw) as PendingWrite[];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function persistPendingWrites(writes: PendingWrite[]) {
  try {
    localStorage.setItem(PENDING_WRITES_KEY, JSON.stringify(writes));
  } catch {
    /* 存储不可用时静默，不影响主流程 */
  }
}

function upsertPendingWrite(set: SetState, get: GetState, write: PendingWrite) {
  const exists = get().pendingWrites.some((w) => w.id === write.id);
  const next = exists
    ? get().pendingWrites.map((w) => (w.id === write.id ? write : w))
    : [...get().pendingWrites, write];
  set({ pendingWrites: next });
  persistPendingWrites(next);
}

function removePendingWrite(set: SetState, get: GetState, id: string) {
  const next = get().pendingWrites.filter((w) => w.id !== id);
  set({ pendingWrites: next });
  persistPendingWrites(next);
}

/**
 * 通用乐观锁更新：
 *  1. 读库内当前记录，比对 revision
 *  2. 不一致 → 构造 RevisionConflict 并写入 state.conflict，返回 'conflict'
 *  3. 一致 → 写入 revision+1，同步内存列表，返回 'ok'
 *  4. 记录已被删除 → 返回 'deleted'
 */
async function applyUpdate(
  kind: RecordKind,
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
  set: SetState,
  get: GetState,
): Promise<{ status: 'ok' } | { status: 'conflict'; conflict: RevisionConflict } | { status: 'deleted' }> {
  const id = base.id as string;
  const baseRevision = (base[REVISION_FIELD] as number) ?? 0;
  const table = tableFor(kind);

  let remote: Record<string, unknown> | undefined;
  try {
    remote = (await table.get(id)) as Record<string, unknown> | undefined;
  } catch (err) {
    // 读取失败：挂起待重试
    upsertPendingWrite(
      set,
      get,
      makePendingWrite(kind, base, patch, baseRevision, 'error', `读取库内记录失败：${(err as Error).message}`),
    );
    return { status: 'deleted' };
  }

  if (!remote) {
    return { status: 'deleted' };
  }

  const remoteRevision = remote[REVISION_FIELD] as number;

  if (remoteRevision !== baseRevision) {
    const local = { ...base, ...patch };
    const diffs = diffRecords(base, remote, local, kind);
    const conflict: RevisionConflict = {
      kind,
      recordId: id,
      recordLabel: recordLabel(kind, remote),
      baseRevision,
      remoteRevision,
      base,
      remote,
      local,
      diffs,
    };
    set({ conflict });
    return { status: 'conflict', conflict };
  }

  const next = { ...remote, ...patch, [REVISION_FIELD]: nextRevision(remoteRevision) };
  try {
    await table.put(next);
  } catch (err) {
    upsertPendingWrite(
      set,
      get,
      makePendingWrite(kind, base, patch, baseRevision, 'error', `写入失败：${(err as Error).message}`),
    );
    return { status: 'deleted' };
  }

  const key = collectionKey(kind);
  set((state) => ({
    [key]: (state[key] as { id: string }[]).map((r) => (r.id === id ? next : r)),
  }) as Partial<SampleState>);

  return { status: 'ok' };
}

function makePendingWrite(
  kind: RecordKind,
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
  baseRevision: number,
  reason: PendingWrite['reason'],
  lastError?: string,
): PendingWrite {
  return {
    id: `pending_${kind}_${base.id}_${Date.now().toString(36)}`,
    kind,
    recordId: base.id as string,
    recordLabel: recordLabel(kind, base),
    record: { ...base, ...patch },
    base,
    baseRevision,
    createdAt: Date.now(),
    reason,
    lastError,
  };
}

export const useSampleStore = create<SampleState>((set, get) => ({
  samples: [],
  finds: [],
  sections: [],
  analysis: [],
  loading: false,
  loaded: false,
  conflict: null,
  pendingWrites: [],

  loadAll: async () => {
    set({ loading: true });
    await seedIfEmpty();
    const [samples, finds, sections, analysis] = await Promise.all([
      db.samples.toArray(),
      db.finds.toArray(),
      db.sections.toArray(),
      db.analysis.toArray(),
    ]);
    samples.sort((a, b) => b.createdAt - a.createdAt);
    finds.sort((a, b) => b.createdAt - a.createdAt);
    sections.sort((a, b) => b.createdAt - a.createdAt);
    analysis.sort((a, b) => b.createdAt - a.createdAt);
    set({
      samples,
      finds,
      sections,
      analysis,
      loading: false,
      loaded: true,
      pendingWrites: loadPendingWrites(),
    });
  },

  addSample: async (input) => {
    const now = Date.now();
    const record: MeteoriteSample = { ...input, id: makeId('sample'), createdAt: now, updatedAt: now, revision: 1 };
    await db.samples.add(record);
    set({ samples: [record, ...get().samples] });
    return record.id;
  },

  updateSample: async (base, patch) => {
    await applyUpdate('sample', base as unknown as Record<string, unknown>, patch as Record<string, unknown>, set, get);
  },

  removeSample: async (id) => {
    await db.transaction('rw', db.samples, db.finds, db.sections, db.analysis, async () => {
      await db.samples.delete(id);
      await db.finds.where('sampleId').equals(id).delete();
      await db.sections.where('sampleId').equals(id).delete();
      await db.analysis.where('sampleId').equals(id).delete();
    });
    set({
      samples: get().samples.filter((s) => s.id !== id),
      finds: get().finds.filter((f) => f.sampleId !== id),
      sections: get().sections.filter((s) => s.sampleId !== id),
      analysis: get().analysis.filter((a) => a.sampleId !== id),
    });
  },

  addFind: async (input) => {
    const record: FindRecord = { ...input, id: makeId('find'), createdAt: Date.now(), revision: 1 };
    await db.finds.add(record);
    set({ finds: [record, ...get().finds] });
    return record.id;
  },

  updateFind: async (base, patch) => {
    await applyUpdate('find', base as unknown as Record<string, unknown>, patch as Record<string, unknown>, set, get);
  },

  addSection: async (input) => {
    const record: ThinSection = { ...input, id: makeId('section'), createdAt: Date.now(), revision: 1 };
    await db.sections.add(record);
    set({ sections: [record, ...get().sections] });
    return record.id;
  },

  updateSection: async (base, patch) => {
    // 切片换绑样本：关联检测记录失效，需重新确认
    const rebinding = Boolean(patch.sampleId) && patch.sampleId !== base.sampleId;

    if (rebinding) {
      // 切片更新与检测记录失效标记放在同一事务，避免不一致
      const id = base.id;
      const baseRevision = base.revision;
      const table = db.sections;
      const remote = (await table.get(id)) as ThinSection | undefined;
      if (!remote) return;
      if (remote.revision !== baseRevision) {
        // 走通用冲突流程
        await applyUpdate('section', base as unknown as Record<string, unknown>, patch as Record<string, unknown>, set, get);
        return;
      }
      const next: ThinSection = {
        ...remote,
        ...patch,
        revision: nextRevision(remote.revision),
      } as ThinSection;
      await db.transaction('rw', db.sections, db.analysis, async () => {
        await db.sections.put(next);
        await db.analysis.where('sectionId').equals(id).modify({ needsReconfirm: true });
      });
      set((state) => ({
        sections: state.sections.map((s) => (s.id === id ? next : s)),
        analysis: state.analysis.map((a) => (a.sectionId === id ? { ...a, needsReconfirm: true } : a)),
      }));
      return;
    }

    await applyUpdate('section', base as unknown as Record<string, unknown>, patch as Record<string, unknown>, set, get);
  },

  addAnalysis: async (input) => {
    const record: AnalysisRecord = { ...input, id: makeId('analysis'), createdAt: Date.now(), revision: 1 };
    await db.analysis.add(record);
    set({ analysis: [record, ...get().analysis] });
    return record.id;
  },

  updateAnalysis: async (base, patch) => {
    await applyUpdate('analysis', base as unknown as Record<string, unknown>, patch as Record<string, unknown>, set, get);
  },

  reconfirmAnalysis: async (base) => {
    // 切片换绑后重新确认：若检测对象是切片，同步样本归属到切片当前所属样本
    const patch: Record<string, unknown> = { needsReconfirm: false };
    if (base.target === 'section' && base.sectionId) {
      const section = await db.sections.get(base.sectionId);
      if (section) patch.sampleId = section.sampleId;
    }
    await applyUpdate(
      'analysis',
      base as unknown as Record<string, unknown>,
      patch,
      set,
      get,
    );
  },

  resolveConflict: async (kind, merged) => {
    const id = merged.id as string;
    const table = tableFor(kind);
    let remote: Record<string, unknown> | undefined;
    try {
      remote = (await table.get(id)) as Record<string, unknown> | undefined;
    } catch {
      remote = undefined;
    }
    const currentRevision = remote ? (remote[REVISION_FIELD] as number) : ((merged[REVISION_FIELD] as number) ?? 0);
    const next = { ...merged, [REVISION_FIELD]: nextRevision(currentRevision) };
    try {
      await table.put(next);
    } catch (err) {
      upsertPendingWrite(
        set,
        get,
        {
          id: `pending_${kind}_${id}_${Date.now().toString(36)}`,
          kind,
          recordId: id,
          recordLabel: recordLabel(kind, merged),
          record: merged,
          base: merged,
          baseRevision: currentRevision,
          createdAt: Date.now(),
          reason: 'error',
          lastError: `合并写入失败：${(err as Error).message}`,
        },
      );
      return;
    }
    const key = collectionKey(kind);
    set((state) => ({
      [key]: (state[key] as { id: string }[]).map((r) => (r.id === id ? next : r)),
      conflict: null,
    }) as Partial<SampleState>);
    // 若该记录在挂起队列中，移除
    const pending = get().pendingWrites.filter((w) => !(w.kind === kind && w.recordId === id));
    if (pending.length !== get().pendingWrites.length) {
      set({ pendingWrites: pending });
      persistPendingWrites(pending);
    }
  },

  discardConflict: (discard = false) => {
    const conflict = get().conflict;
    if (conflict) {
      if (discard) {
        // 放弃本地改动（以库内为准）：移除对应的挂起写入
        const pending = get().pendingWrites.filter(
          (w) => !(w.kind === conflict.kind && w.recordId === conflict.recordId),
        );
        if (pending.length !== get().pendingWrites.length) {
          set({ pendingWrites: pending });
          persistPendingWrites(pending);
        }
      } else {
        // 挂起稍后重试
        upsertPendingWrite(set, get, {
          id: `pending_${conflict.kind}_${conflict.recordId}_${Date.now().toString(36)}`,
          kind: conflict.kind,
          recordId: conflict.recordId,
          recordLabel: conflict.recordLabel,
          record: conflict.local,
          base: conflict.base,
          baseRevision: conflict.baseRevision,
          createdAt: Date.now(),
          reason: 'conflict',
        });
      }
    }
    set({ conflict: null });
  },

  retryPendingWrite: async (id) => {
    const write = get().pendingWrites.find((w) => w.id === id);
    if (!write) return;
    // 从 base 与 record 计算本次改动（patch），用于乐观锁比对与 diff
    const patch: Record<string, unknown> = {};
    for (const key of Object.keys(write.record)) {
      if (!deepEqual(write.base[key], write.record[key])) {
        patch[key] = write.record[key];
      }
    }
    const result = await applyUpdate(write.kind, write.base, patch, set, get);
    if (result.status === 'ok') {
      removePendingWrite(set, get, id);
    } else if (result.status === 'conflict') {
      // 冲突已写入 state.conflict；更新挂起记录的 base 与 baseRevision
      const conflict = result.conflict;
      const next: PendingWrite = {
        ...write,
        record: conflict.local,
        base: conflict.base,
        baseRevision: conflict.baseRevision,
        reason: 'conflict',
        lastError: undefined,
      };
      upsertPendingWrite(set, get, next);
    } else {
      // deleted：记录已不存在，保留挂起并提示
      upsertPendingWrite(set, get, { ...write, lastError: '记录已被删除，无法重试' });
    }
  },

  discardPendingWrite: (id) => {
    removePendingWrite(set, get, id);
  },

  nextSampleSeq: () => {
    const year = new Date().getFullYear();
    const prefix = `MET-${year}-`;
    const used = get()
      .samples.map((s) => s.sampleNo)
      .filter((no) => no.startsWith(prefix))
      .map((no) => Number(no.slice(prefix.length)))
      .filter((n) => Number.isFinite(n));
    const max = used.length ? Math.max(...used) : 0;
    return max + 1;
  },
}));
