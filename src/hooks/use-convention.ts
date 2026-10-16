import { useLanguage } from '@/hooks/use-t';
import { conventionFor } from '@/lib/calc-form';
import { deviceDecimalSeparator } from '@/lib/locale';

/** How typed numbers are read and written: the device's decimal separator, else the UI language (re-renders on language change). */
export function useConvention() {
  const language = useLanguage();
  return conventionFor(deviceDecimalSeparator(), language);
}
