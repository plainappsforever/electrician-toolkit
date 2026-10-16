import { useRouter } from 'expo-router';

import { ListRow, Screen } from '@/components/form';
import { useT } from '@/hooks/use-t';

// More (SPEC §9): Settings, Backup & restore, Sources & licences, About & responsibility.
export default function MoreScreen() {
  const t = useT();
  const router = useRouter();
  return (
    <Screen testID="more-screen">
      <ListRow testID="open-settings" title={t('more.settings')} onPress={() => router.push('/settings')} />
      <ListRow testID="open-backup" title={t('more.backup')} onPress={() => router.push('/backup')} />
      <ListRow testID="open-sources" title={t('more.sources')} onPress={() => router.push('/sources')} />
      <ListRow testID="open-about" title={t('more.about')} onPress={() => router.push('/about')} />
    </Screen>
  );
}
