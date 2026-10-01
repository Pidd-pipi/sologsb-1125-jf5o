import {
  CATEGORY_LABELS,
  CHEMICAL_GROUPS,
  FALL_OR_FIND_LABELS,
  FALL_OR_FINDS,
  SAMPLE_CATEGORIES,
  STORAGE_LABELS,
  STORAGE_LOCATIONS,
  WEATHERING_GRADES,
} from '../types/sample';
import {
  COORDINATE_SOURCES,
  FIND_ENVIRONMENTS,
  COORDINATE_SOURCE_LABELS,
  FIND_ENVIRONMENT_LABELS,
} from '../types/find';
import {
  MINERAL_KEYS,
  PREPARATIONS,
  SECTION_QUALITIES,
  PREPARATION_LABELS,
  SECTION_QUALITY_LABELS,
} from '../types/section';
import {
  ANALYSIS_METHODS,
  ANALYSIS_METHOD_LABELS,
} from '../types/analysis';
import type { RecordEntity } from '../db/revision';

/** 字段值的渲染类型，决定冲突对比时怎么显示 */export type FieldKind =
  | 'text'
  | 'number'
  | 'select'
  | 'date'
  | 'sampleRef'
  | 'sectionRef'
  | 'mineralRatios'
  | 'boolean';

export interface FieldMeta {
  key: string;
  label: string;
  kind: FieldKind;
  unit?: string;
  /** select 类型的可选项 */
  options?: { value: string; label: string }[];
  /** number 的小数位 */
  digits?: number;
}

const sampleCategoryOptions = SAMPLE_CATEGORIES.map((c) => ({
  value: c,
  label: CATEGORY_LABELS[c],
}));
const chemicalGroupOptions = CHEMICAL_GROUPS.map((g) => ({
  value: g,
  label: g,
}));
const weatheringOptions = WEATHERING_GRADES.map((w) => ({ value: w, label: w }));
const fallOrFindOptions = FALL_OR_FINDS.map((f) => ({
  value: f,
  label: FALL_OR_FIND_LABELS[f as keyof typeof FALL_OR_FIND_LABELS],
}));
const storageOptions = STORAGE_LOCATIONS.map((s) => ({
  value: s,
  label: STORAGE_LABELS[s as keyof typeof STORAGE_LABELS],
}));
const coordinateSourceOptions = COORDINATE_SOURCES.map((c) => ({
  value: c,
  label: COORDINATE_SOURCE_LABELS[c],
}));
const findEnvironmentOptions = FIND_ENVIRONMENTS.map((e) => ({
  value: e,
  label: FIND_ENVIRONMENT_LABELS[e],
}));
const preparationOptions = PREPARATIONS.map((p) => ({ value: p, label: PREPARATION_LABELS[p] }));
const qualityOptions = SECTION_QUALITIES.map((q) => ({
  value: q,
  label: SECTION_QUALITY_LABELS[q].split('（')[0],
}));
const methodOptions = ANALYSIS_METHODS.map((m) => ({
  value: m,
  label: ANALYSIS_METHOD_LABELS[m],
}));

/** 各实体的业务字段（不含 id / createdAt / updatedAt / revision 等系统字段） */
export const ENTITY_FIELDS: Record<RecordEntity, FieldMeta[]> = {
  sample: [
    { key: 'sampleNo', label: '样本编号', kind: 'text' },
    { key: 'totalWeight', label: '总重量', kind: 'number', unit: 'g', digits: 2 },
    { key: 'category', label: '分类', kind: 'select', options: sampleCategoryOptions },
    { key: 'chemicalGroup', label: '化学群', kind: 'select', options: chemicalGroupOptions },
    { key: 'weathering', label: '风化等级', kind: 'select', options: weatheringOptions },
    { key: 'fallOrFind', label: '发现/坠落', kind: 'select', options: fallOrFindOptions },
    { key: 'storage', label: '存放位置', kind: 'select', options: storageOptions },
    { key: 'note', label: '备注', kind: 'text' },
  ],
  find: [
    { key: 'sampleId', label: '关联样本', kind: 'sampleRef' },
    { key: 'placeName', label: '发现地名', kind: 'text' },
    { key: 'region', label: '国家/地区', kind: 'text' },
    { key: 'longitude', label: '经度', kind: 'number', unit: '°', digits: 4 },
    { key: 'latitude', label: '纬度', kind: 'number', unit: '°', digits: 4 },
    { key: 'coordinateSource', label: '坐标来源', kind: 'select', options: coordinateSourceOptions },
    { key: 'environment', label: '发现环境', kind: 'select', options: findEnvironmentOptions },
    { key: 'finder', label: '发现者', kind: 'text' },
  ],
  section: [
    { key: 'sectionNo', label: '切片编号', kind: 'text' },
    { key: 'sampleId', label: '关联样本', kind: 'sampleRef' },
    { key: 'thickness', label: '厚度', kind: 'number', unit: 'μm' },
    { key: 'preparation', label: '制样方式', kind: 'select', options: preparationOptions },
    { key: 'minerals', label: '矿物占比', kind: 'mineralRatios' },
    { key: 'micrographs', label: '显微照片', kind: 'text' },
    { key: 'quality', label: '质量标注', kind: 'select', options: qualityOptions },
  ],
  analysis: [
    { key: 'sampleId', label: '关联样本', kind: 'sampleRef' },
    { key: 'sectionId', label: '关联切片', kind: 'sectionRef' },
    { key: 'method', label: '检测方法', kind: 'select', options: methodOptions },
    { key: 'fa', label: '橄榄石 Fa', kind: 'number', unit: 'mol%', digits: 2 },
    { key: 'fs', label: '辉石 Fs', kind: 'number', unit: 'mol%', digits: 2 },
    { key: 'ni', label: 'Ni', kind: 'number', unit: 'wt%', digits: 2 },
    { key: 'kamaciteBandwidth', label: '铁纹石带宽', kind: 'number', unit: 'mm', digits: 3 },
    { key: 'testedAt', label: '检测日期', kind: 'date' },
    { key: 'confirmed', label: '确认状态', kind: 'boolean' },
  ],
};

export const ENTITY_LABELS: Record<RecordEntity, string> = {
  sample: '样本档案',
  find: '发现地记录',
  section: '切片记录',
  analysis: '检测记录',
};

/** 格式化单个字段值用于冲突对比展示；引用类字段由调用方解析 */
export function formatFieldValue(meta: FieldMeta, value: unknown, refLabels?: RefLabels): string {
  if (value === undefined || value === null || value === '') return '—';
  switch (meta.kind) {
    case 'select': {
      const hit = meta.options?.find((o) => o.value === value);
      return hit ? hit.label : String(value);
    }
    case 'number': {
      const n = Number(value);
      if (!Number.isFinite(n)) return '—';
      return `${n.toFixed(meta.digits ?? 2)}${meta.unit ?? ''}`;
    }
    case 'date':
      return String(value);
    case 'text':
      return String(value);
    case 'boolean':
      return value ? '已确认 / 有效' : '失效待确认';
    case 'sampleRef':
      return refLabels?.samples.get(String(value)) ?? `${String(value)}（样本已不存在）`;
    case 'sectionRef':
      return refLabels?.sections.get(String(value)) ?? `${String(value)}（切片已不存在）`;
    case 'mineralRatios': {
      if (!value || typeof value !== 'object') return '—';
      return MINERAL_KEYS.map((k) => `${k}: ${(value as Record<string, unknown>)[k] ?? '—'}%`).join(' · ');
    }
    default:
      return String(value);
  }
}

export interface RefLabels {
  samples: Map<string, string>;
  sections: Map<string, string>;
}
