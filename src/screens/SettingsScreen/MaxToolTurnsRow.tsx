import React, {useContext} from 'react';
import {View} from 'react-native';

import {observer} from 'mobx-react-lite';

import {useTheme} from '../../hooks';
import {chatSessionStore} from '../../store';
import {L10nContext} from '../../utils';
import {t} from '../../locales';
import {InputSlider} from '../../components/InputSlider';
import {MAX_TOOL_TURNS, MIN_TOOL_TURNS} from '../../services/agent';

import {createStyles} from './styles';

/**
 * Fork-only settings row: max tool-calling turns per assistant reply.
 *
 * Kept in its own file so upstream syncs never touch it — SettingsScreen
 * only imports it and renders it after the auto-compaction toggle. The
 * row itself calls only the store's setMaxToolTurns action and reads
 * only its value, so it needs no changes to any file upstream owns.
 *
 * The slider runs MIN_TOOL_TURNS..MAX_TOOL_TURNS (2..20), default 5
 * (DEFAULT_MAX_TURNS). The value is persisted in global_settings and
 * read fresh on every run, so it takes effect on the next reply with
 * no rebuild. The model is told a budget of turns - 1 (one turn is
 * kept for the final answer), and the runner enforces the turn cap.
 */
export const MaxToolTurnsRow: React.FC = observer(() => {
  const theme = useTheme();
  const l10n = useContext(L10nContext);
  const styles = createStyles(theme);
  const turns = chatSessionStore.maxToolTurns;

  return (
    <View style={styles.settingItemContainer}>
      <InputSlider
        testID="max-tool-turns-slider"
        label={l10n.settings.maxToolTurns}
        description={t(l10n.settings.maxToolTurnsDescription, {
          maxToolTurns: turns.toString(),
          toolBudget: (turns - 1).toString(),
        })}
        value={turns}
        onValueChange={value =>
          chatSessionStore.setMaxToolTurns(Math.round(value))
        }
        min={MIN_TOOL_TURNS}
        max={MAX_TOOL_TURNS}
        step={1}
        showRangeLabel
      />
    </View>
  );
});
