import type { RecordEntity, RevisionConflict, RevisionUpdateResult } from '../db/revision';
import { useConflictStore, type ConflictKind } from '../stores/conflictStore';
import { readPending, removePending, replacePending, stashPending, type PendingWrite } from '../stores/pendingWrites';
import { useSampleStore } from '../stores/sampleStore';
import type { AnalysisRecord } from '../types/analysis';
import type { FindRecord } from '../types/find';
import type { MeteoriteSample } from '../types/sample';
import type { ThinSection } from '../types/section';

type AnyRecord = MeteoriteSample | FindRecord | ThinSection | AnalysisRecord;

interface AttemptArgs<R extends AnyRecord> {
  entity: RecordEntity;
  kind: ConflictKind;
  recordId: string;
  recordLabel: string;
  base: R;
  patch: Partial<R>;
  /** 换绑目标样本（kind=rebind 时使用） */
  rebindSampleId?: string;
}

/** 按实体调对应的乐观锁更新方法 */
async function callUpdate(
  entity: RecordEntity,
  id: string,
  patch: Record<string, unknown>,
  rebindSampleId?: string,
): Promise<
  RevisionUpdateResult<AnyRecord> & {
    invalidatedAnalysis?: number;
    skippedAnalysis?: number;
  }
> {
  const store = useSampleStore.getState();
  switch (entity) {
    case 'sample':
      return store.updateSample(id, patch as Partial<MeteoriteSample>);
    case 'find':
      return store.updateFind(id, patch as Partial<FindRecord>);
    case 'section':
      if (rebindSampleId !== undefined) {
        const { sampleId: _omit, ...rest } = patch as Partial<ThinSection> & { sampleId?: string };
        void _omit;
        return store.rebindSection(id, rebindSampleId, rest);
      }
      return store.updateSection(id, patch as Partial<ThinSection>);
    case 'analysis':
      return store.updateAnalysis(id, patch as Partial<AnalysisRecord>);
  }
}

/** 记录名（样本用样本编号，切片用切片编号，其他回退 id） */
export function labelOf(entity: RecordEntity, record: unknown): string {
  const r = record as Partial<MeteoriteSample & ThinSection>;
  if (entity === 'sample') return r.sampleNo ?? (r.id as string);
  if (entity === 'section') return r.sectionNo ?? (r.id as string);
  return (r.id as string) ?? '未命名记录';
}

/**
 * 统一保存入口：
 *  1. 带修订号写入；版本过期 → 拒绝写入、暂存待办、弹出双方改动合并对话框
 *  2. 记录被删除 → 抛出可提示的错误
 *  3. 其他异常 → 同样暂存待办，可稍后重试
 *
 * @returns { ok:false } 表示未写入（冲突已暂存，等用户合并）；ok:true 携带写后信息
 */
export async function attemptSave<R extends AnyRecord>(
  args: AttemptArgs<R>,
): Promise<{ ok: boolean; invalidatedAnalysis?: number; skippedAnalysis?: number }> {
  const { entity, kind, recordId, recordLabel, base, patch, rebindSampleId } = args;
  let result: RevisionUpdateResult<AnyRecord> & {
    invalidatedAnalysis?: number;
    skippedAnalysis?: number;
  };
  try {
    result = await callUpdate(entity, recordId, patch as Record<string, unknown>, rebindSampleId);
  } catch (err) {
    stashPending({
      entity,
      recordId,
      recordLabel,
      base,
      patch: patch as Record<string, unknown>,
      rebind: kind === 'rebind',
      reason: `写入异常：${err instanceof Error ? err.message : String(err)}`,
    });
    throw err;
  }

  if (result.ok) {
    return {
      ok: true,
      invalidatedAnalysis: result.invalidatedAnalysis,
      skippedAnalysis: result.skippedAnalysis,
    };
  }

  if (result.reason === 'missing') {
    throw new Error('记录已被删除，无法保存修改');
  }

  // 版本过期：拒绝写入，暂存待办并弹出合并对话框
  const pending = stashPending({
    entity,
    recordId,
    recordLabel,
    base,
    patch: patch as Record<string, unknown>,
    rebind: kind === 'rebind',
    reason: `修订号过期（基线 r${(base as { revision: number }).revision}，库内 r${result.conflict.currentRevision}），已拒绝写入`,
  });

  useConflictStore.getState().present({
    conflict: result.conflict as RevisionConflict<never>,
    entity,
    kind,
    rebindSampleId,
    recordLabel,
    onResolved: async (mergedPatch) => {
      await retryPending(pending.pendingId, mergedPatch);
    },
  });
  return { ok: false };
}

/**
 * 重试一条待恢复写入（合并对话框确认或待办条点击重试都走这里）。
 * 合并后的补丁仍以库内最新修订号重新比对，再冲突会再次弹窗。
 */
export async function retryPending(
  pendingId: string,
  mergedPatch?: Record<string, unknown>,
): Promise<
  | { status: 'done'; invalidatedAnalysis?: number; skippedAnalysis?: number }
  | { status: 'still-conflict' }
  | { status: 'missing' }
> {
  const pending = readPending().find((w) => w.pendingId === pendingId);
  if (!pending) return { status: 'missing' };

  const patch = mergedPatch ?? pending.patch;
  // 换绑目标以本次合并补丁里的 sampleId 为准（含对方在冲突期间又改挂的情况），回退待办原值
  const rebindSampleId = pending.rebind
    ? ((patch.sampleId as string | undefined) ?? (pending.patch.sampleId as string | undefined))
    : undefined;
  const result = await callUpdate(pending.entity, pending.recordId, patch, rebindSampleId);

  if (result.ok) {
    removePending(pendingId);
    useConflictStore.getState().close();
    return {
      status: 'done',
      invalidatedAnalysis: result.invalidatedAnalysis,
      skippedAnalysis: result.skippedAnalysis,
    };
  }
  if (result.reason === 'missing') {
    removePending(pendingId);
    useConflictStore.getState().close();
    return { status: 'missing' };
  }

  // 又冲突：刷新待办的基线为库内最新值，重新弹合并对话框
  replacePending(pendingId, {
    base: result.conflict.current,
    reason: `修订号过期（库内 r${result.conflict.currentRevision}），合并期间又有新改动`,
  });
  useConflictStore.getState().present({
    conflict: result.conflict as RevisionConflict<never>,
    entity: pending.entity,
    kind: pending.rebind ? 'rebind' : 'update',
    rebindSampleId,
    recordLabel: pending.recordLabel,
    onResolved: async (mp) => {
      await retryPending(pendingId, mp);
    },
  });
  return { status: 'still-conflict' };
}

/** 放弃当前冲突对话框对应的本地改动（以库内值为准） */
export function discardCurrent(): void {
  const req = useConflictStore.getState().request;
  if (!req) return;
  const pending = readPending().find(
    (w) => w.entity === req.entity && w.recordId === req.conflict.id,
  );
  if (pending) removePending(pending.pendingId);
  useConflictStore.getState().close();
}

export type { PendingWrite };
