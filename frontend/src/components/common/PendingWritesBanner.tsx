import { useState } from 'react';
import {
  Alert,
  Button,
  Chip,
  Collapse,
  IconButton,
  Stack,
  Typography,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import { useSampleStore } from '../../stores/sampleStore';
import { KIND_LABELS } from '../../utils/revision';

/**
 * 挂起写入横幅：写入失败或冲突未决时展示，支持逐条重试或放弃。
 * 保证「写入失败后可以恢复重试」。
 */
export default function PendingWritesBanner() {
  const pendingWrites = useSampleStore((s) => s.pendingWrites);
  const retryPendingWrite = useSampleStore((s) => s.retryPendingWrite);
  const discardPendingWrite = useSampleStore((s) => s.discardPendingWrite);
  const [expanded, setExpanded] = useState(false);

  if (pendingWrites.length === 0) return null;

  const conflictCount = pendingWrites.filter((w) => w.reason === 'conflict').length;
  const errorCount = pendingWrites.length - conflictCount;

  return (
    <Alert
      severity="warning"
      sx={{ mb: 2 }}
      action={
        <IconButton size="small" onClick={() => setExpanded((v) => !v)} aria-label="展开挂起列表">
          {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
        </IconButton>
      }
    >
      <Stack spacing={0.5}>
        <Typography variant="body2" fontWeight={600}>
          有 {pendingWrites.length} 项写入未完成
          {conflictCount ? `（${conflictCount} 项版本冲突` : ''}
          {conflictCount && errorCount ? '，' : ''}
          {errorCount ? `${errorCount} 项写入异常` : ''}
          {conflictCount || errorCount ? '）' : ''}
          ，可重试或放弃。
        </Typography>
        <Collapse in={expanded}>
          <Stack spacing={0.75} sx={{ mt: 1 }}>
            {pendingWrites.map((w) => (
              <Stack
                key={w.id}
                direction="row"
                spacing={1}
                alignItems="center"
                flexWrap="wrap"
                useFlexGap
                sx={{ bgcolor: 'background.paper', borderRadius: 1, px: 1, py: 0.5 }}
              >
                <Chip size="small" label={KIND_LABELS[w.kind]} />
                <Typography variant="body2" sx={{ flex: 1, minWidth: 120 }}>
                  {w.recordLabel}
                  {w.lastError ? ` · ${w.lastError}` : ''}
                </Typography>
                <Button
                  size="small"
                  startIcon={<RefreshIcon />}
                  onClick={() => void retryPendingWrite(w.id)}
                >
                  重试
                </Button>
                <Button size="small" color="inherit" onClick={() => discardPendingWrite(w.id)}>
                  放弃
                </Button>
              </Stack>
            ))}
          </Stack>
        </Collapse>
      </Stack>
    </Alert>
  );
}
