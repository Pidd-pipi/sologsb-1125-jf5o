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
  COORDINATE_SOURCES,
  COORDINATE_SOURCE_LABELS,
  FIND_ENVIRONMENTS,
  FIND_ENVIRONMENT_LABELS,
  isValidLatitude,
  isValidLongitude,
  type CoordinateSource,
  type FindEnvironment,
  type FindRecord,
} from '../../types/find';
import { attemptSave } from '../../services/persist';
import { useToastStore } from '../../stores/uiStore';

interface Props {
  open: boolean;
  find: FindRecord;
  onClose: () => void;
  onSaved?: () => void;
}

/** 发现地记录编辑（携带修订号保存，过期走合并对话框） */
export default function FindEditDialog({ open, find, onClose, onSaved }: Props) {
  const notify = useToastStore((s) => s.notify);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FindRecord>(find);

  useEffect(() => {
    if (open) setForm(find);
  }, [open, find]);

  const set = <K extends keyof FindRecord>(key: K, value: FindRecord[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const coordOk = isValidLongitude(form.longitude) && isValidLatitude(form.latitude);

  const handleSave = async () => {
    if (!form.placeName.trim() || !form.region.trim()) {
      notify('发现地名与国家/地区不能为空', 'warning');
      return;
    }
    if (!coordOk) {
      notify('经纬度超出合法范围（经度 ±180、纬度 ±90）', 'warning');
      return;
    }
    const patch: Partial<FindRecord> = {};
    (Object.keys(form) as (keyof FindRecord)[]).forEach((k) => {
      if (k === 'id' || k === 'createdAt' || k === 'updatedAt' || k === 'revision') return;
      if (form[k] !== find[k]) (patch as Record<string, unknown>)[k] = form[k];
    });
    if (!Object.keys(patch).length) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      const result = await attemptSave({
        entity: 'find',
        kind: 'update',
        recordId: find.id,
        recordLabel: find.placeName,
        base: find,
        patch,
      });
      if (result.ok) {
        notify(`发现地「${find.placeName}」已保存（修订号 r${find.revision + 1}）`);
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
        编辑发现地记录
        <Chip size="small" variant="outlined" label={`修订号 r${find.revision}`} />
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2} sx={{ mt: 1 }}>
          <TextField
            size="small"
            label="发现地名"
            value={form.placeName}
            onChange={(e) => set('placeName', e.target.value)}
          />
          <TextField
            size="small"
            label="国家 / 地区"
            value={form.region}
            onChange={(e) => set('region', e.target.value)}
          />
          <Stack direction="row" spacing={1.5}>
            <TextField
              size="small"
              type="number"
              label="经度"
              value={form.longitude}
              onChange={(e) => set('longitude', Number(e.target.value))}
              error={!isValidLongitude(form.longitude)}
            />
            <TextField
              size="small"
              type="number"
              label="纬度"
              value={form.latitude}
              onChange={(e) => set('latitude', Number(e.target.value))}
              error={!isValidLatitude(form.latitude)}
            />
          </Stack>
          <Stack direction="row" spacing={1.5}>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel id="edit-coord-src-label">坐标来源</InputLabel>
              <Select
                labelId="edit-coord-src-label"
                label="坐标来源"
                value={form.coordinateSource}
                onChange={(e) => set('coordinateSource', e.target.value as CoordinateSource)}
              >
                {COORDINATE_SOURCES.map((c) => (
                  <MenuItem key={c} value={c}>
                    {COORDINATE_SOURCE_LABELS[c]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <FormControl size="small" sx={{ minWidth: 150 }}>
              <InputLabel id="edit-env-label">发现环境</InputLabel>
              <Select
                labelId="edit-env-label"
                label="发现环境"
                value={form.environment}
                onChange={(e) => set('environment', e.target.value as FindEnvironment)}
              >
                {FIND_ENVIRONMENTS.map((e) => (
                  <MenuItem key={e} value={e}>
                    {FIND_ENVIRONMENT_LABELS[e]}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Stack>
          <TextField
            size="small"
            label="发现者"
            value={form.finder}
            onChange={(e) => set('finder', e.target.value)}
          />
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          取消
        </Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || !coordOk}>
          保存（带修订号校验）
        </Button>
      </DialogActions>
    </Dialog>
  );
}
