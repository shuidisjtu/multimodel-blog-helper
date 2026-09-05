import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import App from './App';

afterEach(cleanup);

describe('App workbench tabs', () => {
  it('switches between audio and weather panels without unmounting their state', async () => {
    const user = userEvent.setup();
    render(<App />);

    const audioTab = screen.getByRole('tab', { name: /音频任务/ });
    const weatherTab = screen.getByRole('tab', { name: /天气查询/ });
    const audioPanel = document.querySelector('#audio-tabpanel');
    const weatherPanel = document.querySelector('#weather-tabpanel');

    expect(audioTab).toHaveAttribute('aria-selected', 'true');
    expect(audioPanel).toBeInTheDocument();
    expect(weatherPanel).toBeInTheDocument();
    expect(audioPanel).not.toHaveAttribute('hidden');
    expect(weatherPanel).toHaveAttribute('hidden');

    await user.click(weatherTab);
    const locationInput = screen.getByLabelText('地点名称');
    await user.clear(locationInput);
    await user.type(locationInput, 'Beijing');

    expect(weatherTab).toHaveAttribute('aria-selected', 'true');
    expect(audioPanel).toHaveAttribute('hidden');
    expect(weatherPanel).not.toHaveAttribute('hidden');

    await user.click(audioTab);
    await user.click(weatherTab);
    expect(locationInput).toHaveValue('Beijing');
  });

  it('supports arrow, Home and End keyboard navigation', async () => {
    const user = userEvent.setup();
    render(<App />);

    const audioTab = screen.getByRole('tab', { name: /音频任务/ });
    const weatherTab = screen.getByRole('tab', { name: /天气查询/ });

    audioTab.focus();
    await user.keyboard('{ArrowRight}');
    expect(weatherTab).toHaveFocus();
    expect(weatherTab).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Home}');
    expect(audioTab).toHaveFocus();
    expect(audioTab).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{End}');
    expect(weatherTab).toHaveFocus();
  });
});
