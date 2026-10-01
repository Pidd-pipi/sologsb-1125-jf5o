import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import { useSampleStore } from '../../stores/sampleStore';
import { attemptSave, labelOf } from '../../services/persist';
import { useToastStore } from '../../stores/uiStore';
import type { ThinSection } from '../../types/section';

interface Props {
  section: ThinSection;
}

/** 切片库卡片上的快捷换绑：选目标样本 → 确认级联失效 → 带修订号提交 */
export default function QuickRebindControl({ section }: Props) {
  const samples = useSampleStore((s) => s.samples);
  const analysis = useSampleStore((s) => s.analysis);
  const notify = useToastStore((s) => s.notify);
  const [open, setOpen] = useState(false);
  const [targetId, setTargetId] = useState(section.sampleId);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setTargetId(section.sampleId);
  }, [open, section.sampleId]);

  const linkedCount = useMemo(
    () => analysis.filter((a) => a.sectionId === section.id).length,
    [analysis, section.id],
  );

  const openDialog = () => {
    setOpen(true);
  };

  const handleConfirm = async () => {
    if (targetId === section.sampleId) {
      setOpen(false);
      return;
    }
    setBusy(true);
    try {
      const result = await attemptSave({
        entity: 'section',
        kind: 'rebind',
        recordId: section.id,
        recordLabel: labelOf('section', section),
        base: section,
        patch: { sampleId: targetId },
        rebindSampleId: targetId,
      });
      if (result.ok) {
        notify(
          result.invalidatedAnalysis
            ? `已换绑，${result.invalidatedAnalysis} 条关联检测记录失效，等待重新确认${
                result.skippedAnalysis ? `，${result.skippedAnalysis} 条因被并发修改跳过` : ''
              }`
            : '切片已换绑到新样本',
        );
        setOpen(false);
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : '换绑失败，已加入待恢复写入', 'warning');
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="small"
        startIcon={<SwapHorizIcon />}
        onClick={openDialog}
        aria-label={`换绑切片 ${section.sectionNo} 的关联样本`}
      >
        换绑样本
      </Button>
      <Dialog open={open} onClose={busy ? undefined : () => setOpen(false)} maxWidth="xs" fullWidth>
        <DialogTitle>换绑切片「{section.sectionNo}」</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControl size="small" fullWidth>
              <InputLabel id={`rebind-target-${section.id}`}>新关联样本</InputLabel>
              <Select
                labelId={`rebind-target-${section.id}`}
                label="新关联样本"
                value={targetId}
                onChange={(e) => setTargetId(e.target.value)}
              >
                {samples.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.sampleNo}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Typography variant="body2" color="warning.main">
              换绑后，该切片关联的 {linkedCount} 条检测记录将改挂到新样本并标记失效，必须逐条重新确认后才可继续引用。
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>
            取消
          </Button>
          <Button variant="contained" color="warning" onClick={handleConfirm} disabled={busy || targetId === section.sampleId}>
            确认换绑
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
