import { build } from "esbuild";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
const here = dirname(fileURLToPath(import.meta.url));
export function inlineNotebook(template, script, css) {
  const code = script.replace(/<\/script/gi, "<\\/script");
  const html = template
    .replace("</head>", () => `<style>${css}</style></head>`)
    .replace("</body>", () => `<script>${code}</script></body>`);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (scripts.length !== 1)
    throw new Error("Notebook UI requires exactly one inline script.");
  new vm.Script(scripts[0][1]);
  return html;
}
export async function buildUI(output) {
  const result = await build({
    entryPoints: [join(here, "ui/main.mjs")],
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "es2022",
    minify: true,
    write: false,
  });
  const template = await readFile(join(here, "ui/notebook.html"), "utf8");
  const selectCSS = await readFile(
    join(here, "../../../packages/plugin-sdk/select.css"),
    "utf8",
  );
  const css =
    selectCSS + "\n" + (await readFile(join(here, "ui/notebook.css"), "utf8"));
  const html = inlineNotebook(template, result.outputFiles[0].text, css);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, html);
  return html;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const output = resolve(process.argv[2] || join(here, "dist/notebook.html"));
  await buildUI(output);
  console.log(`Notebook UI ready: ${output}`);
}
