// A short status message under an action (done, failed, working). `kind` colours it; every one has a testID so a flow can read it.
import { Card } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { useTheme } from '@/hooks/use-theme';

export type NoticeData = { kind: 'info' | 'error' | 'warning'; text: string; testID: string };

export function Notice({ note }: { note: NoticeData | null }) {
  const theme = useTheme();
  if (!note) return null;
  const color = note.kind === 'error' ? theme.danger : note.kind === 'warning' ? theme.warning : theme.success;
  return (
    <Card>
      <ThemedText testID={note.testID} type="small" style={{ color }}>
        {note.text}
      </ThemedText>
    </Card>
  );
}
