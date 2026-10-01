import { create } from 'zustand';
import { db, makeId, seedIfEmpty } from '../db';
import { computeTheirs, guardUpdate, type RecordEntity, type RevisionConflict, type RevisionUpdateResult } from '../db/revision';
import { broadcastChanged } from '../db/sync';
import type { AnalysisRecord } from '../types/analysis';
import type { FindRecord } from '../types/find';
import type { MeteoriteSample } from '../types/sample';
import type { ThinSection } from '../types/section';

/** 更新结果：成功 / 版本冲突（含双方改动）/ 记录已删除 */
export type SaveResult<T> = RevisionUpdateResult<T>;
export type { RevisionConflict };

export interface SampleState {
  samples: MeteoriteSample[];
  finds: FindRecord[];
  sections: ThinSection[];
  analysis: AnalysisRecord[];
  loading: boolean;
  loaded: boolean;
  loadAll: () => Promise<void>;
  addSample: (input: Omit<MeteoriteSample, 'id' | 'createdAt' | 'updatedAt' | 'revision'>) => Promise<string>;
  updateSample: (id: string, patch: Partial<MeteoriteSample>) => Promise<SaveResult<MeteoriteSample>>;
  removeSample: (id: string) => Promise<void>;
  addFind: (input: Omit<FindRecord, 'id' | 'createdAt' | 'updatedAt' | 'revision'>) => Promise<string>;
  updateFind: (id: string, patch: Partial<FindRecord>) => Promise<SaveResult<FindRecord>>;
  addSection: (input: Omit<ThinSection, 'id' | 'createdAt' | 'updatedAt' | 'revision'>) => Promise<string>;
  updateSection: (id: string, patch: Partial<ThinSection>) => Promise<SaveResult<ThinSection>>;
  /** 切片换绑样本：级联使关联检测记录失效（confirmed=false，revision +1）；并发改过的检测跳过 */
  rebindSection: (
    id: string,
    newSampleId: string,
    extraPatch?: Partial<ThinSection>,
  ) => Promise<SaveResult<ThinSection> & { invalidatedAnalysis?: number; skippedAnalysis?: number }>;
  addAnalysis: (
    input: Omit<AnalysisRecord, 'id' | 'createdAt' | 'updatedAt' | 'revision'>,
  ) => Promise<string>;
  updateAnalysis: (id: string, patch: Partial<AnalysisRecord>) => Promise<SaveResult<AnalysisRecord>>;
  /** 重新确认失效的检测记录（confirmed 置回 true） */
  confirmAnalysis: (id: string) => Promise<SaveResult<AnalysisRecord>>;
  /** 从库内重新读取全部数据（跨标签页写入后同步） */
  refreshFromDb: () => Promise<void>;
  nextSampleSeq: () => number;
}

/** 内存数组中按 id 替换单条记录（保持新建在前的顺序不变） */
function replaceById<T extends { id: string }>(list: T[], next: T): T[] {
  return list.map((x) => (x.id === next.id ? next : x));
}

