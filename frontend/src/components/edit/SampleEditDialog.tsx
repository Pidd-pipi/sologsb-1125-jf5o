import { useEffect, useState } from 'react';
import {
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
  CHEMICAL_GROUPS,
  CHEMICAL_GROUP_LABELS,
  FALL_OR_FINDS,
  FALL_OR_FIND_LABELS,
  SAMPLE_CATEGORIES,
  CATEGORY_LABELS,
  STORAGE_LOCATIONS,
  STORAGE_LABELS,
  WEATHERING_GRADES,
  WEATHERING_LABELS,
  type ChemicalGroup,
  type FallOrFind,
  type MeteoriteSample,
  type SampleCategory,
  type StorageLocation,
  type WeatheringGrade,
} from '../../types/sample';
import { attemptSave, labelOf } from '../../services/persist';
import { useToastStore } from '../../stores/uiStore';

interface Props {
  open: boolean;
  sample: MeteoriteSample;
  onClose: () => void;
  onSaved?: () => void;
}

/** 样本档案编辑（携带修订号保存，过期走合并对话框） */
export default function SampleEditDialog({ open, sample, onClose, onSaved }: Props) {
  const notify = useToastStore((s) => s.notify);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<MeteoriteSample>(sample);

  useEffect(() => {
    if (open) setForm(sample);
  }, [open, sample]);

  const set = <K extends keyof MeteoriteSample>(key: K, value: MeteoriteSample[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    const patch: Partial<MeteoriteSample> = {};
    (Object.keys(form) as (keyof MeteoriteSample)[]).forEach((k) => {
      if (k === 'id' || k === 'createdAt' || k === 'updatedAt' || k === 'revision') return;
      if (form[k] !== sample[k]) (patch as Record<string, unknown>)[k] = form[k];
    });
    if (!Object.keys(patch).length) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const result = await attemptSave({
        entity: 'sample',
        kind: 'update',
        recordId: sample.id,
        recordLabel: labelOf('sample', sample),
        base: sample,
        patch,
      });
      if (result.ok) {
        notify(`样本 ${sample.sampleNo} 已保存（修订号 r${sample.revision + 1}）`);
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
        编辑样本 {sample.sampleNo}
        <Chip size="small" variant="outlined" label={`修订号 r${sample.revision}`} />
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            size="small"
            label="样本编号"
            value={form.sampleNo}
            onChange={(e) => set('sampleNo', e.target.value)}
          />
          <TextField
            size="small"
            type="number"
            label="总重量 g"
            value={form.totalWeight}
            onChange={(e) => set('totalWeight', Number(e.target.value))}
          />
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel id="edit-category-label">分类</InputLabel>
              <Select
                labelId="edit-category-label"
                label="分类"
                value={form.category}
                onChange={(e) => set('category', e.target.value as SampleCategory)}
              >
                {SAMPLE_CATEGORIES.map((c) => (
                  <MenuItem key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel id="edit-group-label">化学群</InputLabel>
              <Select
                labelId="edit-group-label"
                label="化学群"
                value={form.chemicalGroup}
                onChange={(e) => set('chemicalGroup', e.target.value as ChemicalGroup)}
              >
                {CHEMICAL_GROUPS.map((g) => (
                  <MenuItem key={g} value={g}>
                    {CHEMICAL_GROUP_LABELS[g]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel id="edit-weathering-label">风化等级</InputLabel>
              <Select
                labelId="edit-weathering-label"
                label="风化等级"
                value={form.weathering}
                onChange={(e) => set('weathering', e.target.value as WeatheringGrade)}
              >
                {WEATHERING_GRADES.map((w) => (
                  <MenuItem key={w} value={w}>
                    {WEATHERING_LABELS[w]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 140 }}>
              <InputLabel id="edit-fallfind-label">发现/坠落</InputLabel>
              <Select
                labelId="edit-fallfind-label"
                label="发现/坠落"
                value={form.fallOrFind}
                onChange={(e) => set('fallOrFind', e.target.value as FallOrFind)}
              >
                {FALL_OR_FINDS.map((f) => (
                  <MenuItem key={f} value={f}>
                    {FALL_OR_FIND_LABELS[f]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 170 }}>
              <InputLabel id="edit-storage-label">存放位置</InputLabel>
              <Select
                labelId="edit-storage-label"
                label="存放位置"
                value={form.storage}
                onChange={(e) => set('storage', e.target.value as StorageLocation)}
              >
                {STORAGE_LOCATIONS.map((s) => (
                  <MenuItem key={s} value={s}>
                    {STORAGE_LABELS[s]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
          <TextField
            size="small"
            label="备注"
            multiline
            minRows={2}
            value={form.note ?? ''}
            onChange={(e) => set('note', e.target.value || undefined)}
          />
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
