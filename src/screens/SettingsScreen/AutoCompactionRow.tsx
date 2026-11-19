import React, {useContext} from 'react';
import {View} from 'react-native';

import {observer} from 'mobx-react-lite';
import {Switch, Text} from 'react-native-paper';

import {useTheme} from '../../hooks';
import {chatSessionStore} from '../../store';
import {L10nContext} from '../../utils';

import {createStyles} from './styles';

/**
 * Fork-only settings row: the automatic-compaction toggle.
 *
 * Kept in its own file so upstream syncs never touch it — SettingsScreen
 * only imports it and renders it after the Context Size item. The row
 * itself calls only the store's setAutoCompactionEnabled action and reads
 * only its flag, so it needs no changes to any file upstream owns.
 *
 * On: a finished turn that pushes context usage past the headroom
 * threshold compacts by itself, and a context-full turn recovers by
 * compacting. Off (default): nothing compacts on its own — the chat
 * behaves as before the compaction PR, and /compact plus the banner
 * Compact buttons still work.
 */
export const AutoCompactionRow: React.FC = observer(() => {
  const theme = useTheme();
  const l10n = useContext(L10nContext);
  const styles = createStyles(theme);

  return (
    <View style={styles.switchContainer}>
      <View style={styles.textContainer}>
        <Text variant="titleMedium" style={styles.textLabel}>
          {l10n.settings.autoCompaction}
        </Text>
        <Text variant="labelSmall" style={styles.textDescription}>
          {l10n.settings.autoCompactionDescription}
        </Text>
      </View>
      <Switch
        testID="auto-compaction-switch"
        value={chatSessionStore.autoCompactionEnabled}
        onValueChange={value =>
          chatSessionStore.setAutoCompactionEnabled(value)
        }
      />
    </View>
  );
});
