/**
 * 乐观修订字段：四类业务记录（样本 / 发现地 / 切片 / 检测）均带修订号。
 * 保存时携带打开编辑时读到的 baseRevision，库内 revision 不一致即判定过期，拒绝写入。
 */
export interface RevisionedFields {
  /** 修订号：新建为 1，每次成功写入 +1（v4 升级迁移补齐） */
  revision: number;
  /** 最近一次写入时间（v3 起 samples 带此字段，v4 扩展到四类记录） */
  updatedAt: number;
}

/** v4：检测记录换绑失效标记 */
export type AnalysisConfirmState = 'confirmed' | 'invalidated';
