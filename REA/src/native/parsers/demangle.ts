import { z } from "zod";

const resultSchema = z.object({
  input: z.string(),
  output: z.string(),
  status: z.enum(["demangled", "unchanged", "invalid"]),
});

export type DemangledSymbol = z.infer<typeof resultSchema>;

/**
 * Prefixes the Swift demangler accepts as mangled names (Swift 4, 4.x, 5+,
 * macro file names and Embedded Swift). Legacy `_T` is omitted because it is
 * also an ordinary C symbol spelling such as `_Tprintf`.
 */
const SWIFT_MANGLING_PREFIXES = [
  "_T0",
  "$S",
  "_$S",
  "$s",
  "_$s",
  "@__swiftmacro_",
  "$e",
  "_$e",
] as const;

/**
 * Preserve input ordering while parsing `swift-demangle --compact` lines.
 * The demangler ends each record with LF, so a carriage return belongs to the
 * symbol text.
 */
export const parseDemangledSymbols = (
  inputs: readonly string[],
  output: string,
): DemangledSymbol[] => {
  if (inputs.length === 0) {
    if (output === "" || output === "\n") return [];
    throw new TypeError("swift-demangle emitted output for an empty input");
  }
  const lines = output.replace(/\n$/u, "").split("\n");
  if (lines.length !== inputs.length)
    throw new TypeError("swift-demangle output count does not match input");
  return inputs.map((input, index) => {
    const value = lines[index];
    if (value === undefined)
      throw new TypeError("swift-demangle omitted an output line");
    return resultSchema.parse({
      input,
      output: value,
      status:
        value === input
          ? SWIFT_MANGLING_PREFIXES.some((prefix) => input.startsWith(prefix))
            ? "invalid"
            : "unchanged"
          : "demangled",
    });
  });
};
