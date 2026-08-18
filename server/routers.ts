import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { z } from "zod";
import { createRun, executeRun, readRun } from "./agent/workflow.ts";
import { checkLocalOllamaHealth } from "./agent/ollama.ts";

export const appRouter = router({
    // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),
  agent: router({
    localHealth: publicProcedure.query(({ ctx }) => checkLocalOllamaHealth(ctx.req.headers.host)),
    create: publicProcedure.input(z.object({ task: z.string().trim().min(8).max(2_000) })).mutation(({ input, ctx }) =>
      createRun(input.task, ctx.user?.id),
    ),
    execute: publicProcedure.input(z.object({ runId: z.string().min(8).max(40), confirmationApproved: z.boolean().optional() })).mutation(({ input }) =>
      executeRun(input.runId, input.confirmationApproved === true),
    ),
    get: publicProcedure.input(z.object({ runId: z.string().min(8).max(40) })).query(async ({ input }) => {
      const run = await readRun(input.runId);
      if (!run) throw new Error("Research run not found.");
      return run;
    }),
  }),
});

export type AppRouter = typeof appRouter;
