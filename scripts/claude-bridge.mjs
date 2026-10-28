#!/usr/bin/env node
/**
 * Claude without an API key: the local `claude` CLI, behind the Anthropic Messages API.
 *
 * The API's AI endpoints talk to Claude through anthropic-java, which speaks the Messages
 * API. The workspace runs on Claude subscriptions, which Claude Code runs. This is the piece
 * between the two: a server on the Mac that accepts `POST /v1/messages` exactly as
 * api.anthropic.com would, runs the turn with `claude --print`, and answers in the shape
 * the SDK expects — a Message, or the server-sent events of one. The API is pointed here
 * by `CLAUDE_BRIDGE_URL`, and nothing in it can tell the difference; prompts, usage rows and the streaming envelopes all stay where they are.
 *
 * It runs as the `claude-bridge` service in the dev stack, which the api container reaches
 * by name, and it is the path for every AI call the API makes. Every turn runs on the
 * Claude subscription of the person asking: the token they connected in the workspace
 * (`claude setup-token`, `sk-ant-oat…`) arrives in the request's key header and is handed
 * to the CLI for that one run. The bridge has no login of its own and falls back on
 * nothing — a request without a subscription token, or with an API key instead of one, is
 * refused. No port is published: the bridge itself authenticates nobody, and the only
 * thing that should reach it is one network away.
 *
 *   pnpm stack:dev                      # starts it with everything else
 *   node scripts/claude-bridge.mjs      # or by hand, on a machine with `claude` signed in
 *   CLAUDE_BRIDGE_PORT=8788             # the default
 *   CLAUDE_BRIDGE_HOST=127.0.0.1        # the default; the image sets 0.0.0.0
 *
 * Tools are off, so a browser button can never touch this filesystem. The one exception
 * is a request that carries images: they are written to a temp folder and Read is allowed
 * on that folder and nothing else, which is how the model gets to look at them.
 *
 * Dependency-free on purpose. It runs with whatever node the host has, outside the repo's
 * install, and must keep working when node_modules is arm64 and the host is not.
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const HOST = process.env.CLAUDE_BRIDGE_HOST ?? '127.0.0.1';
const PORT = Number(process.env.CLAUDE_BRIDGE_PORT ?? 8788);

/** Four images at ~2 MB each, base64, plus a screen's html. */
const MAX_BODY_BYTES = 25_000_000;
/** A ceiling, not the deadline: the API's own per-endpoint timeout is what normally fires. */
const MAX_RUN_MS = 15 * 60_000;
/** How much the model may think when a request asks for thinking at all. */
const THINKING_TOKENS = '10000';

/* ------------------------------------------------------------------------ */
/* The request, as the CLI can take it                                       */
/* ------------------------------------------------------------------------ */

