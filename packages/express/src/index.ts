import type { NextFunction, Request, Response } from "express";

export interface Split402RequestContext {
  method: string;
  pathTemplate: string;
  pathParams: Record<string, unknown>;
  query: Record<string, unknown>;
  body: unknown;
  referralClaimHint?: string;
}

const requestContexts = new WeakMap<Request, Split402RequestContext>();

export function split402RequestContext(pathTemplate?: string) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const context: Split402RequestContext = {
      method: req.method,
      pathTemplate: pathTemplate ?? req.path,
      pathParams: { ...req.params },
      query: normalizeQuery(req.query),
      body: req.body ?? null
    };
    const claimHint = headerValue(req.headers["split402-claim"]);
    if (claimHint !== undefined) {
      context.referralClaimHint = claimHint;
    }
    requestContexts.set(req, context);
    next();
  };
}

export function getSplit402RequestContext(req: Request): Split402RequestContext {
  const context = requestContexts.get(req);
  if (context === undefined) {
    return {
      method: req.method,
      pathTemplate: req.path,
      pathParams: { ...req.params },
      query: normalizeQuery(req.query),
      body: req.body ?? null
    };
  }
  return context;
}

function normalizeQuery(query: Request["query"]): Record<string, unknown> {
  return Object.fromEntries(Object.entries(query));
}

function headerValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}
