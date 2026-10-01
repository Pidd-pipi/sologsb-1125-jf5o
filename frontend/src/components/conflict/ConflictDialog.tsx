import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Radio,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { ENTITY_FIELDS, ENTITY_LABELS, formatFieldValue, type FieldMeta, type RefLabels } from '../../utils/fields';
import { sameValue } from '../../db/revision';
import { useConflictStore } from '../../stores/conflictStore';
import { useSampleStore } from '../../stores/sampleStore';
import { discardCurrent } from '../../services/persist';
import { useToastStore } from '../../stores/uiStore';
import { MINERAL_LABELS, MINERAL_KEYS } from '../../types/section';

type Side = 'mine' | 'theirs';

/** 与库内值是否相同（嵌套对象深比） */
const sameRef = sameValue;

/** 从补丁里取字段值（嵌套 minerals 子键也可下钻） */
function pickPatchValue(patch: Record<string, unknown>, meta: FieldMeta): unknown {
  return patch[meta.key];
}

/** `/` 全局冲突合并对话框：版本过期时展示双方改动，逐字段选择后再入库 */
export default function ConflictDialog() {
  const request = useConflictStore((s) => s.request);
  const close = useConflictStore((s) => s.close);
  const notify = useToastStore((s) => s.notify);
  const samples = useSampleStore((s) => s.samples);
  const sections = useSampleStore((s) => s.sections);
  const [choices, setChoices] = useState<Record<string, Side>>({});
  const [submitting, setSubmitting] = useState(false);

  // 新的冲突（或重试后再次冲突）时重置字段选择
  useEffect(() => {
    setChoices({});
  }, [request?.conflict.id, request?.conflict.currentRevision, request?.entity]);

  const refLabels: RefLabels = useMemo(
    () => ({
      samples: new Map(samples.map((s) => [s.id, s.sampleNo])),
      sections: new Map(sections.map((s) => [s.id, s.sectionNo])),
    }),
    [samples, sections],
  );

  const data = useMemo(() => {
    if (!request) return null;
    const fields = ENTITY_FIELDS[request.entity];
    const base = request.conflict.base as Record<string, unknown>;
    const mine = request.conflict.patch as Record<string, unknown>;
    const theirs = request.conflict.theirs as Record<string, unknown>;
    const current = request.conflict.current as Record<string, unknown>;

    const rows = fields
      .map((meta) => {
        const mineVal = pickPatchValue(mine, meta);
        const theirsVal = pickPatchValue(theirs, meta);
        const mineChanged = Object.prototype.hasOwnProperty.call(mine, meta.key);
        const theirsChanged = Object.prototype.hasOwnProperty.call(theirs, meta.key);
        // 嵌套对象（矿物占比）按子键判断是否重叠
        let overlap = mineChanged && theirsChanged;
        if (overlap && meta.kind === 'mineralRatios') {
          const mineKeys = mineVal && typeof mineVal === 'object' ? Object.keys(mineVal as object) : [];
          const theirsKeys = theirsVal && typeof theirsVal === 'object' ? Object.keys(theirsVal as object) : [];
          overlap = mineKeys.some((k) => theirsKeys.includes(k));
        }
        return {
          meta,
          mineChanged,
          theirsChanged,
          overlap,
          baseVal: base[meta.key],
          mineVal,
          theirsVal,
          currentVal: current[meta.key],
        };
      })
      .filter((r) => r.mineChanged || r.theirsChanged);

    return { fields: rows, base, mine, theirs };
  }, [request]);

  if (!request || !data) return null;

  const overlapRows = data.fields.filter((r) => r.overlap);
  const mineOnly = data.fields.filter((r) => r.mineChanged && !r.theirsChanged);
  const theirsOnly = data.fields.filter((r) => r.theirsChanged && !r.mineChanged);

  const renderVal = (meta: FieldMeta, v: unknown) => {
    if (meta.kind === 'mineralRatios' && v && typeof v === 'object') {
      // 只展示补丁中出现的子键，未出现的显示 —
      return MINERAL_KEYS.map((k) => {
        const obj = v as Record<string, unknown>;
        return Object.prototype.hasOwnProperty.call(obj, k)
          ? `${MINERAL_LABELS[k]} ${obj[k]}%`
          : null;
      })
        .filter(Boolean)
        .join(' · ') || '—';
    }
    return formatFieldValue(meta, v, refLabels);
  };

  /** 按当前逐字段选择合成合并补丁（基于库内最新 current，保证未改字段不回退） */
  function buildMergedPatch(): Record<string, unknown> {
    if (!request || !data) return {};
    const current = request.conflict.current as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    // 先以库内最新值为底：嵌套矿物占比复制完整对象，避免缺子键被守卫浅合并清空
    for (const meta of ENTITY_FIELDS[request.entity]) {
      if (meta.kind === 'mineralRatios' && current[meta.key] && typeof current[meta.key] === 'object') {
        patch[meta.key] = { ...(current[meta.key] as object) };
      }
    }
    // 我方独有改动：自动并入
    for (const r of mineOnly) {
      if (r.meta.kind === 'mineralRatios') {
        patch[r.meta.key] = { ...(patch[r.meta.key] as object), ...(r.mineVal as object) };
      } else {
        patch[r.meta.key] = r.mineVal;
      }
    }
    // 对方独有改动：自动并入（current 已包含，这里显式覆盖保持语义一致）
    for (const r of theirsOnly) {
      if (r.meta.kind === 'mineralRatios') {
        patch[r.meta.key] = { ...(patch[r.meta.key] as object), ...(r.theirsVal as object) };
      } else {
        patch[r.meta.key] = r.theirsVal;
      }
    }
    // 双方都改：按选择
    for (const r of overlapRows) {
      const side: Side = choices[r.meta.key] ?? 'mine';
      if (r.meta.kind === 'mineralRatios') {
        const mineObj = (r.mineVal ?? {}) as Record<string, unknown>;
        const theirsObj = (r.theirsVal ?? {}) as Record<string, unknown>;
        const mergedMinerals: Record<string, unknown> = {
          ...(patch[r.meta.key] as object),
        };
        // 只在双方都改了同一子键时按选择；仅一方改的子键取该方
        for (const k of new Set([...Object.keys(mineObj), ...Object.keys(theirsObj)])) {
          const inMine = k in mineObj;
          const inTheirs = k in theirsObj;
          if (inMine && inTheirs) mergedMinerals[k] = side === 'mine' ? mineObj[k] : theirsObj[k];
          else if (inMine) mergedMinerals[k] = mineObj[k];
          else mergedMinerals[k] = theirsObj[k];
        }
        patch[r.meta.key] = mergedMinerals;
      } else {
        patch[r.meta.key] = side === 'mine' ? r.mineVal : r.theirsVal;
      }
    }
    return patch;
  }

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      // request.onResolved 已绑定到对应 pendingId 的 retryPending
      await request.onResolved(buildMergedPatch());
      notify('合并内容已按最新修订号重新写入');
    } catch (err) {
      notify(err instanceof Error ? err.message : '合并写入失败，已保留待恢复写入', 'warning');
    } finally {
      setSubmitting(false);
    }
  };

  const handleTakeTheirsAll = async () => {
    setSubmitting(true);
    try {
      discardCurrent();
      notify('已放弃本地改动，以库内最新内容为准');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onClose={submitting ? undefined : close} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <WarningAmberIcon color="warning" />
        修订号过期：{ENTITY_LABELS[request.entity]}「{request.recordLabel}」存在并发改动
      </DialogTitle>
      <DialogContent>
        <Stack spacing={1.5}>
          <Alert severity="warning">
            本标签页基于修订号 <strong>r{request.conflict.baseRevision}</strong> 编辑，但库内已被其他标签页更新到{' '}
            <strong>r{request.conflict.currentRevision}</strong>。本次保存已被拒绝，避免覆盖先保存的内容。
            请对照双方改动逐字段选择合并方式，确认后再入库。
          </Alert>
          {request.kind === 'rebind' ? (
            <Alert severity="info">
              本次操作包含「切片换绑样本」，合并保存后关联的切片检测记录将改挂到新样本并标记失效，需要逐条重新确认。
            </Alert>
          ) : null}

          <Table size="small" aria-label="冲突字段对比">
            <TableHead>
              <TableRow>
                <TableCell sx={{ width: 130 }}>字段</TableCell>
                <TableCell sx={{ width: '26%' }}>我方（本页）改动</TableCell>
                <TableCell sx={{ width: '26%' }}>对方（库内）改动</TableCell>
                <TableCell>合并选择</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.fields.map((r) => {
                const mineText = r.mineChanged ? renderVal(r.meta, r.mineVal) : '（未改）';
                const theirsText = r.theirsChanged ? renderVal(r.meta, r.theirsVal) : '（未改）';
                return (
                  <TableRow
                    key={r.meta.key}
                    selected={r.overlap}
                    sx={{ bgcolor: r.overlap ? 'rgba(237,108,2,0.06)' : undefined }}
                  >
                    <TableCell>
                      <Typography variant="body2" fontWeight={r.overlap ? 700 : 400}>
                        {r.meta.label}
                      </Typography>
                      {r.overlap ? <Chip size="small" color="warning" label="双方都改" sx={{ mt: 0.5 }} /> : null}
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" sx={{ textDecoration: r.mineChanged ? 'none' : undefined }} color={r.mineChanged ? 'text.primary' : 'text.disabled'}>
                        {mineText}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Typography variant="body2" color={r.theirsChanged ? 'text.primary' : 'text.disabled'}>
                        {theirsText}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      {r.overlap ? (
                        <Stack direction="row" spacing={1} alignItems="center">
                          <Radio
                            size="small"
                            checked={(choices[r.meta.key] ?? 'mine') === 'mine'}
                            onChange={() => setChoices((c) => ({ ...c, [r.meta.key]: 'mine' }))}
                            inputProps={{ 'aria-label': `字段 ${r.meta.label} 采用我方改动` }}
                          />
                          <Typography variant="caption">用我方</Typography>
                          <Radio
                            size="small"
                            checked={choices[r.meta.key] === 'theirs'}
                            onChange={() => setChoices((c) => ({ ...c, [r.meta.key]: 'theirs' }))}
                            inputProps={{ 'aria-label': `字段 ${r.meta.label} 采用对方改动` }}
                          />
                          <Typography variant="caption">用对方</Typography>
                        </Stack>
                      ) : (
                        <Typography variant="caption" color="text.secondary">
                          {r.mineChanged ? '我方改动自动并入' : '对方改动自动并入'}
                        </Typography>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <Divider />
          <Box>
            <Typography variant="subtitle2">合并后将写入（修订号推进到 r{request.conflict.currentRevision + 1}）：</Typography>
            <Typography variant="caption" color="text.secondary" component="div">
              {data.fields
                .map((r) => {
                  const v = buildMergedPatch()[r.meta.key];
                  if (v === undefined) return null;
                  if (r.meta.kind === 'mineralRatios') {
                    // 只列出相对库内值真正变化的子键
                    const curObj = (r.currentVal ?? {}) as Record<string, unknown>;
                    const changed = MINERAL_KEYS.filter(
                      (mk) =>
                        (v as object) &&
                        Object.prototype.hasOwnProperty.call(v as object, mk) &&
                        (v as Record<string, unknown>)[mk] !== curObj[mk],
                    );
                    if (!changed.length) return null;
                    return `${r.meta.label}: ${changed
                      .map((mk) => `${MINERAL_LABELS[mk]} ${(v as Record<string, unknown>)[mk]}%`)
                      .join('、')}`;
                  }
                  if (sameRef(v, r.currentVal)) return null;
                  return `${r.meta.label}: ${formatFieldValue(r.meta, v, refLabels)}`;
                })
                .filter(Boolean)
                .join('　；') || '（无变化）'}
            </Typography>
          </Box>
          <Typography variant="caption" color="text.disabled">
            若选择取消，本次改动会保留在顶部「待恢复写入」条中，随时可再次重试。
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ flexWrap: 'wrap', gap: 1, px: 3, pb: 2 }}>
        <Button onClick={close} disabled={submitting}>
          取消（稍后处理）
        </Button>
        <Button onClick={handleTakeTheirsAll} disabled={submitting} color="inherit">
          放弃本地改动
        </Button>
        <Button variant="contained" onClick={handleConfirm} disabled={submitting} color="warning">
          确认合并并入库
        </Button>
      </DialogActions>
    </Dialog>
  );
}
