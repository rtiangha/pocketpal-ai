import React from 'react';

import {render, fireEvent} from '@testing-library/react-native';

import {ChatTemplatePicker} from '../ChatTemplatePicker';

jest.useFakeTimers();

jest.mock('../../../../utils/chat', () => ({
  chatTemplates: {
    template1: {name: 'Template 1'},
    template2: {name: 'Template 2'},
  },
}));

describe('ChatTemplatePicker', () => {
  it('renders correctly with initial value', async () => {
    const {getByText, getByTestId} = await render(
      <ChatTemplatePicker
        selectedTemplateName="template1"
        handleChatTemplateNameChange={jest.fn()}
      />,
    );

    expect(getByText('Base Chat Template:')).toBeTruthy();
    expect(getByTestId('text_input').props.value).toBe('Template 1');
  });

  it('displays the correct templates in the picker', async () => {
    const {getByText, getByTestId} = await render(
      <ChatTemplatePicker
        selectedTemplateName="template2"
        handleChatTemplateNameChange={jest.fn()}
      />,
    );

    expect(getByText('Base Chat Template:')).toBeTruthy();
    expect(getByTestId('text_input').props.value).toBe('Template 2');
  });

  it('calls handleChatTemplateNameChange when a template is selected', async () => {
    const mockHandleChatTemplateNameChange = jest.fn();
    const {getByTestId} = await render(
      <ChatTemplatePicker
        selectedTemplateName="template1"
        handleChatTemplateNameChange={mockHandleChatTemplateNameChange}
      />,
    );

    const textInput = getByTestId('text_input');
    await fireEvent(textInput, 'onValueChange', 'template2');
    expect(mockHandleChatTemplateNameChange).toHaveBeenCalledWith('template2');
  });
});
