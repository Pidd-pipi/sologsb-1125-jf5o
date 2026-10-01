import { create } from 'zustand';
import type { RecordEntity, RevisionConflict } from '../db/revision';

/** 触发冲突的操作类型：普通编辑保存，或切片换绑（合并确认后继续级联失效） */
export type ConflictKind = 'update' | 'rebind';

export interface ConflictRequest {
  conflict: RevisionConflict<never>;
  entity: RecordEntity;
  kind: ConflictKind;
  /** 换绑时的目标样本 id */
  rebindSampleId?: string;
  /** 记录的人类可读名称 */
  recordLabel: string;
  /** 合并保存成功后的回调（由发起方提供，用于关弹窗/提示） */
  onResolved: (mergedPatch: Record<string, unknown>) => void | Promise<void>;
}

interface ConflictState {
  request: ConflictRequest | null;
  present: (req: ConflictRequest) => void;
  close: () => void;
}

/** 全局冲突合并对话框状态：同一时刻只处理一条 */
export const useConflictStore = create<ConflictState>((set) => ({
  request: null,
  present: (request) => set({ request }),
  close: () => set({ request: null }),
}));
