/**
 * Markdown 语法增强扩展集
 *
 * 目的：把 markdown.com.cn cheat-sheet 上常见的"内联标记 + 粘贴整段 markdown"两类
 * 体验补齐。原始 StarterKit / Highlight / Underline 扩展只提供节点/快捷键，
 * 但**没有自动把 `~~xx~~` `==xx==` 转成对应 mark 的 input rule**，更没有
 * "粘贴一段 markdown 文本时自动结构化"的能力。这里集中补这两块，避免散落到
 * 主编辑器文件里。
 *
 * 暴露：
 *   - StrikeMarkdownRules：删除线 `~~text~~` input/paste rule
 *   - HighlightMarkdownRules：高亮 `==text==` input/paste rule
 *   - MarkdownPasteHandler：纯文本粘贴时检测是否是 markdown，是的话用项目里
 *       已经装好的 `marked` 渲染成 HTML 再让 ProseMirror 走 HTML 解析路径，
 *       直接得到结构化文档（标题/列表/表格/链接 等）。
 *
 * 故意不做的事：
 *   - 不引入新依赖（marked、turndown 已在 frontend/package.json）
 *   - 不新增脚注/定义列表/emoji 等节点：项目自研的 lezer GFM 渲染端不识别这些
 *     节点，加了之后预览/分享页会塌，得不偿失。
 */
import { Extension } from "@tiptap/react";
import { markInputRule, markPasteRule, InputRule } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { markdownToHtml } from "@/lib/contentFormat";

/* -------------------------------------------------------------------------- */
/*  内联 mark 的 input / paste rule                                           */
/* -------------------------------------------------------------------------- */

// 删除线：`~~xxx~~`
// 不能与 `~text~` 冲突（部分 MD 方言用单 `~` 表示删除线，但项目 turndown 序列化
// 用 `~~` 双波浪号，这里只匹配双 `~~` 即可，避免把数学公式 / 文件名误当成删除线）
const STRIKE_INPUT = /(?:^|\s)(~~([^~]+)~~)$/;
const STRIKE_PASTE = /(?:^|\s)(~~([^~]+)~~)/g;

export const StrikeMarkdownRules = Extension.create({
  name: "strikeMarkdownRules",
  addInputRules() {
    const type = this.editor.schema.marks.strike;
    if (!type) return [];
    return [markInputRule({ find: STRIKE_INPUT, type })];
  },
  addPasteRules() {
    const type = this.editor.schema.marks.strike;
    if (!type) return [];
    return [markPasteRule({ find: STRIKE_PASTE, type })];
  },
});

// 高亮：`==xxx==`
// 注意：== 在某些代码片段（Python 比较、C 等于）里也会出现，所以仅在前后是边界
// （行首/空白）时触发 input rule，避免在写代码时被误转。
const HIGHLIGHT_INPUT = /(?:^|\s)(==([^=]+)==)$/;
const HIGHLIGHT_PASTE = /(?:^|\s)(==([^=]+)==)/g;

export const HighlightMarkdownRules = Extension.create({
  name: "highlightMarkdownRules",
  addInputRules() {
    const type = this.editor.schema.marks.highlight;
    if (!type) return [];
    return [markInputRule({ find: HIGHLIGHT_INPUT, type })];
  },
  addPasteRules() {
    const type = this.editor.schema.marks.highlight;
    if (!type) return [];
    return [markPasteRule({ find: HIGHLIGHT_PASTE, type })];
  },
});

/* -------------------------------------------------------------------------- */
/*  Markdown 链接：`[文本](url "title")` input rule                             */
/* -------------------------------------------------------------------------- */

/**
 * 匹配 `[text](url "可选 title")`，触发字符是收尾的 `)`。
 *
 * 设计取舍：
 *   - 文本部分 `[^\]]+` 禁止再嵌 `]`，避免嵌套时贪婪吞段
 *   - URL 部分 `\S+` 不允许空格（用空格做天然分隔，规避把后面整段抓进来）
 *   - 标题部分可选，必须用双引号包裹（markdown.com.cn 标准写法）
 *   - 整体放在 `(?:^|[^!])` 后面，确保前一个字符不是 `!`，否则会劫持图片语法
 *     `![alt](url)`。捕获组 1 是前导字符（用作起点修正），2 文字、3 URL、4 title
 *   - 末尾 `$` 要求是输入行尾——这是 input rule 的常态（边打边匹配）
 *
 * 替换逻辑：把整段 `[a](u "t")` 替换为 `a` 文本节点 + link mark。
 */
const LINK_INPUT = /(?:^|[^!])(\[([^\]]+)\]\((\S+?)(?:\s+"([^"]*)")?\))$/;

export const LinkMarkdownRule = Extension.create({
  name: "linkMarkdownRule",
  addInputRules() {
    const type = this.editor.schema.marks.link;
    if (!type) return [];
    return [
      new InputRule({
        find: LINK_INPUT,
        handler: ({ state, range, match }) => {
          const full = match[1];        // `[text](url "title")`
          const text = match[2];        // text
          const href = match[3];        // url
          const title = match[4] ?? null; // title 可选

          if (!full || !text || !href) return null;

          // 起点修正：match[0] 可能比 match[1] 多 1 个前导字符（非 `!` 的那个）
          const fullStart = range.to - full.length;

          const linkMark = type.create({ href, title });
          const tr = state.tr;
          tr.replaceWith(
            fullStart,
            range.to,
            state.schema.text(text, [linkMark]),
          );
          // 关键：替换完成后让光标落在新链接 mark 之外，避免接着输入还在 link 里
          tr.removeStoredMark(type);
        },
      }),
    ];
  },
});

