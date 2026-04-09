import { expandPastedTextRefs } from '../../history.js';
import type { PastedContent } from '@claude-code/config';

export function parseImmediateCommandInput(input: string, pastedContents: Record<number, PastedContent>) {
  const trimmedInput = expandPastedTextRefs(input, pastedContents).trim();
  const spaceIndex = trimmedInput.indexOf(' ');

  return {
    trimmedInput,
    commandName: spaceIndex === -1 ? trimmedInput.slice(1) : trimmedInput.slice(1, spaceIndex),
    commandArgs: spaceIndex === -1 ? '' : trimmedInput.slice(spaceIndex + 1).trim(),
  };
}
