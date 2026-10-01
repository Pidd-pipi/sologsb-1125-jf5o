import { useState } from 'react';
import { Button } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import { attemptSave } from '../../services/persist';
import { useToastStore } from '../../stores/uiStore';
import type { AnalysisRecord } from '../../types/analysis';

interface Props {
  analysis: AnalysisRecord;
  size?: 'small' | 'medium';
}

/**
 * 失效检测记录的「重新确认」：
 * 切片换绑后记录 confirmed=false；人工核对无误后点此恢复有效。
 * 仍走修订号校验，期间又被其他标签页改动则弹合并对话框。
 */
export default function ReconfirmButton({ analysis, size = 'small' }: Props) {
  const notify = useToastStore((s) => s.notify);
  const [busy, setBusy] = useState(false);

  if (analysis.confirmed) return null;

  const handleClick = async () => {
    setBusy(true);
    try {
      const result = await attemptSave({
        entity: 'analysis',
        kind: 'update',
        recordId: analysis.id,
        recordLabel: `检测记录 · ${analysis.testedAt}`,
        base: analysis,
        patch: { confirmed: true },
      });
      if (result.ok) {
        notify('检测记录已重新确认，恢复为有效结论');
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : '确认失败，已加入待恢复写入', 'warning');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      size={size}
      variant="outlined"
      color="warning"
      startIcon={<CheckCircleOutlineIcon />}
      disabled={busy}
      onClick={() => void handleClick()}
    >
      {busy ? '确认中…' : '重新确认'}
    </Button>
  );
}
