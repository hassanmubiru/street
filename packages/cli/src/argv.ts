// packages/cli/src/argv.ts
// Robust argument parser supporting flags, subcommands, and positional args.

export interface ParsedArgs {
  command: string | null;
  positional: string[];
  flags: Record<string, string | boolean>;
}

/**
 * Parse process.argv-like arrays into structured command, positional args, and flags.
 *
 * Supports:
 *   --flag=value
 *   --flag value
 *   --flag         (boolean)
 *   -f value
 *   -f             (boolean)
 *   command sub positional
 */
export function argvParser(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const flags: Record<string, string | boolean> = {};
  const positional: string[] = [];
  let command: string | null = null;

  let i = 0;
  while (i < args.length) {
    const arg = args[i]!;

    // `--` signals end of options — everything after is positional
    if (arg === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const eqIdx = key.indexOf('=');
      if (eqIdx !== -1) {
        flags[key.slice(0, eqIdx)] = key.slice(eqIdx + 1);
      } else {
        const next = args[i + 1];
        // Only consume next token as flag value if we already have a command
        // (prevents consuming the command token as a flag value)
        if (next !== undefined && !next.startsWith('-') && command !== null) {
          flags[key] = next;
          i++;
        } else {
          flags[key] = true;
        }
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const key = arg.slice(1);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('-') && command !== null) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      // First non-flag token is the command
      if (command === null) {
        command = arg;
      } else {
        positional.push(arg);
      }
    }

    i++;
  }

  return { command, positional, flags };
}
