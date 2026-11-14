import React from 'react';
import type {TextInputInstance} from 'react-native';
import {fireEvent} from '@testing-library/react-native';
import {FormProvider, useForm} from 'react-hook-form';

import {render} from '../../../../jest/test-utils';
import {FormField} from '../FormField';

// Simple test form data type for testing the generic FormField component
interface TestFormData {
  name: string;
  systemPrompt: string;
  description?: string;
}

const TestWrapper = ({
  children,
  defaultValues = {},
}: {
  children: React.ReactNode;
  defaultValues?: Partial<TestFormData>;
}) => {
  const methods = useForm<TestFormData>({
    defaultValues: {
      name: '',
      systemPrompt: '',
      ...defaultValues,
    },
  });
  return <FormProvider {...methods}>{children}</FormProvider>;
};

describe('FormField', () => {
  it('renders with required props', async () => {
    const {getByText, getByPlaceholderText} = await render(
      <TestWrapper>
        <FormField name="name" label="Name" placeholder="Enter name" />
      </TestWrapper>,
    );

    expect(getByText('Name')).toBeDefined();
    expect(getByPlaceholderText('Enter name')).toBeDefined();
  });

  it('shows required asterisk when required prop is true', async () => {
    const {getByText} = await render(
      <TestWrapper>
        <FormField name="name" label="Name" required />
      </TestWrapper>,
    );

    expect(getByText('Name*')).toBeDefined();
  });

  it('shows sublabel when provided', async () => {
    const {getByText} = await render(
      <TestWrapper>
        <FormField
          name="name"
          label="Name"
          sublabel="This is a helpful description"
        />
      </TestWrapper>,
    );

    expect(getByText('This is a helpful description')).toBeDefined();
  });

  it('updates form value on text change', async () => {
    const {getByPlaceholderText} = await render(
      <TestWrapper>
        <FormField name="name" label="Name" placeholder="Enter name" />
      </TestWrapper>,
    );

    const input = getByPlaceholderText('Enter name');
    await fireEvent.changeText(input, 'Test Name');

    expect(input.props.value).toBe('Test Name');
  });

  it('shows error message when form has errors', async () => {
    const TestComponent = () => {
      const methods = useForm<TestFormData>({
        defaultValues: {
          name: '',
          systemPrompt: '',
        },
      });

      React.useEffect(() => {
        methods.setError('name', {
          type: 'manual',
          message: 'Name is required',
        });
      }, [methods]);

      return (
        <FormProvider {...methods}>
          <FormField name="name" label="Name" />
        </FormProvider>
      );
    };

    const {getByText} = await render(<TestComponent />);
    expect(getByText('Name is required')).toBeDefined();
  });

  it('renders multiline input when multiline prop is true', async () => {
    const {getByPlaceholderText} = await render(
      <TestWrapper>
        <FormField
          name="systemPrompt"
          label="System Prompt"
          placeholder="Enter prompt"
          multiline
        />
      </TestWrapper>,
    );

    const input = getByPlaceholderText('Enter prompt');
    expect(input.props.multiline).toBe(true);
    expect(input.props.numberOfLines).toBe(5);
  });

  it('calls onSubmitEditing when not multiline', async () => {
    const onSubmitEditing = jest.fn();
    const {getByPlaceholderText} = await render(
      <TestWrapper>
        <FormField
          name="name"
          label="Name"
          placeholder="Enter name"
          onSubmitEditing={onSubmitEditing}
        />
      </TestWrapper>,
    );

    const input = getByPlaceholderText('Enter name');
    await fireEvent(input, 'onSubmitEditing');
    expect(onSubmitEditing).toHaveBeenCalled();
  });

  it('does not pass onSubmitEditing when multiline', async () => {
    const onSubmitEditing = jest.fn();
    const {getByPlaceholderText} = await render(
      <TestWrapper>
        <FormField
          name="systemPrompt"
          label="System Prompt"
          placeholder="Enter prompt"
          multiline
          onSubmitEditing={onSubmitEditing}
        />
      </TestWrapper>,
    );

    const input = getByPlaceholderText('Enter prompt');
    expect(input.props.onSubmitEditing).toBeUndefined();
  });

  it('disables input when disabled prop is true', async () => {
    const {getByPlaceholderText} = await render(
      <TestWrapper>
        <FormField name="name" label="Name" placeholder="Enter name" disabled />
      </TestWrapper>,
    );

    const input = getByPlaceholderText('Enter name');
    expect(input.props.editable).toBe(false);
  });

  it('handles empty or undefined values', async () => {
    const {getByPlaceholderText} = await render(
      <TestWrapper defaultValues={{name: undefined}}>
        <FormField name="name" label="Name" placeholder="Enter name" />
      </TestWrapper>,
    );

    const input = getByPlaceholderText('Enter name');
    expect(input.props.value).toBe('');
  });

  it('forwards ref to TextInput', async () => {
    const ref = React.createRef<TextInputInstance>();
    await render(
      <TestWrapper>
        <FormField
          ref={ref}
          name="name"
          label="Name"
          placeholder="Enter name"
        />
      </TestWrapper>,
    );

    expect(ref.current).toBeTruthy();
  });
});
