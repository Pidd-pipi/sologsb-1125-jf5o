/** 四类业务记录 */
export type RecordKind = 'sample' | 'find' | 'section' | 'analysis';

/** 字段级改动对比（用于冲突时列出双方改动） */
export interface FieldDiff {
  field: string;
  label: string;
  /** 编辑起点（用户开始编辑时的库内值） */
  baseValue: unknown;
  /** 库内当前值（对方已提交的改动） */
  remoteValue: unknown;
  /** 用户拟写入的值（本地改动） */
  localValue: unknown;
  /** 库内相对起点是否发生了变化 */
  changedByRemote: boolean;
  /** 本地相对起点是否发生了变化 */
  changedByLocal: boolean;
}

/**
 * 修订号冲突：保存前比对库内值，发现库内修订号已领先于用户编辑起点时抛出。
 * UI 据此展示「双方改动」对照表，供用户确认合并后再入库。
 */
export interface RevisionConflict {
  kind: RecordKind;
  recordId: string;
  recordLabel: string;
  /** 用户编辑起点的修订号 */
  baseRevision: number;
  /** 库内当前修订号 */
  remoteRevision: number;
  /** 编辑起点快照 */
  base: Record<string, unknown>;
  /** 库内当前记录 */
  remote: Record<string, unknown>;
  /** 用户拟写入的记录 */
  local: Record<string, unknown>;
  /** 字段级改动对照 */
  diffs: FieldDiff[];
}

/** 记录已被其他标签页删除 */
export interface RecordDeletedError {
  kind: RecordKind;
  recordId: string;
}

/** 写入失败后挂起、待重试的写入 */
export interface PendingWrite {
  id: string;
  kind: RecordKind;
  recordId: string;
  recordLabel: string;
  /** 拟写入的完整记录（含用户改动） */
  record: Record<string, unknown>;
  /** 用户编辑起点的基础记录（用于重试时计算改动与 diff） */
  base: Record<string, unknown>;
  /** 用户编辑起点的修订号 */
  baseRevision: number;
  createdAt: number;
  /** 挂起原因：冲突未解决 / 写入异常 */
  reason: 'conflict' | 'error';
  /** 最近一次失败信息 */
  lastError?: string;
}
