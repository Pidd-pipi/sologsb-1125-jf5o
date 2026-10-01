import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  TextField,
} from '@mui/material';
import {
  ANALYSIS_METHODS,
  ANALYSIS_METHOD_LABELS,
  type AnalysisMethod,
  type AnalysisRecord,
} from '../../types/analysis';
import { attemptSave } from '../../services/persist';
import { useSampleStore } from '../../stores/sampleStore';
import { useToastStore } from '../../stores/uiStore';

interface Props {
  open: boolean;
  analysis: AnalysisRecord;
  onClose: () => void;
  onSaved?: () => void;
}

/** 检测记录编辑（数值与方法；携带修订号保存，过期走合并对话框）。重新确认由专门按钮触发。 */
export default function AnalysisEditDialog({ open, analysis, onClose, onSaved }: Props) {
  const notify = useToastStore((s) => s.notify);
  const samples = useSampleStore((s) => s.samples);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<AnalysisRecord>(analysis);

  useEffect(() => {
    if (open) setForm(analysis);
  }, [open, analysis]);

  const set = <K extends keyof AnalysisRecord>(key: K, value: AnalysisRecord[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    const patch: Partial<AnalysisRecord> = {};
    (Object.keys(form) as (keyof AnalysisRecord)[]).forEach((k) => {
      if (k === 'id' || k === 'createdAt' || k === 'updatedAt' || k === 'revision') return;
      // 普通编辑不触碰确认状态，避免误把失效记录自动改回有效
      if (k === 'confirmed' || k === 'confirmedAt') return;
      if (JSON.stringify(form[k]) !== JSON.stringify(analysis[k])) {
        (patch as Record<string, unknown>)[k] = form[k];
      }
    });
    if (!Object.keys(patch).length) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const result = await attemptSave({
        entity: 'analysis',
        kind: 'update',
        recordId: analysis.id,
        recordLabel: `${ANALYSIS_METHOD_LABELS[analysis.method]} · ${analysis.testedAt}`,
        base: analysis,
        patch,
      });
      if (result.ok) {
        notify(`检测记录已保存（修订号 r${analysis.revision + 1}）`);
        onSaved?.();
        onClose();
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : '保存失败，已加入待恢复写入', 'warning');
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={saving ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        编辑检测记录
        <Stack direction="row" spacing={1}>
          <Chip
            size="small"
            color={analysis.confirmed ? 'success' : 'warning'}
            label={analysis.confirmed ? '有效' : '失效待确认'}
          />
          <Chip size="small" variant="outlined" label={`修订号 r${analysis.revision}`} />
        </Stack>
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <FormControl size="small" disabled>
            <InputLabel id="edit-analysis-sample-label">关联样本（不可改）</InputLabel>
            <Select labelId="edit-analysis-sample-label" label="关联样本（不可改）" value={analysis.sampleId}>
              {samples.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.sampleNo}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {!analysis.confirmed ? (
            <Alert severity="warning">
              该记录因切片换绑已失效。可以修改数值，但保存后仍需点击「重新确认」才会恢复有效。
            </Alert>
          ) : null}
          <Stack direction="row" spacing={1.5}>
            <FormControl size="small" sx={{ minWidth: 160 }}>
              <InputLabel id="edit-analysis-method-label">检测方法</InputLabel>
              <Select
                labelId="edit-analysis-method-label"
                label="检测方法"
                value={form.method}
                onChange={(e) => set('method', e.target.value as AnalysisMethod)}
              >
                {ANALYSIS_METHODS.map((m) => (
                  <MenuItem key={m} value={m}>
                    {ANALYSIS_METHOD_LABELS[m]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <TextField
              size="small"
              type="date"
              label="检测日期"
              InputLabelProps={{ shrink: true }}
              value={form.testedAt}
              onChange={(e) => set('testedAt', e.target.value)}
            />
          </Stack>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <TextField
              size="small"
              type="number"
              label="橄榄石 Fa mol%"
              value={form.fa}
              onChange={(e) => set('fa', Number(e.target.value))}
              sx={{ width: 150 }}
            />
            <TextField
              size="small"
              type="number"
              label="辉石 Fs mol%"
              value={form.fs}
              onChange={(e) => set('fs', Number(e.target.value))}
              sx={{ width: 150 }}
            />
            <TextField
              size="small"
              type="number"
              label="Ni wt%"
              value={form.ni}
              onChange={(e) => set('ni', Number(e.target.value))}
              sx={{ width: 140 }}
            />
            <TextField
              size="small"
              type="number"
              label="铁纹石带宽 mm"
              value={form.kamaciteBandwidth}
              onChange={(e) => set('kamaciteBandwidth', Number(e.target.value))}
              sx={{ width: 160 }}
            />
          </Stack>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          取消
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          保存（带修订号校验）
        </Button>
      </DialogActions>
    </Dialog>
  );
}
