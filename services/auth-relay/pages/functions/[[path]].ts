import { createRelay, type Env } from '../../src/index';

const relay = createRelay();
export function onRequest(context: { request: Request; env: Env }): Promise<Response> {
  return relay.fetch(context.request, context.env);
}
