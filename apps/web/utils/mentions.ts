/** Someone a post can @mention. */
export type MentionablePerson = {
  id: string;
  name: string;
  /** As shown and inserted; mentions ignore case. */
  username: string;
  image: string | null;
  role: string;
};

/**
 * @mentions in a discussion post: `@username`, as the picker inserts it. Not
 * after a letter, so an email address ("qa@test.com") is not a mention, and a
 * trailing dot is the sentence's, not the name's.
 */
const MENTION = /(?<![\w.@])@([a-zA-Z0-9_.]*[a-zA-Z0-9_])/g;

/** The usernames a post mentions, lower case, each once. */
export function mentionedUsernames(body: string): string[] {
  return [...new Set([...body.matchAll(MENTION)].map((match) => match[1]!.toLowerCase()))];
}

/** A post's text in pieces: plain text, and each @mention with its username. */
export function splitMentions(body: string): ({ text: string } | { mention: string; text: string })[] {
  const parts: ({ text: string } | { mention: string; text: string })[] = [];
  let last = 0;
  for (const match of body.matchAll(MENTION)) {
    if (match.index > last) parts.push({ text: body.slice(last, match.index) });
    parts.push({ mention: match[1]!.toLowerCase(), text: match[0] });
    last = match.index + match[0].length;
  }
  if (last < body.length) parts.push({ text: body.slice(last) });
  return parts;
}

/**
 * The @mention being typed at the caret, if any: where its "@" is, and what
 * follows it so far.
 */
export function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const match = /(?:^|[^\w.@])@([a-zA-Z0-9_.]{0,30})$/.exec(text.slice(0, caret));
  if (!match) return null;
  return { start: caret - match[1]!.length - 1, query: match[1]! };
}
