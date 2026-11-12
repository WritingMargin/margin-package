import vm from "node:vm";
/** Replacement callbacks preserve dollar sequences embedded in bundled JS/CSS. */
export function inlineDocument(template, javascript, css) {
  if (!template.includes("</head>") || !template.includes("</body>")) throw new Error("Block HTML template needs head and body closing tags.");
  const script = javascript.replace(/<\/script/gi, "<\\/script");
  const html = template
    .replace("</head>", () => `<style>${css}</style></head>`)
    .replace("</body>", () => `<script>${script}</script></body>`);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  if (scripts.length !== 1) throw new Error("Block HTML must contain exactly one inline script.");
  // Check the final extracted bytes, not just esbuild's output. Never execute UI
  // code during packaging; browser globals are resolved only in the iframe.
  new vm.Script(scripts[0][1], { filename: "ui/scene.html:inline-script" });
  return html;
}
