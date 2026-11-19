import React, {useContext, useRef, useEffect} from 'react';
import {
  View,
  TextInput,
  TextInputInstance,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';

import {observer} from 'mobx-react-lite';
import {Text} from 'react-native-paper';

import {useTheme} from '../../hooks';
import {chatSessionStore} from '../../store';

import {
  ChevronDownIcon,
  ChevronUpIcon,
  CloseIcon,
  SearchIcon,
} from '../../assets/icons';
import {L10nContext} from '../../utils';
import {t} from '../../locales';

interface ChatSearchBarProps {
  matchCount: number;
  matchIndex: number;
}

export const ChatSearchBar: React.FC<ChatSearchBarProps> = observer(
  ({matchCount, matchIndex}) => {
    const theme = useTheme();
    const l10n = useContext(L10nContext);
    const inputRef = useRef<TextInputInstance>(null);

    useEffect(() => {
      // Auto-focus when search bar appears
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }, []);

    const hasQuery = chatSessionStore.searchQuery.trim().length > 0;
    // Before the first prev/next tap there is no selection yet, so show
    // the plain count; once navigating, show the position ("3 of 12").
    const counterText =
      matchCount === 0
        ? l10n.chat.noResults
        : matchIndex >= 0
          ? t(l10n.chat.searchResultPosition, {
              current: matchIndex + 1,
              total: matchCount,
            })
          : `${matchCount}`;
    const navDisabled = matchCount === 0;

    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: theme.colors.surface,
            borderBottomColor: theme.colors.outlineVariant,
          },
        ]}>
        <View style={styles.inputRow}>
          <SearchIcon
            width={18}
            height={18}
            stroke={theme.colors.onSurfaceVariant}
          />
          <TextInput
            ref={inputRef}
            style={[styles.input, {color: theme.colors.onSurface}]}
            placeholder={l10n.chat.searchMessages}
            placeholderTextColor={theme.colors.onSurfaceVariant}
            value={chatSessionStore.searchQuery}
            onChangeText={query => chatSessionStore.setSearchQuery(query)}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            accessibilityLabel={l10n.chat.searchMessages}
            testID="chat-search-input"
          />
          {hasQuery && (
            <Text
              variant="bodySmall"
              style={[
                styles.matchCount,
                {color: theme.colors.onSurfaceVariant},
              ]}>
              {counterText}
            </Text>
          )}
          <TouchableOpacity
            onPress={() => chatSessionStore.goToPreviousSearchMatch()}
            disabled={navDisabled}
            style={[styles.navButton, navDisabled && styles.navButtonDisabled]}
            accessibilityRole="button"
            accessibilityLabel={l10n.chat.previousResult}
            testID="search-prev-button">
            <ChevronUpIcon
              width={18}
              height={18}
              stroke={theme.colors.onSurfaceVariant}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => chatSessionStore.goToNextSearchMatch()}
            disabled={navDisabled}
            style={[styles.navButton, navDisabled && styles.navButtonDisabled]}
            accessibilityRole="button"
            accessibilityLabel={l10n.chat.nextResult}
            testID="search-next-button">
            <ChevronDownIcon
              width={18}
              height={18}
              stroke={theme.colors.onSurfaceVariant}
            />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => chatSessionStore.exitSearchMode()}
            style={styles.closeButton}
            accessibilityRole="button"
            accessibilityLabel={l10n.chat.closeSearch}
            testID="search-close-button">
            <CloseIcon
              width={18}
              height={18}
              stroke={theme.colors.onSurfaceVariant}
            />
          </TouchableOpacity>
        </View>
      </View>
    );
  },
);

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  input: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 4,
  },
  matchCount: {
    marginHorizontal: 4,
  },
  navButton: {
    padding: 4,
  },
  navButtonDisabled: {
    opacity: 0.4,
  },
  closeButton: {
    padding: 4,
  },
});
