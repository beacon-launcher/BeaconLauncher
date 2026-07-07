import { Agent, setGlobalDispatcher } from 'undici'

// Just a bigger connect timeout + capped connections. NO interceptors: undici's retry interceptor
// resumes interrupted downloads with a byte-range request, and Mojang's CDN answers with the full
// body → "content-range mismatch". We instead let @xmcl's own retry (maxRetryCount, passed at the
// install call) re-download failed files cleanly from scratch.
export const dispatcher = new Agent({
  connections: 5,
  connect: { timeout: 60_000 },
  headersTimeout: 300_000,
  bodyTimeout: 300_000
})

setGlobalDispatcher(dispatcher)
