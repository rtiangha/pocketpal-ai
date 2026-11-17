import React, {useContext, useRef, useState} from 'react';
import {View} from 'react-native';
import {IconButton, Text} from 'react-native-paper';
import {Camera, useCameraDevice} from 'react-native-vision-camera';
import {useBarcodeScannerOutput} from 'react-native-vision-camera-barcode-scanner';

import {useTheme} from '../../hooks';
import {L10nContext} from '../../utils';

import {createStyles} from './styles';

interface ServerQRScannerProps {
  onScanned: (url: string) => void;
  onClose: () => void;
}

const isServerUrl = (value: string) => {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      !!parsed.hostname
    );
  } catch {
    return false;
  }
};

export const ServerQRScanner: React.FC<ServerQRScannerProps> = ({
  onScanned,
  onClose,
}) => {
  const theme = useTheme();
  const l10n = useContext(L10nContext);
  const styles = createStyles(theme);
  const device = useCameraDevice('back');
  const acceptedRef = useRef(false);
  const [rejectedPayload, setRejectedPayload] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  const [frameError, setFrameError] = useState(false);
  const showCamera = !!device && !cameraFailed;

  const barcodeOutput = useBarcodeScannerOutput({
    barcodeFormats: ['qr-code'],
    onBarcodeScanned: barcodes => {
      setFrameError(false);
      if (acceptedRef.current) {
        return;
      }
      const url = barcodes
        .map(barcode => barcode.rawValue?.trim() ?? '')
        .find(isServerUrl);
      if (url) {
        acceptedRef.current = true;
        onScanned(url);
      } else {
        setRejectedPayload(true);
      }
    },
    // A scanner error is transient (e.g. the scanner is not ready yet):
    // keep the preview and show the "not ready" hint until the next scan.
    onError: () => {
      setFrameError(true);
    },
  });

  // In v5 the Camera's onError only fires for session/device errors,
  // which are fatal to the preview (there is no typed error code to
  // distinguish anymore — it receives a plain Error).
  const handleCameraError = (_error: Error) => {
    setCameraFailed(true);
  };

  return (
    <View style={styles.container}>
      {showCamera ? (
        <View testID="server-qr-camera" style={styles.preview}>
          <Camera
            style={styles.camera}
            device={device}
            isActive
            outputs={[barcodeOutput]}
            onError={handleCameraError}
          />
        </View>
      ) : (
        <Text style={styles.message}>
          {cameraFailed
            ? l10n.settings.scanQrUnavailable
            : l10n.camera.noDevice}
        </Text>
      )}
      {showCamera && frameError && (
        <Text style={styles.notReadyHint}>{l10n.settings.scanQrNotReady}</Text>
      )}
      {showCamera && !frameError && rejectedPayload && (
        <Text style={styles.hint}>{l10n.settings.scanQrNotServer}</Text>
      )}
      <IconButton
        testID="server-qr-close"
        icon="close"
        accessibilityLabel={l10n.common.close}
        style={styles.closeButton}
        onPress={onClose}
      />
    </View>
  );
};
