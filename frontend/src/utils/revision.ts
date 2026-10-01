import type { RecordKind, FieldDiff } from '../types/conflict';
import { CATEGORY_LABELS, CHEMICAL_GROUP_LABELS, WEATHERING_LABELS, FALL_OR_FIND_LABELS, STORAGE_LABELS } from '../types/sample';
import { COORDINATE_SOURCE_LABELS, FIND_ENVIRONMENT_LABELS } from '../types/find';
import { PREPARATION_LABELS, SECTION_QUALITY_LABELS, MINERAL_LABELS, type MineralRatios } from '../types/section';
import { ANALYSIS_METHOD_LABELS, ANALYSIS_TARGET_LABELS } from '../types/analysis';

export const REVISION_FIELD = 'revision';

/** 各类记录的中文名 */
export const KIND_LABELS: Record<RecordKind, string> = {
  sample: '样本',
  find: '发现记录',
  section: '切片',
  analysis: '检测记录',
};

/** 各类记录的可编辑字段与中文标签（冲突对照用） */
export const FIELD_LABELS: Record<RecordKind, Record<string, string>> = {
  sample: {
    sampleNo: '样本编号',
    totalWeight: '总重量',
    category: '分类',
    chemicalGroup: '化学群',
    weathering: '风化等级',
    fallOrFind: '发现/坠落',
    storage: '存放位置',
    note: '备注',
  },
  find: {
    sampleId: '关联样本',
    placeName: '发现地名',
    region: '国家/地区',
    longitude: '经度',
    latitude: '纬度',
    coordinateSource: '坐标来源',
    environment: '发现环境',
    finder: '发现者',
  },
  section: {
    sectionNo: '切片编号',
    sampleId: '关联样本',
    thickness: '厚度',
    preparation: '制样方式',
    minerals: '矿物占比',
    micrographs: '显微照片',
    quality: '质量标注',
  },
  analysis: {
    sampleId: '关联样本',
    sectionId: '关联切片',
    target: '检测对象',
    method: '检测方法',
    fa: '橄榄石 Fa',
    fs: '辉石 Fs',
    ni: 'Ni 含量',
    kamaciteBandwidth: '铁纹石带宽',
    testedAt: '检测日期',
    needsReconfirm: '待重新确认',
  },
};

/** 各类记录用于在冲突列表中显示的标题字段 */
export const LABEL_FIELD: Record<RecordKind, string> = {
  sample: 'sampleNo',
  find: 'placeName',
  section: 'sectionNo',
  analysis: 'testedAt',
};

/** 取下一个修订号 */
export function nextRevision(current: number | undefined): number {
  return (typeof current === 'number' && current >= 1 ? current : 0) + 1;
}

/** 深比较（支持数组与普通对象） */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return a === b;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
  }
  return false;
}

/** 计算字段级改动对照：base=编辑起点，remote=库内当前，local=用户拟写入 */
export function diffRecords(
  base: Record<string, unknown>,
  remote: Record<string, unknown>,
  local: Record<string, unknown>,
  kind: RecordKind,
): FieldDiff[] {
  const labels = FIELD_LABELS[kind];
  const diffs: FieldDiff[] = [];
  for (const field of Object.keys(labels)) {
    const b = base[field];
    const r = remote[field];
    const l = local[field];
    const changedByRemote = !deepEqual(b, r);
    const changedByLocal = !deepEqual(b, l);
    if (changedByRemote || changedByLocal) {
      diffs.push({ field, label: labels[field], baseValue: b, remoteValue: r, localValue: l, changedByRemote, changedByLocal });
    }
  }
  return diffs;
}

const ENUM_LABELS: Record<string, Record<string, string>> = {
  category: CATEGORY_LABELS,
  chemicalGroup: CHEMICAL_GROUP_LABELS,
  weathering: WEATHERING_LABELS,
  fallOrFind: FALL_OR_FIND_LABELS,
  storage: STORAGE_LABELS,
  coordinateSource: COORDINATE_SOURCE_LABELS,
  environment: FIND_ENVIRONMENT_LABELS,
  preparation: PREPARATION_LABELS,
  quality: SECTION_QUALITY_LABELS,
  method: ANALYSIS_METHOD_LABELS,
  target: ANALYSIS_TARGET_LABELS,
};

/** 把字段值格式化成可展示文本（枚举转中文，对象/数组转 JSON） */
export function formatFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '（空）';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    const labelMap = ENUM_LABELS[field];
    if (labelMap && labelMap[value]) return labelMap[value];
    return value;
  }
  if (field === 'minerals' && typeof value === 'object') {
    const m = value as MineralRatios;
    return (Object.keys(MINERAL_LABELS) as (keyof MineralRatios)[])
      .map((k) => `${MINERAL_LABELS[k]} ${m[k] ?? 0}%`)
      .join(' · ');
  }
  if (Array.isArray(value)) return value.length ? value.join('、') : '（空）';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** 取记录的展示标题 */
export function recordLabel(kind: RecordKind, record: Record<string, unknown>): string {
  const field = LABEL_FIELD[kind];
  const v = record[field];
  if (typeof v === 'string' && v) return v;
  if (typeof v === 'number') return String(v);
  return record.id as string;
}