/** A `system` field: a string, or text blocks to be joined. */
function systemText(system) {
  if (typeof system === 'string') return system;
  if (!Array.isArray(system)) return '';
  return system
    .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

const IMAGE_EXTENSION = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

/**
 * One message's content, split into what goes in the prompt and what goes on disk.
 *
 * The CLI takes text on stdin and nothing else, so an image block becomes a file the
 * model is told to Read. That is exactly how the workspace did it before the API existed.
 */
function splitContent(content) {
  if (typeof content === 'string') return { text: content, images: [] };
  if (!Array.isArray(content)) return { text: '', images: [] };
  const texts = [];
  const images = [];
  for (const block of content) {
    if (!block) continue;
    if (block.type === 'text' && typeof block.text === 'string') {
      texts.push(block.text);
    } else if (block.type === 'image' && block.source?.type === 'base64') {
      images.push({
        data: String(block.source.data ?? ''),
        extension: IMAGE_EXTENSION[block.source.media_type] ?? 'png',
      });
    }
  }
  return { text: texts.join('\n'), images };
}

/**
 * The conversation, as one prompt.
 *
 * `--print` takes a single user turn, so earlier turns ride along as a transcript in front
 * of it. A lone message — every non-chat endpoint, and a chat's first turn — is passed as
 * it is. Images are written out first so the prompt can name their paths.
 */
async function flatten(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  let imageDir;
  const parts = [];
  let imageIndex = 0;

  for (const message of messages) {
    const { text, images } = splitContent(message.content);
    const notes = [];
    for (const image of images) {
      if (!imageDir) imageDir = await mkdtemp(join(tmpdir(), 'we-adp-bridge-'));
      imageIndex += 1;
      const path = join(imageDir, `image-${imageIndex}.${image.extension}`);
      await writeFile(path, Buffer.from(image.data, 'base64'));
      notes.push(`--- attached image: read it with the Read tool at ${path} before answering ---`);
    }
    const turn = [text, ...notes].filter(Boolean).join('\n\n');
    if (messages.length === 1) {
      parts.push(turn);
    } else {
      parts.push(message.role === 'assistant' ? `You replied: ${turn}` : `User: ${turn}`);
    }
  }

  return { prompt: parts.join('\n\n'), imageDir };
}

/* ------------------------------------------------------------------------ */
/* Running the CLI                                                           */
/* ------------------------------------------------------------------------ */

/** A placeholder key an older API sent when nobody supplied one. Treated as none. */
const NO_CREDENTIAL = 'local-claude-cli';

/**
 * The credential the request carries, or null when there is none.
 *
 * Read from where the SDK puts it — `x-api-key`, or a bearer token — and classified the
 * way the API classifies the same values: `sk-ant-oat…` is a Claude subscription token
 * from `claude setup-token`, anything else an API key. The CLI takes them through
 * different variables, and given the wrong one it reports itself signed out.
 */
function requestCredential(req) {
  const header = req.headers['x-api-key'];
  const bearer = String(req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const value = String(Array.isArray(header) ? header[0] : (header ?? bearer)).trim();
  if (!value || value === NO_CREDENTIAL) return null;
  return { value, kind: value.startsWith('sk-ant-oat') ? 'caller-token' : 'caller-key' };
}

/**
 * Why a request's credential cannot run, or null when it can.
 *
 * Only subscription tokens, and always one. The API already refuses both cases; this is
 * the same rule at the last hop, so nothing that reaches the bridge directly can run on a
 * console account or on a login the bridge does not have.
 */
function credentialProblem(credential) {
  if (credential === null) {
    return 'Connect your Claude subscription to use AI features. Run `claude setup-token` and paste the token it prints.';
  }
  if (credential.kind !== 'caller-token') {
    return 'Only a Claude subscription token is accepted. Run `claude setup-token` and paste the token it prints.';
  }
  return null;
}

function spawnClaude(body, prompt, imageDir, stream, credential) {
  const args = [
    '--print',
    '--output-format',
    stream ? 'stream-json' : 'json',
    ...(stream ? ['--verbose', '--include-partial-messages'] : []),
    // No images: no tools at all. `--tools ""` is what actually empties the set — with the
    // tools left in place the model answers "look at this screen" by reaching for Glob and
    // spends its one turn on that. With images: Read, on their folder only, and turns
    // enough to look. The leading "/" makes the pattern absolute.
    ...(imageDir ? ['--allowed-tools', `Read(/${imageDir}/**)`] : ['--tools', '']),
    '--max-turns',
    imageDir ? '4' : '1',
    '--no-session-persistence',
    '--model',
    String(body.model ?? 'sonnet'),
  ];
  const system = systemText(body.system);
  if (system) args.push('--append-system-prompt', system);

  // Thinking and effort are env-only knobs for the headless CLI. Thinking is off unless
  // the request asked, which is also what the API does with a real key.
  const env = { ...process.env };
  // This one run is that person's subscription and nothing else: whatever the environment
  // happens to hold is cleared, so the CLI cannot pick another credential by its own rules.
  delete env.ANTHROPIC_API_KEY;
  env.CLAUDE_CODE_OAUTH_TOKEN = credential.value;
  const thinking = body.thinking && body.thinking.type !== 'disabled';
  env.MAX_THINKING_TOKENS = thinking ? THINKING_TOKENS : '0';
  const effort = body.output_config?.effort;
  if (typeof effort === 'string') env.CLAUDE_CODE_EFFORT_LEVEL = effort;

  const child = spawn('claude', args, {
    // Outside the repo, so the CLI does not auto-load a project's CLAUDE.md into a turn
    // that is supposed to know only what the request told it.
    cwd: imageDir ?? tmpdir(),
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdin.end(prompt, 'utf8');
  return child;
}

/** The CLI's usage block, as the API spells it. */
function usageOf(source) {
  const usage = source && typeof source.usage === 'object' && source.usage ? source.usage : {};
  const count = (value) => (typeof value === 'number' && Number.isFinite(value) ? value : 0);
  return {
    input_tokens: count(usage.input_tokens),
    output_tokens: count(usage.output_tokens),
    cache_creation_input_tokens: count(usage.cache_creation_input_tokens),
    cache_read_input_tokens: count(usage.cache_read_input_tokens),
  };
}

/**
 * The sentence to fail with, or null when the run actually succeeded.
 *
 * `subtype` is not enough on its own. A CLI that could not sign in still calls the turn a
 * "success" and sets `is_error`, with the reason in `result` — so a bridge reading only
 * the subtype hands "Not logged in · Please run /login" back as the model's reply, and it
 * arrives in someone's chat looking like an answer.
 */
function envelopeFailure(envelope) {
  if (!envelope || typeof envelope !== 'object') return 'Claude Code ended without a reply.';
  const detail = typeof envelope.result === 'string' ? envelope.result : '';
  if (envelope.subtype === 'error_max_turns') {
    return 'Claude stopped before answering — it went looking for something instead of replying.';
  }
  if (NOT_SIGNED_IN.test(detail)) return NOT_SIGNED_IN_HELP;
  if (envelope.is_error === true || envelope.subtype !== 'success') {
    return detail || 'Claude Code ended without a reply.';
  }
  return typeof envelope.result === 'string' ? null : 'Claude Code ended without a reply.';
}

/**
 * The failure worth explaining, because the fix is not where the message points.
 *
 * The CLI says "run /login", which is the right advice at a terminal and useless inside a
 * container: there is nobody to open a browser. What the person needs is a fresh token,
 * and where to put it.
 */
const NOT_SIGNED_IN =
  /not logged in|please run \/login|invalid api key|authentication_error|failed to authenticate|oauth (access )?token (has expired|expired|is invalid)/i;

const NOT_SIGNED_IN_HELP =
  'Claude did not accept your subscription token — it may have expired or been revoked. Run ' +
  '`claude setup-token` again and reconnect it in Connect your Claude subscription.';

function messageId() {
  return `msg_bridge_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** An error body in the API's shape, so the SDK raises it as one of its own. */
function errorBody(message) {
  return JSON.stringify({ type: 'error', error: { type: 'api_error', message } });
}

function startFailure(error) {
  const notFound = error && error.code === 'ENOENT';
  return notFound
    ? 'The `claude` CLI was not found on this machine. Install Claude Code and make sure `claude` is on PATH.'
    : 'Could not start the local Claude Code CLI.';
}

/* ------------------------------------------------------------------------ */
/* POST /v1/messages                                                         */
/* ------------------------------------------------------------------------ */

async function handleMessages(req, res, body) {
  const startedAt = Date.now();
  const stream = body.stream === true;
  const credential = requestCredential(req);
  const problem = credentialProblem(credential);
  if (problem) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(errorBody(problem));
    return;
  }
  const { prompt, imageDir } = await flatten(body);
  if (!prompt.trim()) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(errorBody('The request had no text to send.'));
    return;
  }
  const cleanup = () => {
    if (imageDir) void rm(imageDir, { recursive: true, force: true });
  };

  const child = spawnClaude(body, prompt, imageDir, stream, credential);
  let stdout = '';
  let stderrTail = '';
  let finished = false;
  let headersSent = false;

  /* ---- Streaming: the SDK wants one message's events, however many turns the CLI ran ---- */

  let started = false; // message_start + content_block_start have gone out
  let sawText = false;
  let stopReason = null;
  let lastMessageDeltaOutput = 0;
  let result = null; // the CLI's closing envelope

  const sse = (type, data) => {
    if (!headersSent) {
      headersSent = true;
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      });
    }
    res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const open = (message) => {
    if (started) return;
    started = true;
    sse('message_start', { type: 'message_start', message });
    sse('content_block_start', {
      type: 'content_block_start',
      index: 0,
      content_block: { type: 'text', text: '' },
    });
  };

  const stubMessage = (usage) => ({
    id: messageId(),
    type: 'message',
    role: 'assistant',
    model: String(body.model ?? ''),
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage,
  });

  const onStreamLine = (line) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      return;
    }
    if (event.type === 'result') {
      result = event;
      return;
    }
    if (event.type !== 'stream_event' || !event.event) return;
    const inner = event.event;
    switch (inner.type) {
      case 'message_start':
        // The first one carries the real input token count; later turns (only ever with
        // images, when the model Reads them) are folded into this one message.
        if (inner.message && typeof inner.message === 'object') {
          open({ ...inner.message, content: [], stop_reason: null, stop_sequence: null });
        }
        break;
      case 'content_block_delta':
        if (inner.delta?.type === 'text_delta') {
          open(stubMessage(usageOf(null)));
          sawText = true;
          sse('content_block_delta', { type: 'content_block_delta', index: 0, delta: inner.delta });
        }
        break;
      case 'message_delta':
        stopReason = inner.delta?.stop_reason ?? stopReason;
        lastMessageDeltaOutput = inner.usage?.output_tokens ?? lastMessageDeltaOutput;
        break;
      default:
        break;
    }
  };

  const fail = (status, message) => {
    if (finished) return;
    finished = true;
    cleanup();
    if (!headersSent) {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(errorBody(message));
    } else {
      sse('error', { type: 'error', error: { type: 'api_error', message } });
      res.end();
    }
  };

  const finishStream = () => {
    if (finished) return;
    // Only when the run produced nothing: text already streamed is the answer, and a late
    // `is_error` on a turn the reader has been watching arrive is not worth erasing it for.
    const failure = sawText ? null : envelopeFailure(result ?? {});
    if (failure) {
      fail(502, failure);
      return;
    }
    const usage = usageOf(result);
    if (!sawText && typeof result?.result === 'string' && result.result) {
      // Nothing streamed but the run has an answer — a CLI without partial messages, say.
      // The message is synthesised whole.
      open(stubMessage({ ...usage, output_tokens: 0 }));
      sse('content_block_delta', {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: result.result },
      });
    } else {
      open(stubMessage({ ...usage, output_tokens: 0 }));
    }
    finished = true;
    cleanup();
    sse('content_block_stop', { type: 'content_block_stop', index: 0 });
    sse('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason ?? 'end_turn', stop_sequence: null },
      usage: { output_tokens: usage.output_tokens || lastMessageDeltaOutput },
    });
    sse('message_stop', { type: 'message_stop' });
    res.end();
  };

  /* ---- Buffered: one envelope in, one Message out ---- */

  const finishJson = () => {
    if (finished) return;
    let envelope;
    try {
      envelope = JSON.parse(stdout);
    } catch {
      fail(502, 'Could not read the Claude Code response envelope.');
      return;
    }
    const failure = envelopeFailure(envelope);
    if (failure) {
      fail(502, failure);
      return;
    }
    finished = true;
    cleanup();
    const message = {
      id: messageId(),
      type: 'message',
      role: 'assistant',
      model: String(body.model ?? ''),
      content: [{ type: 'text', text: envelope.result }],
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: usageOf(envelope),
    };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(message));
  };

  /* ---- Wiring ---- */

  let buffer = '';
  child.stdout.on('data', (chunk) => {
    if (!stream) {
      stdout += chunk.toString('utf8');
      return;
    }
    buffer += chunk.toString('utf8');
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) onStreamLine(line);
  });
  child.stderr.on('data', (chunk) => {
    stderrTail = (stderrTail + chunk.toString('utf8')).slice(-2_000);
  });

  const timer = setTimeout(() => {
    child.kill('SIGKILL');
    fail(504, `Claude Code timed out after ${MAX_RUN_MS / 60_000} minutes.`);
  }, MAX_RUN_MS);

  child.on('error', (error) => {
    clearTimeout(timer);
    fail(503, startFailure(error));
  });

  child.on('close', (code) => {
    clearTimeout(timer);
    if (finished) return;
    if (stream && buffer.trim()) onStreamLine(buffer);
    // A refused sign-in exits 1 and prints a perfectly good envelope saying why, so the
    // envelope is tried first and the exit code is only the answer when there is none.
    const hasEnvelope = stream ? result !== null : stdout.trim().startsWith('{');
    if (code !== 0 && !started && !hasEnvelope) {
      const detail = stderrTail.trim().split('\n').at(-1) || `exit code ${code}`;
      fail(502, NOT_SIGNED_IN.test(detail) ? NOT_SIGNED_IN_HELP : `Claude Code failed: ${detail}`);
      return;
    }
    if (stream) finishStream();
    else finishJson();
  });

  // The API dropped the request — the user pressed escape, or its timeout fired. The turn
  // is not worth finishing for nobody.
  req.on('close', () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    if (child.exitCode === null) child.kill('SIGKILL');
    cleanup();
    // Logged here because a dropped request never reaches the response's finish event, and a
    // turn that vanishes without a line is exactly the one someone will be asking about.
    console.log(
      `${new Date().toISOString()} aborted ${stream ? 'stream' : 'json'} ${body.model ?? '?'} after ${((Date.now() - startedAt) / 1000).toFixed(1)}s — the caller dropped the request`,
    );
  });
}

/* ------------------------------------------------------------------------ */
/* The server                                                                */
/* ------------------------------------------------------------------------ */

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Asked once at startup — /health reports it, and it is the first thing to check. */
let claudeVersion = null;
function probeClaude() {
  return new Promise((resolve) => {
    const child = spawn('claude', ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk.toString('utf8')));
    child.on('error', () => resolve(null));
    child.on('close', (code) => resolve(code === 0 ? out.trim() : null));
  });
}

const server = createServer(async (req, res) => {
  const startedAt = Date.now();
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

  if (req.method === 'GET' && url.pathname === '/health') {
    const ok = claudeVersion !== null;
    res.writeHead(ok ? 200 : 503, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify(
        ok
          ? { ok, claude: claudeVersion, auth: 'per-request' }
          : { ok, error: 'claude CLI not found' },
      ),
    );
    return;
  }

  if (req.method !== 'POST' || url.pathname !== '/v1/messages') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(
      errorBody(`This bridge answers POST /v1/messages only, not ${req.method} ${url.pathname}.`),
    );
    return;
  }

  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'too large';
    res.writeHead(tooLarge ? 413 : 400, { 'Content-Type': 'application/json' });
    res.end(errorBody(tooLarge ? 'Request body too large.' : 'Invalid JSON body.'));
    return;
  }

  res.on('finish', () => {
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    const who = requestCredential(req)?.kind ?? 'no-credential';
    console.log(
      `${new Date().toISOString()} ${res.statusCode} ${body.stream ? 'stream' : 'json'} ${body.model ?? '?'} ${seconds}s as ${who}`,
    );
  });

  try {
    await handleMessages(req, res, body);
  } catch (error) {
    console.error('bridge failure', error);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(errorBody('The Claude bridge failed unexpectedly.'));
    } else {
      res.end();
    }
  }
});

/*
 * Idle connections outlive the API's. Its OkHttp pool keeps one open for up to
 * five minutes, and Node's default closed it here after five seconds — so a
 * message sent just as this side hung up went out on a dead socket and failed at
 * once, "timed out or the connection dropped", with no retry on the API side.
 * The client closes first now. Only the API can reach this server.
 */
server.keepAliveTimeout = 6 * 60_000;
server.headersTimeout = server.keepAliveTimeout + 1_000;

claudeVersion = await probeClaude();
if (claudeVersion === null) {
  console.error(
    'warning: `claude` is not on PATH — requests will fail until Claude Code is installed.',
  );
}
server.listen(PORT, HOST, () => {
  console.log(
    `claude bridge listening on http://${HOST}:${PORT} (claude ${claudeVersion ?? 'not found'}, auth per-request)`,
  );
});
