import { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import RestoreIcon from '@mui/icons-material/Restore';
import CloseIcon from '@mui/icons-material/Close';
import PendingActionsIcon from '@mui/icons-material/PendingActions';
import { removePending, usePendingWrites } from '../../stores/pendingWrites';
import { discardCurrent, retryPending } from '../../services/persist';
import { ENTITY_LABELS } from '../../utils/fields';
import { useToastStore } from '../../stores/uiStore';

/**
 * 顶部待恢复写入条：保存因版本冲突或写入异常失败后，改动保存在这里，
 * 可逐条「重试」（走最新修订号，仍冲突会再弹合并对话框）或「丢弃」。
 */
export default function PendingWritesBar() {
  const pending = usePendingWrites();
  const notify = useToastStore((s) => s.notify);
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (pending.length === 0) return null;

  const handleRetry = async (pendingId: string) => {
    setBusyId(pendingId);
    try {
      const r = await retryPending(pendingId);
      if (r.status === 'done') {
        notify(
          typeof r.invalidatedAnalysis === 'number' && r.invalidatedAnalysis > 0
            ? `换绑成功，${r.invalidatedAnalysis} 条关联检测记录已失效，等待重新确认`
            : '待恢复写入已成功入库',
        );
      } else if (r.status === 'missing') {
        notify('原记录已不存在，该待办已清理', 'warning');
      }
      // still-conflict 时合并对话框已自动弹出
    } catch (err) {
      notify(err instanceof Error ? err.message : '重试失败，待办仍保留', 'warning');
    } finally {
      setBusyId(null);
    }
  };

  const handleDiscard = (pendingId: string) => {
    removePending(pendingId);
    discardCurrent();
    notify('已丢弃该条待恢复写入', 'info');
  };

  return (
    <>
      <Alert
        severity="warning"
        icon={<PendingActionsIcon />}
        action={
          <Stack direction="row" spacing={1} alignItems="center">
            <Button size="small" startIcon={<RestoreIcon />} onClick={() => setOpen(true)}>
              查看并恢复
            </Button>
          </Stack>
        }
        sx={{ mb: 2 }}
      >
        有 <strong>{pending.length}</strong> 条写入未入库（版本冲突或写入失败），改动已暂存，可恢复重试。
      </Alert>

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>待恢复写入（{pending.length}）</DialogTitle>
        <DialogContent>
          <Stack spacing={1.5}>
            {pending.map((w) => (
              <Stack
                key={w.pendingId}
                spacing={0.5}
                sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, p: 1.5 }}
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <Chip size="small" label={ENTITY_LABELS[w.entity]} color="primary" variant="outlined" />
                  <Typography variant="subtitle2">{w.recordLabel}</Typography>
                  {w.rebind ? <Chip size="small" color="secondary" label="含换绑" /> : null}
                </Stack>
                <Typography variant="caption" color="text.secondary">
                  {w.reason}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  改动字段：{Object.keys(w.patch).join('、') || '（无）'}
                </Typography>
                <Stack direction="row" spacing={1} sx={{ mt: 0.5 }}>
                  <Button
                    size="small"
                    variant="outlined"
                    disabled={busyId === w.pendingId}
                    onClick={() => void handleRetry(w.pendingId)}
                  >
                    {busyId === w.pendingId ? '重试中…' : '按最新版本重试'}
                  </Button>
                  <Button size="small" color="inherit" onClick={() => handleDiscard(w.pendingId)}>
                    丢弃
                  </Button>
                </Stack>
              </Stack>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <IconButton size="small" onClick={() => setOpen(false)} aria-label="关闭待恢复列表">
            <CloseIcon />
          </IconButton>
        </DialogActions>
      </Dialog>
    </>
  );
}
