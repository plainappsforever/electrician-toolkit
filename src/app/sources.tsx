// Sources & licences (SPEC §7.8, D30): every source the calculations cite, with clause, licence status and — where one
// exists — a public restatement. "licensed-cited" = the clause is cited, the standard's text or tables are not reproduced.
import * as WebBrowser from 'expo-web-browser';

import { Card, LinkButton, Screen } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { SOURCES, SOURCE_IDS, type Source } from '@/engine';
import { useLanguage, useT } from '@/hooks/use-t';

export default function SourcesScreen() {
  const t = useT();
  const lang = useLanguage();
  return (
    <Screen testID="sources-screen">
      <ThemedText type="small" themeColor="textSecondary">
        {t('sources.intro')}
      </ThemedText>
      {SOURCE_IDS.map((id) => {
        const s: Source = SOURCES[id];
        const text = lang === 'de' ? s.de : s;
        return (
          <Card key={id} testID={`source-card-${id}`}>
            <ThemedText type="smallBold">{text.standard}</ThemedText>
            <ThemedText type="small">{`${s.edition} — ${text.clause}`}</ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {text.summary}
            </ThemedText>
            <ThemedText type="small" themeColor="textSecondary">
              {t(s.licence === 'public' ? 'report.licence.public' : 'report.licence.licensed-cited')}
            </ThemedText>
            {text.unconfirmed ? <ThemedText type="small">{t('report.unconfirmed', { note: text.unconfirmed })}</ThemedText> : null}
            {s.publicUrl ? <LinkButton testID={`source-link-${id}`} label={t('sources.open')} onPress={() => void WebBrowser.openBrowserAsync(s.publicUrl!)} /> : null}
          </Card>
        );
      })}
    </Screen>
  );
}
