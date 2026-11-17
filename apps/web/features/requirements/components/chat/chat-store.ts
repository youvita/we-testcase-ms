import type { AiChatEffort, AiChatMessage, AiModel } from "@wetestcase/dto";

/**
 * The requirements chat's memory, kept in this browser only: the current
 * thread and past threads per project, and the person's model settings.
 * Nothing here reaches the server except as the next question's history.
 */

export type ChatTurn = {
  role: "user" | "assistant";
  text: string;
  /** The reply failed; shown, never sent back as history. */
  error?: boolean;
  /** Stopped by the person part-way. */
  interrupted?: boolean;
  /** Names of what went with a question: attached files, mentioned documents. */
  files?: string[];
};

export type PastChat = {
  id: string;
  title: string;
  /** `YYYY-MM-DD HH:MM` */
  updatedAt: string;
  turns: ChatTurn[];
};

export type ChatSettings = { model: AiModel; effort: AiChatEffort; thinking: boolean };

export const DEFAULT_SETTINGS: ChatSettings = { model: "sonnet", effort: "medium", thinking: false };

const MAX_CHATS = 20;
const MAX_TURNS = 40;

/**
 * Whose chats: a person's, in one project. The browser is shared by everyone
 * who signs in on it, so a key without the person would show the next one
 * the last one's chats.
 */
export const chatScope = (userId: string, projectId: string) => `${userId}:${projectId}`;

const currentKey = (scope: string) => `wtc:requirements-chat:${scope}:current`;
const historyKey = (scope: string) => `wtc:requirements-chat:${scope}:history`;
const settingsKey = (userId: string) => `wtc:requirements-chat:${userId}:settings`;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value == null || (Array.isArray(value) && value.length === 0)) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked: the chat simply is not remembered.
  }
}

export const loadCurrent = (scope: string) => read<ChatTurn[]>(currentKey(scope), []);
export const saveCurrent = (scope: string, turns: ChatTurn[]) =>
  write(currentKey(scope), turns.slice(-MAX_TURNS));

export const loadHistory = (scope: string) => read<PastChat[]>(historyKey(scope), []);
export const saveHistory = (scope: string, chats: PastChat[]) =>
  write(historyKey(scope), chats.slice(0, MAX_CHATS));

export function loadSettings(userId: string): ChatSettings {
  return { ...DEFAULT_SETTINGS, ...read<Partial<ChatSettings>>(settingsKey(userId), {}) };
}
export const saveSettings = (userId: string, settings: ChatSettings) => write(settingsKey(userId), settings);

/**
 * Chats saved before they were kept per person (keyed by the project alone):
 * nobody can tell whose they are, so they go.
 */
export function dropUnownedChats(projectId: string) {
  try {
    for (const key of [`wtc:requirements-chat:${projectId}:current`, `wtc:requirements-chat:${projectId}:history`, "wtc:requirements-chat:settings"]) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Storage blocked: nothing was kept either.
  }
}

/** A past chat made from a thread: titled by its first question, stamped now. */
export function toPastChat(turns: ChatTurn[]): PastChat {
  const first = turns.find((turn) => turn.role === "user")?.text ?? "";
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    id: `chat-${now.getTime().toString(36)}`,
    title: first.replace(/\s+/g, " ").trim().slice(0, 60) || "Untitled chat",
    updatedAt: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`,
    turns: turns.slice(-MAX_TURNS),
  };
}

/** A past turn as sent back as history; the schema allows 20,000. */
const MAX_PAST_TURN_CHARS = 6_000;
/** The schema allows 40 messages; the new question is one of them. */
const MAX_HISTORY = 38;

/**
 * The thread as the model gets it: failed replies left out, one question per
 * answer, long turns cut, and starting with a question.
 */
export function toHistory(turns: ChatTurn[]): AiChatMessage[] {
  const out: AiChatMessage[] = [];
  for (const turn of turns) {
    if (turn.error || !turn.text.trim()) continue;
    let content = turn.text;
    if (turn.role === "user" && turn.files?.length) content += `\n(attached then: ${turn.files.join(", ")})`;
    if (content.length > MAX_PAST_TURN_CHARS) content = `${content.slice(0, MAX_PAST_TURN_CHARS - 8)}\n…(cut)`;
    const previous = out[out.length - 1];
    if (previous?.role === turn.role) {
      // A question that got no answer is replaced by the next one.
      previous.content = turn.role === "user" ? content : `${previous.content}\n\n${content}`;
    } else {
      out.push({ role: turn.role, content });
    }
  }
  const recent = out.slice(-MAX_HISTORY);
  while (recent[0]?.role === "assistant") recent.shift();
  // The new question follows; an unanswered one before it would be two in a row.
  if (recent[recent.length - 1]?.role === "user") recent.pop();
  return recent;
}
