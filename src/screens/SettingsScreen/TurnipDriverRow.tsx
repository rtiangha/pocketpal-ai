import React, {useCallback, useEffect, useState} from 'react';
import {
  Alert,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';

import {Button, Switch, Text, TextInput} from 'react-native-paper';

import {useTheme} from '../../hooks';
import {
  clearTurnipImportError,
  clearTurnipSelfTest,
  getTurnipEnv,
  getTurnipLastPipeline,
  getTurnipSelfTest,
  getTurnipState,
  importTurnipDriver,
  removeTurnipDriver,
  setTurnipEnabled,
  setTurnipEnv,
  type TurnipState,
} from '../../utils/turnipDriver';

import {createStyles} from './styles';

const localStyles = StyleSheet.create({
  buttonRow: {flexDirection: 'row', marginTop: 8},
  envInput: {marginTop: 8},
  errorRow: {flexDirection: 'row', alignItems: 'center', marginTop: 4},
  errorText: {flex: 1},
  report: {marginTop: 8, fontFamily: 'monospace'},
  helpBackdrop: {flex: 1, justifyContent: 'center', padding: 16},
  helpCard: {borderRadius: 16, padding: 16, maxHeight: '90%'},
  helpItem: {marginTop: 10},
});

/** Starting points for the environment box (the Save button still has to be pressed). */
const ENV_PRESETS = {
  defaults: '',
  stock: 'RNLLAMA_VK_NO_DEFAULTS=1',
  safe: [
    'RNLLAMA_VK_NO_DEFAULTS=1',
    'GGML_VK_DISABLE_F16=1',
    'GGML_VK_DISABLE_INTEGER_DOT_PRODUCT=1',
    'GGML_VK_DISABLE_FUSION=1',
  ].join('\n'),
};

/** Variables the driver environment box understands: [name, what it does]. */
const ENV_HELP: Array<[string, string]> = [
  [
    'RNLLAMA_VK_NO_DEFAULTS=1',
    'Turns off every automatic workaround below (and enables buffer device address): stock driver behaviour. Variables you add still apply.',
  ],
  [
    'GGML_VK_UNSUPPORTED_TYPES=Q6_K,Q2_K',
    'Weight types whose matrix multiplications run on the CPU. Default: Q6_K, Q2_K, Q3_K, IQ1_S, IQ1_M, IQ2_XXS, IQ2_XS, IQ2_S, IQ3_XXS, IQ3_S, IQ4_XS (wrong results on this driver). Set it empty to run everything on the GPU.',
  ],
  [
    'GGML_VK_DISABLE_QUANT_GET_ROWS=0',
    'Default 1: get_rows (token embedding lookups) on quantized weights run on the CPU because the GPU returns wrong rows. 0 runs them on the GPU.',
  ],
  [
    'GGML_VK_DISABLE_QUANT_SET_ROWS=0',
    'Default 1: writes into a quantized KV cache run on the CPU because the GPU writes wrong data. 0 runs them on the GPU. The app keeps the KV cache at F16 with the Vulkan GPU anyway.',
  ],
  [
    'GGML_VK_UNSUPPORTED_OPS=SSM_CONV,SOFT_MAX',
    'Operations (by ggml name) that run on the CPU instead of the GPU.',
  ],
  [
    'GGML_VK_ALLOWED_OPS=MUL_MAT,ADD',
    'Only these operations run on the GPU, everything else on the CPU. Useful to find which operation breaks the output.',
  ],
  [
    'RNLLAMA_VK_NO_WG512=0',
    'Default 1: avoids the 512-wide soft_max shaders, which make the driver kill the app (long contexts without flash attention). 0 allows them.',
  ],
  [
    'RNLLAMA_VK_ENABLE_BDA=1',
    'Enables buffer device address. Off by default because it crashed Adreno 660 drivers.',
  ],
  ['GGML_VK_DISABLE_F16=1', 'No 16-bit float shaders (everything in 32-bit).'],
  [
    'GGML_VK_DISABLE_FUSION=1',
    'Do not fuse consecutive operations into one shader.',
  ],
  [
    'GGML_VK_DISABLE_INTEGER_DOT_PRODUCT=1',
    'Do not use integer dot product matrix multiplications.',
  ],
  ['GGML_VK_DISABLE_MMVQ=1', 'Do not use the quantized matrix-vector shaders.'],
  [
    'GGML_VK_DISABLE_GRAPH_OPTIMIZE=1',
    'Do not reorder operations in the graph.',
  ],
  [
    'GGML_VK_DISABLE_MULTI_ADD=1',
    'Do not combine several additions into one shader.',
  ],
  [
    'GGML_VK_DISABLE_NARROW_MUL_MAT=1',
    'Do not use the narrow-matrix multiplication shaders.',
  ],
  ['GGML_VK_DISABLE_DOT2=1', 'Do not use the dot2 fp16 instructions.'],
  [
    'GGML_VK_DISABLE_ASYNC=1',
    'Do the work in one queue, without asynchronous transfers.',
  ],
  [
    'GGML_VK_DISABLE_DESCRIPTOR_REUSE=1',
    'Do not reuse descriptor sets between operations.',
  ],
  [
    'GGML_VK_MAX_NODES_PER_SUBMIT=100',
    'How many graph operations are sent to the GPU per submission. Smaller values can avoid GPU timeouts.',
  ],
  ['GGML_VK_PREFER_HOST_MEMORY=1', 'Allocate buffers in host memory first.'],
  [
    'GGML_VK_FORCE_MAX_ALLOCATION_SIZE=134217728',
    'Largest single allocation in bytes. Lower it if allocations fail.',
  ],
  [
    'GGML_VK_SUBALLOCATION_BLOCK_SIZE=268435456',
    'Block size in bytes for sub-allocating memory.',
  ],
  [
    'RNLLAMA_VK_SELFTEST=1',
    'Runs the GPU self-test when the next model loads (2 adds large sizes and may kill the driver). Removed after it runs; the report appears above.',
  ],
  [
    'RNLLAMA_VK_SELFTEST_ONLY=soft_max',
    'Self-test: only run cases whose names contain one of these comma separated fragments.',
  ],
  [
    'RNLLAMA_VK_SELFTEST_SKIP=flash_attn',
    'Self-test: skip cases whose names contain one of these fragments (use it to get past a case that kills the app).',
  ],
  [
    'RNLLAMA_VK_LOG_PIPELINES=1',
    'Logs every shader the driver compiles to logcat (tag RNLlamaVk).',
  ],
];

/**
 * Fork-only settings row (Android): use a custom Vulkan driver (Mesa Turnip) through
 * libadrenotools. The switch and the imported driver are stored as files that the patched
 * llama.rn reads when the app starts, so every change needs an app restart.
 *
 * Kept in its own file so upstream syncs never touch it.
 */
export const TurnipDriverRow: React.FC = () => {
  const theme = useTheme();
  const styles = createStyles(theme);
  const [state, setState] = useState<TurnipState | null>(null);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [envText, setEnvText] = useState('');
  const [envDirty, setEnvDirty] = useState(false);
  const [selfTest, setSelfTest] = useState('');
  const [lastPipeline, setLastPipeline] = useState('');
  const [helpVisible, setHelpVisible] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setState(await getTurnipState());
      setSelfTest(await getTurnipSelfTest());
      setLastPipeline(await getTurnipLastPipeline());
    } catch (error) {
      console.warn('Failed to read the custom driver state:', error);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    getTurnipEnv()
      .then(setEnvText)
      .catch(error => console.warn('Failed to read the driver env:', error));
  }, []);

  if (Platform.OS !== 'android' || !state) {
    return null;
  }

  const hasDriver = state.driverName !== null || state.pendingImport;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      setChanged(true);
    } catch (error) {
      Alert.alert('Custom Vulkan driver', (error as Error).message);
    } finally {
      await refresh();
      setBusy(false);
    }
  };

  const onToggle = (value: boolean) => run(() => setTurnipEnabled(value));

  const onRunSelfTest = (level: number) =>
    run(async () => {
      const lines = envText
        .split('\n')
        .filter(line => !line.trim().startsWith('RNLLAMA_VK_SELFTEST='));
      const next = [...lines, `RNLLAMA_VK_SELFTEST=${level}`].join('\n').trim();
      await setTurnipEnv(next);
      await clearTurnipSelfTest();
      setEnvText(next);
      setEnvDirty(false);
    });

  const applyPreset = (text: string) => {
    setEnvText(text);
    setEnvDirty(true);
  };

  const onSaveEnv = () =>
    run(async () => {
      await setTurnipEnv(envText);
      setEnvDirty(false);
    });

  const onDismissSelfTest = async () => {
    try {
      await clearTurnipSelfTest();
      setSelfTest('');
    } catch (error) {
      console.warn('Failed to dismiss the self-test report:', error);
    }
  };

  const onDismissImportError = async () => {
    try {
      await clearTurnipImportError();
      setState(prev => (prev ? {...prev, importError: null} : prev));
    } catch (error) {
      console.warn('Failed to dismiss the driver import error:', error);
    }
  };

  const onImport = () =>
    run(async () => {
      await importTurnipDriver();
    });

  const onRemove = () =>
    Alert.alert(
      'Remove driver',
      'Delete the imported driver and its environment variables, and turn the custom driver off?',
      [
        {text: 'Cancel', style: 'cancel'},
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => run(removeTurnipDriver),
        },
      ],
    );

  const driverText = state.pendingImport
    ? 'Driver package imported, it is unpacked the next time the app starts.'
    : state.driverName
      ? `Driver: ${state.driverName}`
      : 'No driver imported yet.';

  const versionValue =
    state.driverVersion ??
    'unknown (import a package with meta.json for the version)';
  const versionText = state.pendingImport
    ? 'Vulkan Ver: available after the app restarts'
    : `Vulkan Ver: ${versionValue}`;

  return (
    <View>
      <View style={styles.switchContainer}>
        <View style={styles.textContainer}>
          <Text variant="titleMedium" style={styles.textLabel}>
            Custom Vulkan driver (Turnip)
          </Text>
          <Text variant="labelSmall" style={styles.textDescription}>
            Loads an imported Mesa Turnip driver through libadrenotools and adds
            a Vulkan GPU option to the device selection. Experimental.
          </Text>
        </View>
        <Switch
          testID="turnip-driver-switch"
          value={state.enabled}
          disabled={busy || !hasDriver}
          onValueChange={onToggle}
        />
      </View>
      <Text variant="labelSmall" style={styles.textDescription}>
        {driverText}
      </Text>
      {hasDriver && (
        <Text
          testID="turnip-driver-version"
          variant="labelSmall"
          style={styles.textDescription}>
          {versionText}
        </Text>
      )}
      {state.importError !== null && (
        <View style={localStyles.errorRow}>
          <Text
            testID="turnip-import-error"
            variant="labelSmall"
            style={[
              styles.textDescription,
              {color: theme.colors.error},
              localStyles.errorText,
            ]}>
            {`Driver import failed: ${state.importError}`}
          </Text>
          <Button
            testID="turnip-import-error-dismiss"
            compact
            onPress={onDismissImportError}>
            Dismiss
          </Button>
        </View>
      )}
      <View style={localStyles.buttonRow}>
        <Button
          testID="turnip-import-button"
          mode="outlined"
          disabled={busy}
          onPress={onImport}>
          {hasDriver ? 'Replace driver' : 'Import driver'}
        </Button>
        {hasDriver && (
          <Button
            testID="turnip-remove-button"
            disabled={busy}
            onPress={onRemove}>
            Remove
          </Button>
        )}
      </View>
      <TextInput
        testID="turnip-env-input"
        mode="outlined"
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        label="Driver environment variables"
        placeholder="GGML_VK_DISABLE_F16=1"
        value={envText}
        onChangeText={text => {
          setEnvText(text);
          setEnvDirty(true);
        }}
        style={localStyles.envInput}
      />
      <View style={localStyles.buttonRow}>
        <Button
          testID="turnip-preset-defaults"
          compact
          onPress={() => applyPreset(ENV_PRESETS.defaults)}>
          Defaults
        </Button>
        <Button
          testID="turnip-preset-stock"
          compact
          onPress={() => applyPreset(ENV_PRESETS.stock)}>
          Stock
        </Button>
        <Button
          testID="turnip-preset-safe"
          compact
          onPress={() => applyPreset(ENV_PRESETS.safe)}>
          Safe
        </Button>
        <Button
          testID="turnip-env-help-button"
          compact
          onPress={() => setHelpVisible(true)}>
          Help
        </Button>
      </View>
      <Text variant="labelSmall" style={styles.textDescription}>
        Defaults: Set all known workarounds. Stock: Set no options. Safe: Stock
        plus known safe options. With the Vulkan GPU the KV cache is always F16.
      </Text>
      <Button
        testID="turnip-env-save-button"
        disabled={busy || !envDirty}
        onPress={onSaveEnv}>
        Save variables
      </Button>
      <Button
        testID="turnip-selftest-button"
        mode="outlined"
        disabled={busy || !hasDriver || !state.enabled}
        onPress={() => onRunSelfTest(1)}>
        Run GPU self-test on next launch
      </Button>
      <Button
        testID="turnip-selftest-extended-button"
        disabled={busy || !hasDriver || !state.enabled}
        onPress={() => onRunSelfTest(2)}>
        Extended self-test (large sizes, may crash the app)
      </Button>
      {lastPipeline !== '' && (
        <Text
          selectable
          variant="labelSmall"
          style={[styles.textDescription, localStyles.report]}>
          {`The last run ended while the GPU driver was compiling:\n${lastPipeline}`}
        </Text>
      )}
      {selfTest !== '' && (
        <>
          <Text
            selectable
            variant="labelSmall"
            style={[styles.textDescription, localStyles.report]}>
            {selfTest}
          </Text>
          <View style={localStyles.buttonRow}>
            <Button
              testID="turnip-selftest-dismiss"
              compact
              onPress={onDismissSelfTest}>
              Dismiss
            </Button>
          </View>
        </>
      )}
      <Modal
        visible={helpVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setHelpVisible(false)}>
        <View
          style={[
            localStyles.helpBackdrop,
            {backgroundColor: theme.colors.backdrop},
          ]}>
          <View
            style={[
              localStyles.helpCard,
              {backgroundColor: theme.colors.surface},
            ]}>
            <Text variant="titleMedium">Driver environment variables</Text>
            <ScrollView>
              {ENV_HELP.map(([name, description]) => (
                <View key={name} style={localStyles.helpItem}>
                  <Text variant="labelLarge" selectable>
                    {name}
                  </Text>
                  <Text variant="bodySmall">{description}</Text>
                </View>
              ))}
            </ScrollView>
            <Button onPress={() => setHelpVisible(false)}>Close</Button>
          </View>
        </View>
      </Modal>
      {changed && (
        <Text
          testID="turnip-restart-notice"
          variant="labelSmall"
          style={styles.textDescription}>
          Restart the app for the change to take effect.
        </Text>
      )}
    </View>
  );
};
