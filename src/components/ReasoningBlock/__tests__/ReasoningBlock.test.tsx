import React from 'react';

import {EnrichedMarkdownText} from 'react-native-enriched-markdown';

import {render} from '../../../../jest/test-utils';

import {ReasoningBlock} from '../ReasoningBlock';

const spy = EnrichedMarkdownText as unknown as jest.Mock;

describe('ReasoningBlock', () => {
  beforeEach(() => {
    spy.mockClear();
  });

  it('renders reasoning through the shared markdown view, not selectable', async () => {
    const {getByText} = await render(
      <ReasoningBlock text="Plan: **x**" maxWidth={300} />,
    );

    expect(getByText('Plan: **x**')).toBeTruthy();
    expect(spy.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        markdown: 'Plan: **x**',
        flavor: 'github',
        selectable: false,
      }),
    );
    expect(spy.mock.calls[0][0].markdownStyle.paragraph.fontSize).toBe(14);
  });

  it('re-renders for new text or width, not for identical props', async () => {
    const {rerender} = await render(<ReasoningBlock text="a" maxWidth={300} />);
    await rerender(<ReasoningBlock text="a" maxWidth={300} />);
    expect(spy).toHaveBeenCalledTimes(1);

    await rerender(<ReasoningBlock text="ab" maxWidth={300} />);
    expect(spy.mock.calls[spy.mock.calls.length - 1][0].markdown).toBe('ab');

    const calls = spy.mock.calls.length;
    await rerender(<ReasoningBlock text="ab" maxWidth={200} />);
    await rerender(<ReasoningBlock text="ab" maxWidth={200} autoCollapse />);
    expect(spy.mock.calls.length).toBeGreaterThan(calls);
  });

  it.each(['', '  \n'])(
    'renders nothing for empty reasoning %j',
    async text => {
      const {queryByTestId} = await render(
        <ReasoningBlock text={text} maxWidth={300} />,
      );

      expect(queryByTestId('markdown-content')).toBeNull();
      expect(spy).not.toHaveBeenCalled();
    },
  );
});
