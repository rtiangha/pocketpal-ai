import {render} from '@testing-library/react-native';
import * as React from 'react';

import {user} from '../../../../jest/fixtures';
import {Avatar} from '../Avatar';
import {lightTheme} from '../../../utils/theme';

describe('avatar', () => {
  it(`should render container with a placeholder`, async () => {
    expect.assertions(1);
    const {getByTestId} = await render(
      <Avatar
        author={user}
        currentUserIsAuthor={false}
        showAvatar={false}
        showUserAvatars
        theme={lightTheme}
      />,
    );
    expect(getByTestId('AvatarContainer')).toBeDefined();
  });

  it('should render background with a first letter', async () => {
    expect.assertions(1);
    const authorWithName = {...user, firstName: 'John'};
    const {getByText} = await render(
      <Avatar
        author={authorWithName}
        currentUserIsAuthor={false}
        showAvatar
        showUserAvatars
        theme={lightTheme}
      />,
    );
    expect(getByText(authorWithName.firstName[0])).toBeDefined();
  });

  it('should render image background', async () => {
    expect.assertions(2);
    const imageUrl = 'https://avatars.githubusercontent.com/u/14123304?v=4';
    const {getByTestId} = await render(
      <Avatar
        author={{
          ...user,
          imageUrl,
        }}
        currentUserIsAuthor={false}
        showAvatar
        showUserAvatars
        theme={lightTheme}
      />,
    );
    const image = getByTestId('avatar-image');
    expect(image).toBeDefined();
    expect(image.props.source).toHaveProperty('uri', imageUrl);
  });
});
