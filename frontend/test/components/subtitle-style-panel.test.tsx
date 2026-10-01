import { SubtitleStylePanel } from '@/components/videos/subtitle-style-panel';
import { changeStyle, selectPreset } from '@/lib/subtitle-style';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { subtitleCatalog } from '../support/subtitle-catalog';

function renderPanel(
  overrides: Partial<Parameters<typeof SubtitleStylePanel>[0]> = {},
) {
  const handlers = {
    onChoosePreset: jest.fn(),
    onChangeStyle: jest.fn(),
    onReset: jest.fn(),
  };
  render(
    <SubtitleStylePanel
      catalog={subtitleCatalog}
      selection={selectPreset(subtitleCatalog, 'REEL')}
      error={null}
      {...handlers}
      {...overrides}
    />,
  );
  return handlers;
}

describe('SubtitleStylePanel', () => {
  it('offers undo only when there is something to undo', () => {
    const onUndo = jest.fn();
    renderPanel({ onUndo, canUndo: false });
    expect(screen.getByRole('button', { name: /Undo changes/ })).toBeDisabled();
  });

  it('calls onUndo when undo is pressed', () => {
    const onUndo = jest.fn();
    renderPanel({ onUndo, canUndo: true });
    fireEvent.click(screen.getByRole('button', { name: /Undo changes/ }));
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('shows a loading message until the styles arrive', () => {
    renderPanel({ catalog: null, selection: null });

    expect(screen.getByText('Loading subtitle styles...')).toBeInTheDocument();
  });

  it('shows the error when the styles cannot be loaded', () => {
    renderPanel({ error: 'Subtitle styles could not be loaded.' });

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Subtitle styles could not be loaded.',
    );
  });

  it('lists every preset and marks the selected one', () => {
    renderPanel();

    const presets = within(
      screen.getByRole('radiogroup', { name: 'Subtitle presets' }),
    ).getAllByRole('radio');
    expect(presets).toHaveLength(subtitleCatalog.presets.length);
    expect(screen.getByRole('radio', { name: /Reel/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('radio', { name: /Highlight/ })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('chooses a preset', () => {
    const handlers = renderPanel();

    fireEvent.click(screen.getByRole('radio', { name: /Highlight/ }));

    expect(handlers.onChoosePreset).toHaveBeenCalledWith('HIGHLIGHT');
  });

  it('previews each preset with its own style', () => {
    renderPanel({
      selection: selectPreset(subtitleCatalog, 'HIGHLIGHT'),
    });

    const highlight = screen.getByRole('radio', { name: /Highlight/ });
    expect(highlight).toHaveAttribute('aria-checked', 'true');
    const sample = highlight.querySelector('[dir="rtl"]') as HTMLElement;
    expect(sample).toHaveStyle({
      color: '#facc15',
      backgroundColor: 'rgba(0, 0, 0, 0.85)',
      fontWeight: '700',
    });
  });

  it('reports each control change as a style patch', () => {
    const handlers = renderPanel();

    fireEvent.click(screen.getByRole('radio', { name: /Amiri/ }));
    fireEvent.change(screen.getByLabelText(/^Size/), {
      target: { value: '48' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Regular' }));
    fireEvent.change(screen.getByLabelText('Text color'), {
      target: { value: '#ff0000' },
    });
    fireEvent.change(screen.getByLabelText('Background color'), {
      target: { value: '#0000ff' },
    });
    fireEvent.change(screen.getByLabelText(/^Background opacity/), {
      target: { value: '40' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Top (start)' }));

    expect(handlers.onChangeStyle.mock.calls).toEqual([
      [{ fontFamily: 'Amiri' }],
      [{ fontSizePx: 48 }],
      [{ bold: false }],
      [{ textColor: '#ff0000' }],
      [{ backgroundColor: '#0000ff' }],
      [{ backgroundOpacity: 0.4 }],
      [{ position: 'TOP' }],
    ]);
  });

  it('offers top, middle and bottom positions and marks the active one', () => {
    renderPanel();

    const group = screen.getByRole('radiogroup', { name: 'Position' });
    const options = within(group).getAllByRole('radio');
    expect(options.map((option) => option.textContent)).toEqual([
      'Top (start)',
      'Middle',
      'Bottom (end)',
    ]);
    expect(
      options.filter(
        (option) => option.getAttribute('aria-checked') === 'true',
      ),
    ).toHaveLength(1);
  });

  it('limits the size slider to the catalog range', () => {
    renderPanel();

    const size = screen.getByLabelText(/^Size/);
    expect(size).toHaveAttribute('min', '20');
    expect(size).toHaveAttribute('max', '72');
  });

  it('hides the reset while the style matches its preset', () => {
    renderPanel();

    expect(
      screen.queryByRole('button', { name: 'Reset to preset' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText('Customized from the selected preset.'),
    ).not.toBeInTheDocument();
  });

  it('resets a customized style to its preset', () => {
    const handlers = renderPanel({
      selection: changeStyle(selectPreset(subtitleCatalog, 'REEL'), {
        fontSizePx: 60,
      }),
    });

    expect(
      screen.getByText('Customized from the selected preset.'),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Reset to preset' }));

    expect(handlers.onReset).toHaveBeenCalledTimes(1);
  });

  it('lets the user choose phrases or word by word', () => {
    const handlers = renderPanel();
    const group = screen.getByRole('radiogroup', { name: 'Show subtitles as' });

    expect(within(group).getAllByRole('radio')).toHaveLength(2);
    expect(
      within(group).getByRole('radio', { name: /Phrases/ }),
    ).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(within(group).getByRole('radio', { name: /Word by word/ }));

    expect(handlers.onChangeStyle).toHaveBeenCalledWith({
      displayMode: 'WORD',
    });
  });
});
