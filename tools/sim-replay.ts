import { replayHash } from "../packages/core/src/replay";

function parseArg(name: string, fallback: number): number {
  const args = process.argv.slice(2);
  const flag = `--${name}`;
  const prefix = `--${name}=`;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i] as string;
    if (arg === flag && i + 1 < args.length) {
      const value = Number(args[i + 1]);
      if (Number.isInteger(value)) {
        return value;
      }
    } else if (arg.startsWith(prefix)) {
      const value = Number(arg.slice(prefix.length));
      if (Number.isInteger(value)) {
        return value;
      }
    }
  }
  return fallback;
}

const seed = parseArg("seed", 42);
const ticks = parseArg("ticks", 3600);
const hash = replayHash(seed, ticks);
console.log(`seed=${seed} ticks=${ticks} hash=${hash}`);
