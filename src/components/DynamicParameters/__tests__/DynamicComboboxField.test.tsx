import React from 'react';
import {FormProvider, useForm} from 'react-hook-form';
import {render, fireEvent} from '../../../../jest/test-utils';
import {DynamicComboboxField} from '../DynamicComboboxField';
import type {ParameterDefinition} from '../../../types/pal';

// Wrapper component to provide form context
const TestWrapper: React.FC<{
  children: React.ReactNode;
  defaultValues?: Record<string, any>;
}> = ({children, defaultValues = {}}) => {
  const methods = useForm({defaultValues});
  return <FormProvider {...methods}>{children}</FormProvider>;
};

describe('DynamicComboboxField', () => {
  const mockParameter: ParameterDefinition = {
    key: 'testCombobox',
    type: 'combobox',
    label: 'Test Combobox',
    required: false,
    options: ['English', 'French', 'German', 'Spanish'],
    placeholder: 'Type or select a language',
    description: 'Choose or type a language',
  };

  it('should render with label and description', async () => {
    const {getByText} = await render(
      <TestWrapper>
        <DynamicComboboxField parameter={mockParameter} />
      </TestWrapper>,
    );

    expect(getByText('Test Combobox')).toBeTruthy();
    expect(getByText('Choose or type a language')).toBeTruthy();
  });

  it('should show required indicator when required', async () => {
    const requiredParameter = {...mockParameter, required: true};

    const {getByText} = await render(
      <TestWrapper>
        <DynamicComboboxField parameter={requiredParameter} />
      </TestWrapper>,
    );

    expect(getByText('Test Combobox*')).toBeTruthy();
  });

  it('should render input with placeholder', async () => {
    const {getByPlaceholderText} = await render(
      <TestWrapper>
        <DynamicComboboxField parameter={mockParameter} />
      </TestWrapper>,
    );

    expect(getByPlaceholderText('Type or select a language')).toBeTruthy();
  });

  it('should handle text input changes (free text)', async () => {
    const {getByTestId} = await render(
      <TestWrapper>
        <DynamicComboboxField parameter={mockParameter} />
      </TestWrapper>,
    );

    const input = getByTestId('dynamic-combobox-input-testCombobox');
    await fireEvent.changeText(input, 'Custom Language');

    expect(input.props.value).toBe('Custom Language');
  });

  it('should filter options by typed text (case-insensitive)', async () => {
    const {getByTestId, queryByTestId} = await render(
      <TestWrapper>
        <DynamicComboboxField parameter={mockParameter} />
      </TestWrapper>,
    );

    const input = getByTestId('dynamic-combobox-input-testCombobox');
    await fireEvent.changeText(input, 'en');

    // "English" and "French" contain "en"
    expect(
      queryByTestId('dynamic-combobox-option-testCombobox-English'),
    ).toBeTruthy();
    expect(
      queryByTestId('dynamic-combobox-option-testCombobox-French'),
    ).toBeTruthy();
    // "German" contains "en" too (GermaN? No — "German" has "an" not "en")
    // Actually "German" does NOT contain "en". Let's check: G-e-r-m-a-n. No "en".
    expect(
      queryByTestId('dynamic-combobox-option-testCombobox-German'),
    ).toBeNull();
    // "Spanish" does not contain "en"
    expect(
      queryByTestId('dynamic-combobox-option-testCombobox-Spanish'),
    ).toBeNull();
  });

  it('should select a menu option and update the input value', async () => {
    const {getByTestId} = await render(
      <TestWrapper>
        <DynamicComboboxField parameter={mockParameter} />
      </TestWrapper>,
    );

    const input = getByTestId('dynamic-combobox-input-testCombobox');

    // Focus to show menu
    await fireEvent(input, 'focus');

    // Select an option
    const option = getByTestId('dynamic-combobox-option-testCombobox-French');
    await fireEvent.press(option);

    expect(input.props.value).toBe('French');
  });

  it('should show all options when input is empty and focused', async () => {
    const {getByTestId} = await render(
      <TestWrapper>
        <DynamicComboboxField parameter={mockParameter} />
      </TestWrapper>,
    );

    const input = getByTestId('dynamic-combobox-input-testCombobox');
    await fireEvent(input, 'focus');

    expect(
      getByTestId('dynamic-combobox-option-testCombobox-English'),
    ).toBeTruthy();
    expect(
      getByTestId('dynamic-combobox-option-testCombobox-French'),
    ).toBeTruthy();
    expect(
      getByTestId('dynamic-combobox-option-testCombobox-German'),
    ).toBeTruthy();
    expect(
      getByTestId('dynamic-combobox-option-testCombobox-Spanish'),
    ).toBeTruthy();
  });

  it('should display error message when provided', async () => {
    const {getByText} = await render(
      <TestWrapper>
        <DynamicComboboxField
          parameter={mockParameter}
          error="This field is required"
        />
      </TestWrapper>,
    );

    expect(getByText('This field is required')).toBeTruthy();
  });

  it('should be disabled when disabled prop is true', async () => {
    const {getByTestId} = await render(
      <TestWrapper>
        <DynamicComboboxField parameter={mockParameter} disabled={true} />
      </TestWrapper>,
    );

    const input = getByTestId('dynamic-combobox-input-testCombobox');
    expect(input.props.editable).toBe(false);
  });

  it('should use default value from form context', async () => {
    const {getByTestId} = await render(
      <TestWrapper defaultValues={{testCombobox: 'German'}}>
        <DynamicComboboxField parameter={mockParameter} />
      </TestWrapper>,
    );

    const input = getByTestId('dynamic-combobox-input-testCombobox');
    expect(input.props.value).toBe('German');
  });

  it('should handle empty options array', async () => {
    const parameterWithoutOptions = {...mockParameter, options: []};

    const {getByTestId} = await render(
      <TestWrapper>
        <DynamicComboboxField parameter={parameterWithoutOptions} />
      </TestWrapper>,
    );

    const input = getByTestId('dynamic-combobox-input-testCombobox');
    expect(input).toBeTruthy();
  });

  it('should handle undefined options', async () => {
    const parameterWithoutOptions = {...mockParameter, options: undefined};

    const {getByTestId} = await render(
      <TestWrapper>
        <DynamicComboboxField parameter={parameterWithoutOptions} />
      </TestWrapper>,
    );

    const input = getByTestId('dynamic-combobox-input-testCombobox');
    expect(input).toBeTruthy();
  });
});
