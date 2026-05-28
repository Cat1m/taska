import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({
  gfm: true,
  breaks: true,
});

export function renderMarkdown(src: string): string {
  const raw = marked.parse(src, { async: false }) as string;
  return DOMPurify.sanitize(raw, {
    ALLOWED_TAGS: [
      "h1", "h2", "h3", "h4", "h5", "h6",
      "p", "br", "hr",
      "ul", "ol", "li",
      "strong", "em", "del", "code", "pre",
      "blockquote",
      "a", "img",
      "table", "thead", "tbody", "tr", "th", "td",
      "input", // for task list checkboxes (GFM)
    ],
    ALLOWED_ATTR: ["href", "title", "src", "alt", "type", "checked", "disabled", "class"],
  });
}
