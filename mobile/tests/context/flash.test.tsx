import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { FLASH_DURATION_MS, FlashProvider, useFlash } from '../../src/context/FlashContext';

function Harness() {
  const { flash, show, dismiss } = useFlash();
  return (
    <>
      <Text testID="message">{flash ? `${flash.tone}:${flash.message}` : ''}</Text>
      <Pressable testID="success" onPress={() => show('Saved.')}>
        <Text>success</Text>
      </Pressable>
      <Pressable testID="info" onPress={() => show('FYI.', 'info')}>
        <Text>info</Text>
      </Pressable>
      <Pressable testID="error" onPress={() => show('Failed.', 'error')}>
        <Text>error</Text>
      </Pressable>
      <Pressable testID="dismiss" onPress={dismiss}>
        <Text>dismiss</Text>
      </Pressable>
    </>
  );
}

const message = () => screen.getByTestId('message').props.children as string;

async function setup() {
  jest.useFakeTimers();
  await render(
    <FlashProvider>
      <Harness />
    </FlashProvider>,
  );
}

const advance = (ms: number) =>
  act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });

afterEach(() => jest.useRealTimers());

describe('FlashProvider', () => {
  it('shows one message at a time; success clears itself after the set time', async () => {
    await setup();
    await fireEvent.press(screen.getByTestId('success'));
    expect(message()).toBe('success:Saved.');

    await advance(FLASH_DURATION_MS - 1);
    expect(message()).toBe('success:Saved.');
    await advance(2);
    expect(message()).toBe('');
  });

  it('info messages also clear themselves', async () => {
    await setup();
    await fireEvent.press(screen.getByTestId('info'));
    expect(message()).toBe('info:FYI.');
    await advance(FLASH_DURATION_MS + 1);
    expect(message()).toBe('');
  });

  it('error messages stay until dismissed', async () => {
    await setup();
    await fireEvent.press(screen.getByTestId('error'));
    await advance(FLASH_DURATION_MS * 5);
    expect(message()).toBe('error:Failed.');

    await fireEvent.press(screen.getByTestId('dismiss'));
    expect(message()).toBe('');
  });

  it('a newer message replaces the old one and gets its own full countdown', async () => {
    await setup();
    await fireEvent.press(screen.getByTestId('success'));
    await advance(FLASH_DURATION_MS - 500);
    await fireEvent.press(screen.getByTestId('info'));
    expect(message()).toBe('info:FYI.');

    await advance(1000); // past the first message's original deadline
    expect(message()).toBe('info:FYI.');
    await advance(FLASH_DURATION_MS);
    expect(message()).toBe('');
  });

  it('fails loudly when used outside the provider', async () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await expect(render(<Harness />)).rejects.toThrow(/inside <FlashProvider>/);
    } finally {
      spy.mockRestore();
    }
  });
});
