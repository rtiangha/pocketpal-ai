import {
  BottomSheetModal,
  BottomSheetModalProps,
  BottomSheetView,
  type SNAP_POINT_TYPE,
} from '@gorhom/bottom-sheet';
import React, {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  useSafeAreaFrame,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {BottomSheetModalMethods} from '@gorhom/bottom-sheet/lib/typescript/types';
import {Text} from 'react-native-paper';
import {CloseIcon} from '../../assets/icons';
import {useTheme} from '../../hooks';
import {styles} from './styles';
import {BackHandler, TouchableOpacity, View} from 'react-native';
import {CustomBackdrop} from './CustomBackdrop';
import {Actions} from './Actions';
import {SheetBackground} from './SheetBackground';
import {SheetHandle} from './SheetHandle';
import {SheetScrollView} from './SheetScrollView';
import {SheetAwareNativeInput} from '../TextInput/SheetAwareNativeInput';
import {DismissKeyboardOnRotation} from './DismissKeyboardOnRotation';
import {fullHeightSnapPoint, resolveSnapPoints} from './snapPoints';

export interface SheetProps extends Partial<BottomSheetModalProps> {
  children?: React.ReactNode;
  title?: string;
  isVisible?: boolean;
  onClose?: () => void;
  displayFullHeight?: boolean;
  showCloseButton?: boolean;
}

interface SheetComponent extends React.ForwardRefExoticComponent<
  SheetProps & React.RefAttributes<BottomSheetModalMethods>
> {
  ScrollView: typeof SheetScrollView;
  View: typeof BottomSheetView;
  Actions: typeof Actions;
  TextInput: typeof SheetAwareNativeInput;
}

export const Sheet = forwardRef(
  (
    {
      children,
      title,
      isVisible,
      displayFullHeight,
      onClose,
      onChange,
      showCloseButton = true,
      snapPoints: requestedSnapPoints,
      ...props
    }: SheetProps,
    ref: React.Ref<BottomSheetModalMethods>,
  ) => {
    const insets = useSafeAreaInsets();
    const innerRef = useRef<BottomSheetModalMethods>(null);

    const activeRef = useMemo(() => {
      if (ref && 'current' in ref && ref.current) {
        return ref;
      }
      return innerRef;
    }, [ref, innerRef]);

    const theme = useTheme();

    // The modal never sees a back press itself: it renders as a portal
    // overlay, not a system modal, and @gorhom/bottom-sheet registers no
    // BackHandler. Without one here the press falls through to navigation,
    // which pops the screen underneath — or finishes the activity when the
    // sheet sits on a root screen. Track presentation from onChange so this
    // covers sheets presented by ref as well as by isVisible.
    const [isPresented, setIsPresented] = useState(false);

    const handleChange = useCallback(
      (index: number, position: number, type: SNAP_POINT_TYPE) => {
        setIsPresented(index >= 0);
        onChange?.(index, position, type);
      },
      [onChange],
    );

    useEffect(() => {
      if (!isPresented) {
        return;
      }
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        () => {
          // dismiss(), not close(): close() only collapses the inner
          // sheet, dismiss() is what takes the modal down and fires
          // onDismiss.
          activeRef.current?.dismiss();
          return true;
        },
      );
      return () => subscription.remove();
    }, [isPresented, activeRef]);

    useEffect(() => {
      if (isVisible) {
        activeRef?.current?.present();
      } else {
        activeRef?.current?.close();
      }
    }, [isVisible, activeRef]);

    const onDismiss = () => {
      setIsPresented(false);
      activeRef?.current?.close();
      onClose?.();
    };

    const {height: containerHeight} = useSafeAreaFrame();
    const snapPoints = useMemo(() => {
      if (displayFullHeight) {
        return [fullHeightSnapPoint(containerHeight, insets.top)];
      }
      return resolveSnapPoints(
        requestedSnapPoints,
        containerHeight,
        insets.top,
      );
    }, [displayFullHeight, containerHeight, insets.top, requestedSnapPoints]);

    return (
      <BottomSheetModal
        ref={activeRef}
        maxDynamicContentSize={fullHeightSnapPoint(containerHeight, insets.top)}
        topInset={insets.top}
        enableDynamicSizing={!snapPoints}
        stackBehavior="push"
        backdropComponent={CustomBackdrop}
        backgroundComponent={SheetBackground}
        handleComponent={SheetHandle}
        keyboardBlurBehavior="restore"
        activeOffsetY={[-1, 1]}
        failOffsetX={[-5, 5]}
        backgroundStyle={{
          backgroundColor: theme.colors.background,
        }}
        snapPoints={snapPoints}
        onChange={handleChange}
        onDismiss={onDismiss}
        // Disable accessible to allow Appium/e2e tests to access child elements on iOS
        // See: https://github.com/gorhom/react-native-bottom-sheet/issues/1141
        accessible={false}
        {...props}>
        <DismissKeyboardOnRotation />
        <View style={styles.header}>
          {title && <Text variant="titleMedium">{title}</Text>}
          {showCloseButton && (
            <TouchableOpacity
              style={styles.closeBtn}
              onPress={onDismiss}
              hitSlop={10}
              testID="sheet-close-button"
              accessibilityLabel="Close"
              accessibilityRole="button">
              <CloseIcon stroke={theme.colors.primary} />
            </TouchableOpacity>
          )}
        </View>
        {children}
      </BottomSheetModal>
    );
  },
) as SheetComponent;

Sheet.displayName = 'Sheet';
Sheet.ScrollView = SheetScrollView;
Sheet.View = BottomSheetView;
Sheet.Actions = Actions;
Sheet.TextInput = SheetAwareNativeInput;