export const useSampleStore = create<SampleState>((set, get) => ({
  samples: [],
  finds: [],
  sections: [],
  analysis: [],
  loading: false,
  loaded: false,

  loadAll: async () => {
    set({ loading: true });
    await seedIfEmpty();
    await get().refreshFromDb();
    set({ loading: false, loaded: true });
  },

  refreshFromDb: async () => {
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
    set({ samples, finds, sections, analysis });
  },

  addSample: async (input) => {
    const now = Date.now();
    const record: MeteoriteSample = {
      ...input,
      id: makeId('sample'),
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    await db.samples.add(record);
    set({ samples: [record, ...get().samples] });
    broadcastChanged();
    return record.id;
  },

  updateSample: async (id, patch) => {
    const base = get().samples.find((s) => s.id === id);
    if (!base) return { ok: false, reason: 'missing' };
    const result = await guardUpdate(db.samples, id, base, patch);
    if (result.ok) {
      set({ samples: replaceById(get().samples, result.record) });
      broadcastChanged();
    }
    return result;
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
    broadcastChanged();
  },

  addFind: async (input) => {
    const now = Date.now();
    const record: FindRecord = { ...input, id: makeId('find'), createdAt: now, updatedAt: now, revision: 1 };
    await db.finds.add(record);
    set({ finds: [record, ...get().finds] });
    broadcastChanged();
    return record.id;
  },

  updateFind: async (id, patch) => {
    const base = get().finds.find((f) => f.id === id);
    if (!base) return { ok: false, reason: 'missing' };
    const result = await guardUpdate(db.finds, id, base, patch);
    if (result.ok) {
      set({ finds: replaceById(get().finds, result.record) });
      broadcastChanged();
    }
    return result;
  },

  addSection: async (input) => {
    const now = Date.now();
    const record: ThinSection = { ...input, id: makeId('section'), createdAt: now, updatedAt: now, revision: 1 };
    await db.sections.add(record);
    set({ sections: [record, ...get().sections] });
    broadcastChanged();
    return record.id;
  },

  updateSection: async (id, patch) => {
    const base = get().sections.find((s) => s.id === id);
    if (!base) return { ok: false, reason: 'missing' };
    const result = await guardUpdate(db.sections, id, base, patch);
    if (result.ok) {
      set({ sections: replaceById(get().sections, result.record) });
      broadcastChanged();
    }
    return result;
  },

  rebindSection: async (id, newSampleId, extraPatch = {}) => {
    const base = get().sections.find((s) => s.id === id);
    if (!base) return { ok: false, reason: 'missing' as const };

    // 内存中的关联检测快照（用于事务内逐条比对修订号）
    const linkedSnapshot = get().analysis.filter((a) => a.sectionId === id);
    const snapshotRev = new Map(linkedSnapshot.map((a) => [a.id, a.revision]));
    let invalidatedAnalysis = 0;
    let skippedAnalysis = 0;

    const result = await db.transaction(
      'rw',
      db.sections,
      db.analysis,
      async (): Promise<SaveResult<ThinSection>> => {
        const current = await db.sections.get(id);
        if (!current) return { ok: false, reason: 'missing' };
        if (current.revision !== base.revision) {
          return {
            ok: false,
            reason: 'conflict',
            conflict: {
              entity: 'section' as RecordEntity,
              id,
              base,
              current,
              patch: { sampleId: newSampleId, ...extraPatch },
              baseRevision: base.revision,
              currentRevision: current.revision,
              theirs: computeTheirs(base, current),
            },
          };
        }
        const now = Date.now();
        const nextSection: ThinSection = {
          ...current,
          ...extraPatch,
          sampleId: newSampleId,
          revision: current.revision + 1,
          updatedAt: now,
        };
        await db.sections.put(nextSection);

        // 关联检测记录：从事务内按 sectionId 索引实时读取，逐条校验修订号。
        // 修订号已变（别的标签页刚改过该检测）的记录不覆盖，跳过并计数，由人工处理。
        const linked = await db.analysis.where('sectionId').equals(id).toArray();
        await Promise.all(
          linked.map(async (currentA) => {
            const baseRev = snapshotRev.get(currentA.id);
            if (baseRev !== undefined && currentA.revision !== baseRev) {
              skippedAnalysis += 1;
              return;
            }
            const nextA: AnalysisRecord = {
              ...currentA,
              sampleId: newSampleId,
              confirmed: false,
              confirmedAt: undefined,
              revision: currentA.revision + 1,
              updatedAt: now,
            };
            // IndexedDB 对 undefined 键的支持不一致，显式删除
            delete (nextA as Partial<AnalysisRecord>).confirmedAt;
            invalidatedAnalysis += 1;
            await db.analysis.put(nextA);
          }),
        );
        return { ok: true, record: nextSection, revision: nextSection.revision };
      },
    );

    if (result.ok) {
      // 事务内对部分检测记录做了跳过（并发改过），直接以库内为准重拉检测与切片列表
      const [latestSections, latestAnalysis] = await Promise.all([
        db.sections.toArray(),
        db.analysis.toArray(),
      ]);
      latestSections.sort((a, b) => b.createdAt - a.createdAt);
      latestAnalysis.sort((a, b) => b.createdAt - a.createdAt);
      set({
        sections: replaceById(latestSections, result.record),
        analysis: latestAnalysis,
      });
      broadcastChanged();
    }
    return {
      ...result,
      invalidatedAnalysis: result.ok ? invalidatedAnalysis : 0,
      skippedAnalysis: result.ok ? skippedAnalysis : 0,
    };
  },

  addAnalysis: async (input) => {
    const now = Date.now();
    const record: AnalysisRecord = {
      ...input,
      id: makeId('analysis'),
      createdAt: now,
      updatedAt: now,
      revision: 1,
    };
    await db.analysis.add(record);
    set({ analysis: [record, ...get().analysis] });
    broadcastChanged();
    return record.id;
  },

  updateAnalysis: async (id, patch) => {
    const base = get().analysis.find((a) => a.id === id);
    if (!base) return { ok: false, reason: 'missing' };
    const nextPatch: Partial<AnalysisRecord> = { ...patch };
    // confirmed 变化时同步 confirmedAt
    if (nextPatch.confirmed === true) nextPatch.confirmedAt = Date.now();
    if (nextPatch.confirmed === false) delete nextPatch.confirmedAt;
    const result = await guardUpdate(db.analysis, id, base, nextPatch);
    if (result.ok) {
      set({ analysis: replaceById(get().analysis, result.record) });
      broadcastChanged();
    }
    return result;
  },

  confirmAnalysis: async (id) => {
    return get().updateAnalysis(id, { confirmed: true });
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
