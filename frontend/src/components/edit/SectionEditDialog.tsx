import { useEffect, useMemo, useState } from 'react';
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
  MINERAL_KEYS,
  MINERAL_LABELS,
  PREPARATIONS,
  PREPARATION_LABELS,
  SECTION_QUALITIES,
  SECTION_QUALITY_LABELS,
  type PreparationMethod,
  type SectionQuality,
  type ThinSection,
} from '../../types/section';
import { attemptSave, labelOf } from '../../services/persist';
import { useSampleStore } from '../../stores/sampleStore';
import { useToastStore } from '../../stores/uiStore';

interface Props {
  open: boolean;
  section: ThinSection;
  onClose: () => void;
  onSaved?: (info?: { invalidatedAnalysis: number }) => void;
}

/** 切片编辑：普通字段带修订号保存；换绑关联样本走级联失效逻辑 */
export default function SectionEditDialog({ open, section, onClose, onSaved }: Props) {
  const notify = useToastStore((s) => s.notify);
  const samples = useSampleStore((s) => s.samples);
  const analysis = useSampleStore((s) => s.analysis);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<ThinSection>(section);
  const [micrographsText, setMicrographsText] = useState(section.micrographs.join('、'));
  useEffect(() => {
    if (open) {
      setForm(section);
      setMicrographsText(section.micrographs.join('、'));
    }
  }, [open, section]);

  const rebinding = form.sampleId !== section.sampleId;

  // 换绑后会失效的切片检测记录数（仅统计 target=section 且关联本切片的）
  const linkedAnalysisCount = useMemo(
    () => analysis.filter((a) => a.sectionId === section.id).length,
    [analysis, section.id],
  );

  const set = <K extends keyof ThinSection>(key: K, value: ThinSection[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const parseMicrographs = () =>
    micrographsText
      .split(/[、,，\n]/)
      .map((s) => s.trim())
      .filter(Boolean);

  const handleSave = async () => {
    const micrographs = parseMicrographs();
    const next: ThinSection = { ...form, micrographs };
    const patch: Partial<ThinSection> = {};
    (Object.keys(next) as (keyof ThinSection)[]).forEach((k) => {
      if (k === 'id' || k === 'createdAt' || k === 'updatedAt' || k === 'revision') return;
      if (k === 'sampleId') return; // sampleId 单独按换绑处理
      if (JSON.stringify(next[k]) !== JSON.stringify(section[k])) {
        (patch as Record<string, unknown>)[k] = next[k];
      }
    });

    setSaving(true);
    try {
      let invalidated = 0;
      let skipped = 0;
      if (rebinding) {
        const result = await attemptSave({
          entity: 'section',
          kind: 'rebind',
          recordId: section.id,
          recordLabel: labelOf('section', section),
          base: section,
          patch: { ...patch, sampleId: form.sampleId },
          rebindSampleId: form.sampleId,
        });
        if (!result.ok) return;
        invalidated = result.invalidatedAnalysis ?? 0;
        skipped = result.skippedAnalysis ?? 0;
      } else {
        if (!Object.keys(patch).length) {
          onClose();
          return;
        }
        const result = await attemptSave({
          entity: 'section',
          kind: 'update',
          recordId: section.id,
          recordLabel: labelOf('section', section),
          base: section,
          patch,
        });
        if (!result.ok) return;
      }
      notify(
        rebinding
          ? `切片已换绑到新样本${
              invalidated ? `，${invalidated} 条关联检测记录已失效待重新确认` : ''
            }${skipped ? `，${skipped} 条检测因被并发修改未处理` : ''}`
          : `切片 ${section.sectionNo} 已保存（修订号 r${section.revision + 1}）`,
      );
      onSaved?.({ invalidatedAnalysis: invalidated });
      onClose();
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
        编辑切片 {section.sectionNo}
        <Chip size="small" variant="outlined" label={`修订号 r${section.revision}`} />
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            size="small"
            label="切片编号"
            value={form.sectionNo}
            onChange={(e) => set('sectionNo', e.target.value)}
          />
          <FormControl size="small">
            <InputLabel id="edit-section-sample-label">关联样本（换绑会失效关联检测）</InputLabel>
            <Select
              labelId="edit-section-sample-label"
              label="关联样本（换绑会失效关联检测）"
              value={form.sampleId}
              onChange={(e) => set('sampleId', e.target.value)}
            >
              {samples.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.sampleNo}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          {rebinding ? (
            <Alert severity="warning">
              确认换绑后，该切片下 {linkedAnalysisCount} 条检测记录将改挂到新样本并标记为
              <strong>失效</strong>，需要在样本详情或检测页逐条「重新确认」后才能继续作为结论引用。
            </Alert>
          ) : null}
          <Stack direction="row" spacing={1.5}>
            <TextField
              size="small"
              type="number"
              label="厚度 μm"
              value={form.thickness}
              onChange={(e) => set('thickness', Number(e.target.value))}
            />
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel id="edit-prep-label">制样方式</InputLabel>
              <Select
                labelId="edit-prep-label"
                label="制样方式"
                value={form.preparation}
                onChange={(e) => set('preparation', e.target.value as PreparationMethod)}
              >
                {PREPARATIONS.map((p) => (
                  <MenuItem key={p} value={p}>
                    {PREPARATION_LABELS[p]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel id="edit-quality-label">质量标注</InputLabel>
              <Select
                labelId="edit-quality-label"
                label="质量标注"
                value={form.quality}
                onChange={(e) => set('quality', e.target.value as SectionQuality)}
              >
                {SECTION_QUALITIES.map((q) => (
                  <MenuItem key={q} value={q}>
                    {SECTION_QUALITY_LABELS[q]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            {MINERAL_KEYS.map((k) => (
              <TextField
                key={k}
                size="small"
                type="number"
                label={`${MINERAL_LABELS[k]} %`}
                value={form.minerals[k]}
                onChange={(e) =>
                  set('minerals', { ...form.minerals, [k]: Number(e.target.value) })
                }
                sx={{ width: 130 }}
              />
            ))}
          </Stack>
          <TextField
            size="small"
            label="显微照片（多个用顿号或逗号分隔）"
            value={micrographsText}
            onChange={(e) => setMicrographsText(e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          取消
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {rebinding ? '换绑并保存（失效关联检测）' : '保存（带修订号校验）'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
