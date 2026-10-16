// About & responsibility (SPEC §9, §15): the note, versions, privacy policy, contact, open-source licences.
// OWNER WORDING: the owner decides the final note text (D16). v1.1: privacy link, contact line and licences (RELEASE_KIT 1c 8-10).
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

import { Card, LinkButton, ListRow, Screen, SectionTitle } from '@/components/form';
import { ThemedText } from '@/components/themed-text';
import { PRIVACY_POLICY_URL, SUPPORT_EMAIL, SUPPORT_URL } from '@/constants/contact';
import { ENGINE_VERSION, EU_DE } from '@/engine';
import { useT } from '@/hooks/use-t';

export default function AboutScreen() {
  const t = useT();
  const router = useRouter();
  return (
    <Screen testID="about-screen">
      <ThemedText type="subtitle">{t('about.title')}</ThemedText>
      <ThemedText>{t('about.tagline')}</ThemedText>
      <SectionTitle>{t('about.responsibility')}</SectionTitle>
      <Card>
        <ThemedText testID="about-note">{t('note.responsibility')}</ThemedText>
      </Card>
      <SectionTitle>{t('about.versions')}</SectionTitle>
      <ThemedText testID="about-versions" type="small">
        {t('report.versions', { app: Constants.expoConfig?.version ?? '', engine: ENGINE_VERSION, profile: EU_DE.id })}
      </ThemedText>
      <ThemedText type="small" themeColor="textSecondary">
        {t('about.privacy')}
      </ThemedText>
      <LinkButton testID="about-privacy-link" label={t('about.privacyLink')} onPress={() => void WebBrowser.openBrowserAsync(PRIVACY_POLICY_URL)} />
      <SectionTitle>{t('about.contact')}</SectionTitle>
      <ThemedText testID="about-contact" type="small" selectable>
        {t('about.contactLine', { email: SUPPORT_EMAIL })}
      </ThemedText>
      <LinkButton testID="about-support-link" label={t('about.supportLink')} onPress={() => void WebBrowser.openBrowserAsync(SUPPORT_URL)} />
      <ListRow testID="open-licences" title={t('about.licences')} onPress={() => router.push('/licences')} />
    </Screen>
  );
}
