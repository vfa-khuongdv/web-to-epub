import express, { NextFunction, Request, RequestHandler, Response, Router } from "express";

// Express 4 ignores the promise an async handler returns: a rejection there is unhandled and
// takes the process down (Express 5 forwards it to the error middleware). The request would
// never be answered — e.g. a story delete whose audio file is still being streamed throws
// EPERM in fs.rm. Wrapping the handler catches both a thrown error and a rejected promise and
// hands them to `next`, so the error middleware answers like it does for a sync handler.
export function asyncRoute(handler: RequestHandler): RequestHandler {
  return function wrapped(req: Request, res: Response, next: NextFunction): void {
    try {
      const result = handler(req, res, next) as unknown;
      if (result && typeof (result as Promise<unknown>).then === "function") {
        Promise.resolve(result).catch(next);
      }
    } catch (err) {
      next(err);
    }
  };
}

// A Router whose route handlers are wrapped with asyncRoute. `use` is left alone: an error
// middleware is recognised by its four parameters, and wrapping one would hide that.
export function createRouter(): Router {
  const router = express.Router();
  for (const method of ["get", "post", "put", "patch", "delete", "all", "options", "head"] as const) {
    const original = router[method].bind(router) as (...args: unknown[]) => Router;
    (router as unknown as Record<string, (...args: unknown[]) => Router>)[method] = (...args: unknown[]) =>
      original(...args.map((arg) => (typeof arg === "function" ? asyncRoute(arg as RequestHandler) : arg)));
  }
  return router;
}
