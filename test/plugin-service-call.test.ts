import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  buildPluginRuntime,
  callPluginService,
  PluginInputError,
} from "../src/plugins.ts";
import type { PluginDefinition, PluginServiceContext } from "../src/index.ts";

const emptyInput = z.object({}).strict();
const echoInput = z
  .object({
    value: z.string(),
  })
  .strict();
const echoOutput = z
  .object({
    value: z.string(),
    depth: z.number().int(),
    sawRequestMeta: z.boolean(),
  })
  .strict();

function pluginWithServices(
  services: PluginDefinition["services"],
): PluginDefinition {
  return {
    id: "test",
    version: "1.0.0",
    services,
  };
}

describe("plugin service invocation", () => {
  test("a service can call another registered service and receive parsed output", async () => {
    const runtime = buildPluginRuntime([
      pluginWithServices({
        "inner.echo": {
          input: echoInput,
          output: echoOutput,
          handler(input, context) {
            return {
              value: input.value.toUpperCase(),
              depth: 0,
              sawRequestMeta: context.requestMeta !== undefined,
            };
          },
        },
        "outer.run": {
          input: emptyInput,
          output: echoOutput,
          async handler(_input, context) {
            return context.call("inner.echo", { value: "hello" });
          },
        },
      }),
    ]);

    const result = await callPluginService(runtime, "outer.run", {});
    expect(result).toEqual({
      value: "HELLO",
      depth: 0,
      sawRequestMeta: false,
    });
  });

  test("calling an unknown service throws", async () => {
    const runtime = buildPluginRuntime([
      pluginWithServices({
        "outer.run": {
          input: emptyInput,
          output: z.object({ ok: z.boolean() }).strict(),
          async handler(_input, context) {
            await context.call("missing.service", {});
            return { ok: true };
          },
        },
      }),
    ]);

    await expect(callPluginService(runtime, "outer.run", {})).rejects.toThrow(
      /Unknown plugin service: missing\.service/,
    );
  });

  test("nested calls beyond the depth limit are rejected", async () => {
    const runtime = buildPluginRuntime([
      pluginWithServices({
        "chain.step": {
          input: z
            .object({
              remaining: z.number().int().nonnegative(),
            })
            .strict(),
          output: z.object({ remaining: z.number().int() }).strict(),
          async handler(input, context) {
            if (input.remaining === 0) {
              return { remaining: 0 };
            }
            return context.call("chain.step", {
              remaining: input.remaining - 1,
            });
          },
        },
      }),
    ]);

    // depth: root call is 0; each context.call increments.
    // Max depth 3 allows root + 3 nested = remaining 3 works; remaining 4 fails.
    await expect(
      callPluginService(runtime, "chain.step", { remaining: 3 }),
    ).resolves.toEqual({ remaining: 0 });

    await expect(
      callPluginService(runtime, "chain.step", { remaining: 4 }),
    ).rejects.toThrow(/Plugin service call depth exceeded/);
  });

  test("nested calls do not receive requestMeta from the parent Action path", async () => {
    let nestedSawMeta: boolean | undefined;
    const runtime = buildPluginRuntime([
      pluginWithServices({
        "inner.probe": {
          input: emptyInput,
          output: z.object({ sawRequestMeta: z.boolean() }).strict(),
          handler(_input, context) {
            nestedSawMeta = context.requestMeta !== undefined;
            return { sawRequestMeta: nestedSawMeta };
          },
        },
        "outer.run": {
          input: emptyInput,
          output: z
            .object({
              parentSawRequestMeta: z.boolean(),
              nestedSawRequestMeta: z.boolean(),
            })
            .strict(),
          async handler(_input, context: PluginServiceContext) {
            const nested = (await context.call("inner.probe", {})) as {
              sawRequestMeta: boolean;
            };
            return {
              parentSawRequestMeta: context.requestMeta !== undefined,
              nestedSawRequestMeta: nested.sawRequestMeta,
            };
          },
        },
      }),
    ]);

    const result = await callPluginService(
      runtime,
      "outer.run",
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      { clientAddress: "1.2.3.4", userAgent: "test" },
    );

    expect(result).toEqual({
      parentSawRequestMeta: true,
      nestedSawRequestMeta: false,
    });
    expect(nestedSawMeta).toBe(false);
  });

  test("nested calls share the parent AbortSignal", async () => {
    const controller = new AbortController();
    let nestedSignal: AbortSignal | undefined;
    const runtime = buildPluginRuntime([
      pluginWithServices({
        "inner.probe": {
          input: emptyInput,
          output: z.object({ aborted: z.boolean() }).strict(),
          handler(_input, context) {
            nestedSignal = context.signal;
            return { aborted: context.signal.aborted };
          },
        },
        "outer.run": {
          input: emptyInput,
          output: z.object({ same: z.boolean() }).strict(),
          async handler(_input, context) {
            await context.call("inner.probe", {});
            return { same: nestedSignal === context.signal };
          },
        },
      }),
    ]);

    const result = await callPluginService(
      runtime,
      "outer.run",
      {},
      undefined,
      undefined,
      controller.signal,
    );

    expect(result).toEqual({ same: true });
    controller.abort();
    expect(nestedSignal?.aborted).toBe(true);
  });

  test("invalid nested input surfaces as PluginInputError", async () => {
    const runtime = buildPluginRuntime([
      pluginWithServices({
        "inner.echo": {
          input: echoInput,
          output: echoOutput,
          handler(input) {
            return {
              value: input.value,
              depth: 0,
              sawRequestMeta: false,
            };
          },
        },
        "outer.run": {
          input: emptyInput,
          output: z.object({ ok: z.boolean() }).strict(),
          async handler(_input, context) {
            await context.call("inner.echo", { value: 1 });
            return { ok: true };
          },
        },
      }),
    ]);

    await expect(callPluginService(runtime, "outer.run", {})).rejects.toBeInstanceOf(
      PluginInputError,
    );
  });
});
