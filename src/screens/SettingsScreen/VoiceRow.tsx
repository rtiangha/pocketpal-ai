import React, {useContext} from 'react';
import {Pressable, View} from 'react-native';

import {observer} from 'mobx-react-lite';
import {Icon, Text} from 'react-native-paper';

import {VolumeOnIcon} from '../../assets/icons';
import {useTheme} from '../../hooks';
import {ttsStore} from '../../store';
import {L10nContext} from '../../utils';

import {createStyles} from './styles';

/**
 * Fork-only settings row: opens the voice picker (the global TTS setup
 * sheet) so the voice can be changed after first setup, without hunting
 * for the chevron on the chat input's voice pill.
 *
 * Kept in its own file so upstream syncs never touch it — SettingsScreen
 * only imports it and renders it in the text-to-speech section. The row
 * itself calls only the store's existing public action and reads only its
 * current voice, so it needs no changes to any voice file upstream owns.
 */
export const VoiceRow: React.FC = observer(() => {
  const theme = useTheme();
  const l10n = useContext(L10nContext);
  const styles = createStyles(theme);
  const voice = ttsStore.currentVoice;

  return (
    <Pressable
      testID="voice-settings-row"
      accessibilityRole="button"
      accessibilityLabel={l10n.settings.ttsVoice}
      onPress={() => ttsStore.openSetupSheet()}>
      <View style={styles.switchContainer}>
        <View style={styles.textContainer}>
          <View style={styles.labelWithIconContainer}>
            <VolumeOnIcon
              width={20}
              height={20}
              style={styles.settingIcon}
              stroke={theme.colors.onSurface}
            />
            <Text variant="titleMedium" style={styles.textLabel}>
              {l10n.settings.ttsVoice}
            </Text>
          </View>
          <Text variant="labelSmall" style={styles.textDescription}>
            {voice?.name ?? l10n.voiceMode.chooseVoiceCta}
          </Text>
        </View>
        <Icon
          source="chevron-right"
          size={24}
          color={theme.colors.onSurfaceVariant}
        />
      </View>
    </Pressable>
  );
});
