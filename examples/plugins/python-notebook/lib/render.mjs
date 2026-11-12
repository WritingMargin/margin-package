import { notebookText, notebookOutputText } from "./notebook.ts";
export function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
export function pngData(output) {
  const value = notebookText(output.data?.["image/png"]).replace(/\s/g, "");
  return value.length <= 1500000 && /^[a-zA-Z0-9+/]+=*$/.test(value)
    ? value
    : "";
}
/** Deliberately small Markdown renderer: only DOM text nodes, never HTML. */
export function markdown(source) {
  const host = element("div", "markdown");
  let fence = null;
  for (const line of source.split("\n")) {
    if (line.startsWith("```")) {
      if (fence) fence = null;
      else {
        fence = element("pre", "markdown-code");
        host.append(fence);
      }
      continue;
    }
    if (fence) {
      fence.append(document.createTextNode(line + "\n"));
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) host.append(element(`h${heading[1].length}`, "", heading[2]));
    else if (/^\s*[-*]\s+/.test(line))
      host.append(
        element("p", "list-line", "• " + line.replace(/^\s*[-*]\s+/, "")),
      );
    else if (line.trim()) host.append(element("p", "", line));
  }
  return host;
}
export function outputView(outputs, number) {
  const host = element("div", "outputs");
  for (const output of outputs || []) {
    const png = pngData(output);
    const text = notebookOutputText(output);
    if (png) {
      const image = element("img", "output-image");
      image.src = `data:image/png;base64,${png}`;
      image.alt = `Output of cell ${number}`;
      image.loading = "lazy";
      host.append(image);
    }
    if (text) host.append(element("pre", "output-text", text));
    if (!png && !text)
      host.append(
        element(
          "p",
          "hint",
          "This output format is preserved. Export the notebook to view it in Jupyter.",
        ),
      );
  }
  return host;
}