/* -------------------------------------------------------------------------- */
/*  Markdown 粘贴：纯文本 → HTML → ProseMirror                                */
/* -------------------------------------------------------------------------- */

/**
 * 启发式判断一段纯文本是不是"足够 markdown"，避免把每段普通文本都按 MD 渲染。
 *
 * 判定为 markdown 的特征（命中任一即可）：
 *   - ATX 标题：行首 `# ` ~ `###### `
 *   - 围栏代码块：``` 或 ~~~
 *   - 列表项：行首 `- `、`* `、`+ `、`1. `
 *   - 引用：行首 `> `
 *   - 表格：包含 `| ... |` 至少 2 行 + 一行分隔 `| --- |`
 *   - 链接/图片：`[txt](url)` `![alt](url)`
 *   - 任务列表：`- [ ]` / `- [x]`
 *   - 行内代码 + 至少一个换行（避免单行 `code` 误判）
 */
function looksLikeMarkdown(text: string): boolean {
  if (!text || text.length < 3) return false;
  // 太短的纯单行链接/图片也算
  if (/!\[[^\]]*\]\([^)]+\)/.test(text)) return true; // 图片
  if (/\[[^\]]+\]\([^)]+\)/.test(text)) return true;  // 链接

  const lines = text.split(/\r?\n/);
  if (lines.length === 1) {
    // 单行：除非是纯链接/图片（上面已处理），否则不当 MD
    return false;
  }

  let signalCount = 0;
  let inFence = false;
  let tableHeader = false;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const trimmed = ln.trim();
    if (/^(```|~~~)/.test(trimmed)) {
      inFence = !inFence;
      signalCount += 2; // 围栏代码块是强信号
      continue;
    }
    if (inFence) continue;

    if (/^#{1,6}\s+\S/.test(trimmed)) signalCount += 2;            // 标题
    else if (/^>\s+\S/.test(trimmed)) signalCount++;                // 引用
    else if (/^[-*+]\s+\S/.test(trimmed)) signalCount++;            // 列表
    else if (/^\d+\.\s+\S/.test(trimmed)) signalCount++;            // 有序列表
    else if (/^[-*+]\s+\[[ xX]\]\s+/.test(trimmed)) signalCount += 2; // 任务
    else if (/^---+$|^\*\*\*+$/.test(trimmed)) signalCount++;       // 分隔线
    else if (/\*\*[^*]+\*\*|__[^_]+__/.test(trimmed)) signalCount++; // 粗体
    else if (/`[^`\n]+`/.test(trimmed)) signalCount++;              // 行内代码

    // 表格：连续两行都有 `|`，且第二行像 `|---|---|`
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      if (tableHeader && /^\|\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|$/.test(trimmed)) {
        signalCount += 3;
      }
      tableHeader = true;
    } else {
      tableHeader = false;
    }
  }

  // 多行文本里至少 2 个 markdown 信号才认定为 MD
  return signalCount >= 2;
}

/**
 * 粘贴增强：监听 `paste` 事件
 *   - 如果剪贴板已经有 HTML（ProseMirror 自己会处理，不干预）
 *   - 如果只有 text/plain，且内容看起来是 markdown，就用 marked 渲染成 HTML，
 *     再以 HTML 形式塞回 ProseMirror，让其按结构化方式解析。
 *
 * 这条策略让 cheat-sheet 上任何片段一贴就成形（标题/表格/任务/链接 全部还原）。
 */
const MARKDOWN_PASTE_KEY = new PluginKey("markdownPaste");

export const MarkdownPasteHandler = Extension.create({
  name: "markdownPaste",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: MARKDOWN_PASTE_KEY,
        props: {
          handlePaste: (view, event) => {
            const cb = event.clipboardData;
            if (!cb) return false;

            const html = cb.getData("text/html");
            // 已有 HTML，且不是某些浏览器的"只是把纯文本包了一层 <html>"骗局
            // → 让 ProseMirror 走默认 HTML 路径
            if (html && /<\w+[\s>]/.test(html)) return false;

            const text = cb.getData("text/plain");
            if (!text || !looksLikeMarkdown(text)) return false;

            // 关键步骤：复用项目已有的 markdownToHtml（基于 marked + GFM），
            // 转成 HTML 后让 PM 解析。这样表格、任务列表、代码块、链接全都能还原。
            let rendered: string;
            try {
              rendered = markdownToHtml(text);
            } catch {
              return false;
            }
            if (!rendered) return false;

            // 用一个临时容器解析 HTML，再用 ProseMirror 的 clipboardParser 走标准
            // 路径，避免直接 insertContent(html) 在某些 schema 下丢失节点属性。
            const dom = document.createElement("div");
            dom.innerHTML = rendered;

            const slice = (view.props as any).clipboardParser
              ? (view.props as any).clipboardParser.parseSlice(dom, { preserveWhitespace: false })
              : view.someProp("clipboardParser", (parser: any) =>
                  parser.parseSlice(dom, { preserveWhitespace: false })
                );

            if (!slice) return false;

            const tr = view.state.tr.replaceSelection(slice).scrollIntoView();
            view.dispatch(tr);
            event.preventDefault();
            return true;
          },
        },
      }),
    ];
  },
});

/* -------------------------------------------------------------------------- */
/*  打包导出                                                                  */
/* -------------------------------------------------------------------------- */

export const MarkdownEnhancements = [
  StrikeMarkdownRules,
  HighlightMarkdownRules,
  LinkMarkdownRule,
  MarkdownPasteHandler,
];
