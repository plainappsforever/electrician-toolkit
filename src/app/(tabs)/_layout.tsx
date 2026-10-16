import { Tabs } from 'expo-router/js-tabs';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import type { ColorValue } from 'react-native';

import { useT } from '@/hooks/use-t';
import { useTheme } from '@/hooks/use-theme';
import type { MessageKey } from '@/i18n';

// D28: Calculators · Projects · Tables · More. expo-router 57 bundles bottom tabs as `expo-router/js-tabs`
// (`@react-navigation/bottom-tabs` does not resolve on its own — D31). Icons (D75): SF Symbols on iPhone, Material Symbols on
// Android, both drawn by expo-symbols (already a dependency; Apple's terms allow symbols in an app's interface).
const ICONS: Record<'index' | 'projects' | 'tables' | 'more', SymbolViewProps['name']> = {
  index: { ios: 'function', android: 'calculate' },
  projects: { ios: 'folder', android: 'folder' },
  tables: { ios: 'tablecells', android: 'table_chart' },
  more: { ios: 'ellipsis.circle', android: 'more_horiz' },
};

export default function TabLayout() {
  const t = useT();
  const theme = useTheme();
  const tab = (key: keyof typeof ICONS, titleKey: MessageKey, testID: string) => ({
    title: t(titleKey),
    tabBarButtonTestID: testID,
    tabBarIcon: ({ color, size }: { color: ColorValue; size: number }) => <SymbolView name={ICONS[key]} tintColor={color as string} size={size} weight="regular" />,
    tabBarLabelStyle: { fontSize: 12 },
  });
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: theme.tint,
        tabBarInactiveTintColor: theme.textSecondary,
        tabBarStyle: { backgroundColor: theme.background },
        headerStyle: { backgroundColor: theme.background },
        headerTintColor: theme.text,
        tabBarAllowFontScaling: false, // "Calculators" was cut to "Calcula…" at 200 % text
        headerTitleAllowFontScaling: false, // the header has a fixed height; at the largest text sizes the title was cut off
      }}>
      <Tabs.Screen name="index" options={tab('index', 'tab.calculators', 'tab-calculators')} />
      <Tabs.Screen name="projects" options={tab('projects', 'tab.projects', 'tab-projects')} />
      <Tabs.Screen name="tables" options={tab('tables', 'tab.tables', 'tab-tables')} />
      <Tabs.Screen name="more" options={tab('more', 'tab.more', 'tab-more')} />
    </Tabs>
  );
}
