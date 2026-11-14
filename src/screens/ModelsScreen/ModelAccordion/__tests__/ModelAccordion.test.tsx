import React from 'react';
import {StyleSheet} from 'react-native';

import {List} from 'react-native-paper';
import {render, fireEvent} from '@testing-library/react-native';

import {themeFixtures} from '../../../../../jest/fixtures/theme';

import {ModelAccordion} from '../ModelAccordion';

import {modelStore} from '../../../../store';

describe('ModelAccordion', () => {
  beforeEach(() => {
    modelStore.activeModelId = undefined;
  });

  it('renders the accordion with correct title and children', async () => {
    const group = {type: 'Test Group'};
    const {getByText} = await render(
      <ModelAccordion group={group} expanded={true} onPress={jest.fn()}>
        <List.Item title="First item" />
        <List.Item title="Second item" />
      </ModelAccordion>,
    );

    expect(getByText('Test Group')).toBeTruthy();
    expect(getByText('First item')).toBeTruthy();
    expect(getByText('Second item')).toBeTruthy();
  });

  it('renders the accordion with correct title and children when expanded is false', async () => {
    const group = {type: 'Test Group'};
    const {getByText, queryByText} = await render(
      <ModelAccordion group={group} expanded={false} onPress={jest.fn()}>
        <List.Item title="First item" />
        <List.Item title="Second item" />
      </ModelAccordion>,
    );

    expect(getByText('Test Group')).toBeTruthy();
    expect(queryByText('First item')).toBeNull();
    expect(queryByText('Second item')).toBeNull();
  });

  it('calls onPress when the accordion is pressed', async () => {
    const mockOnPress = jest.fn();
    const group = {type: 'Test Group'};

    const {getByText} = await render(
      <ModelAccordion group={group} expanded={false} onPress={mockOnPress}>
        <List.Item title="Child Item" />
      </ModelAccordion>,
    );

    await fireEvent.press(getByText('Test Group'));
    expect(mockOnPress).toHaveBeenCalled();
  });

  it('displays the expanded state correctly', async () => {
    const group = {type: 'Test Group'};

    const {getByText, queryByText, rerender} = await render(
      <ModelAccordion group={group} expanded={false} onPress={jest.fn()}>
        <List.Item title="Child Item" />
      </ModelAccordion>,
    );

    expect(queryByText('Child Item')).toBeNull();

    await rerender(
      <ModelAccordion group={group} expanded={true} onPress={jest.fn()}>
        <List.Item title="Child Item" />
      </ModelAccordion>,
    );

    expect(getByText('Child Item')).toBeTruthy();
  });

  it('applies active group styles when activeModel matches group type', async () => {
    const activeModel = modelStore.models[0];
    modelStore.activeModelId = activeModel.id;

    const {getByTestId} = await render(
      <ModelAccordion
        group={{type: activeModel.type}}
        expanded={false}
        onPress={jest.fn()}>
        <List.Item title="Child Item" />
      </ModelAccordion>,
    );

    // v14: the testID node itself carries the active style (flattened);
    // .parent is a plain surface container, and props.style is a single
    // flattened object, not nested arrays.
    const accordion = getByTestId(`model-accordion-${activeModel.type}`);
    const flat = StyleSheet.flatten(accordion.props.style);
    expect(flat.backgroundColor).toBe(
      themeFixtures.lightTheme.colors.tertiaryContainer,
    );
    expect(flat.borderColor).toBe(themeFixtures.lightTheme.colors.primary);
  });
});
