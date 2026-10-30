"use client";

import { useEffect, useRef, useState } from "react";
import Editor, { loader, type BeforeMount, type Monaco, type OnMount } from "@monaco-editor/react";
import { Loader2 } from "lucide-react";

import {
  MONACO_CDN,
  PLAYWRIGHT_TYPE_FILES,
  scriptGlobals,
} from "@/features/automation/script-types";

loader.config({ paths: { vs: MONACO_CDN } });

const LINE_HEIGHT = 18;
const MIN_LINES = 8;
const MAX_LINES = 28;

// TypeScript codes that are wrong about a script body, which runs inside an
// async test: top-level await, and a file with no imports or exports.
const IGNORED_DIAGNOSTICS = [1375, 1378, 1208];

type TypeScriptApi = Monaco["typescript"];

/**
 * VS Code's light theme, with outlines rather than grey fills: the current
 * line, and the word under the cursor with its other occurrences.
 */
const THEME = "wetestcase-light";
const defineTheme: BeforeMount = (monaco) => {
  monaco.editor.defineTheme(THEME, {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.lineHighlightBackground": "#00000000",
      "editor.lineHighlightBorder": "#cbd5e1",
      "editor.wordHighlightBackground": "#00000000",
      "editor.wordHighlightBorder": "#94a3b8",
      "editor.wordHighlightStrongBackground": "#00000000",
      "editor.wordHighlightStrongBorder": "#94a3b8",
      "editor.wordHighlightTextBackground": "#00000000",
      "editor.wordHighlightTextBorder": "#94a3b8",
    },
  });
};

/** Set up TypeScript and load Playwright's types: once per page, shared by every editor. */
let setup: Promise<void> | null = null;
function setUpTypeScript(monaco: Monaco): Promise<void> {
  setup ??= (async () => {
    // 0.56 moved the TypeScript API from languages.typescript to the top level.
    const ts: TypeScriptApi =
      monaco.typescript ??
      (monaco.languages as unknown as { typescript: TypeScriptApi }).typescript;
    ts.typescriptDefaults.setCompilerOptions({
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      // Every file a module, so top-level await is allowed.
      moduleDetection: 3,
      // Playwright's types use Symbol.asyncDispose.
      lib: ["esnext", "dom"],
      allowNonTsExtensions: true,
      strict: false,
      noImplicitAny: false,
    });
    ts.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
      diagnosticCodesToIgnore: IGNORED_DIAGNOSTICS,
    });

    // Without them the editor still highlights and checks syntax; it just
    // cannot suggest Playwright's methods.
    const files = await Promise.allSettled(
      PLAYWRIGHT_TYPE_FILES.map(async (file) => {
        const response = await fetch(file.url);
        if (!response.ok) throw new Error(`${file.url}: ${response.status}`);
        return { content: await response.text(), filePath: file.path };
      }),
    );
    const loaded = files.flatMap((f) => (f.status === "fulfilled" ? [f.value] : []));
    if (loaded.length < files.length) {
      console.warn("[script-editor] Playwright types did not all load; suggestions are limited.");
    }
    for (const lib of loaded) ts.typescriptDefaults.addExtraLib(lib.content, lib.filePath);
    // Playwright's types name Node's Buffer, which the browser does not have;
    // without it, e.g. page.screenshot() would be typed as any.
    ts.typescriptDefaults.addExtraLib(
      "interface Buffer extends Uint8Array { toString(encoding?: string): string }",
      "file:///node-shims.d.ts",
    );
  })();
  return setup;
}

/**
 * The Playwright script editor: VS Code's editor, with suggestions, hover
 * docs and type checking for what the runner puts in scope.
 */
export function ScriptEditor({
  value,
  onChange,
  platform,
  variables,
  readOnly,
  placeholder,
  onSave,
}: {
  value: string;
  onChange: (value: string) => void;
  platform: "WEB" | "API";
  /** Every environment's variables, so vars. lists their names. */
  variables: { key: string; secret: boolean }[];
  readOnly: boolean;
  placeholder?: string;
  /** Ctrl/Cmd+S. */
  onSave?: () => void;
}) {
  const [monaco, setMonaco] = useState<Monaco | null>(null);
  const [lines, setLines] = useState(() => value.split("\n").length);
  const saveRef = useRef(onSave);
  saveRef.current = onSave;

  // What is in scope follows the case's platform and the project's variables.
  const variableKey = variables.map((v) => `${v.key}:${v.secret}`).join(",");
  useEffect(() => {
    if (!monaco) return;
    const ts: TypeScriptApi =
      monaco.typescript ??
      (monaco.languages as unknown as { typescript: TypeScriptApi }).typescript;
    const lib = ts.typescriptDefaults.addExtraLib(
      scriptGlobals(platform, variables),
      "file:///script-globals.d.ts",
    );
    return () => lib.dispose();
    // variableKey stands for variables, which is a new array on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monaco, platform, variableKey]);

  const handleMount: OnMount = (editor, instance) => {
    void setUpTypeScript(instance);
    setMonaco(instance);
    editor.addCommand(instance.KeyMod.CtrlCmd | instance.KeyCode.KeyS, () => saveRef.current?.());
    editor.onDidChangeModelContent(() => setLines(editor.getModel()?.getLineCount() ?? 1));
  };

  const height = Math.min(MAX_LINES, Math.max(MIN_LINES, lines + 1)) * LINE_HEIGHT + 16;

  return (
    <div className="overflow-hidden rounded-md border focus-within:ring-1 focus-within:ring-ring">
      <Editor
        height={height}
        language="typescript"
        // A path per platform: the model is TypeScript, not a loose script.
        path={`file:///script.${platform.toLowerCase()}.ts`}
        value={value}
        onChange={(next) => onChange(next ?? "")}
        beforeMount={defineTheme}
        onMount={handleMount}
        theme={THEME}
        loading={
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />
            Loading editor…
          </div>
        }
        options={{
          readOnly,
          placeholder,
          fontSize: 12,
          lineHeight: LINE_HEIGHT,
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          tabSize: 2,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: "on",
          automaticLayout: true,
          padding: { top: 8, bottom: 8 },
          lineNumbersMinChars: 3,
          renderLineHighlight: readOnly ? "none" : "line",
          fixedOverflowWidgets: true,
          scrollbar: { alwaysConsumeMouseWheel: false },
          ariaLabel: "Playwright script",
        }}
      />
    </div>
  );
}
