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
  FormControlLabel,
  Radio,
  RadioGroup,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import MergeTypeIcon from '@mui/icons-material/MergeType';
import UndoIcon from '@mui/icons-material/Undo';
import SaveIcon from '@mui/icons-material/Save';
import { useSampleStore } from '../../stores/sampleStore';
import { KIND_LABELS, formatFieldValue } from '../../utils/revision';
import type { FieldDiff } from '../../types/conflict';

type Choice = 'remote' | 'local';

/**
 * 修订号冲突合并对话框：
 * 保存前比对库内值发现版本过期时弹出，列出「库内改动 / 我的改动 / 基础值」三方对照，
 * 用户可逐字段选择采用哪一方，确认合并后再入库。
 */
export default function ConflictDialog() {
  const conflict = useSampleStore((s) => s.conflict);
  const resolveConflict = useSampleStore((s) => s.resolveConflict);
  const discardConflict = useSampleStore((s) => s.discardConflict);
  const pendingWrites = useSampleStore((s) => s.pendingWrites);
  const discardPendingWrite = useSampleStore((s) => s.discardPendingWrite);

  const [choices, setChoices] = useState<Record<string, Choice>>({});

  // 每次冲突变化时，按「仅库内改→库内，仅本地改→本地，双方都改→本地」初始化选择
  useEffect(() => {
    if (!conflict) return;
    const init: Record<string, Choice> = {};
    for (const d of conflict.diffs) {
      if (d.changedByRemote && !d.changedByLocal) init[d.field] = 'remote';
      else init[d.field] = 'local';
    }
    setChoices(init);
  }, [conflict]);

  const merged = useMemo(() => {
    if (!conflict) return null;
    const out: Record<string, unknown> = { ...conflict.remote };
    for (const d of conflict.diffs) {
      const choice = choices[d.field] ?? 'local';
      out[d.field] = choice === 'local' ? conflict.local[d.field] : conflict.remote[d.field];
    }
    return out;
  }, [conflict, choices]);

  if (!conflict || !merged) return null;

  const kindLabel = KIND_LABELS[conflict.kind];
  const fromQueue = pendingWrites.some(
    (w) => w.kind === conflict.kind && w.recordId === conflict.recordId && w.reason === 'conflict',
  );

  const setChoice = (field: string, c: Choice) => setChoices((prev) => ({ ...prev, [field]: c }));

  const handleMerge = async () => {
    await resolveConflict(conflict.kind, merged);
  };

  const handleForceLocal = async () => {
    await resolveConflict(conflict.kind, { ...conflict.local });
  };

  const handleAcceptRemote = () => {
    // 以库内为准 = 放弃本地改动，不写入、不挂起；若来自挂起队列则一并移除
    if (fromQueue) {
      const pw = pendingWrites.find(
        (w) => w.kind === conflict.kind && w.recordId === conflict.recordId && w.reason === 'conflict',
      );
      if (pw) discardPendingWrite(pw.id);
    }
    discardConflict(true);
  };

  return (
    <Dialog open onClose={handleAcceptRemote} maxWidth="md" fullWidth>
      <DialogTitle>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          <MergeTypeIcon color="warning" />
          <Typography variant="h6">保存被拒绝：{kindLabel}已被其他标签页修改</Typography>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Alert severity="warning">
            你编辑的是旧版本（修订号 rev {conflict.baseRevision}），库内当前已更新到 rev {conflict.remoteRevision}
            。为避免后保存覆盖先改内容，请确认合并后再入库。
          </Alert>

          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
            <Chip size="small" label={`${kindLabel}：${conflict.recordLabel}`} />
            <Chip size="small" variant="outlined" label={`基础 rev ${conflict.baseRevision}`} />
            <Chip size="small" color="warning" label={`库内 rev ${conflict.remoteRevision}`} />
            <Chip size="small" color="info" variant="outlined" label={`我的 rev ${conflict.baseRevision}（未入库）`} />
          </Stack>

          {conflict.diffs.length === 0 ? (
            <Alert severity="info">双方改动字段相同，可直接确认合并。</Alert>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ width: '18%' }}>字段</TableCell>
                  <TableCell sx={{ width: '32%' }}>库内改动（对方）</TableCell>
                  <TableCell sx={{ width: '32%' }}>我的改动</TableCell>
                  <TableCell sx={{ width: '18%' }}>采用</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {conflict.diffs.map((d: FieldDiff) => {
                  const choice = choices[d.field] ?? 'local';
                  return (
                    <TableRow key={d.field}>
                      <TableCell>
                        <Stack spacing={0.25}>
                          <Typography variant="body2" fontWeight={600}>
                            {d.label}
                          </Typography>
                          <Stack direction="row" spacing={0.5}>
                            {d.changedByRemote ? (
                              <Chip size="small" color="warning" label="库内改" sx={{ height: 18, fontSize: 11 }} />
                            ) : null}
                            {d.changedByLocal ? (
                              <Chip size="small" color="info" label="我改" sx={{ height: 18, fontSize: 11 }} />
                            ) : null}
                          </Stack>
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          color={d.changedByRemote ? 'warning.main' : 'text.secondary'}
                          sx={{ wordBreak: 'break-word' }}
                        >
                          {formatFieldValue(d.field, d.remoteValue)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Typography
                          variant="body2"
                          color={d.changedByLocal ? 'info.main' : 'text.secondary'}
                          sx={{ wordBreak: 'break-word' }}
                        >
                          {formatFieldValue(d.field, d.localValue)}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <RadioGroup
                          row
                          value={choice}
                          onChange={(e) => setChoice(d.field, e.target.value as Choice)}
                        >
                          <FormControlLabel value="remote" control={<Radio size="small" />} label="库内" />
                          <FormControlLabel value="local" control={<Radio size="small" />} label="我的" />
                        </RadioGroup>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          <Divider />
          <Typography variant="caption" color="text.secondary">
            合并结果将以 rev {conflict.remoteRevision + 1} 入库。若暂时无法决定，可关闭对话框，本次写入会挂起并在顶部提示重试。
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleAcceptRemote} startIcon={<UndoIcon />} color="inherit">
          以库内为准
        </Button>
        <Button onClick={() => discardConflict()} color="inherit">
          稍后处理
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button onClick={handleForceLocal} color="warning" variant="outlined">
          强制以我的入库
        </Button>
        <Button onClick={handleMerge} variant="contained" startIcon={<SaveIcon />}>
          确认合并
        </Button>
      </DialogActions>
    </Dialog>
  );
}
