import React from 'react';
import {render} from '../../../../jest/test-utils';
import {SectionDivider} from '../SectionDivider';

describe('SectionDivider', () => {
  it('renders with label', async () => {
    const {getByText} = await render(<SectionDivider label="Test Section" />);
    expect(getByText('Test Section')).toBeDefined();
  });

  it('renders divider line', async () => {
    const {getByTestId} = await render(<SectionDivider label="Test Section" />);
    expect(getByTestId('section-divider-line')).toBeDefined();
  });

  it('applies correct styles', async () => {
    const {getByTestId} = await render(<SectionDivider label="Test Section" />);
    const container = getByTestId('section-divider-container');
    const content = getByTestId('section-divider-content');

    expect(container.props.style).toMatchObject({
      marginVertical: expect.any(Number),
    });

    expect(content.props.style).toMatchObject({
      flexDirection: 'row',
      alignItems: 'center',
      gap: expect.any(Number),
    });
  });
});
