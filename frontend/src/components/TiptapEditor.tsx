import React, { forwardRef, lazy, Suspense, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor, Editor, EditorContent, Extension, ReactNodeViewRenderer } from "@tiptap/react";

// 鎳掑姞杞?docx 鍐呰仈棰勮锛歰ffice 瑙ｆ瀽鍣紙fflate + 鑷爺 OOXML parser锛夋湁鍑犲崄 KB锛?
// 鑰岀粷澶у鏁颁細璇濅笉浼氱偣 docx 闄勪欢锛屾墍浠ユ媶鍑哄幓鎸夐渶鎷夈€?
const DocxAttachmentPreview = lazy(() => import("@/office/word/DocxAttachmentPreview"));
// 澶嶇敤鐨勯檮浠惰鎯呮娊灞夛紙涓?FileManager 鍚屼竴浠藉疄鐜帮級
import AttachmentDetailDrawer from "@/components/attachmentDetail/AttachmentDetailDrawer";
import { posToDOMRect } from "@tiptap/core";
import { AnimatePresence, motion } from "framer-motion";import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Image from "@tiptap/extension-image";
import ResizableImageView from "./ResizableImageView";
import { TableGridPicker, TableResizeDialog } from "./TableGridPicker";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import Underline from "@tiptap/extension-underline";
import Highlight from "@tiptap/extension-highlight";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table, TableHeader, TableCell } from "@tiptap/extension-table";
// 鑷畾涔?TableRow锛氬湪鍘熸墿灞曞熀纭€涓婂姞 height 鎸佷箙鍖?attribute + 琛岄珮鎷栨嫿鎵嬫焺銆?
// 涔嬫墍浠ヤ粠 @tiptap/extension-table 瑙ｆ瀯閲屽幓鎺?TableRow锛屾槸鍥犱负涓嬮潰瑕佺敤鎵╁睍杩囩殑鐗堟湰锛?
// 鍚屽悕瀵煎嚭浼氬啿绐併€傝楂樿涔変负"min-height"鈥斺€斿唴瀹硅秴鍑轰粛浼氭拺寮€銆?
import { TableRowResizable } from "./extensions/TableRowResizable";
import TextAlign from "@tiptap/extension-text-align";
import { common, createLowlight } from "lowlight";
import { DOMParser as ProseMirrorDOMParser, Node as ProseMirrorNode } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { markdownToSimpleHtml } from "@/lib/importService";
import { repairTiptapJson } from "@/lib/tiptapSchemaRepair";
import { markdownToHtml as mdToFullHtml, detectFormat as detectContentFormat, tiptapJsonToMarkdown } from "@/lib/contentFormat";
import { api } from "@/lib/api";
import { extractRtfImagesAsync } from "@/lib/rtfImageWorkerClient";
import { replaceDataUrlImagesWithAttachments } from "@/lib/rtfImageUploader";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, ListOrdered, Heading1, Heading2, Heading3,
  Quote, ImagePlus, Film, Paperclip, CheckSquare, Highlighter, Minus, Undo, Redo,
  Code, FileCode, Sparkles, X, ZoomIn, ZoomOut, RotateCcw,
  Indent, Outdent, AlignLeft, AlignCenter, AlignRight, Trash2,
  FileType, Check, AlertCircle, Info, ArrowUp, Link as LinkIcon,
  ExternalLink, Unlink2, Workflow, Sigma, BookOpen, Download,
  Type, Palette, Eraser, ChevronDown, Search,
  // 琛ㄦ牸姘旀场鑿滃崟鍥炬爣
  Rows3, Columns3, Merge, Split, Heading,
} from "lucide-react";
import { downloadAttachment } from "@/lib/downloadFile";
import { cn } from "@/lib/utils";
import { toast } from "@/lib/toast";
import { prompt as promptDialog } from "@/components/ui/confirm";
import { Note, Tag } from "@/types";
import TagInput from "@/components/TagInput";
import AIWritingAssistant from "@/components/AIWritingAssistant";
import type { NoteEditorHandle, NoteEditorHeading, NoteEditorProps } from "@/components/editors/types";
import type { FormatMenuPayload } from "@/lib/desktopBridge";
import { sendFormatState } from "@/lib/desktopBridge";
import { SlashCommandsMenu, getDefaultSlashCommands, createSlashExtension, createSlashEventHandlers } from "@/components/SlashCommands";
import { MarkdownEnhancements } from "@/components/MarkdownEnhancements";
import { MathExtensions } from "@/components/MathExtensions";
import { FootnoteExtensions, nextFootnoteIdentifier } from "@/components/FootnoteExtensions";
import {
  TextStyleKit,
  FONT_SIZE_PRESETS,
  COLOR_PRESETS,
  HIGHLIGHT_PRESETS,
} from "@/components/FontSizeExtension";
import CodeBlockView from "@/components/CodeBlockView";
import { SearchReplacePanel, createSearchReplaceExtension } from "@/components/SearchReplacePanel";
import { Video as VideoExtension } from "@/components/VideoExtension";

import { useTranslation } from "react-i18next";

const lowlight = createLowlight(common);

// ---------------------------------------------------------------------------
// ProseMirror 闃插尽鎬цˉ涓侊細閬垮厤 "Position X out of range" RangeError 瀵艰嚧宕╂簝
// ---------------------------------------------------------------------------
// 鑳屾櫙锛?
//   ProseMirror 鐨?DOMObserver 鍦ㄦ煇浜涙儏鍐典笅锛堝涓枃 IME composition銆丷eact
//   NodeView 鐨?DOM 缁撴瀯涓?PM 鏂囨。鏍戠煭鏆備笉涓€鑷淬€乮nputRule 寮曡捣鐨勮妭鐐圭被鍨嬭浆鎹?
//   绛夛級浼氳皟鐢?Node.resolve(pos) 瑙ｆ瀽涓€涓秺鐣岋紙甯镐负璐熸暟锛夌殑浣嶇疆锛岀洿鎺ユ姏鍑?
//   鏈鎹曡幏鐨?RangeError锛屽鑷存暣涓紪杈戝櫒宕╂簝銆侀〉闈㈡樉绀哄紓甯搞€?
//
// 鎬濊矾锛?
//   瑕嗙洊 Node.prototype.resolve锛屽瓒婄晫浣嶇疆閽冲埗鍒?[0, content.size] 鑼冨洿鍐?
//   鍐嶈皟鐢ㄥ師瀹炵幇銆傚浜庣粷澶у鏁板満鏅細
//     - 鍚堟硶浣嶇疆锛氳涓哄畬鍏ㄤ笉鍙橈紙璧板師 resolve 璺緞锛夈€?
//     - 瓒婄晫浣嶇疆锛氳繑鍥炰竴涓悎娉曠鐐圭殑 ResolvedPos锛岃€屼笉鏄姏閿欏穿婧冦€?
//
//   杩欎笌 PM 鐨勮璁″摬瀛﹀吋瀹癸細瀹冧細鍦ㄤ笅涓€娆′簨鍔′腑閫氳繃 DOMObserver 閲嶆柊鍚屾 DOM
//   涓庢枃妗ｆ爲锛岄€氬父涓€鐬嵆鎭㈠涓€鑷达紱鑰屽穿婧冨悗缂栬緫鍣ㄦ棤娉曠户缁搷浣滐紝鐢ㄦ埛蹇呴』鍒锋柊銆?
//
// 杩欐槸鍏ㄥ眬涓€娆℃€цˉ涓侊紝浣跨敤 Symbol 闃查噸澶嶅簲鐢ㄣ€?
// ---------------------------------------------------------------------------
const RESOLVE_PATCHED = Symbol.for("nowen.pm.resolve.patched");
if (!(ProseMirrorNode.prototype as any)[RESOLVE_PATCHED]) {
  const originalResolve = ProseMirrorNode.prototype.resolve;
  ProseMirrorNode.prototype.resolve = function patchedResolve(pos: number) {
    const size = this.content.size;
    if (pos < 0 || pos > size) {
      // 浣嶇疆瓒婄晫锛氶挸鍒跺埌鍚堟硶鑼冨洿锛岄伩鍏嶆姏 RangeError 宕╂簝銆?
      // 璁板綍涓€娆¤鍛婃柟渚挎帓鏌ワ紝浣嗕笉涓柇鐢ㄦ埛杈撳叆銆?
      if (typeof console !== "undefined" && console.warn) {
        console.warn(
          `[PM Patch] resolve() called with out-of-range position ${pos} (valid: 0..${size}); clamped.`
        );
      }
      const clamped = Math.max(0, Math.min(size, pos));
      return originalResolve.call(this, clamped);
    }
    return originalResolve.call(this, pos);
  };
  (ProseMirrorNode.prototype as any)[RESOLVE_PATCHED] = true;
}

// ---------------------------------------------------------------------------
// 绮樿创 HTML 褰掍竴鍖栵細鎶?浼琛屾钀?鎷嗘垚鐪熸鐨勫涓?<p>
// ---------------------------------------------------------------------------
// 寰堝鏉ユ簮锛堝井淇?QQ/閽夐拤/椋炰功缃戦〉澶嶅埗銆乄ord銆侀儴鍒嗘祻瑙堝櫒瀵屾枃鏈級鍦?clipboard
// 鐨?text/html 閲屼細鎶婂琛屾枃鏈簭鍒楀寲鎴愶細
//     <p>琛?<br>琛?<br>琛?</p>          鈫?鍚屼竴娈佃惤鍐呭涓?<br>
//     <div>琛?</div><div>琛?</div>       鈫?澶氫釜 <div> 褰撴钀?
// 杩欑缁撴瀯绮樺埌 Tiptap 鍚?ProseMirror 浼氳В鏋愭垚**涓€涓?paragraph 鑺傜偣閲屽涓?
// hardBreak**锛岃瑙変笂鏄琛岋紝浣嗗潡绾ф搷浣滐紙toggleHeading / setParagraph /
// blockquote锛変細鎶?*鏁存**杞崲锛屽氨鍑虹幇"鍙€変竴琛屽嵈鏁存鍙樻爣棰?鐨?bug銆?
//
// 杩欓噷鍦ㄧ矘璐磋繘鍏?PM DOMParser 涔嬪墠锛屾妸椤跺眰鐨?<br> 鎷嗘垚娈佃惤杈圭晫銆佹妸 <div>
// 缁熶竴鍗囩骇涓?<p>锛岃 PM 鐪嬪埌鐨勬槸鐪熸鐨勫娈佃惤缁撴瀯銆?
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// rescuePastedImages锛氫粠璁哄潧 / 鎳掑姞杞介〉闈㈠鍒?HTML 鏃讹紝<img src> 缁忓父鏄?
// 1脳1 鍗犱綅鍥撅紙濡?Discuz 鐨?static/image/common/none.gif锛夛紝鐪熸鐨勫浘鐗囧湴鍧€
// 钘忓湪 file / zoomfile / data-src / data-original / data-lazy-src 绛夎嚜瀹氫箟
// 灞炴€ч噷銆傝繖閲屾妸杩欎簺灞炴€у€?鏁?鍥炲埌 src锛屽苟灏濊瘯鎶婄浉瀵硅矾寰勮ˉ鎴愮粷瀵?URL锛?
// 閬垮厤绮樿创鍚庡浘鐗囧畬鍏ㄦ秷澶辨垨鏄剧ず鎴?1脳1 閫忔槑鍧椼€?
//
// 閫夋嫨绗竴涓潪绌虹殑"鐪嬭捣鏉ュ儚鐪熸鍥剧墖鍦板潃"鐨勫睘鎬у€硷紱鑻?src 宸茬粡鏄粷瀵圭殑
// http(s)/data:/blob: URL 鍒欎繚鐣欎笉鍔紙涓嶈鐩栫敤鎴峰師鏈氨姝ｅ父鐨勫浘锛夈€?
//
// 杩斿洖鍊硷細{ total, rescued, failed }
//   total   - 澶勭悊鍒扮殑 <img> 鎬绘暟
//   rescued - 浠?data-src / file / srcset 绛夊€欓€夊睘鎬ф晳鍥炵湡瀹炲湴鍧€鐨?<img> 鏁?
//   failed  - 浠嶇劧娌℃湁鍙敤 src 鐨?<img>锛堥€氬父鏄師缃戦〉鍥剧墖杩樻病鍔犺浇瀹屽氨琚鍒讹級
// ---------------------------------------------------------------------------
type RescueStats = { total: number; rescued: number; failed: number };
function rescuePastedImages(root: Element): RescueStats {
  const stats: RescueStats = { total: 0, rescued: 0, failed: 0 };
  // 1) 鍏堟壂涓€閬嶆壘鍑烘湰鐗囨鍐?浠绘剰涓€涓粷瀵?URL 鐨?origin"锛屼綔涓虹浉瀵硅矾寰勭殑 base銆?
  //    浼樺厛鐢?<a href>/<link href>/宸茬粡鏄粷瀵瑰湴鍧€鐨?<img src>锛屽洜涓?Discuz
  //    澶嶅埗杩囨潵鐨?HTML 寰€寰€甯︽湁鎸囧悜婧愮珯鐨勯摼鎺ワ紙濡傞檮浠朵笅杞介摼鎺ワ級銆?
  let pasteBaseOrigin: string | null = null;
  const pickOrigin = (raw: string | null) => {
    if (pasteBaseOrigin || !raw) return;
    if (!/^https?:\/\//i.test(raw)) return;
    try {
      pasteBaseOrigin = new URL(raw).origin;
    } catch {
      /* ignore malformed */
    }
  };
  root.querySelectorAll("a[href]").forEach((a) => pickOrigin(a.getAttribute("href")));
  root.querySelectorAll("img").forEach((img) => {
    pickOrigin(img.getAttribute("src"));
    pickOrigin(img.getAttribute("file"));
    pickOrigin(img.getAttribute("zoomfile"));
    pickOrigin(img.getAttribute("data-src"));
    pickOrigin(img.getAttribute("data-original"));
  });

  // 2) 鍗犱綅鍥剧壒寰侊細Discuz/typecho/甯歌 lazyload 搴撻兘鐢ㄦ瀬灏忕殑 gif/png 鍗犱綅锛?
  //    鎴栧共鑴?src 涓虹┖銆佷负 about:blank銆傚懡涓嵆瑙嗕负"闇€瑕佹晳鎻?銆?
  const isPlaceholderSrc = (src: string | null): boolean => {
    if (!src) return true;
    const s = src.trim();
    if (!s || s === "about:blank") return true;
    // data:image/gif;base64,R0lGODlh...锛?脳1 閫忔槑 gif/png 鍗犱綅锛?
    if (/^data:image\/(gif|png);base64,/i.test(s) && s.length < 200) return true;
    // Discuz 鏍囧噯鍗犱綅
    if (/\/none\.gif(\?|$)/i.test(s)) return true;
    if (/\/(blank|placeholder|spacer|grey|loading)\.(gif|png|svg)(\?|$)/i.test(s)) return true;
    return false;
  };

  // 3) 鎶婄浉瀵?鍗忚鐩稿璺緞琛ユ垚缁濆 URL锛堟壘涓嶅埌 base 鍒欎繚鎸佸師鏍凤紝璁╂祻瑙堝櫒鑷鍐冲畾锛?
  const toAbsolute = (url: string): string => {
    const u = url.trim();
    if (!u) return u;
    if (/^(https?:|data:|blob:)/i.test(u)) return u;
    if (u.startsWith("//")) return `https:${u}`;
    if (!pasteBaseOrigin) return u;
    if (u.startsWith("/")) return `${pasteBaseOrigin}${u}`;
    return `${pasteBaseOrigin}/${u.replace(/^\.?\//, "")}`;
  };

  // 浠?srcset 瀛楃涓蹭腑鎸戜竴涓?URL锛堜紭鍏堟渶楂樺垎杈ㄧ巼锛夈€?
  //   "url1 1x, url2 2x"  鈫?url2
  //   "url1 320w, url2 1280w" 鈫?url2
  //   "url1"              鈫?url1
  const pickFromSrcset = (raw: string | null): string | null => {
    if (!raw) return null;
    const entries = raw
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean)
      .map((e) => {
        // 鍏佽 URL 鍐呭惈绌烘牸锛堢綍瑙侊級锛涘彇鏈€鍚庝竴娈靛仛 descriptor
        const m = e.match(/^(\S+)(?:\s+(\S+))?$/);
        if (!m) return null;
        const url = m[1];
        const desc = (m[2] || "").toLowerCase();
        let weight = 0;
        if (desc.endsWith("w")) weight = parseFloat(desc);
        else if (desc.endsWith("x")) weight = parseFloat(desc) * 1000; // 绮楃暐缁熶竴閲忕翰
        else weight = 0;
        return { url, weight };
      })
      .filter((x): x is { url: string; weight: number } => !!x);
    if (entries.length === 0) return null;
    entries.sort((a, b) => b.weight - a.weight);
    return entries[0].url;
  };

  // 4) 鏁戞彺姣忎竴涓?<img>锛氭寜浼樺厛绾ф寫涓€涓湁鏁堢殑鐪熷疄鍦板潃瑕嗙洊鍒?src
  root.querySelectorAll("img").forEach((img) => {
    stats.total += 1;
    const currentSrc = img.getAttribute("src");
    // src 宸茬粡鏄悎娉曚笖闈炲崰浣嶇殑杩滅/data URL 鈫?涓嶅姩
    //   娉ㄦ剰锛歠ile:// 涓嶇畻鍚堟硶锛堟祻瑙堝櫒鍑轰簬瀹夊叏闄愬埗涓嶄細鍔犺浇锛夛紝
    //   Word 澶嶅埗杩囨潵鐨?<img src="file:///C:/Users/.../clip_image001.png"> 蹇呴』璧版晳鎻存祦绋嬨€?
    if (currentSrc && /^(https?:|data:|blob:)/i.test(currentSrc) && !isPlaceholderSrc(currentSrc)) {
      return;
    }
    // 鍊欓€夊睘鎬ч『搴忥細Discuz 鐨?zoomfile锛堢偣鍑绘斁澶у師鍥撅級> file > 閫氱敤 lazyload 灞炴€?
    // 瑕嗙洊涓绘祦鎳掑姞杞藉簱涓庣珯鐐癸細lazysizes銆乴ozad銆乯Query.lazyload銆佸井淇″叕浼楀彿銆?
    // CSDN銆佺畝涔︺€佹帢閲戙€佺煡涔庛€佸崥瀹㈠洯銆丮edium 绛?
    const candidates = [
      "zoomfile",
      "file",
      "data-src",
      "data-original",
      "data-lazy-src",
      "data-actualsrc",
      "data-echo",
      "data-raw-src",
      "data-original-src",
      "data-src-large",
      "data-src-hd",
      "data-hires",
      "data-full",
      "data-url",
      "data-href",
    ];
    let picked: string | null = null;
    for (const attr of candidates) {
      const v = img.getAttribute(attr);
      if (v && v.trim()) {
        picked = v.trim();
        break;
      }
    }
    // 浠?data-srcset / srcset 鎸戞渶澶у昂瀵?
    if (!picked) {
      picked = pickFromSrcset(img.getAttribute("data-srcset"))
        || pickFromSrcset(img.getAttribute("srcset"));
    }
    // 浠庣埗灞?<picture> 鐨?<source srcset> 鎸戞渶澶у昂瀵?
    if (!picked) {
      const picture = img.closest("picture");
      if (picture) {
        const sources = Array.from(picture.querySelectorAll("source"));
        for (const s of sources) {
          const url = pickFromSrcset(s.getAttribute("srcset"))
            || pickFromSrcset(s.getAttribute("data-srcset"));
          if (url) {
            picked = url;
            break;
          }
        }
      }
    }
    // 鍊欓€夐兘娌℃湁锛屼絾褰撳墠 src 鏄浉瀵硅矾寰勶紙闈炲崰浣嶏級鈫?涔熷皾璇曡ˉ鍏?
    if (!picked && currentSrc && !isPlaceholderSrc(currentSrc)) {
      picked = currentSrc;
    }
    if (!picked) {
      // 鏁戜笉鍥炴潵锛岃涓€绗旓紙甯歌鏉ユ簮锛?
      //   a) 鎳掑姞杞界綉椤靛浘鐗囨湭鍔犺浇瀹岋紱
      //   b) Word/WPS 澶嶅埗鑰屾潵 鈥斺€?HTML 閲?<img src="file:///..."> 娴忚鍣ㄦ棤娉曞姞杞斤級
      // 浠庣墖娈典腑绉婚櫎璇?<img>锛岄伩鍏嶆渶缁堢瑪璁伴噷鍑虹幇鐮村浘鍥炬爣銆?
      stats.failed += 1;
      img.remove();
      return;
    }
    const abs = toAbsolute(picked);
    if (abs && /^(https?:|data:|blob:)/i.test(abs)) {
      img.setAttribute("src", abs);
      // 椤烘墜娓呮帀 file:// 鐨?data-* 涓?srcset锛岄伩鍏嶅共鎵颁笅娓?
      img.removeAttribute("srcset");
      stats.rescued += 1;
    } else {
      stats.failed += 1;
      img.remove();
    }
  });

  // 5) Discuz 鎶?<img> 鍖呭湪 <ignore_js_op> 閲岋紙涓€涓?Discuz 鑷€犳爣绛撅紝
  //    PM schema 璁や笉鍑轰細琚涪锛岃繛甯?<img> 涓€璧蜂涪锛夈€傝繖閲屾妸瀹冩浛鎹负 <span>銆?
  root.querySelectorAll("ignore_js_op").forEach((el) => {
    const span = el.ownerDocument.createElement("span");
    while (el.firstChild) span.appendChild(el.firstChild);
    el.replaceWith(span);
  });

  return stats;
}

// ---------------------------------------------------------------------------
// isWordLikeHtml锛氬垽鏂壀璐存澘 HTML 鏄惁鏉ヨ嚜 Microsoft Word / WPS / Outlook
// ---------------------------------------------------------------------------
// Office 绯讳骇鍝佸湪鍐欏壀璐存澘 HTML 鏃舵湁闈炲父绋冲畾鐨?鎸囩汗"锛?
//   - <html xmlns:o="urn:schemas-microsoft-com:office:office"> 绛?Office 鍛藉悕绌洪棿
//   - CSS class 甯?Mso 鍓嶇紑锛圡soNormal銆丮soListParagraph 绛夛級
//   - 涓撴湁鏍囩锛?o:p>銆?v:shape>銆?v:imagedata>
//   - 娉ㄩ噴 "ProgId" 鎸囩ず MS Office HTML
//   - <img src="file:///..."> 鎸囧悜 Word 涓存椂鐩綍鐨勬湰鍦板浘鐗囷紙澶嶅埗鍒板叾浠栫▼搴忓悗涓嶅彲璁块棶锛?
//
// 璇嗗埆杩欎簺鏉ユ簮鏄负浜嗗湪鍥剧墖涓㈠け鏃剁粰鍑?*鏇存湁閽堝鎬?*鐨勬彁绀猴紝鍛婅瘔鐢ㄦ埛
// "Word 绮樿创甯︿笉杩囨潵鍥剧墖锛岃鏀圭敤瀵煎叆 Word 鏂囨。"銆?
// ---------------------------------------------------------------------------
function isWordLikeHtml(html: string): boolean {
  if (!html) return false;
  const head = html.slice(0, 4096); // 鎸囩汗鍩烘湰閮藉湪澶撮儴锛岄伩鍏嶆壂鍏ㄩ噺澶у潡
  return (
    /xmlns:o="urn:schemas-microsoft-com:office/i.test(head) ||
    /xmlns:w="urn:schemas-microsoft-com:office:word/i.test(head) ||
    /<meta[^>]+content=["']?[^"']*Microsoft[^"']*Word/i.test(head) ||
    /ProgId["']?\s*=?\s*["']?Word\.Document/i.test(head) ||
    /class=["'][^"']*Mso[A-Z]/i.test(html) ||
    /<o:p[\s>/]/i.test(html) ||
    /<v:imagedata\b/i.test(html) ||
    /<v:shape\b/i.test(html)
  );
}

// ---------------------------------------------------------------------------
// extractImagesFromRtf锛氫粠 Word/WPS 绮樿创鐨?RTF 閲屾彁鍙栧唴鑱斿浘鐗囥€?
//
// 鑳屾櫙锛歐ord 鍏ㄩ€夊鍒舵椂锛宼ext/html 閲岀殑 <img> src 閫氬父鏄?"file:///C:/Users/
// .../clip_image001.png" 绛夋湰鍦拌矾寰勶紙娴忚鍣ㄥ嚭浜庡畨鍏ㄩ檺鍒舵棤娉曞姞杞斤級锛岃€岀湡姝?
// 鐨勫浘鍍忎簩杩涘埗鏀惧湪鍚屾椂鎼哄甫鐨?text/rtf 涓紝浠?\pngblip 鎴?\jpegblip 寮€澶淬€?
// 鍚庤窡涓€澶ф鍗佸叚杩涘埗瀛楃銆佷互 `}` 缁撴潫銆傝吘璁枃妗?/ Google Docs 绮樿创鑳戒繚鐣?
// 鍥剧墖灏辨槸鍥犱负瀹冧滑瑙ｆ瀽浜?RTF 閫氶亾銆?
//
// 杩斿洖椤哄簭鐨?data URL 鏁扮粍锛屼笌 HTML 閲?<img> 鍑虹幇椤哄簭涓€涓€瀵瑰簲銆?
// ---------------------------------------------------------------------------
function hexToBase64(hex: string): string {
  // hex 瀛楃涓茶浆 Uint8Array 鍐嶈浆 base64銆傞噰鐢ㄥ垎鍧?String.fromCharCode
  // 閬垮厤涓€娆℃€?apply 瓒呭ぇ鏁扮粍鏍堟孩鍑恒€?
  const clean = hex.replace(/[^0-9a-fA-F]/g, "");
  const len = Math.floor(clean.length / 2);
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(
      null,
      Array.from(bytes.subarray(i, i + CHUNK))
    );
  }
  return btoa(binary);
}

function extractImagesFromRtf(rtf: string): string[] {
  const result: string[] = [];
  if (!rtf || rtf.length === 0) return result;
  // 浠?\pict 鍧椾负鍗曚綅鎵弿锛圵ord 姣忓紶鍥鹃兘鍖呭湪 {\pict ... } 閲岋級銆?
  // 姝ｅ垯璇存槑锛?
  //   \{\\\*?\\?pict      鍖归厤 "{\pict" 鎴?"{\*\pict"锛堝吋瀹归儴鍒嗗啓娉曪級
  //   [\s\S]*?            闈炶椽濠尮閰嶅潡鍐呭唴瀹?
  //   (\\pngblip|\\jpegblip)   鍥剧墖鏍煎紡鏍囪瘑
  //   ([\s\S]*?)          鎹曡幏鍗佸叚杩涘埗锛堝惈绌虹櫧鍜屾崲琛岋級
  //   \}                  鍧楃粨鏉?
  // 鐢ㄧ畝鍖栫増锛氱洿鎺ュ畾浣?\pngblip / \jpegblip锛岀劧鍚庡線鍚庤鍗佸叚杩涘埗鐩村埌閬囧埌
  // 闈?hex锛堥€氬父鏄?`}` 鎴栨帶鍒跺瓧锛夈€傝繖鏍峰宓屽 {} 瀹瑰繊搴︽洿楂樸€?
  const re = /\\(pngblip|jpegblip)[^}]*?([0-9a-fA-F\s]{32,})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rtf)) !== null) {
    const format = m[1] === "pngblip" ? "png" : "jpeg";
    const hex = m[2];
    try {
      const b64 = hexToBase64(hex);
      if (b64.length > 0) {
        result.push(`data:image/${format};base64,${b64}`);
      }
    } catch {
      /* 鍗曞紶鍥炬崯鍧忎笉褰卞搷鍏朵粬 */
    }
  }
  return result;
}

// 鎶?HTML 閲岀殑鍗犱綅 <img>锛坒ile:///銆乿:imagedata銆佺┖ src 绛夛級鎸夊嚭鐜伴『搴?
// 鏇挎崲鎴愪粠 RTF 鎻愬彇鍑烘潵鐨?data URL銆傝繑鍥炴浛鎹㈠悗鐨?HTML銆?
// 鑻?rtfImages 鏁伴噺灏戜簬 HTML 閲岀殑 <img>锛屽鍑烘潵鐨?<img> 淇濇寔鍘熸牱锛堣鍚庣画
// rescue 娴佺▼鍘绘竻鐞?/ 鏍囪涓?failed锛夈€?
function mergeRtfImagesIntoHtml(html: string, rtfImages: string[]): string {
  if (!rtfImages.length || !html) return html;
  try {
    const doc = new DOMParser().parseFromString(
      `<div id="__root">${html}</div>`,
      "text/html"
    );
    const root = doc.getElementById("__root");
    if (!root) return html;
    // Word 鏈夋椂浼氱敤 <v:imagedata src="file://..."/>锛圴ML锛夋壙杞藉浘鐗囧崰浣嶏紝
    // 杩欎簺鑺傜偣鏈韩涓嶆槸 <img>锛涗絾瀹冧滑閫氬父琚?<img> 鍖呰９鎴栦笌 <img> 鎴愬鍑虹幇銆?
    // 杩欓噷鍙寜椤哄簭鏇挎崲鏅€?<img> 鐨?src锛屽凡鑳借鐩?Word 鐨勪富娴佹儏鍐点€?
    const imgs = Array.from(root.querySelectorAll("img"));
    let cursor = 0;
    for (const img of imgs) {
      if (cursor >= rtfImages.length) break;
      const src = img.getAttribute("src") || "";
      // 鍙浛鎹?鏄剧劧鏃犳硶鍔犺浇"鐨勫崰浣嶏細file:///銆佺┖銆乿ml 鍗忚绛夈€?
      // 鑻?src 宸茬粡鏄?http/https/data/blob锛屼繚鐣欎笉鍔ㄣ€?
      const needReplace =
        !src ||
        /^file:\/\//i.test(src) ||
        /^about:/i.test(src) ||
        src.trim().length === 0;
      if (needReplace) {
        img.setAttribute("src", rtfImages[cursor]);
        cursor += 1;
      }
    }
    return root.innerHTML;
  } catch {
    return html;
  }
}

function normalizePastedHtmlForBlocks(html: string): { html: string; imageStats: RescueStats; isWordSource: boolean } {
  const empty: RescueStats = { total: 0, rescued: 0, failed: 0 };
  if (!html) return { html, imageStats: empty, isWordSource: false };
  const isWordSource = isWordLikeHtml(html);
  try {
    const doc = new DOMParser().parseFromString(`<div id="__root">${html}</div>`, "text/html");
    const root = doc.getElementById("__root");
    if (!root) return { html, imageStats: empty, isWordSource };

    // 0) 鍏堟姠鏁戝浘鐗囷細鎶?Discuz / 鎳掑姞杞界珯鐐逛腑钘忓湪 file/zoomfile/data-src
    //    绛夊睘鎬ч噷鐨?鐪熸鍥剧墖鍦板潃"鎻愬崌鍒?src锛屽苟琛ュ叏鐩稿璺緞锛?
    //    閬垮厤鍚庣画 PM DOMParser 鎶?src 鏄崰浣?/ 绌?/ 鐩稿璺緞"鐨?<img> 鑺傜偣涓㈡帀銆?
    const imageStats = rescuePastedImages(root);

    // 1) 椤跺眰 <div> 鐩存帴鏇挎崲涓?<p>锛堜繚鐣欏唴閮ㄥ唴鑱斿唴瀹癸級
    //    娉ㄦ剰鍙鐞?鐩存帴瀛愯妭鐐瑰眰"锛屼笉閫掑綊鏀瑰姩寮曠敤/琛ㄦ牸鍐呯殑 <div>銆?
    Array.from(root.children).forEach((child) => {
      if (child.tagName === "DIV") {
        const p = doc.createElement("p");
        while (child.firstChild) p.appendChild(child.firstChild);
        child.replaceWith(p);
      }
    });

    // 2) 閫掑綊閬嶅巻 block 鍏冪礌鍐呴儴锛?p>/<h1..h6>/<li>/<blockquote> 閲岃嫢鍑虹幇椤跺眰 <br>锛?
    //    灏辨寜 <br> 鍒囨垚澶氫釜鍚岀被鍨嬬殑鍏勫紵鑺傜偣锛堝 <p> 鏈€甯歌锛屽鏍囬涔熼€傜敤锛夈€?
    const splitByTopLevelBr = (el: Element) => {
      const brs = Array.from(el.children).filter((c) => c.tagName === "BR");
      if (brs.length === 0) return;
      const parent = el.parentNode;
      if (!parent) return;
      // 鏀堕泦姣忎竴娈靛唴瀹癸紙鎸?<br> 鍒囧垎鐨勫唴鑱旂墖娈碉級
      const groups: Node[][] = [[]];
      Array.from(el.childNodes).forEach((n) => {
        if (n.nodeType === 1 && (n as Element).tagName === "BR") {
          groups.push([]);
        } else {
          groups[groups.length - 1].push(n);
        }
      });
      // 涓㈡帀瀹屽叏绌虹櫧鐨勯/灏炬锛屼腑闂寸┖娈典繚鐣欎负绌烘钀斤紙绗﹀悎鐢ㄦ埛瑙嗚棰勬湡锛?
      while (groups.length && isWhitespaceGroup(groups[0])) groups.shift();
      while (groups.length && isWhitespaceGroup(groups[groups.length - 1])) groups.pop();
      if (groups.length <= 1) return; // 娌℃湁瀹為檯鍒囧垎鏁堟灉
      const frag = doc.createDocumentFragment();
      groups.forEach((nodes) => {
        const clone = doc.createElement(el.tagName.toLowerCase());
        // 鎷疯礉灞炴€э紙淇濈暀 class/style 绛夛級
        Array.from(el.attributes).forEach((a) => clone.setAttribute(a.name, a.value));
        nodes.forEach((n) => clone.appendChild(n));
        frag.appendChild(clone);
      });
      parent.replaceChild(frag, el);
    };

    const isWhitespaceGroup = (nodes: Node[]) =>
      nodes.every((n) => n.nodeType === 3 && !(n.nodeValue || "").trim());

    // 鍙媶椤跺眰 block锛?p> <h1..h6>锛岄伩鍏嶇牬鍧忓垪琛?琛ㄦ牸/浠ｇ爜鍧楀唴閮ㄧ粨鏋?
    const topBlocks = Array.from(root.querySelectorAll(":scope > p, :scope > h1, :scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > h6"));
    topBlocks.forEach(splitByTopLevelBr);

    return { html: root.innerHTML, imageStats, isWordSource };
  } catch (e) {
    // 寮傚父鏃朵笉闃诲绮樿创娴佺▼锛岃繑鍥炲師 HTML
    if (typeof console !== "undefined") console.warn("[normalizePastedHtmlForBlocks] failed:", e);
    return { html, imageStats: empty, isWordSource };
  }
}

// ---------------------------------------------------------------------------
// 鏅鸿兘 toggleHeading锛氬厛鎶婂綋鍓嶆钀介噷鐨?hardBreak 鎷嗘垚鐙珛娈佃惤锛屽啀 toggle
// ---------------------------------------------------------------------------
// 瀵瑰簲鐢ㄦ埛鍦烘櫙锛氳€佹暟鎹噷宸茬粡瀛樺湪"涓€涓?<p> + 澶氫釜 <br>"鐨勪吉澶氳娈佃惤銆?
// 鑻ョ敤鎴峰彧閫変腑鍏朵腑鍑犱釜瀛楃偣 H1锛屾湡鏈涘彧鎶婅繖涓€琛岃浆鎴愭爣棰橈紝鑰屼笉鏄暣娈点€?
//
// 绛栫暐锛?
//   1) 鎵惧埌閫夊尯鎵€瑕嗙洊鐨?paragraph 鑺傜偣鑼冨洿锛?
//   2) 瀵硅繖浜?paragraph 閲岀殑 hardBreak锛屼粠鍚庡線鍓嶉亶鍘嗭紙閬垮厤浣嶇疆鍋忕Щ闂锛夛紝
//      鍦?hardBreak 澶勬墽琛?split锛堟妸鍓嶅悗鍒囨垚涓や釜 paragraph锛夛紝骞跺垹闄?hardBreak
//      鑷韩锛?
//   3) split 瀹屾垚鍚庯紝鐢ㄦ埛鍏夋爣浼氳嚜鐒惰惤鍒颁粬鍘熸湰閫変腑鐨勯偅涓€琛屽搴旂殑鏂版钀介噷锛?
//   4) 鏈€鍚庤皟鐢ㄦ爣鍑?toggleHeading锛屽彧褰卞搷璇ユ銆?
//
// 濡傛灉鍘熸钀介噷娌℃湁 hardBreak锛岀洿鎺ヨ蛋鏍囧噯 toggleHeading锛堟棤鎬ц兘鎹熷け锛夈€?
// ---------------------------------------------------------------------------
function toggleHeadingSmart(editor: any, level: 1 | 2 | 3 | 4 | 5 | 6) {
  if (!editor || editor.isDestroyed) return;
  try {
    const { state } = editor;
    const hardBreakType = state.schema.nodes.hardBreak;
    if (!hardBreakType) {
      editor.chain().focus().toggleHeading({ level }).run();
      return;
    }
    const { from, to } = state.selection;

    // 鎵惧嚭閫夊尯瑕嗙洊鐨?鍧楃骇鏂囨湰鑺傜偣"锛坧aragraph / heading锛夌殑浣嶇疆鍖洪棿
    const blocks: Array<{ from: number; to: number }> = [];
    state.doc.nodesBetween(from, to, (node: any, pos: number) => {
      if (node.type.name === "paragraph" || node.type.name === "heading") {
        blocks.push({ from: pos, to: pos + node.nodeSize });
        return false; // 涓嶅啀娣卞叆锛坔ardBreak 鍦ㄥ彾瀛愬唴閮級
      }
      return true;
    });
    if (blocks.length === 0) {
      editor.chain().focus().toggleHeading({ level }).run();
      return;
    }

    // 鏀堕泦鎵€鏈夐渶瑕佹媶鐨?hardBreak 缁濆浣嶇疆锛堝€掑簭澶勭悊锛?
    const breakPositions: number[] = [];
    blocks.forEach((b) => {
      state.doc.nodesBetween(b.from, b.to, (node: any, pos: number) => {
        if (node.type === hardBreakType) breakPositions.push(pos);
      });
    });

    if (breakPositions.length === 0) {
      editor.chain().focus().toggleHeading({ level }).run();
      return;
    }

    // 鍊掑簭鎷嗗垎锛氬湪姣忎釜 hardBreak 澶?split paragraph 骞跺垹闄?hardBreak銆?
    // tr.delete(pos, pos+1) + tr.split(pos) 浼氭妸 hardBreak 鎵€鍦ㄤ綅缃垏鎴愪袱涓钀姐€?
    const tr = state.tr;
    // 鍦ㄦ湭搴旂敤涓棿浜嬪姟鏃讹紝鍚屼竴浠?doc 涓婃墍鏈変綅缃粛鐩稿绋冲畾锛涘€掑簭淇濊瘉鍓嶉潰浣嶇疆涓嶈褰卞搷銆?
    breakPositions.sort((a, b) => b - a);
    breakPositions.forEach((pos) => {
      // 鍒犻櫎 hardBreak锛? 涓綅缃級锛岀劧鍚庡湪鍘熶綅缃?split 鍒?paragraph 灞?
      tr.delete(pos, pos + 1);
      tr.split(pos);
    });
    editor.view.dispatch(tr);

    // split 鍚庡啀瑙﹀彂 toggleHeading锛氭鏃跺厜鏍囨墍鍦ㄦ钀藉氨鏄崟琛?
    editor.chain().focus().toggleHeading({ level }).run();
  } catch (e) {
    if (typeof console !== "undefined") console.warn("[toggleHeadingSmart] fallback:", e);
    editor.chain().focus().toggleHeading({ level }).run();
  }
}

// 鑷畾涔夌缉杩涙墿灞?
// 鏀寔娈佃惤銆佹爣棰樸€佸垪琛紙bullet / ordered / task锛夈€佸紩鐢ㄣ€佷唬鐮佸潡鏁翠綋鍋?鎵嬪姩缂╄繘"璋冩暣銆?
// 閫氳繃 data-indent 灞炴€?+ CSS 鐨?padding-left 瀹炵幇绾瑙夌缉杩涳紝涓嶇牬鍧忔枃妗ｇ粨鏋勩€?
const INDENT_MIN = 0;
const INDENT_MAX = 8;
const INDENTABLE_TYPES = [
  "paragraph",
  "heading",
  "blockquote",
  "codeBlock",
  "bulletList",
  "orderedList",
  "taskList",
] as const;

const IndentExtension = Extension.create({
  name: "indent",
  addGlobalAttributes() {
    return [
      {
        types: [...INDENTABLE_TYPES],
        attributes: {
          indent: {
            default: 0,
            parseHTML: (element) => parseInt(element.getAttribute("data-indent") || "0", 10),
            renderHTML: (attributes) => {
              if (!attributes.indent || attributes.indent === 0) return {};
              return { "data-indent": attributes.indent };
            },
          },
        },
      },
    ];
  },
  addCommands() {
    return {
      // 瀵归€夊尯瑕嗙洊鐨勫彲缂╄繘鍧楁寜 delta 璋冩暣 indent锛堥檺鍒?0..INDENT_MAX锛?
      changeIndent: (delta: number) => ({ state, tr, dispatch }: any) => {
        const { from, to } = state.selection;
        let changed = false;
        state.doc.nodesBetween(from, to, (node: any, pos: number) => {
          if (!(INDENTABLE_TYPES as readonly string[]).includes(node.type.name)) return;
          const current = (node.attrs as any).indent || 0;
          const next = Math.max(INDENT_MIN, Math.min(INDENT_MAX, current + delta));
          if (next === current) return;
          tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: next });
          changed = true;
        });
        if (changed && dispatch) dispatch(tr);
        return changed;
      },
    } as any;
  },
});

/**
 * 閿洏鎵╁睍锛?
 *   - Tab / Shift-Tab锛氭櫤鑳界缉杩?鈥斺€?浠ｇ爜鍧楀唴鎻掔┖鏍硷紱鍒楄〃鍐?sink/lift锛涜〃鏍煎唴鐢?tiptap-table 澶勭悊锛涘叾浣欒皟鍧楃骇 indent銆?
 *   - Mod-s锛氱珛鍗充繚瀛橈紙鐢卞閮ㄩ€氳繃 ref 娉ㄥ叆 flush 鍑芥暟锛夈€?
 */
function createKeyboardExtension(flushSaveRef: React.MutableRefObject<() => void>) {
  return Extension.create({
    name: "nowenKeyboard",
    addKeyboardShortcuts() {
      const editor = this.editor as any;

      const isInCodeBlock = () => editor.isActive("codeBlock");
      const isInTable = () => editor.isActive("table");
      const isInTaskList = () => editor.isActive("taskList") || editor.isActive("taskItem");
      const isInBulletOrOrdered = () =>
        editor.isActive("bulletList") || editor.isActive("orderedList") || editor.isActive("listItem");

      const handleTab = (delta: 1 | -1) => {
        // 琛ㄦ牸锛氫氦缁?tiptap-table 榛樿鐨?goToNextCell/goToPreviousCell
        if (isInTable()) return false;

        // 浠ｇ爜鍧楋細鎻掑叆 / 鍒犻櫎 2 涓┖鏍?
        if (isInCodeBlock()) {
          if (delta === 1) {
            editor.chain().focus().insertContent("  ").run();
            return true;
          } else {
            // Shift+Tab锛氳嫢鍏夋爣鍓嶆湁鑷冲 2 涓┖鏍煎垯鍒犳帀
            const { state } = editor;
            const { from, empty } = state.selection;
            if (!empty) return false;
            const before = state.doc.textBetween(Math.max(0, from - 2), from, "\n", "\n");
            const strip = before.endsWith("  ") ? 2 : before.endsWith(" ") ? 1 : 0;
            if (strip === 0) return true; // 闃绘榛樿琛屼负浣嗕笉鍒?
            editor.chain().focus().deleteRange({ from: from - strip, to: from }).run();
            return true;
          }
        }

        // 浠诲姟鍒楄〃 / 鏅€氬垪琛細sink / lift
        if (isInTaskList()) {
          const ok = delta === 1
            ? editor.chain().focus().sinkListItem("taskItem").run()
            : editor.chain().focus().liftListItem("taskItem").run();
          if (ok) return true;
          // 鑻ユ棤娉?sink/lift锛堜緥濡傚凡鏄渶澶栧眰锛夛紝閫€鍖栦负鍧楃骇 indent
        } else if (isInBulletOrOrdered()) {
          const ok = delta === 1
            ? editor.chain().focus().sinkListItem("listItem").run()
            : editor.chain().focus().liftListItem("listItem").run();
          if (ok) return true;
        }

        // 鍏朵綑锛氳皟鏁村潡绾?indent 灞炴€?
        return editor.chain().focus().changeIndent(delta).run();
      };

      // 鍒楄〃椤瑰唴 Enter锛氱┖椤?lift 璺冲嚭锛岄潪绌洪」 split 鍑烘柊椤广€?
      // 鏄惧紡鎺ョ鍏ㄩ儴鍒嗘敮锛堜笉渚濊禆 listItem 鍐呯疆 keymap fallthrough锛夛紝
      // 閬垮厤 tiptap 澶?keymap plugin 椤哄簭 / IndentExtension 鍏ㄥ眬灞炴€?
      // 骞叉壈涓嬪嚭鐜般€岃緭鍏ュ唴瀹逛篃琚竴娆″洖杞﹁烦鍑哄垪琛ㄣ€嶇殑璇″紓琛屼负銆?
      const handleEnterInListItem = () => {
        const { state } = editor;
        const { selection } = state;
        if (!selection.empty) return false;
        const $from = selection.$from;
        // 鑷笅寰€涓婃壘鏈€杩戠殑 listItem / taskItem
        for (let depth = $from.depth; depth > 0; depth--) {
          const node = $from.node(depth);
          const typeName = node.type.name;
          if (typeName !== "listItem" && typeName !== "taskItem") continue;
          // 鍒ゅ畾銆岀┖ li銆嶏細鍗曟钀?+ 鏃犳枃鏈?+ 娈佃惤鍐呭灏哄涓?0
          const isEmpty =
            node.childCount === 1 &&
            node.textContent === "" &&
            !!node.firstChild &&
            node.firstChild.content.size === 0;
          if (isEmpty) {
            return editor.chain().focus().liftListItem(typeName).run();
          }
          // 闈炵┖ li锛氭樉寮?split锛屽苟寮哄埗 return true 闃绘鍚庣画 keymap 鍐嶈Е鍙戜竴娆°€?
          return editor.chain().focus().splitListItem(typeName).run();
        }
        return false;
      };

      return {
        Backspace: () => {
          const { state } = editor;
          const { selection } = state;
          if (!selection.empty) return false;
          const { $from } = selection;
          if ($from.parentOffset !== 0) return false;
          const parent = $from.parent;
          const parentType = parent.type.name;
          // 琛岄 Backspace锛氳嫢鏈?indent > 0 鍒欏厛鍑忕缉杩?
          const currentIndent = (parent.attrs as any).indent || 0;
          if (currentIndent > 0) {
            return (editor as any).chain().focus().changeIndent(-1).run();
          }
          // heading 鈫?paragraph
          if (parentType === "heading") {
            const paragraphType = state.schema.nodes.paragraph;
            if (!paragraphType) return false;
            const depth = $from.depth;
            const tr = state.tr.setBlockType($from.before(depth), $from.after(depth), paragraphType);
            editor.view.dispatch(tr.scrollIntoView());
            return true;
          }
          return false;
        },
        Tab: () => handleTab(1),
        "Shift-Tab": () => handleTab(-1),
        Enter: () => handleEnterInListItem(),
        "Mod-s": () => {
          flushSaveRef.current?.();
          return true; // 杩斿洖 true 闃绘娴忚鍣ㄩ粯璁ょ殑"淇濆瓨缃戦〉"瀵硅瘽妗?
        },
      };
    },
  });
}

/**
 * 澶х翰/璺宠浆鏉＄洰锛氱洿鎺ュ鐢ㄥ叡浜殑 NoteEditorHeading銆?
 * 淇濈暀 `HeadingItem` 鍚嶅瓧渚涘巻鍙?`import { HeadingItem } from "./TiptapEditor"` 鐨勫紩鐢ㄣ€?
 */
export type HeadingItem = NoteEditorHeading;

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
  title?: string;
  compact?: boolean;
}

function ToolbarButton({ onClick, isActive, disabled, children, title, compact }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={cn(
        compact ? "p-1 rounded-md transition-colors" : "p-1.5 rounded-md transition-colors",
        isActive
          ? "bg-accent-primary/20 text-accent-primary"
          : "text-tx-secondary hover:bg-app-hover hover:text-tx-primary",
        disabled && "opacity-30 cursor-not-allowed"
      )}
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <div className="w-px h-5 bg-app-border mx-1" />;
}

/**
 * 瀛楀彿閫夋嫨鍣紙杞婚噺 Popover锛?
 * - 4 涓璁炬。浣?+ 鑷畾涔?px 杈撳叆锛?-96锛?
 * - "娓呴櫎"锛氱Щ闄ゅ綋鍓嶉€夊尯鐨?fontSize 灞炴€?
 * - 閫氳繃 onMouseDown preventDefault 闃叉缂栬緫鍣?blur锛屼繚璇?setMark 鍚庨€夊尯杩樺湪
 */
interface FontSizePopoverProps {
  editor: any;
  iconSize?: number;
  /** 浠呯敤浜庢皵娉¤彍鍗曪紝UI 绱у噾涓€浜?*/
  compact?: boolean;
}
function FontSizePopover({ editor, iconSize = 15, compact = false }: FontSizePopoverProps) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const ref = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const currentSize: string | null = editor.getAttributes("textStyle")?.fontSize || null;

  // 鎵撳紑鏃跺熀浜庢寜閽綅缃绠楀脊灞傚潗鏍囷紙fixed 瀹氫綅锛岄伩鍏嶈宸ュ叿鏍?overflow-x-auto 瑁佸垏锛?
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const update = () => {
      const r = btnRef.current!.getBoundingClientRect();
      const POP_W = 176; // w-44
      let left = r.left;
      if (left + POP_W > window.innerWidth - 8) left = window.innerWidth - POP_W - 8;
      if (left < 8) left = 8;
      setPos({ top: r.bottom + 4, left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  // 鐐瑰嚮澶栭儴鍏抽棴锛堝悓鏃惰€冭檻鎸夐挳鍜屽脊灞備袱涓尯鍩燂級
  useEffect(() => {
    if (!open) return;
    const onInteract = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      if ((t as Element)?.closest?.('[data-popover]')) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onInteract, true);
    return () => document.removeEventListener("mousedown", onInteract, true);
  }, [open]);

  const apply = (size: string) => {
    if (!size) return;
    editor.chain().focus().setFontSize(size).run();
    setOpen(false);
  };
  const clear = () => {
    editor.chain().focus().unsetFontSize().run();
    setOpen(false);
  };
  const applyCustom = () => {
    const raw = custom.trim();
    if (!raw) return;
    // 鐢ㄦ埛鍙緭浜嗘暟瀛?鈫?榛樿 px
    const size = /^\d+(\.\d+)?$/.test(raw) ? `${raw}px` : raw;
    apply(size);
    setCustom("");
  };

  const btnSize = compact ? 14 : iconSize;
  return (
    <div ref={ref} className="relative" onMouseDown={(e) => e.preventDefault()}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`${currentSize ? `瀛楀彿: ${currentSize}` : "瀛楀彿"}`}
        className={cn(
          "p-1.5 rounded-md transition-colors flex items-center gap-0.5",
          currentSize
            ? "bg-accent-primary/20 text-accent-primary"
            : "text-tx-secondary hover:bg-app-hover hover:text-tx-primary",
        )}
      >
        <Type size={btnSize} />
        <ChevronDown size={10} className="opacity-60" />
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          style={{ position: "fixed", top: pos.top, left: pos.left }}
          className="z-[100] w-52 p-2 rounded-lg shadow-lg bg-app-elevated border border-app-border"
          data-popover=""
          onMouseDown={(e) => e.preventDefault()}
        >
          <div className="text-[11px] text-tx-tertiary px-1 pb-1">棰勮</div>
          <div className="grid grid-cols-2 gap-1">
            {FONT_SIZE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => apply(p.value)}
                className={cn(
                  "px-2 py-1 rounded text-left hover:bg-app-hover flex items-baseline gap-1.5",
                  currentSize === p.value && "bg-accent-primary/15 text-accent-primary",
                )}
              >
                {/* 寮瑰眰鍐呯粺涓€瀛楀彿锛岄伩鍏?24px"瓒呭ぇ"鎾戠牬甯冨眬锛涢瑙堟晥鏋滃湪缂栬緫鍖哄憟鐜?*/}
                <span className="text-[13px] font-medium leading-tight">{p.label}</span>
                <span className="text-[10px] text-tx-tertiary">{p.value}</span>
              </button>
            ))}
          </div>
          <div className="text-[11px] text-tx-tertiary px-1 pt-2 pb-1">鑷畾涔?(8鈥?6 px)</div>
          <div className="flex gap-1">
            <input
              type="text"
              inputMode="numeric"
              placeholder="濡?18 鎴?18px"
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  applyCustom();
                }
              }}
              // 闃绘鍐掓场鍒板脊灞傛牴 div 鐨?onMouseDown preventDefault锛?
              // 鍚﹀垯娴忚鍣ㄨ涓?mousedown 榛樿琛屼负琚彇娑堬紝input 涓嶄細鑾峰緱 focus锛?
              // 琛ㄧ幇涓?杈撳叆妗嗘墦涓嶈繘瀛?銆?
              onMouseDown={(e) => e.stopPropagation()}
              className="flex-1 px-2 py-1 text-xs rounded border border-app-border bg-app-surface focus:outline-none focus:ring-1 focus:ring-accent-primary"
            />
            <button
              type="button"
              onClick={applyCustom}
              className="px-2 py-1 text-xs rounded bg-accent-primary text-white hover:opacity-90"
            >
              <Check size={12} />
            </button>
          </div>
          <div className="border-t border-app-border my-2" />
          <button
            type="button"
            onClick={clear}
            className="w-full px-2 py-1 text-xs rounded text-tx-secondary hover:bg-app-hover flex items-center gap-1"
          >
            <Eraser size={12} />
            娓呴櫎瀛楀彿
          </button>
        </div>,
        document.body,
      )}
    </div>
  );
}

/**
 * 棰滆壊 / 楂樹寒閫夋嫨鍣紙鍙?Tab锛?
 * - 鍓嶆櫙鑹诧細鍩轰簬 TextStyle + Color 鎵╁睍锛坰etColor / unsetColor锛?
 * - 鑳屾櫙鑹诧細鍩轰簬 Highlight multicolor 鎵╁睍锛坰etHighlight {color} / unsetHighlight锛?
 * - 12 鑹?swatch + <input type="color"> 鑷畾涔?
 */
interface ColorPopoverProps {
  editor: any;
  iconSize?: number;
  compact?: boolean;
}
function ColorPopover({ editor, iconSize = 15, compact = false }: ColorPopoverProps) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"fg" | "bg">("fg");
  const ref = useRef<HTMLDivElement | null>(null);
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const fgColor: string | null = editor.getAttributes("textStyle")?.color || null;
  const bgColor: string | null = editor.getAttributes("highlight")?.color || null;
  const isActive = !!fgColor || !!bgColor;

  // 鎵撳紑鏃跺熀浜庢寜閽綅缃绠楀脊灞傚潗鏍囷紙fixed 瀹氫綅锛岀粫杩囧伐鍏锋爮 overflow-x-auto 瑁佸垏锛?
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const update = () => {
      const r = btnRef.current!.getBoundingClientRect();
      const POP_W = 224; // w-56
      let left = r.left;
      if (left + POP_W > window.innerWidth - 8) left = window.innerWidth - POP_W - 8;
      if (left < 8) left = 8;
      setPos({ top: r.bottom + 4, left });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onInteract = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (popRef.current?.contains(t)) return;
      if ((t as Element)?.closest?.('[data-popover]')) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onInteract, true);
    return () => document.removeEventListener("mousedown", onInteract, true);
  }, [open]);

  const applyColor = (c: string) => {
    if (tab === "fg") editor.chain().focus().setColor(c).run();
    else editor.chain().focus().setHighlight({ color: c }).run();
  };
  const clearColor = () => {
    if (tab === "fg") editor.chain().focus().unsetColor().run();
    else editor.chain().focus().unsetHighlight().run();
  };

  const swatches = tab === "fg" ? COLOR_PRESETS : HIGHLIGHT_PRESETS;
  const current = tab === "fg" ? fgColor : bgColor;
  const btnSize = compact ? 14 : iconSize;

  return (
    <div ref={ref} className="relative" onMouseDown={(e) => e.preventDefault()}>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={isActive ? `棰滆壊: ${fgColor || ""} ${bgColor ? "鑳屾櫙: " + bgColor : ""}`.trim() : "棰滆壊"}
        className={cn(
          "p-1.5 rounded-md transition-colors flex items-center gap-0.5",
          isActive
            ? "bg-accent-primary/20 text-accent-primary"
            : "text-tx-secondary hover:bg-app-hover hover:text-tx-primary",
        )}
      >
        <span className="relative inline-flex items-center">
          <Palette size={btnSize} />
          {/* 褰撳墠鑹叉彁绀烘í鏉?*/}
          <span
            className="absolute -bottom-0.5 left-0 right-0 h-0.5 rounded-full"
            style={{ background: fgColor || "transparent" }}
          />
        </span>
        <ChevronDown size={10} className="opacity-60" />
      </button>
      {open && createPortal(
        <div
          ref={popRef}
          style={{ position: "fixed", top: pos.top, left: pos.left }}
          className="z-[100] w-56 p-2 rounded-lg shadow-lg bg-app-elevated border border-app-border"
          data-popover=""
          onMouseDown={(e) => e.preventDefault()}
        >
          {/* Tab */}
          <div className="flex gap-1 mb-2 p-0.5 rounded bg-app-surface">
            <button
              type="button"
              onClick={() => setTab("fg")}
              className={cn(
                "flex-1 px-2 py-1 text-xs rounded transition-colors",
                tab === "fg" ? "bg-app-elevated shadow-sm" : "text-tx-tertiary hover:text-tx-primary",
              )}
            >
              鏂囧瓧
            </button>
            <button
              type="button"
              onClick={() => setTab("bg")}
              className={cn(
                "flex-1 px-2 py-1 text-xs rounded transition-colors",
                tab === "bg" ? "bg-app-elevated shadow-sm" : "text-tx-tertiary hover:text-tx-primary",
              )}
            >
              鑳屾櫙
            </button>
          </div>
          {/* Swatches */}
          <div className="grid grid-cols-6 gap-1.5">
            {swatches.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => applyColor(c)}
                title={c}
                className={cn(
                  "w-7 h-7 rounded border transition-transform hover:scale-110",
                  current?.toLowerCase() === c.toLowerCase()
                    ? "border-accent-primary ring-2 ring-accent-primary/40"
                    : "border-app-border",
                )}
                style={{ background: c }}
              />
            ))}
          </div>
          {/* 鑷畾涔夐鑹?*/}
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={() => { const el = document.querySelector('input[type="color"]'); el?.click(); }}
              className="flex items-center gap-1.5 px-2 py-1 text-xs rounded border border-app-border hover:bg-app-hover"
            >
              <input
                type="color"
                value={current || (tab === "fg" ? "#ef4444" : "#fef9c3")}
                onChange={(e) => applyColor(e.target.value)}
                className="sr-only"
              />
              <Palette size={12} className="text-tx-secondary" />
            </button>
            <button
              type="button"
              onClick={clearColor}
              className="ml-auto px-2 py-1 text-xs rounded text-tx-secondary hover:bg-app-hover flex items-center gap-1"
            >
              <Eraser size={12} />
              娓呴櫎
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

/**
 * TiptapEditor props 濂戠害锛氬畬鍏ㄧ户鎵?NoteEditorProps锛屼繚璇佸拰 MarkdownEditor 100% 瀵归綈銆?
 * 鑻ラ渶瑕?Tiptap 鐙湁鐨?prop锛岃鍦ㄦ澶?extends 鎵╁睍锛岃€岄潪鍙﹁捣鐐夌伓銆?
 */
type TiptapEditorProps = NoteEditorProps;

function extractHeadings(editor: any): HeadingItem[] {
  const headings: HeadingItem[] = [];
  const doc = editor.state.doc;
  let idx = 0;
  doc.descendants((node: any, pos: number) => {
    if (node.type.name === "heading") {
      headings.push({
        id: `h-${idx++}`,
        level: node.attrs.level,
        text: node.textContent || "",
        pos,
      });
    }
  });
  return headings;
}

export default forwardRef<NoteEditorHandle, TiptapEditorProps>(function TiptapEditor(
  { note, onUpdate, onTagsChange, onHeadingsChange, onEditorReady, editable = true, isGuest = false },
  ref,
) {
  const titleRef = useRef<HTMLInputElement>(null);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  // P0-1: 鏍囬 debounce 鐙珛 timer銆?
  //   鏃у疄鐜?handleTitleChange 澶嶇敤 debounceTimer锛屽鑷达細
  //     1) 鐢ㄦ埛鏁插唴瀹?500ms 鍐呮敼鏍囬 鈫?鍐呭鐨?debounce 琚?clearTimeout 娓呮帀锛?
  //        鏍囬淇濆瓨 payload 閲岃櫧鐒跺甫浜嗗綋鍓?editor.getJSON()锛屼絾**娌℃湁鏇存柊**
  //        lastEmittedContentRef銆?
  //     2) PUT 鍥炲寘 setActiveNote 鈫?useEffect([note.id, note.content]) 瑙﹀彂锛?
  //        鑷啓瀹堝崼鍥?lastEmittedContentRef 鏈悓姝ヨ€?*鏈懡涓?* 鈫?璧?setContent
  //        鈫?缂栬緫鍣?DOM 閲嶅缓 鈫?鐢ㄦ埛缁х画鍦ㄦ墦鐨勫瓧琚埅鏂?鍥為€€銆?
  //   鐙珛 timer 鍚庡唴瀹?debounce 涓嶅啀琚爣棰樹慨鏀规墦鏂紱鏍囬淇濆瓨鍙彂 { title }锛?
  //   鍐呭瀛楁鐓у父鐢?onUpdate 鐨?content debounce 淇濆瓨銆?
  const titleDebounceTimer = useRef<NodeJS.Timeout | null>(null);
  const [wordStats, setWordStats] = useState({ chars: 0, charsNoSpace: 0, words: 0 });
  const [showAI, setShowAI] = useState(false);
  const [aiSelectedText, setAiSelectedText] = useState("");
  const [aiPosition, setAiPosition] = useState<{ top: number; left: number } | undefined>();
  // 鍐呭祵闄勪欢棰勮锛氱偣缂栬緫鍣ㄩ噷 馃搸 闄勪欢閾炬帴 鈫?鍙充晶鎶藉眽鏄剧ず闄勪欢璇︽儏銆?
  // 閲囩敤 attachmentId 璧?api.files.get 鎷垮畬鏁磋鎯咃紙鍖呭惈澶栭摼鍒嗕韩 / 閲嶅懡鍚?/ 寮曠敤鍒楄〃锛夛紝
  // 涓庢枃浠剁鐞嗘娊灞変綋楠屼竴鑷淬€?
  // - id锛氫粠 /api/attachments/<uuid> 鎶犲嚭銆?
  // - isDocx锛歞ocx 璧颁腑杞覆鏌擄紙鏀寔涓婁紶鏂扮増鏈級锛涘叾浠栬蛋榛樿 AttachmentPreview銆?
  const [attachmentPreview, setAttachmentPreview] = useState<
    { id: string; isDocx: boolean; filename: string } | null
  >(null);  // 鍥剧墖棰勮鐘舵€?
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [imageZoom, setImageZoom] = useState(1);
  const [imageDrag, setImageDrag] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  // 缂栬緫鍣ㄦ槸鍚﹁仛鐒?鈥斺€?鐢ㄦ潵鎺у埗绉诲姩绔诞鍔ㄥ伐鍏锋爮鏄惁鏄剧ず
  // 锛堟湭鑱氱劍鏃堕敭鐩樺叾瀹炲凡缁忔敹璧凤紝杩欓噷鏄弻閲嶄繚闄╋細閬垮厤鑱氱劍鍒版爣棰樻爮鏃惰鏄剧ず锛?

  // 绉诲姩绔蒋閿洏鏄惁寮硅捣锛涚敤浜庡湪鍘熺敓 + 閿洏寮硅捣鏃堕殣钘忛《閮ㄥ伐鍏锋爮锛堣蛋搴曢儴娴姩宸ュ叿鏍忥級

  const dragStart = useRef({ x: 0, y: 0, imgX: 0, imgY: 0 });
  const { t, i18n } = useTranslation();

  // ---------- 閫夊尯姘旀场鑿滃崟锛堝垝璇嶅脊鍑猴級 ----------
  // 鎵嬪姩瀹炵幇锛屼笉渚濊禆 Tiptap 鍐呯疆 BubbleMenu锛坴3 涓嬫湁 overflow-auto 瑁佸壀闂锛?
  const [bubble, setBubble] = useState<{ open: boolean; top: number; left: number }>({
    open: false, top: 0, left: 0,
  });
  // 鍥剧墖閫変腑鏃剁殑蹇嵎灏哄姘旀场
  const [imageBubble, setImageBubble] = useState<{ open: boolean; top: number; left: number }>({
    open: false, top: 0, left: 0,
  });
  // 鍏夋爣鍦ㄨ〃鏍煎唴鏃剁殑琛ㄦ牸鎿嶄綔姘旀场锛堝悎骞?鎷嗗垎/澧炲垹琛屽垪绛夛級
  // 涓庢枃鏈?鍥剧墖姘旀场浜掓枼锛氶€変腑鍥剧墖鎴栭€変腑闈炵┖鏂囨湰鏃朵笉鏄剧ず琛ㄦ牸姘旀场
  const [tableBubble, setTableBubble] = useState<{ open: boolean; top: number; left: number }>({
    open: false, top: 0, left: 0,
  });
  // 璋冩暣琛ㄦ牸灏哄瀵硅瘽妗嗭細鎸夎鍒楀樊鍊艰皟鐢?addRow/deleteRow + addColumn/deleteColumn
  // initialRows/Cols 鏄墦寮€瀵硅瘽妗嗘椂鐨勫綋鍓嶈〃鏍煎昂瀵?
  const [resizeDialog, setResizeDialog] = useState<{ open: boolean; rows: number; cols: number }>({
    open: false, rows: 3, cols: 3,
  });
  // 鍏夋爣鍋滃湪閾炬帴鍐咃紙涓旀棤閫夊尯锛夋椂娴嚭鐨勯摼鎺ユ皵娉★細鎵撳紑 / 缂栬緫 / 鍙栨秷閾炬帴
  // 涓?bubble锛堟枃鏈€夊尯鏍煎紡鍖栵級浜掓枼鈥斺€旈€夊尯鏈夊唴瀹规椂浼樺厛鏄剧ず鏂囨湰姘旀场銆?
  // 閾炬帴姘旀场锛氶檮浠堕摼鎺ワ紙href 褰㈠ /api/attachments/<id>锛夐渶瑕佸崟鐙殑涓嬭浇浜や簰锛?
  // 鍥犳鎶?filename 涓€骞跺瓨杩涙潵鈥斺€斾笅杞芥椂缁欐祻瑙堝櫒涓€涓弸濂界殑鏂囦欢鍚嶏紝鍚﹀垯浼氱敤
  // URL 鏈熬鐨?uuid 褰撴枃浠跺悕銆俧ilename 鍙栬嚜 <a download="..."> DOM 灞炴€с€?
  // source 鍖哄垎姘旀场瑙﹀彂鏉ユ簮锛?
  //   - "caret"锛氬厜鏍囧仠鍦ㄩ摼鎺ラ噷锛坰electionUpdate 瑙﹀彂锛夛紝璺熼殢鍏夋爣锛宐lur 鏃跺叧
  //   - "hover"锛氶紶鏍囨偓鍋滃湪閾炬帴涓婏紙mouseover 瑙﹀彂锛夛紝涓嶄緷璧?focus锛岄紶鏍囩寮€ + 寤惰繜鎵嶅叧
  // 鍖哄垎鐨勭洰鐨勬槸璁╀袱鏉¤Е鍙戦摼璺簰涓嶅共鎵帮細hover 绂诲紑涓嶈兘鍏虫帀鍏夋爣鍋滅暀鐨勬皵娉★紝
  // 鍙嶄箣 blur 涓嶈兘鍏虫帀榧犳爣姝ｅ湪 hover 鐨勬皵娉°€?
  // from/to 锛氳 link mark 鍦ㄦ枃妗ｉ噷鐨勮捣姝綅缃€傚姩浣滄寜閽紙鍙栨秷閾炬帴/缂栬緫閾炬帴锛?
  // 鐐瑰嚮鏃跺厛 setTextSelection({from,to}) 鎵嶈兘璁?extendMarkRange("link") 鐢熸晥鈥斺€?
  // 鍚﹀垯 hover 瑙﹀彂鏃跺厜鏍囧彲鑳戒笉鍦ㄩ摼鎺ラ噷锛寀nsetLink 浼氶潤榛樺け璐ャ€?
  const [linkBubble, setLinkBubble] = useState<{
    open: boolean; top: number; left: number; href: string; filename: string;
    source: "caret" | "hover"; from: number; to: number;
  }>({
    open: false, top: 0, left: 0, href: "", filename: "", source: "caret", from: 0, to: 0,
  });
  // hover 鍏抽棴寤惰繜瀹氭椂鍣細鐢ㄦ埛浠庨摼鎺ョЩ鍒版皵娉′笂鏃剁粰涓€涓紦鍐诧紝閬垮厤绌胯繃绌洪殭鏃堕棯鐑?
  const linkHoverCloseTimer = useRef<NodeJS.Timeout | null>(null);

  // 鏂滄潬鍛戒护浜嬩欢澶勭悊鍣紙绋冲畾寮曠敤锛?
  const slashHandlers = useRef(createSlashEventHandlers());
  const slashExtension = useRef(
    createSlashExtension(
      slashHandlers.current.onActivate,
      slashHandlers.current.onDeactivate,
      slashHandlers.current.onQueryChange,
    )
  );

  // Markdown 绮樿创鎻愮ず toast
  // "confirm" 鍙樹綋锛氭娴嬪埌 MD 璇硶鍚庤闂敤鎴锋槸鍚﹁浆鎹紝鎼哄甫 action 鎸夐挳鍥炶皟
  type PasteToastState =
    | { type: "converting" | "success" | "error"; message: string }
    | { type: "confirm"; message: string; actionLabel: string; onAction: () => void };
  const [pasteToast, setPasteToast] = useState<PasteToastState | null>(null);
  const pasteToastTimer = useRef<NodeJS.Timeout | null>(null);

  const showPasteToast = useCallback((type: "converting" | "success" | "error", message: string, duration = 2500) => {
    if (pasteToastTimer.current) clearTimeout(pasteToastTimer.current);
    setPasteToast({ type, message });
    if (type !== "converting") {
      pasteToastTimer.current = setTimeout(() => setPasteToast(null), duration);
    }
  }, []);

  // confirm 鍙樹綋涓撶敤锛? 绉掕嚜鍔ㄦ秷澶憋紝鐐规寜閽垨 脳 绔嬪嵆鍏抽棴
  const showPasteConfirmToast = useCallback(
    (message: string, actionLabel: string, onAction: () => void, duration = 8000) => {
      if (pasteToastTimer.current) clearTimeout(pasteToastTimer.current);
      setPasteToast({ type: "confirm", message, actionLabel, onAction });
      pasteToastTimer.current = setTimeout(() => setPasteToast(null), duration);
    },
    []
  );

  const dismissPasteToast = useCallback(() => {
    if (pasteToastTimer.current) clearTimeout(pasteToastTimer.current);
    setPasteToast(null);
  }, []);

  const editorScrollRef = useRef<HTMLDivElement | null>(null);
  // 闃叉 setContent 瑙﹀彂 onUpdate 瀵艰嚧鏃犻檺寰幆
  const isSettingContent = useRef(false);
  // 淇濇寔鏈€鏂扮殑 note ref锛岄伩鍏嶉棴鍖呭紩鐢ㄨ繃鏈?
  const noteRef = useRef(note);
  noteRef.current = note;
  // 淇濇寔鏈€鏂扮殑 onUpdate ref
  const onUpdateRef = useRef(onUpdate);
  onUpdateRef.current = onUpdate;

  /**
   * 鏈紪杈戝櫒鏈€杩戜竴娆℃淳鍙戠粰 onUpdate 鐨?content 瀛楃涓层€?
   *
   * 浣滅敤锛氱埗绾?EditorPane 淇濆瓨鎴愬姛鍚庝細鎶?`content` 鍥炲～鍒?`activeNote`锛?
   * 杩欎細璁╂湰缁勪欢鐨?`note.content` 寮曠敤鍙樺寲骞惰Е鍙?
   * `useEffect([note.id, note.content])` 鍘?setContent 鈥斺€?濡傛灉鎭板ソ setContent
   * 鐨勫氨鏄?鑷繁鍒氭淳鍑哄幓鐨勯偅浠?锛屾病鏈夋剰涔変笖鍙兘鎵撴柇姝ｅ湪缁х画杈撳叆鐨勭敤鎴枫€?
   *
   * 瀹堝崼绛栫暐锛?
   *   - onUpdate 娲惧嚭鍓嶆妸 JSON 璁板埌杩欓噷
   *   - 鍚屾 effect 閲屽厛姣斿锛歯ote.content === lastEmittedContentRef.current 灏辫烦杩?
   *   - 鍏朵粬鏉ユ簮锛圡D 缂栬緫鍣ㄤ繚瀛樸€佺増鏈仮澶嶃€佸垏鎹㈢瑪璁帮級鐨勫彉鍖栦笉浼氱瓑浜庤繖涓€硷紝
   *     璧版甯?setContent 璺緞
   */
  const lastEmittedContentRef = useRef<string | null>(null);

  // 绔嬪嵆淇濆瓨锛圕trl/Cmd+S 浣跨敤锛夛細娓呮帀 debounce 骞剁珛鍒昏皟鐢?onUpdate
  const flushSaveRef = useRef<() => void>(() => {});

  // 绋冲畾鐨勯敭鐩樻墿灞曞紩鐢紙Tab/Shift-Tab/Mod-s锛?
  const keyboardExtension = useRef(createKeyboardExtension(flushSaveRef));

  const computeStats = useCallback((text: string) => {
    const chars = text.length;
    const charsNoSpace = text.replace(/\s/g, "").length;
    // 涓枃鎸夊瓧璁℃暟 + 鑻辨枃鎸夌┖鏍煎垎璇?
    const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) || []).length;
    const nonCjk = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, " ").trim();
    const enWords = nonCjk ? nonCjk.split(/\s+/).filter(Boolean).length : 0;
    return { chars, charsNoSpace, words: cjk + enWords };
  }, []);

  const editor: Editor | null = useEditor({
    extensions: [
      keyboardExtension.current,
      StarterKit.configure({
        codeBlock: false,
        // 琛屽唴浠ｇ爜锛坕nline code锛変娇鐢?StarterKit 榛樿瀹炵幇锛?
        //   - 鍙嶅紩鍙?`text` 瑙﹀彂 input rule 鑷姩杞?code mark
        //   - 蹇嵎閿?Mod-E锛圫tarterKit 榛樿锛夊垏鎹?
        //   - Markdown 搴忓垪鍖栦负 `text`
        // 涔嬪墠鏄惧紡缃?false 鏄负浜嗛厤鍚?codeBlock 涓€璧峰叧锛屼絾浠ｇ爜閲?IPC "code" 鍒嗘敮銆?
        // editor.isActive("code")銆佸伐鍏锋爮鎸夐挳閮戒緷璧栬繖涓?mark锛岀己澶变細瀵艰嚧绌鸿窇銆?
        heading: { levels: [1, 2, 3] },
        // 閾炬帴锛氱姝㈢偣鍑昏嚜鍔ㄦ墦寮€锛堝挨鍏舵槸 mailto: / tel: 浼氬敜璧烽偖浠?鐢佃瘽瀹㈡埛绔?
        // 閫犳垚璇Е锛夈€備繚鐣欒嚜鍔ㄨ瘑鍒?URL銆佺矘璐磋嚜鍔ㄩ摼鎺ョ瓑鑳藉姏锛涙柊绐楀彛鐩爣浠嶉€氳繃
        // HTMLAttributes 鎸囧畾锛屽鍑?鍒嗕韩椤典篃娌跨敤銆?
        link: {
          openOnClick: false,
          autolink: true,
          linkOnPaste: true,
          HTMLAttributes: {
            target: "_blank",
            rel: "noopener noreferrer nofollow",
          },
        },
      }),
      Placeholder.configure({
        placeholder: t('tiptap.placeholder'),
        emptyEditorClass: "is-editor-empty",
      }),
      // Image 鎵╁睍锛氬湪鍘熸墿灞曞熀纭€涓?(1) 鏂板 width/height 鍙寔涔呭寲灞炴€э紱
      //             (2) 鎸?ResizableImageView锛屾彁渚涢€変腑鍚庡洓瑙掓嫋鎷芥敼瀹藉害鐨勮兘鍔涖€?
      // 搴忓垪鍖?DOM 浠嶆槸涓€涓櫘閫?<img>锛寃idth/height 浣滀负 HTML 灞炴€э紝
      // 鍥犳鎵€鏈夊鍑鸿矾寰勶紙zip/markdown/鍒嗕韩椤?SSR锛夐兘鏃犻渶鏀瑰姩銆?
      Image.extend({
        addAttributes() {
          return {
            ...this.parent?.(),
            width: {
              default: null,
              parseHTML: (element) => {
                const raw = element.getAttribute("width");
                if (!raw) return null;
                const n = parseInt(raw, 10);
                return Number.isFinite(n) && n > 0 ? n : null;
              },
              renderHTML: (attrs) => {
                if (attrs.width == null) return {};
                return { width: attrs.width };
              },
            },
            height: {
              default: null,
              parseHTML: (element) => {
                const raw = element.getAttribute("height");
                if (!raw) return null;
                const n = parseInt(raw, 10);
                return Number.isFinite(n) && n > 0 ? n : null;
              },
              renderHTML: (attrs) => {
                if (attrs.height == null) return {};
                return { height: attrs.height };
              },
            },
          };
        },
        addNodeView() {
          return ReactNodeViewRenderer(ResizableImageView);
        },
      }).configure({
        // inline: true 鈥斺€?鍏佽鍥剧墖浣滀负 inline 鑺傜偣鍑虹幇鍦?paragraph / listItem
        // 鍐呴儴锛岃В鍐?鍦ㄦ湁搴忓垪琛ㄩ噷鎻掑浘鍚庡簭鍙锋棤娉曢『寤?鐨勯棶棰橈細
        //   鑻?inline:false锛宻etImage 浼氭妸鍥剧墖浣滀负 block 鎻掑叆 doc 椤跺眰锛?
        //   褰撳墠 listItem 琚埅鏂紝鍚庣画鏂?li 鍦?OL 閲岀瓑鍚屾柊璧蜂竴涓?list锛?
        //   瑙嗚涓婅〃鐜颁负搴忓彿浠?1 閲嶆柊寮€濮嬶紙鎴栨柇寮€锛夈€?
        // inline:true 鍚庯紝鍥剧墖鐩存帴浠?<img> 褰㈠紡鐣欏湪褰撳墠 <li> 鍐咃紝
        // 鍒楄〃缁撴瀯瀹屾暣淇濈暀锛屽簭鍙疯嚜鐒堕『寤躲€?
        // NodeView (ResizableImageView) 宸茬敤 display:inline-block锛岃瑙夊吋瀹广€?
        inline: true,
        allowBase64: true,
        HTMLAttributes: { class: "rounded-lg max-w-full mx-auto my-4 shadow-md" },
      }),
      CodeBlockLowlight.extend({
        addNodeView() {
          return ReactNodeViewRenderer(CodeBlockView);
        },
      }).configure({ lowlight, defaultLanguage: null as any }),
      Underline,
      Highlight.configure({
        multicolor: true,
        HTMLAttributes: { class: "highlight-mark" },
      }),
      TaskList.configure({
        HTMLAttributes: {
          class: 'task-list',
        },
      }),
      TaskItem.configure({
        nested: true,
        HTMLAttributes: {
          class: 'task-item',
        },
      }),
      Table.configure({
        resizable: true,
        handleWidth: 5,
        cellMinWidth: 60,
        lastColumnResizable: true,
        HTMLAttributes: { class: 'tiptap-table' },
      }),
      // TableRowResizable: 鏇挎崲鍘?TableRow锛屾柊澧炶楂樻嫋鎷借兘鍔涳紙rowHeight 瀛樺湪 <tr style="height">锛?
      TableRowResizable,
      TableHeader,
      TableCell,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      IndentExtension,

      slashExtension.current,
      // Markdown 璇硶澧炲己锛殈~鍒犻櫎绾縹~ / ==楂樹寒== input rule + 鏅鸿兘绮樿创 markdown
      ...MarkdownEnhancements,
      // 鏁板鍏紡锛氳鍐?$...$ 涓庡潡绾?$$...$$锛圞aTeX 娓叉煋锛屾噿鍔犺浇锛?
      ...MathExtensions,
      // 鑴氭敞锛氳鍐?[^id] 寮曠敤 + 鍧楃骇 [^id]: content 瀹氫箟
      ...FootnoteExtensions,
      // TextStyle + Color + FontSize锛氫换鎰忓瓧鍙?+ 浠绘剰鍓嶆櫙鑹诧紝钀藉湴涓?<span style>
      // 涓変欢濂楀繀椤绘斁鍦ㄦ墍鏈?mark 鎵╁睍涔嬪悗锛氶伩鍏嶅奖鍝?StarterKit 鐨?mark 浼樺厛绾?
      // 涓?importService / exportService / contentFormat / youdaoNoteService 鐨?
      // extensions 鍒楄〃淇濇寔涓€鑷达紝鍚﹀垯 generateHTML/JSON 鏃?textStyle 浼氳
      // schema 杩囨护鎺?鈫?瀛楀彿/棰滆壊涓㈠け
      ...TextStyleKit,
      // 鏌ユ壘鏇挎崲锛氱函瑁呴グ鍣ㄦ彃浠讹紝涓嶆薄鏌?schema锛屼笉鍙備笌瀵煎叆/瀵煎嚭銆?
      // 鍙礋璐ｅ湪 doc 涓婄敾楂樹寒鍜岀淮鎶ゅ懡涓姸鎬侊紝UI 鍦?SearchReplacePanel銆?
      createSearchReplaceExtension(),
      // 瑙嗛鑺傜偣锛氱洿閾?mp4/webm + B 绔?/ YouTube / 鑵捐瑙嗛 / Vimeo embed銆?
      // atom + block + draggable锛孨odeView 鐢ㄩ€忔槑閬僵闃?iframe 鎶㈢劍鐐广€?
      // parseHTML 鍚屾椂璇嗗埆 <iframe> / <video>锛岃鍓棌杩囨潵鐨勮棰戝唴瀹逛篃鑳借惤鍒版鑺傜偣銆?
      VideoExtension,
    ],
    content: parseContent(note.content),
    editable,
    editorProps: {
      attributes: {
        class: "prose prose-sm max-w-none focus:outline-none min-h-[300px] px-1",
      },
      // 鎷︽埅 mailto: / tel: / sms: 閾炬帴鐨勯粯璁ょ偣鍑昏涓猴細
      //   - 缂栬緫鎬侊細铏界劧 Link 鎵╁睍宸查厤缃?openOnClick:false锛屼絾娴忚鍣ㄥ
      //     <a href="mailto:..."> 鐨勫師鐢熺偣鍑讳粛鍙兘琚煇浜涚郴缁?娴忚鍣ㄦ嫤鎴鐞嗭紱
      //     杩欓噷棰濆浠?DOM 浜嬩欢鍏滃簳锛岄槻姝㈣瑙﹀敜璧烽偖浠跺鎴风銆?
      //   - 鍙鎬侊細extension-link 鐨?clickHandler 鍦?view.editable=false 鏃?
      //     鐩存帴 return false 鏀捐娴忚鍣ㄩ粯璁よ涓猴紝鍥犳鏇撮渶瑕佸湪杩欓噷鎷︿綇銆?
      // 鍏朵粬鍗忚锛坔ttp/https銆佺浉瀵硅矾寰勭瓑锛変笉澶勭悊锛屼繚鎸侀粯璁ゃ€?
      handleDOMEvents: {
        click: (_view, event) => {
          const target = event.target as HTMLElement | null;
          const anchor = target?.closest?.("a") as HTMLAnchorElement | null;
          if (!anchor) return false;
          const href = anchor.getAttribute("href") || "";
          // 缂栬緫鍣ㄩ噷鎵€鏈?馃搸 闄勪欢閾炬帴 href 褰㈠锛?api/attachments/<uuid>
          // 杩欓噷鐢?href 鍓嶇紑鍋氳瘑鍒紙鑰屼笉鏄?data-attachment 鑷畾涔夊睘鎬э級鈥斺€斿師鍥狅細
          //   StarterKit 榛樿 Link mark 鍙繚鐣?href / target / rel / class锛?
          //   data-attachment / data-size / download 绛夎嚜瀹氫箟灞炴€т細鍦?parse/serialize
          //   闃舵琚涪寮冿紝鍥犳鍙兘渚濊禆 href 妯″紡銆?
          // 鍛戒腑鍚庨樆姝㈡祻瑙堝櫒榛樿涓嬭浇锛屾敼涓哄彸渚ф娊灞夊唴鑱旈瑙堬細
          //   - .docx 鈫?DocxAttachmentPreview锛堣嚜鐮?OOXML 娓叉煋锛屾敮鎸?涓婁紶鏂扮増鏈?锛?
          //   - 鍏朵粬  鈫?AttachmentPreview锛堝浘鐗?/ 瑙嗛 / 鏂囨湰 / 浠ｇ爜 绛夛級
          // 涓嶆敮鎸佺殑鏍煎紡鐢?AttachmentPreview 鍐呴儴鏄剧ず"璇ユ牸寮忎笉鏀寔鍐呰仈棰勮"鍗犱綅 + 涓嬭浇鍏滃簳銆?
          const attachmentMatch = /^\/api\/attachments\/[0-9a-fA-F-]{36}/.test(href);
          if (attachmentMatch) {
            // 鏂囦欢鍚嶄紭鍏堝彇 download锛屾病鏈夊垯灏濊瘯浠庨摼鎺ユ枃瀛?馃搸 鏂囦欢鍚?(澶у皬)"閲屾姞
            let fname = anchor.getAttribute("download") || "";
            if (!fname) {
              const txt = anchor.textContent || "";
              const m = txt.match(/馃搸\s*(.+?)\s*\([^)]*\)\s*$/);
              fname = m ? m[1] : txt.replace(/^馃搸\s*/, "");
            }
            // 浠?/api/attachments/<uuid> 涓姞 id锛況egex 宸插湪 attachmentMatch 澶勯獙杩囥€?
            const idMatch = href.match(/\/api\/attachments\/([0-9a-fA-F-]{36})/);
            const attachmentId = idMatch ? idMatch[1] : "";
            if (!attachmentId) {
              return false;
            }
            event.preventDefault();
            // 鎵撳紑鍙充晶鏂囦欢璇︽儏鎶藉眽鏃讹紝鍚屾鍏抽棴 hover/caret 瑙﹀彂鐨勯摼鎺ユ皵娉★紝
            // 閬垮厤姘旀场锛堣矾寰勯瑙?+ 涓嬭浇/閾炬帴/鍙栨秷閾炬帴锛変笌鎶藉眽鍚屽睆骞跺瓨閫犳垚瑙嗚骞叉壈銆?
            setLinkBubble(b => (b.open ? { ...b, open: false } : b));
            setAttachmentPreview({
              id: attachmentId,
              filename: fname,
              isDocx: /\.docx$/i.test(fname),
            });
            return true;
          }
          if (/^(mailto:|tel:|sms:)/i.test(href)) {
            event.preventDefault();
            const plain = href.replace(/^(mailto:|tel:|sms:)/i, "").split("?")[0];
            const label = /^mailto:/i.test(href)
              ? "閭"
              : /^tel:/i.test(href)
              ? "鐢佃瘽"
              : "鍙风爜";
            try {
              if (navigator.clipboard && window.isSecureContext) {
                navigator.clipboard.writeText(plain).then(
                  () => toast.success(`宸插鍒?{label}锛?{plain}`),
                  () => toast.info(`${label}锛?{plain}`),
                );
              } else {
                toast.info(`${label}锛?{plain}`);
              }
            } catch {
              toast.info(`${label}锛?{plain}`);
            }
            return true;
          }
          return false;
        },
      },

      handlePaste: (view, event) => {
        // 濮嬬粓闃绘娴忚鍣ㄩ粯璁ょ矘璐磋涓猴紝闃叉椤甸潰璺宠浆鍒扮┖鐧介〉
        event.preventDefault();
        // --- [DIAG] 鍏ュ彛鍏ㄥ眬鎺㈤拡锛氱‘璁よ矾寰勫拰鍚勯€氶亾鏁版嵁 ---
        try {
          const cd = event.clipboardData;
          const probeHtml = cd?.getData("text/html") || "";
          const probeText = cd?.getData("text/plain") || "";
          const probeRtf = cd?.getData("text/rtf") || "";
          const itemList = cd ? Array.from(cd.items).map((it) => it.kind + "/" + it.type) : [];
          const fileList = cd ? Array.from(cd.files).map((f) => f.name + "/" + f.type + "/" + f.size) : [];
          console.log("[paste-diag] ENTRY",
            " text.len=", probeText.length,
            " html.len=", probeHtml.length,
            " rtf.len=", probeRtf.length,
            " pngblip=", (probeRtf.match(/\\pngblip/g) || []).length,
            " items=", itemList,
            " files=", fileList);
        } catch {}
        try {
          // 1) 澶勭悊鍓创鏉夸腑鐨勫浘鐗囨枃浠讹紙濡傛埅鍥剧矘璐达級
          //    璧?/api/attachments 涓婁紶鎺ュ彛锛氬啓纾佺洏 + 钀?attachments 琛岋紝
          //    缂栬緫鍣ㄦ彃鍏ョ殑 <img> 寮曠敤鏈嶅姟绔?URL锛岄伩鍏嶅唴鑱?base64 鎶婃枃妗ｄ綋绉拺澶с€?
          //
          //    鈿狅笍 鍏抽敭锛歐ord / 鑵捐鏂囨。 绛夊瘜鏂囨湰婧愬叏閫夊鍒舵椂锛宑lipboardData 閲?
          //    鍚屾椂瀛樺湪 text/html锛堝唴鑱?base64 鐨勫寮?<img>锛夊拰 image/png锛堥€氬父
          //    鍙槸棣栧紶鍥炬垨缂╃暐鍚堟垚鍥撅級銆傝嫢鐩存帴閬嶅巻 items 鐪嬪埌 image/* 灏?return锛?
          //    浼?鍙笂浼犱竴寮犲浘 + 涓㈡帀 HTML 閲屽叾浣欐墍鏈夊浘 + 涓㈡帀姝ｆ枃鏂囧瓧"銆?
          //    鍥犳锛氬綋鍓创鏉垮悓鏃跺甫鏈夊惈 <img> 鐨?HTML 鏃讹紝璁?HTML 鍒嗘敮鎺ョ锛?
          //    鍙湁绾埅鍥惧満鏅紙HTML 涓虹┖ / HTML 涓嶅惈鍥撅級鎵嶈蛋涓婁紶銆?
          const items = event.clipboardData?.items;
          const htmlForProbe = event.clipboardData?.getData("text/html") || "";
          const htmlHasImg = htmlForProbe.length > 0 && /<img\b/i.test(htmlForProbe);
          if (items && !htmlHasImg) {
            for (let i = 0; i < items.length; i++) {
              if (items[i].type.startsWith("image/")) {
                console.log("[paste-diag] PATH=items image/* (will upload as screenshot)");
                const file = items[i].getAsFile();
                if (file) {
                  const currentNote = noteRef.current;
                  const insertAtSrc = (src: string) => {
                    const { state: editorState, dispatch } = view;
                    const node = editorState.schema.nodes.image?.create({ src });
                    if (node) {
                      const tr = editorState.tr.replaceSelectionWith(node);
                      dispatch(tr);
                    }
                  };
                  if (currentNote?.id) {
                    showPasteToast("converting", t("tiptap.imageUploading"));
                    api.attachments
                      .upload(currentNote.id, file)
                      .then(({ url }) => {
                        insertAtSrc(url);
                        showPasteToast("success", t("tiptap.imageUploadSuccess"));
                      })
                      .catch((err) => {
                        console.error("Attachment upload failed, falling back to base64:", err);
                        showPasteToast("error", t("tiptap.imageUploadFailed"));
                        // 涓婁紶澶辫触鍏滃簳锛氫粛鐢?base64 鎻掑叆锛屼繚璇佺敤鎴蜂笉涓㈠け鎴浘
                        const reader = new FileReader();
                        reader.onload = (e) => {
                          const src = e.target?.result as string;
                          if (src) insertAtSrc(src);
                        };
                        reader.readAsDataURL(file);
                      });
                  } else {
                    // 娌℃湁 note 涓婁笅鏂囷紙鐞嗚涓婁笉搴斿彂鐢燂級锛氶€€鍥?base64
                    const reader = new FileReader();
                    reader.onload = (e) => {
                      const src = e.target?.result as string;
                      if (src) insertAtSrc(src);
                    };
                    reader.readAsDataURL(file);
                  }
                }
                return true;
              }
            }
          }

          // 1b) 闈炲浘鐗囨枃浠剁矘璐达紙鍓创鏉块噷鏉ヨ嚜璧勬簮绠＄悊鍣ㄧ殑澶嶅埗锛夛細褰撲綔闄勪欢涓婁紶
          //     鐢?clipboardData.files 姣?items 鏇寸洿瑙傦紱瀹冨凡鍓旈櫎 string 绫诲瀷椤广€?
          const pastedFiles = Array.from(event.clipboardData?.files || []);
          if (pastedFiles.length > 0) {
            console.log("[paste-diag] PATH=files (attachments upload)");
            const currentNote = noteRef.current;
            if (currentNote?.id) {
              showPasteToast("converting", t("tiptap.attachmentUploading"));
              const insertAttachmentToView = (filename: string, url: string, size: number) => {
                const html = buildAttachmentLinkHtml(filename, url, size);
                const dom = document.createElement("div");
                dom.innerHTML = html;
                const slice = ProseMirrorDOMParser
                  .fromSchema(view.state.schema)
                  .parseSlice(dom);
                view.dispatch(view.state.tr.replaceSelection(slice));
              };
              const insertImageToView = (src: string) => {
                const node = view.state.schema.nodes.image?.create({ src });
                if (node) view.dispatch(view.state.tr.replaceSelectionWith(node));
              };
              const uploadAll = async () => {
                for (const file of pastedFiles) {
                  try {
                    const res = await api.attachments.upload(currentNote.id, file);
                    if (res.category === "image") {
                      insertImageToView(res.url);
                    } else {
                      insertAttachmentToView(res.filename, res.url, res.size);
                    }
                  } catch (err) {
                    console.error("Paste attachment upload failed:", err);
                  }
                }
                showPasteToast("success", t("tiptap.attachmentUploaded"));
              };
              uploadAll();
              return true;
            }
          }

          const text = event.clipboardData?.getData("text/plain") || "";
          const html = event.clipboardData?.getData("text/html") || "";

          // 2) 鑻ュ綋鍓嶅厜鏍囧湪浠ｇ爜鍧楀唴锛氫笉绠℃潵婧愭槸 html 杩樻槸 text锛屽缁堜繚鐣欏師濮嬫枃鏈?+ 鎹㈣
          const { state: stCode } = view;
          const $pasteFrom = stCode.selection.$from;
          let inCodeBlock = false;
          for (let d = $pasteFrom.depth; d >= 0; d--) {
            if ($pasteFrom.node(d).type.name === "codeBlock") {
              inCodeBlock = true;
              break;
            }
          }
          if (inCodeBlock) {
            console.log("[paste-diag] PATH=inCodeBlock (insertText)");
            if (!text) return true;
            const tr = stCode.tr.insertText(text);
            view.dispatch(tr);
            return true;
          }

          // 2.5) RTF 鍥剧墖鎭㈠鍒嗘敮锛圵ord / WPS 鍏ㄩ€夌矘璐存牳蹇冭矾寰勶級鈥斺€斿繀椤绘棭浜?
          //      looksLikeCode / looksLikeMarkdown 鍒ゆ柇锛屽惁鍒?Word 鐨勭函鏂囨湰
          //      浼氳瀹冧滑璇垽涓轰唬鐮?Markdown 浠庤€?return true 鎶㈣蛋浜嬩欢锛?
          //      RTF 閫氶亾閲岀殑 42 寮?\pngblip 鍥惧氨鍐嶄篃鎭㈠涓嶅嚭鏉ャ€?
          //
          // Word/WPS 澶嶅埗鏃剁殑鍏稿瀷鍓创鏉垮舰鎬侊細
          //   - text/plain 锛氬彲瑙佹枃瀛楋紙鏁?KB锛?
          //   - text/html  锛氬瘜鏂囨湰鏍囪锛?img src> 澶氫负 "file:///C:/..." 鏈湴璺緞锛?
          //                  娴忚鍣ㄦ棤娉曞姞杞姐€侰hromium 鍦ㄨ秴澶у壀璐存澘锛圧TF 鐧?MB 绾э級
          //                  涓嬮娆?getData("text/html") 鍋跺皵杩斿洖绌哄瓧绗︿覆锛岄渶绗簩
          //                  娆℃墠鑳借鍒帮紝鐢ㄦ埛浣撴劅灏辨槸"绗竴娆＄矘璐存病鍙嶅簲"銆?
          //   - text/rtf   锛氬惈鎵€鏈夊浘鐗囧瓧鑺傦紝鏍煎紡涓?\pngblip / \jpegblip + 鍗佸叚杩涘埗銆?
          //
          // 鍥犳鍙 RTF 閲屾娴嬪埌 \pngblip/\jpegblip锛屽氨涓€寰嬪湪杩欓噷鍏滃簳锛?
          //   a) 鑻?html 闈炵┖锛氭妸 RTF 閲岀殑鍥炬寜椤哄簭鍥炲～鍒?<img src=file://> 鍗犱綅
          //   b) 鑻?html 涓虹┖锛氱敤 text/plain 鎸夎鎷兼垚绠€鍖?HTML锛屽啀鎶?RTF 鍥剧墖鍏ㄩ儴
          //                    杩藉姞鍒版鏂囨湯灏撅紱鑷冲皯淇濊瘉"鏂囧瓧 + 鍥剧墖閮戒笉涓?銆?
          {
            const rtfForImg = event.clipboardData?.getData("text/rtf") || "";
            // 鍏堝仛寤変环鎺㈡祴锛氬彧鏁?\pngblip / \jpegblip 鐨勫嚭鐜版鏁帮紝涓嶅仛瑙ｇ爜銆?
            // 杩欐牱鑳藉湪闃诲涓荤嚎绋嬪仛閲嶆椿涔嬪墠锛岀珛鍒诲喅瀹氭槸鍚﹂渶瑕佸脊 loading銆?
            const blipMatches = rtfForImg.length > 0
              ? rtfForImg.match(/\\(pngblip|jpegblip)/g)
              : null;
            const blipCount = blipMatches ? blipMatches.length : 0;
            if (blipCount > 0) {
              console.log("[paste-diag] PATH=rtf-image-rescue (html.len=", html.length,
                " blipCount=", blipCount, ")");

              // 1) 绔嬪埢寮?loading toast銆傜湡姝ｇ殑閲嶆椿锛坔ex鈫抌ase64锛夊凡缁忔尓鍒?
              //    Web Worker 閲岋紝涓荤嚎绋嬪畬鍏ㄤ笉浼氶樆濉烇紝toast 鍜?UI 鍔ㄧ敾閮借兘
              //    姝ｅ父鍒锋柊銆?
              showPasteToast(
                "converting",
                t("tiptap.rtfRescueProcessing", { count: blipCount })
              );

              // 2) 淇濆瓨鍏ュ彛鏃跺彲瑙佺殑鍊煎埌闂寘灞€閮紝寮傛娴佺▼缁х画浣跨敤銆?
              const htmlSnapshot = html;
              const textSnapshot = text;
              const noteAtPaste = noteRef.current;

              // 3) 涓㈢粰 worker銆俉orker 閫氫俊澶辫触/涓嶅彲鐢ㄦ椂 client 鍐呴儴浼氳嚜鍔?
              //    闄嶇骇涓轰富绾跨▼鍚屾瀹炵幇锛堝彧浼氬崱锛屼笉浼氶敊锛夈€?
              extractRtfImagesAsync(rtfForImg)
                .then((rtfImages) => {
                  if (view.isDestroyed) return;
                  console.log("[paste-diag] RTF images extracted (worker)=", rtfImages.length);
                  if (rtfImages.length === 0) {
                    dismissPasteToast();
                    return;
                  }

                  let htmlForParse: string;
                  if (htmlSnapshot && htmlSnapshot.trim().length > 0) {
                    // 鎯呭喌 a锛欻TML 宸插氨缁紝鎸変綅缃洖濉?
                    htmlForParse = mergeRtfImagesIntoHtml(htmlSnapshot, rtfImages);
                  } else {
                    // 鎯呭喌 b锛欻TML 涓虹┖锛圕hromium 澶у壀璐存澘棣栨璇伙級锛岀敤 text 鏋勯€犳渶绠€ HTML
                    const lines = (textSnapshot || "").split(/\r?\n/);
                    const textHtml = lines
                      .map((l) => {
                        const trimmed = l.trim();
                        if (!trimmed) return "";
                        const safe = trimmed
                          .replace(/&/g, "&amp;")
                          .replace(/</g, "&lt;")
                          .replace(/>/g, "&gt;");
                        return `<p>${safe}</p>`;
                      })
                      .filter(Boolean)
                      .join("");
                    const imgHtml = rtfImages
                      .map((src) => `<p><img src="${src}"/></p>`)
                      .join("");
                    htmlForParse = textHtml + imgHtml;
                  }

                  const { state, dispatch } = view;
                  const parser = ProseMirrorDOMParser.fromSchema(state.schema);
                  const tempDiv = document.createElement("div");
                  const normalized = normalizePastedHtmlForBlocks(htmlForParse);
                  tempDiv.innerHTML = normalized.html;
                  try {
                    const finalImgs = tempDiv.querySelectorAll("img").length;
                    console.log("[paste-diag] rtf-rescue normalized <img>=", finalImgs,
                      " stats=", normalized.imageStats);
                  } catch {}
                  const slice = parser.parseSlice(tempDiv);
                  try {
                    let cnt = 0;
                    slice.content.descendants((n) => {
                      if (n.type.name === "image") cnt += 1;
                    });
                    console.log("[paste-diag] rtf-rescue PM slice image nodes=", cnt);
                  } catch {}
                  dispatch(state.tr.replaceSelection(slice));

                  // 4) 鎻掑叆宸插畬鎴?鈥斺€?姝ゅ埢鍏堝憡璇夌敤鎴?鍥剧墖宸茬矘璐?锛岄殢鍚?
                  //    杩涘叆鍚庡彴涓婁紶闃舵銆傚垎涓ゆ潯 toast 姣旀尋鍦ㄤ竴鏉￠噷娴佺晠銆?
                  showPasteToast(
                    "success",
                    t("tiptap.rtfRescueDone", { count: rtfImages.length }),
                    1500
                  );

                  // 5) 鍚庡彴寮傛锛氭妸鏂囨。閲屾墍鏈?data:image/* 鏇挎崲鎴?
                  //    /api/attachments/<id>銆傞伩鍏嶇瑪璁?JSON 鑶ㄨ儉鍒板嚑鍗?MB銆?
                  //    婊氬姩/鎼滅储/鍚屾鍏ㄩ儴琚嫋鎱紝鏈嶅姟绔篃鏇村ソ鍋氬幓閲?娓呯悊銆?
                  //
                  //    娌℃湁 noteId 鏃朵笉鍋氾紙姣斿鏈櫥褰曟垨涓存椂缂栬緫鍣ㄥ疄渚嬶級锛?
                  //    鐢ㄦ埛澶辩劍淇濆瓨鏃舵湰鏉ヤ篃璧颁笉浜?/api/attachments锛屽彧鑳?
                  //    淇濇寔 base64鈥斺€斿姛鑳戒笉浼氬潖锛屽彧鏄綋绉ぇ銆?
                  if (editor && noteAtPaste?.id) {
                    const noteId = noteAtPaste.id;
                    // 绋嶄綔寤惰繜璁╂覆鏌撳厛钀藉湴锛岄伩鍏嶄笂浼?HTTP 璇锋眰鍜屽ぇ鍥捐В鐮佹姠璧勬簮
                    setTimeout(() => {
                      if (editor.isDestroyed) return;
                      showPasteToast(
                        "converting",
                        t("tiptap.rtfRescueUploading", {
                          done: 0,
                          total: rtfImages.length,
                        })
                      );
                      replaceDataUrlImagesWithAttachments(editor, noteId, {
                        onProgress: (done, total) => {
                          showPasteToast(
                            "converting",
                            t("tiptap.rtfRescueUploading", { done, total })
                          );
                        },
                      })
                        .then(({ total, uploaded, failed }) => {
                          if (editor.isDestroyed) return;
                          if (total === 0) return;
                          if (failed === 0) {
                            showPasteToast(
                              "success",
                              t("tiptap.rtfRescueUploadDone", {
                                uploaded,
                                total,
                              })
                            );
                          } else {
                            showPasteToast(
                              "error",
                              t("tiptap.rtfRescueUploadPartial", {
                                uploaded,
                                total,
                                failed,
                              }),
                              4000
                            );
                          }
                        })
                        .catch((err) => {
                          console.error(
                            "[paste-diag] background upload failed:",
                            err
                          );
                          // 闈欓粯澶辫触锛歜ase64 鍏滃簳鍥句粛鐒跺湪缂栬緫鍣ㄩ噷锛岀敤鎴风湅寰楄銆?
                        });
                    }, 200);
                  }
                })
                .catch((err) => {
                  console.error("[paste-diag] rtf-rescue failed:", err);
                  showPasteToast("error", t("tiptap.imageUploadFailed"));
                });

              // 6) 鍚屾杩斿洖 true锛歟vent.preventDefault 宸茶皟锛孭M 涓嶄細鍐嶆彃鍏?
              //    鍘熷鍓创鏉垮唴瀹癸紱鐪熸鐨勬彃鍏ョ敱涓婇潰鐨勫紓姝ヤ换鍔″畬鎴愩€?
              return true;
            }
          }

          // 3) 澶氳绾枃鏈紙闈?Markdown锛変笖鐪嬭捣鏉ュ儚浠ｇ爜锛氭暣娈靛寘杩涘崟涓€ codeBlock銆?
          //    娉ㄦ剰锛氬繀椤讳紭鍏堜簬 HTML 鍒嗘敮锛屽洜涓?VS Code / 娴忚鍣ㄥ鍒朵唬鐮佹椂
          //    閫氬父鍚屾椂甯?text/html锛堟瘡琛屼竴涓?<div> 鎴?<pre><br>锛夛紝
          //    鑻ヨ蛋 HTML 瑙ｆ瀽浼氳鎷嗘垚澶氬潡锛屽鑷?姣忚涓€涓唬鐮佸潡"銆?
          //    澧炲姞 looksLikeCode 鍒ゆ柇锛氬惈澶ч噺涓枃鑷劧璇█鐨勫琛屾枃鏈笉搴旇鍖呮垚 codeBlock銆?
          if (text && text.includes("\n") && !looksLikeMarkdown(text) && looksLikeCode(text)) {
            console.log("[paste-diag] PATH=codeBlock (looksLikeCode)");
            // 鎶婄函鏂囨湰鍖呭湪 <pre><code> 涓紝閫氳繃 PM 鐨?DOMParser.parseSlice 鈫?replaceSelection
            // 璁?PM 鑷繁澶勭悊鍧楃骇鑺傜偣锛坈odeBlock锛夌殑宓屽涓庡厜鏍囧畾浣嶃€?
            // 涔嬪墠鐨勫仛娉曟槸鎵嬪姩 codeBlockType.create() + replaceSelectionWith()锛?
            // 浣嗗湪鍏夋爣浣嶄簬娈佃惤鍐呯瓑鍦烘櫙涓?PM 鏃犳硶姝ｇ‘ fit 鍧楃骇鑺傜偣鍒拌鍐呬綅缃紝
            // 瀵艰嚧鏂囨。缁撴瀯鎹熷潖 鈫?鍚庣画 DOM mutation 鏃?resolveSelection 鎶?
            // "Position -12 out of range"銆?
            const { state, dispatch } = view;
            const parser = ProseMirrorDOMParser.fromSchema(state.schema);
            const wrapper = document.createElement("div");
            const pre = document.createElement("pre");
            const code = document.createElement("code");
            code.textContent = text;
            pre.appendChild(code);
            wrapper.appendChild(pre);
            const slice = parser.parseSlice(wrapper);
            const tr = state.tr.replaceSelection(slice).scrollIntoView();
            dispatch(tr);
            return true;
          }

          // 4) Markdown 绾枃鏈細涓嶈嚜鍔ㄨ浆鎹紝鍏堝師鏍锋彃鍏ョ函鏂囨湰骞跺脊 confirm toast锛?
          //    鐢ㄦ埛鐐瑰嚮"绔嬪嵆杞崲鏍峰紡"鏃跺啀鐢ㄥ師濮嬫枃鏈浛鎹㈠垰鎻掑叆鐨勯偅娈佃寖鍥淬€?
          if (text && looksLikeMarkdown(text)) {
            console.log("[paste-diag] PATH=markdown (insertText + confirm toast)");
            const { state, dispatch } = view;
            // 璁板綍鎻掑叆璧风偣锛岀敤浜庡悗缁寜 from..to 鑼冨洿鏇挎崲
            const insertFrom = state.selection.from;
            const tr = state.tr.insertText(text);
            dispatch(tr);
            // 娉ㄦ剰锛氫笉鑳界敤 insertFrom + text.length锛屽洜涓?ProseMirror 鎶?\n 杞垚娈佃惤鑺傜偣锛?
            // 姣忎釜鑺傜偣杈圭晫鍗?2 涓綅缃紝瀹為檯鍋忕Щ杩滃ぇ浜庡瓧绗︽暟銆?
            // insertText 鍚庡厜鏍囩Щ鍒版湯灏撅紝鐩存帴璇?view.state.selection.to 鍗充负鐪熷疄缁堢偣銆?
            const insertTo = view.state.selection.to;

            // 鏋勯€犺浆鎹㈠姩浣滐細鎶?[insertFrom, insertTo] 鏇挎崲涓鸿浆鎹㈠悗鐨?HTML 鍒囩墖銆?
            // 娉ㄦ剰 view 鍦ㄦ闂寘涓暱鏈熸湁鏁堬紙React 鍗歌浇鏃剁紪杈戝櫒浼?destroy锛屽眾鏃?isDestroyed 涓虹湡锛夈€?
            const doConvert = () => {
              try {
                if (view.isDestroyed) return;
                const convertedHtml = markdownToSimpleHtml(text);
                const parser = ProseMirrorDOMParser.fromSchema(view.state.schema);
                const tempDiv = document.createElement("div");
                tempDiv.innerHTML = convertedHtml;
                const slice = parser.parseSlice(tempDiv);
                // 鏇挎崲鑼冨洿瑕?clamp 鍒板綋鍓嶆枃妗ｉ暱搴︼紝闃叉鐢ㄦ埛姝ゅ悗鍙堢紪杈?鍒犻櫎浜嗛儴鍒嗗唴瀹?
                const docSize = view.state.doc.content.size;
                const from = Math.min(insertFrom, docSize);
                const to = Math.min(insertTo, docSize);
                const replaceTr = view.state.tr.replaceRange(from, to, slice).scrollIntoView();
                view.dispatch(replaceTr);
                showPasteToast("success", t("tiptap.markdownConvertSuccess"));
              } catch (err) {
                console.error("Markdown paste conversion failed:", err);
                showPasteToast("error", t("tiptap.markdownConvertError"));
              }
            };

            showPasteConfirmToast(
              t("tiptap.markdownDetected"),
              t("tiptap.markdownConvertNow"),
              doConvert
            );
            return true;
          }

          // 5) 鍙湁 HTML 娌℃湁澶氳绾枃鏈紙濡備粠缃戦〉澶嶅埗鐨勫瘜鏂囨湰鐗囨锛夛細瑙ｆ瀽鎻掑叆
          //    鍏堝綊涓€鍖栵細鎶?<div>/<br> 浼琛屾钀芥媶鎴愮湡姝ｇ殑澶氫釜 <p>锛?
          //    閬垮厤鍚庣画鍧楃骇鎿嶄綔锛坱oggleHeading 绛夛級璇妸鏁存杞崲銆?
          if (html && html.trim().length > 0) {
            console.log("[paste-diag] PATH=html (normalize + parseSlice)");
            const { state, dispatch } = view;
            const parser = ProseMirrorDOMParser.fromSchema(state.schema);
            const tempDiv = document.createElement("div");
            // 5a) Word / WPS 绮樿创锛欻TML 閲岀殑 <img src> 鏄?"file:///..." 鏈湴璺緞锛?
            //     娴忚鍣ㄦ棤娉曞姞杞斤紱浣?text/rtf 閲屼互 \pngblip / \jpegblip 鍐呰仈浜?
            //     鐪熸鐨勫浘鍍忓瓧鑺傘€傚湪褰掍竴鍖栦箣鍓嶏紝鍏堜粠 RTF 鎻愬彇 data URL锛屾寜椤哄簭
            //     鍥炲～鍒?HTML 鐨?<img> 鍗犱綅涓婏紝杩欐牱鍚庣画 rescue / PM DOMParser
            //     鑳芥甯稿綋浣滃悎娉?data:image 鎻掑叆锛堝凡瓒?200B锛屼笉浼氳鍒や负鍗犱綅锛夈€?
            let htmlForParse = html;
            try {
              const rtf = event.clipboardData?.getData("text/rtf") || "";
              if (rtf.length > 0 && /\\(pngblip|jpegblip)/.test(rtf)) {
                const rtfImages = extractImagesFromRtf(rtf);
                if (rtfImages.length > 0) {
                  htmlForParse = mergeRtfImagesIntoHtml(html, rtfImages);
                  console.log(
                    "[paste-diag] RTF images extracted=",
                    rtfImages.length
                  );
                }
              }
            } catch (err) {
              console.warn("[paste-diag] RTF image extraction failed:", err);
            }
            const normalized = normalizePastedHtmlForBlocks(htmlForParse);
            tempDiv.innerHTML = normalized.html;
            // --- [DIAG] Word 绮樿创鍥剧墖涓㈠け鎺掓煡 ---
            try {
              const rawImgs = (html.match(/<img[^>]*>/gi) || []).length;
              const normalizedImgs = tempDiv.querySelectorAll("img").length;
              const firstSrc = tempDiv.querySelector("img")?.getAttribute("src") || "";
              console.log("[paste-diag] raw html <img>=", rawImgs,
                " normalized <img>=", normalizedImgs,
                " isWord=", normalized.isWordSource,
                " stats=", normalized.imageStats,
                " firstSrcHead=", firstSrc.slice(0, 80));
            } catch {}
            const slice = parser.parseSlice(tempDiv);
            try {
              let imgCountInSlice = 0;
              slice.content.descendants((n) => {
                if (n.type.name === "image") imgCountInSlice += 1;
              });
              console.log("[paste-diag] PM slice image nodes=", imgCountInSlice);
            } catch {}
            const tr = state.tr.replaceSelection(slice);
            dispatch(tr);
            // 鑻ュ瓨鍦ㄥ浘鐗囪繕娌″姞杞藉畬锛堟病鏈変换浣曞彲鐢?src 鐨?<img>锛夛紝鎻愮ず鐢ㄦ埛
            //   a) Word 绮樿创锛?img src="file:///..."> 娴忚鍣ㄤ笉鍙姞杞?鈫?寮曞鐢ㄦ埛鏀圭敤"瀵煎叆 Word 鏂囨。"
            //   b) 鎳掑姞杞界綉椤碉細<img> 鐪熷疄鍦板潃娌″～鍏?鈫?鎻愮ず鍥炲師缃戦〉婊氬姩鍔犺浇鍚庡啀澶嶅埗
            if (normalized.imageStats.failed > 0) {
              const msgKey = normalized.isWordSource
                ? "tiptap.wordImagesNotPastable"
                : "tiptap.imagesNotLoaded";
              showPasteToast(
                "error",
                t(msgKey, { count: normalized.imageStats.failed }),
                6000
              );
            }
            return true;
          }

          // 6) 鍗曡绾枃鏈垨鍏朵粬锛氱洿鎺ユ彃鍏?
          if (text) {
            const { state: st, dispatch: dp } = view;
            const tr = st.tr.insertText(text);
            dp(tr);
          }
          return true;
        } catch (err) {
          console.error("Paste handling error:", err);
          // 鍑洪敊鏃跺皾璇曟彃鍏ョ函鏂囨湰锛岄伩鍏嶉〉闈㈠穿婧?
          try {
            const fallbackText = event.clipboardData?.getData("text/plain") || "";
            if (fallbackText) {
              const { state: fst, dispatch: fdp } = view;
              const tr = fst.tr.insertText(fallbackText);
              fdp(tr);
            }
          } catch {}
          return true;
        }
      },
      /**
       * 鎷栨嫿鏂囦欢鍒扮紪杈戝櫒锛氫换鎰忕被鍨嬮兘璧?/api/attachments 涓婁紶銆?
       *   - 鍥剧墖 鈫?setImage锛?
       *   - 闈炲浘鐗?鈫?鎻掑叆闄勪欢閾炬帴銆?
       * 鍙湪鏈?dataTransfer.files 鏃舵帴绠★紱鍏跺畠鎯呭喌锛堜粠缂栬緫鍣ㄥ唴鎷栧姩鑺傜偣锛夎 Tiptap/PM 榛樿澶勭悊銆?
       *
       * 娉ㄦ剰锛歅roseMirror 浼氬湪鎷栨嫿杩囩▼涓妸褰撳墠鍏夋爣鏀惧埌榧犳爣閲婃斁浣嶇疆锛屾墍浠ヨ繖閲岀洿鎺?
       * replaceSelection 灏变細钀藉湪鏈熸湜浣嶇疆銆?
       */
      handleDrop: (view, event, _slice, moved) => {
        if (moved) return false; // 缂栬緫鍣ㄥ唴閮ㄧЩ鍔ㄨ妭鐐癸紝涓嶆嫤鎴?
        const dt = (event as DragEvent).dataTransfer;
        const files = dt ? Array.from(dt.files || []) : [];
        if (files.length === 0) return false;
        event.preventDefault();

        const currentNote = noteRef.current;
        if (!currentNote?.id) return true;

        // 鎶婅惤鐐规崲绠楀埌 PM 鍧愭爣锛屽苟鎶婂厜鏍囩Щ杩囧幓锛岃繖鏍?replaceSelection 鎻掑湪鎷栨斁浣嶇疆銆?
        try {
          const coords = view.posAtCoords({ left: (event as DragEvent).clientX, top: (event as DragEvent).clientY });
          if (coords) {
            const tr = view.state.tr.setSelection(TextSelection.create(view.state.doc, coords.pos));
            view.dispatch(tr);
          }
        } catch {
          /* ignore */
        }

        const insertAttachmentToView = (filename: string, url: string, size: number) => {
          const html = buildAttachmentLinkHtml(filename, url, size);
          const dom = document.createElement("div");
          dom.innerHTML = html;
          const slice = ProseMirrorDOMParser
            .fromSchema(view.state.schema)
            .parseSlice(dom);
          view.dispatch(view.state.tr.replaceSelection(slice));
        };
        const insertImageToView = (src: string) => {
          const node = view.state.schema.nodes.image?.create({ src });
          if (node) view.dispatch(view.state.tr.replaceSelectionWith(node));
        };

        showPasteToast("converting", t("tiptap.attachmentUploading"));
        (async () => {
          for (const file of files) {
            try {
              const res = await api.attachments.upload(currentNote.id, file);
              if (res.category === "image") {
                insertImageToView(res.url);
              } else {
                insertAttachmentToView(res.filename, res.url, res.size);
              }
            } catch (err) {
              console.error("Drop attachment upload failed:", err);
            }
          }
          showPasteToast("success", t("tiptap.attachmentUploaded"));
        })();
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      // setContent 瑙﹀彂鐨?onUpdate 涓嶅簲璇ヤ繚瀛橈紙闃叉姝诲惊鐜級
      if (isSettingContent.current) return;

      const text = editor.getText();
      setWordStats(computeStats(text));
      onHeadingsChange?.(extractHeadings(editor));
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
      debounceTimer.current = setTimeout(() => {
        const json = JSON.stringify(editor.getJSON());
        const title = titleRef.current?.value || noteRef.current.title;
        lastEmittedContentRef.current = json;
        onUpdateRef.current({ content: json, contentText: text, title });
      }, 500);
    },
  });

  // 瀹炵幇 flushSave锛欳trl/Cmd+S 瑙﹀彂锛岀粫杩?500ms debounce 绔嬪嵆淇濆瓨
  flushSaveRef.current = () => {
    if (!editor) return;
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    const json = JSON.stringify(editor.getJSON());
    const text = editor.getText();
    const title = titleRef.current?.value || noteRef.current.title;
    lastEmittedContentRef.current = json;
    onUpdateRef.current({ content: json, contentText: text, title });
    try {
      toast.success(t('tiptap.saved') || 'Saved');
    } catch {}
  };

  /**
   * 瀵圭埗缁勪欢鏆撮湶鍛戒护寮?API锛?
   *   - flushSave(): 鍒囨崲缂栬緫鍣?/ 鍒囨崲绗旇鏃剁珛鍗虫妸 pending 鐨?debounce 鏇存柊鍐欏嚭鍘伙紝
   *                 闃叉涓㈠瓧銆傝繖閲?*涓嶅脊 toast**锛堥伩鍏嶅垏鎹㈢灛闂村埛灞忥級锛?
   *                 涓?Ctrl/Cmd+S 鐨勪氦浜掍繚鎸佸垎绂汇€?
   *   - getSnapshot(): 鍚屾璇诲彇缂栬緫鍣ㄥ綋鍓嶅唴瀹广€俧lushSave 鍙兘瑙﹀彂**寮傛** PUT锛?
   *                 鍒囨崲 RTE鈫扢D 鏃惰嫢鍙潬 flushSave锛孧D 涓€ mount 璇诲埌鐨勮繕鏄?
   *                 鍒囨崲鍓嶇殑鏃?note.content锛圥UT 娌″洖鍖咃級锛屽湪鍑犵櫨姣鍐呬細闂儊
   *                 鏃у唴瀹圭敋鑷充涪澶辩敤鎴锋渶杩戠殑杈撳叆銆傜埗缁勪欢鍙互璋?getSnapshot()
   *                 鎷垮埌鏈€鏂?JSON+绾枃鏈紝绔嬪嵆鍥炲～ activeNote 鍚庡啀 setEditorMode锛?
   *                 MD 渚х殑 normalizeToMarkdown 灏辫兘鐩存帴鍩轰簬鏈€鏂板唴瀹瑰垵濮嬪寲銆?
   */
  useImperativeHandle(
    ref,
    () => ({
      flushSave: () => {
        if (!editor) return;
        if (!debounceTimer.current) return;
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
        const json = JSON.stringify(editor.getJSON());
        const text = editor.getText();
        const title = titleRef.current?.value || noteRef.current.title;
        lastEmittedContentRef.current = json;
        onUpdateRef.current({ content: json, contentText: text, title });
      },
      discardPending: () => {
        // 鍒囨崲缂栬緫鍣ㄦ椂璋冪敤鏂瑰凡缁忚嚜宸?PUT 瑙勮寖鍖栧唴瀹癸紝娓呮帀 debounce 閬垮厤绔炴€?
        if (debounceTimer.current) {
          clearTimeout(debounceTimer.current);
          debounceTimer.current = null;
        }
      },
      getSnapshot: () => {
        if (!editor) return null;
        return {
          content: JSON.stringify(editor.getJSON()),
          contentText: editor.getText(),
        };
      },
      isReady: () => !!editor && !editor.isDestroyed,
    }),
    [editor],
  );

  // 鍒囨崲绗旇鏃跺悓姝ョ紪杈戝櫒鍐呭
  const lastSyncedNoteIdRef = useRef<string | null>(null);
  useEffect(() => {
    // 鍒囨崲绗旇鏃剁珛鍗虫竻鐞嗘棫鐨?debounce timer锛岄槻姝㈡棫绗旇鐨勪繚瀛樿姹傛硠婕?
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    if (titleDebounceTimer.current) {
      clearTimeout(titleDebounceTimer.current);
      titleDebounceTimer.current = null;
    }

    if (editor && note) {
      // 绗旇鍒囨崲鏃堕噸缃?lastEmitted 瀹堝崼锛堟柊绗旇鐨?content 鑲畾瑕佺湡姝?setContent锛?
      if (lastSyncedNoteIdRef.current !== note.id) {
        lastEmittedContentRef.current = null;
        lastSyncedNoteIdRef.current = note.id;
      }

      // 鑷啓鑷瀹堝崼锛氬鏋?note.content 姝ｆ槸鑷繁涓婃娲惧嚭鍘荤殑閭ｄ唤 JSON 瀛楃涓诧紝
      // 璇存槑杩欐 effect 鏄?EditorPane 淇濆瓨瀹屾垚鍚庡洖濉紩璧风殑 鈫?缂栬緫鍣?DOM 宸叉槸
      // 鏈€鏂帮紝涓嶉渶瑕?setContent锛堝惁鍒欎細鎵撴柇缁х画杈撳叆 / 浜х敓鍏夋爣鎶栧姩锛夈€?
      if (
        lastEmittedContentRef.current !== null &&
        note.content === lastEmittedContentRef.current
      ) {
        // 浠嶇劧鍒锋柊瀛楁暟/澶х翰锛屼繚璇佺姸鎬佹爮鍜屽ぇ绾蹭笌瀹為檯鍐呭鍚屾
        setWordStats(computeStats(editor.getText()));
        onHeadingsChange?.(extractHeadings(editor));
        if (titleRef.current && titleRef.current.value !== note.title) {
          titleRef.current.value = note.title;
        }
        return;
      }

      const parsed = parseContent(note.content);
      const currentJson = JSON.stringify(editor.getJSON());
      const newJson = JSON.stringify(parsed);
      if (currentJson !== newJson) {
        // 鏍囪姝ｅ湪璁剧疆鍐呭锛岄樆姝?onUpdate 瑙﹀彂淇濆瓨
        isSettingContent.current = true;
        editor.commands.setContent(parsed);
        // 浣跨敤 queueMicrotask 纭繚鍦?Tiptap 浜嬪姟瀹屾垚鍚庢墠瑙ｉ攣
        queueMicrotask(() => {
          isSettingContent.current = false;
        });
        // 澶栭儴椹卞姩鐨?setContent 涔嬪悗锛屾湰缂栬緫鍣ㄥ綋鍓嶆寔鏈夌殑 content 涓嶅啀绛変簬
        // 鑷繁涔嬪墠娲惧嚭鍘荤殑鍊硷紙鐜板湪鎸佹湁鐨勬槸 parsed 鍚庡啀閲嶆柊 serialize 鐨勭増鏈級锛?
        // 鎶?lastEmitted 娓呮帀锛岄伩鍏嶅悗缁鍒や负"鑷啓"銆?
        lastEmittedContentRef.current = null;
      }
      setWordStats(computeStats(editor.getText()));
      onHeadingsChange?.(extractHeadings(editor));
    }
    if (titleRef.current) {
      titleRef.current.value = note.title;
    }
  }, [note.id, note.content]);
  //   ^^^^^^^^^^^^^^^^^^^^^^
  //   渚濊禆鍚?content 鐨勫畬鏁磋涔夛紙鏇存柊鐗堬級锛?
  //
  //   鐖剁粍浠?EditorPane.handleUpdate 鐜板湪浼氭妸淇濆瓨鎴愬姛鐨?content 鍥炲～鍒?activeNote锛?
  //   杩欐牱鍒囨崲缂栬緫鍣?(MD 鈫?RTE) 鏃跺弻鏂归兘鑳界湅鍒版渶鏂板唴瀹广€備絾涓洪伩鍏?"鑷繁鍒氭淳鐨?
  //   JSON 鍙堣 setContent 鍥炴潵" 鎵撴柇杈撳叆锛屾湰 effect 鍐呯敤 lastEmittedContentRef
  //   鍋氳嚜鍐欒嚜璇诲畧鍗€傚懡涓垯 no-op锛屽惁鍒欐墠鎵ц鐪熸鐨?setContent銆?
  //
  //   瑙﹀彂鏃舵満锛?
  //   1) 鏈紪杈戝櫒鎵撳瓧淇濆瓨锛歝ontent 鍥炲～ == lastEmitted 鈫?瀹堝崼鍛戒腑 鈫?涓嶉噸鏀俱€?
  //   2) 瀵逛晶缂栬緫鍣ㄤ繚瀛樺悗鍒囧洖鏉ワ細content 涓嶇瓑浜?lastEmitted 鈫?姝ｅ父 setContent銆?
  //   3) 鐗堟湰鎭㈠ / 鍒囨崲绗旇 / 澶栭儴淇敼锛氬悓涓婏紝璧版甯?setContent銆?

  // ---------- 鏍囬鍗曠嫭鍚屾 ----------
  //
  // 鏍囬 input 鏄潪鍙楁帶鐨勶紙`defaultValue={note.title}`锛夛紝
  // 涓婇潰鐨勪富 effect 鍙湪 [note.id, note.content] 鍙樺寲鏃舵墠浼氳窇銆?
  // 褰撳閮ㄥ彧鏀瑰姩 title锛堝吀鍨嬶細鐐?AI 鐢熸垚鏍囬"鎸夐挳锛屽悗绔繑鍥炴柊鏍囬 鈫?setActiveNote锛夛紝
  // content 娌″彉锛屼富 effect 涓嶈Е鍙戯紝DOM 閲岀殑鏍囬姘歌繙淇濇寔鏃у€尖€斺€旂敤鎴蜂細浠ヤ负
  //銆孉I 鐢熸垚鏍囬娌＄敓鏁堛€嶃€傝繖閲屽姞涓€涓笓鐢?effect 鐩戝惉 note.title 鍗冲彲銆?
  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    if (el.value !== note.title) {
      el.value = note.title;
    }
  }, [note.title]);

  // 缁勪欢鍗歌浇鏃舵竻鐞?debounce timer
  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
        debounceTimer.current = null;
      }
      if (titleDebounceTimer.current) {
        clearTimeout(titleDebounceTimer.current);
        titleDebounceTimer.current = null;
      }
    };
  }, []);

  // 鍥剧墖鐐瑰嚮棰勮浜嬩欢鐩戝惉
  //
  // 琛屼负鍒嗘祦锛堣В鍐?鐐瑰浘鐗囩珛鍗虫斁澶с€佽皟涓嶅嚭 ResizableImageView 鐨勫昂瀵告墜鏌?闂锛夛細
  //   - 鍙鎬侊紙!editable锛夛細淇濇寔鍘熻涓猴紝鍗曞嚮鍥剧墖鍗冲脊 Lightbox 棰勮锛岀鍚堥槄璇绘湡鏈涖€?
  //   - 缂栬緫鎬侊細
  //       * 鍗曞嚮  鈫?璁?ProseMirror 閫変腑鍥剧墖鑺傜偣锛孯esizableImageView 鏄剧ず鍥涜鎵嬫焺銆?
  //                 杩欓噷鍙渶"涓嶆墦寮€棰勮"鍗冲彲锛堥€変腑鐢?ProseMirror 榛樿琛屼负瀹屾垚锛夈€?
  //       * 鍙屽嚮  鈫?鎵撳紑 Lightbox 棰勮鍘熷浘锛岀浉褰撲簬鏄惧紡"鎴戣鐪嬪ぇ鍥?鐨勬剰鍥撅紝
  //                 涓嶄細鍜屾嫋鍔ㄦ墜鏌勬敼灏哄鐨勬搷浣滀簰鐩稿共鎵般€?
  //
  // 娉ㄦ剰锛歨andle 鍏冪礌浣嶄簬鍥剧墖鍙充笅瑙掔瓑鍥涜澶勶紝浣跨敤 pointer-events:auto 浣?
  //   onMouseDown 浼?stopPropagation锛屾墍浠ユ嫋鎵嬫焺鏃朵笉浼氬啋娉″埌杩欓噷瑙﹀彂棰勮銆?
  useEffect(() => {
    if (!editor) return;

    const isEditorImage = (el: EventTarget | null): el is HTMLImageElement => {
      const node = el as HTMLElement | null;
      return !!node && node.tagName === "IMG" && !!node.closest(".ProseMirror");
    };

    const openPreview = (img: HTMLImageElement) => {
      const src = img.src;
      if (!src) return;
      setPreviewImage(src);
      setImageZoom(1);
      setImageDrag({ x: 0, y: 0 });
    };

    // 鍗曞嚮锛氫粎鍦ㄥ彧璇绘€佷笅鎵撳紑棰勮锛涚紪杈戞€佷繚鐣欑粰 ProseMirror 鍋氳妭鐐归€夋嫨銆?
    const handleClick = (e: MouseEvent) => {
      if (!isEditorImage(e.target)) return;
      if (editor.isEditable) return; // 缂栬緫鎬侊細璁╁嚭鍗曞嚮缁?閫変腑鈫掑嚭鎵嬫焺"
      openPreview(e.target as HTMLImageElement);
    };

    // 鍙屽嚮锛氱紪杈戞€佷笅鏄惧紡"鎵撳紑澶у浘棰勮"銆傚彧璇绘€佹鏃跺凡缁忚蛋 click 浜嗭紝
    // 涓嶅繀閲嶅澶勭悊锛堝弻鍑诲湪鍙鎬佷細琚?click 鍏堟秷璐逛竴娆′絾琛屼负涓€鑷达級銆?
    const handleDblClick = (e: MouseEvent) => {
      if (!isEditorImage(e.target)) return;
      if (!editor.isEditable) return;
      e.preventDefault();
      e.stopPropagation();
      openPreview(e.target as HTMLImageElement);
    };

    const editorDom = editor.view.dom;
    editorDom.addEventListener("click", handleClick);
    editorDom.addEventListener("dblclick", handleDblClick);
    return () => {
      editorDom.removeEventListener("click", handleClick);
      editorDom.removeEventListener("dblclick", handleDblClick);
    };
  }, [editor]);

  // 鍥剧墖棰勮婊氳疆缂╂斁
  const handlePreviewWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setImageZoom(prev => {
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      return Math.max(0.1, Math.min(5, prev + delta));
    });
  }, []);

  // 鍥剧墖棰勮鎷栨嫿
  const handlePreviewMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, imgX: imageDrag.x, imgY: imageDrag.y };
  }, [imageDrag]);

  const handlePreviewMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging) return;
    setImageDrag({
      x: dragStart.current.imgX + (e.clientX - dragStart.current.x),
      y: dragStart.current.imgY + (e.clientY - dragStart.current.y),
    });
  }, [isDragging]);

  const handlePreviewMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // 鍔ㄦ€佸垏鎹㈢紪杈戝櫒鐨勫彲缂栬緫鐘舵€?
  useEffect(() => {
    if (editor) {
      editor.setEditable(editable);
    }
  }, [editor, editable]);

  // ---------- 閾炬帴缂栬緫锛氬脊椤圭洰缁熶竴 prompt 寮圭獥锛屽伐鍏锋爮 & 閾炬帴姘旀场鍏辩敤 ----------
  // 鎶芥垚鍏变韩鍥炶皟閬垮厤涓ゅ閲嶅 ~40 琛?prompt + 瑙ｆ瀽 + apply 閫昏緫銆?
  // 杈撳叆妗嗘敮鎸?markdown.com.cn 鏍囧噯 `https://x.com "鏍囬"` 鍐欐硶锛?
  // 瑙ｆ瀽鏃舵妸绌烘牸鍚庣殑 "..." 閮ㄥ垎浣滀负 link mark 鐨?title 灞炴€с€?
  // range 鍙傛暟锛歨over 瑙﹀彂鏃朵紶鍏ヨ link 鍦ㄦ枃妗ｉ噷鐨勪綅缃紝鍏堝垏鎹㈤€夊尯鍐嶈鍙?淇敼锛?
  //   caret 瑙﹀彂鏃朵笉浼狅紝浣跨敤褰撳墠閫夊尯鍘熻涔変笉鍙樸€?
  const openLinkEditor = useCallback(async (range?: { from: number; to: number }) => {
    if (!editor) return;
    if (range && range.from < range.to) {
      editor.chain().focus().setTextSelection(range).run();
    }
    const { from, to, empty } = editor.state.selection;
    const previousAttrs = editor.getAttributes("link") as { href?: string; title?: string | null };
    const previous = previousAttrs?.href ?? "";
    const previousTitle = previousAttrs?.title ?? "";
    const defaultValue = previous
      ? previousTitle
        ? `${previous} "${previousTitle}"`
        : previous
      : "https://";

    const url = await promptDialog({
      title: t("tiptap.link"),
      placeholder: 'https://example.com  鎴? https://example.com "鏍囬"',
      defaultValue,
      confirmText: t("common.confirm"),
      cancelText: t("common.cancel"),
      allowEmpty: true, // 绌哄瓧绗︿覆 = 绉婚櫎閾炬帴锛屽繀椤诲紑
    });
    if (url == null) return;

    const trimmed = url.trim();
    if (!trimmed) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }

    const match = trimmed.match(/^(\S+)(?:\s+"([^"]*)")?$/);
    const rawHref = (match?.[1] ?? trimmed).trim();
    const linkTitle = match?.[2] ?? null;

    const safe = /^(https?:|mailto:|tel:|\/|#)/i.test(rawHref)
      ? rawHref
      : `https://${rawHref}`;

    const attrs: { href: string; title?: string | null } = { href: safe };
    if (linkTitle) attrs.title = linkTitle;

    if (empty) {
      // 鍏夋爣鍦ㄥ凡鏈夐摼鎺ラ噷锛氬厛鎵╁埌鏁存閾炬帴鍐?setLink锛岃鐩栫幇鏈?mark
      // 瀹屽叏绌洪€夊尯涓斾笉鍦ㄩ摼鎺ヤ笂锛氱洿鎺ユ彃鍏?URL 鏂囨湰骞舵墦 mark
      if (editor.isActive("link")) {
        editor.chain().focus().extendMarkRange("link").setLink(attrs).run();
      } else {
        editor
          .chain()
          .focus()
          .insertContent({
            type: "text",
            text: rawHref,
            marks: [{ type: "link", attrs }],
          })
          .run();
      }
    } else {
      editor.chain().focus().setTextSelection({ from, to }).extendMarkRange("link").setLink(attrs).run();
    }
  }, [editor, t]);

  // 鍙栨秷閾炬帴锛氭墿鍒?link mark 鑼冨洿鍚?unsetLink銆?
  // range 鍙傛暟锛歨over 瑙﹀彂鏃朵紶鍏ヨ link 浣嶇疆锛岄伩鍏嶁€滈紶鏍囧湪閾炬帴涓婁絾鍏夋爣涓嶅湪鈥濇椂闈欓粯澶辫触銆?
  const removeLink = useCallback((range?: { from: number; to: number }) => {
    if (!editor) return;
    if (range && range.from < range.to) {
      editor.chain().focus().setTextSelection(range).extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
  }, [editor]);

  // 鎵撳紑閾炬帴锛氬湪鏂扮獥鍙?鏂版爣绛鹃〉閲屾墦寮€ href
  const openLinkUrl = useCallback((href: string) => {
    if (!href) return;
    window.open(href, "_blank", "noopener,noreferrer");
  }, []);

  // ---------- 鎵嬪姩閫夊尯姘旀场鑿滃崟瀹氫綅 ----------
  // 鐩戝惉 selectionUpdate / blur锛岃绠楁诞鍔ㄨ彍鍗曞潗鏍囷紙fixed 瀹氫綅锛岃鍙ｅ潗鏍囷級
  //
  // 瑙﹀睆閬胯绛栫暐锛?026-05-18锛屾寜鐢ㄦ埛鍙嶉"绯荤粺澶嶅埗鑿滃崟閬尅閫夊尯宸ュ叿鏍?淇锛夛細
  //   Android / iOS 闀挎寜鏂囨湰鏃剁郴缁熶細鑷姩寮瑰師鐢?ActionMode锛堝壀鍒?澶嶅埗/鍏ㄩ€?鏈楄锛夛紝
  //   榛樿鏄剧ず鍦?*閫夊尯涓婃柟**銆傛垜浠殑鑷畾涔夋皵娉′篃榛樿鏀句笂鏂癸紝涓よ€呬細绮剧‘閲嶅彔銆?
  //   - 妫€娴嬫渶杩戜竴娆?pointer 浜嬩欢 type 鏄惁涓?"touch"锛?50ms 鍐咃級锛?
  //   - 鑻ユ槸锛屽垯姘旀场鏀惧湪**閫夊尯涓嬫柟**锛坱op = bottom + 8锛夛紝閿欏紑绯荤粺鑿滃崟锛?
  //   - 鑻ラ€夊尯宸茬粡鎺ヨ繎瑙嗗彛搴曢儴锛堝啀寰€涓嬫斁浼氳閿洏鍚炴帀锛夛紝fallback 鍥炰笂鏂癸紱
  //   - 榧犳爣 / 妗岄潰绔緷鐒舵寜"涓婃柟灞呬腑"閫昏緫锛屼笉鍙樸€?
  const lastTouchAtRef = useRef<number>(0);
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType === "touch") lastTouchAtRef.current = Date.now();
    };
    window.addEventListener("pointerdown", onPointer, { passive: true });
    window.addEventListener("pointerup", onPointer, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("pointerup", onPointer);
    };
  }, []);

  useEffect(() => {
    if (!editor) return;

    /**
     * 鏍规嵁閫夊尯鐭╁舰璁＄畻姘旀场浣嶇疆锛?
     *   - desktop / 榧犳爣锛氫笂鏂瑰眳涓紙top = rect.top - 44锛?
     *   - 瑙﹀睆锛氫笅鏂瑰眳涓紙top = rect.bottom + 8锛夛紝閿欏紑绯荤粺 ActionMode
     *   - 瑙﹀睆 & 閫夊尯璐磋繎瑙嗗彛搴曢儴锛歠allback 涓婃柟
     */
    const placeBubble = (rect: { top: number; bottom: number; left: number; right: number; width: number }, bubbleHeight = 40, bubbleWidth = 220) => {
      const isTouch = Date.now() - lastTouchAtRef.current < 800; // 瑙﹀睆鍚?800ms 鍐呴兘绠楄Е灞忚Е鍙?
      const cx = rect.left + rect.width / 2;
      let top: number;
      if (isTouch) {
        const below = rect.bottom + 8;
        const overflowsBottom = below + bubbleHeight > window.innerHeight - 16;
        // 璺濈搴曢儴澶繎灏?fallback 鍒颁笂鏂癸紙鍐嶄笂鍋?4px锛岀粰绯荤粺鑿滃崟涓€浜涜瑙夌紦鍐诧級
        top = overflowsBottom ? Math.max(8, rect.top - bubbleHeight - 8) : below;
      } else {
        top = Math.max(8, rect.top - bubbleHeight - 4);
      }
      const left = Math.max(8, Math.min(cx - bubbleWidth / 2, window.innerWidth - bubbleWidth - 10));
      return { top, left };
    };

    const updateBubble = () => {
      const { state, view } = editor;
      const { selection } = state;
      const { from, to, empty } = selection;

      // 缂栬緫鍣ㄥけ鐒?鈫?鍏抽棴鎵€鏈夋皵娉?
      if (!view.hasFocus()) {
        setBubble(b => b.open ? { ...b, open: false } : b);
        setImageBubble(b => b.open ? { ...b, open: false } : b);
        setLinkBubble(b => b.open ? { ...b, open: false } : b);
        setTableBubble(b => b.open ? { ...b, open: false } : b);
        return;
      }

      // 绌洪€夊尯 鈫?鏂囨湰/鍥剧墖鏍煎紡鍖栨皵娉￠兘鍏筹紝浣嗚嫢鍏夋爣鍋滃湪閾炬帴閲岋紝鏄剧ず閾炬帴姘旀场
      if (empty) {
        setBubble(b => b.open ? { ...b, open: false } : b);
        setImageBubble(b => b.open ? { ...b, open: false } : b);

        // 鍏夋爣鍦ㄨ〃鏍奸噷 鈫?鏄剧ず琛ㄦ牸鎿嶄綔姘旀场锛堢嫭绔嬩簬 link 姘旀场锛屽洜涓鸿〃鏍奸噷鍩烘湰涓嶄細鏈?link锛?
        if (editor.isActive("table")) {
          // 鐢ㄥ綋鍓嶅厜鏍囦綅缃墍鍦?<td>/<th> 鐨?DOM 浣滀负閿氬畾鐭╁舰
          let cellEl: HTMLElement | null = null;
          try {
            const dom = view.domAtPos(from).node as Node | null;
            const el = dom instanceof Element ? dom : dom?.parentElement ?? null;
            cellEl = el?.closest?.("td, th") as HTMLElement | null;
          } catch { /* ignore */ }
          if (cellEl) {
            const cellRect = cellEl.getBoundingClientRect();
            // 琛ㄦ牸姘旀场杈冨锛屼及 360锛涙斁涓婃柟锛屾斁涓嶄笅鏃堕檷鍒颁笅鏂癸紙placeBubble 宸插鐞嗭級
            const { top } = placeBubble(cellRect, 40, 360);
            const cx = cellRect.left + cellRect.width / 2;
            const left = Math.max(8, Math.min(cx - 180, window.innerWidth - 370));
            setTableBubble({ open: true, top, left });
          } else {
            setTableBubble(b => b.open ? { ...b, open: false } : b);
          }
        } else {
          setTableBubble(b => b.open ? { ...b, open: false } : b);
        }

        if (editor.isActive("link")) {
          // 鍙栨暣娈?link mark 鐨勮寖鍥寸敤浜庡畾浣嶏紙鍏夋爣浣嶇疆鐭╁舰鏄浂瀹斤紝瀹氫綅浼氬亸锛?
          const $pos = state.doc.resolve(from);
          const linkType = state.schema.marks.link;
          // resolvedPos.marks() 缁欏綋鍓嶄綅缃殑鎵€鏈?mark锛涙壘 link 鍚庣敤 mark.attrs.href
          const linkMark = $pos.marks().find((m: any) => m.type === linkType);
          const href = (linkMark?.attrs as { href?: string } | undefined)?.href ?? "";
          // ProseMirror 娌℃湁 getMarkRange 鍦?Node 涓婏紝浣?Tiptap 鍦ㄩ€夊尯鏂规硶閲屾湁锛?
          // 杩欓噷鐢?textBetween 鍙嶆煡 + 浠庡綋鍓嶄綅缃悜宸﹀彸鎵╁睍鎵?mark 杈圭晫锛岄伩鍏嶅紩鍏ユ柊渚濊禆
          let start = from;
          let end = from;
          // 鍚戝乏鎵?
          while (start > 0) {
            const prevPos = state.doc.resolve(start - 1);
            if (prevPos.marks().some((m: any) => m.type === linkType && m.eq(linkMark!))) {
              start -= 1;
            } else break;
          }
          // 鍚戝彸鎵?
          while (end < state.doc.content.size) {
            const nextPos = state.doc.resolve(end);
            if (nextPos.marks().some((m: any) => m.type === linkType && m.eq(linkMark!))) {
              end += 1;
            } else break;
          }

          // 閾炬帴姘旀场鐢ㄦ暣娈?link rect + 鍏夋爣 x锛堥伩鍏嶉暱閾炬帴鎹㈣鏃跺眳涓亸鍒拌涓偣锛?
          const linkRect = posToDOMRect(view, start, end);
          const caretRect = posToDOMRect(view, from, from);
          const { top } = placeBubble(linkRect, 40, 280);
          const cx = caretRect.left; // 鍏夋爣 x锛堥浂瀹界煩褰紝left===right锛?
          // 姘旀场瀹藉害绾?280px锛屽眳涓噺鍗婏紝骞跺す鍒拌鍙ｅ唴
          const left = Math.max(8, Math.min(cx - 140, window.innerWidth - 290));
          // 闄勪欢閾炬帴闇€瑕?filename锛氫粠 DOM 涓婄殑 <a download="..."> 灞炴€у彇鈥斺€?
          // ProseMirror 鍦?link mark attrs 閲屼笉瀛?download锛屼絾娓叉煋鍑虹殑 DOM
          // 鑺傜偣涓婁繚鐣欎簡銆傜敤 view.domAtPos 鎷垮埌鍖呰９鏂囨湰鐨?anchor 鍏冪礌銆?
          let filename = "";
          try {
            const dom = view.domAtPos(from).node as Node | null;
            const el = dom instanceof Element ? dom : dom?.parentElement ?? null;
            const anchor = el?.closest?.("a") as HTMLAnchorElement | null;
            filename = anchor?.getAttribute("download") ?? "";
          } catch { /* 鍙栦笉鍒板氨绌猴紝涓嬭浇鏃堕檷绾х敤 URL 鏈熬娈?*/ }
          setLinkBubble({ open: true, top, left, href, filename, source: "caret", from: start, to: end });
        } else {
          // 浠呭叧闂?caret 瑙﹀彂鐨勬皵娉★紝hover 瑙﹀彂鐨勭暀缁?mouse 浜嬩欢鍘诲叧
          setLinkBubble(b => (b.open && b.source === "caret") ? { ...b, open: false } : b);
        }
        return;
      }

      // 鏈夐€夊尯 鈫?鍏抽棴 caret 閾炬帴姘旀场锛坔over 鐨勪笉鍔級锛岃蛋鍘熸湁鏂囨湰/鍥剧墖姘旀场閫昏緫
      setLinkBubble(b => (b.open && b.source === "caret") ? { ...b, open: false } : b);
      // Keep table bubble open when cells are selected
      if (editor.isActive("table")) {
        const rect = posToDOMRect(view, from, to);
        const { top } = placeBubble(rect, 40, 360);
        const cx = rect.left + rect.width / 2;
        const left = Math.max(8, Math.min(cx - 180, window.innerWidth - 370));
        setTableBubble({ open: true, top, left });
      } else {
        setTableBubble(b => b.open ? { ...b, open: false } : b);
      }

      const isImage = editor.isActive("image");

      if (isImage) {
        // 鍥剧墖閫夊尯 鈫?鏄剧ず鍥剧墖灏哄姘旀场
        setBubble(b => b.open ? { ...b, open: false } : b);
        const rect = posToDOMRect(view, from, to);
        const { top, left } = placeBubble(rect, 40, 280);
        setImageBubble({ open: true, top, left });
      } else {
        // 鏂囨湰閫夊尯 鈫?鏄剧ず鏍煎紡鍖栨皵娉?
        setImageBubble(b => b.open ? { ...b, open: false } : b);
        // 鑻ユ枃鏈暱搴︿负 0锛堝叏鏄笉鍙瀛楃锛変篃璺宠繃
        const text = state.doc.textBetween(from, to, " ");
        if (!text.trim().length) {
          setBubble(b => b.open ? { ...b, open: false } : b);
          return;
        }
        const rect = posToDOMRect(view, from, to);
        const { top, left } = placeBubble(rect, 40, 220);
        setBubble({ open: true, top, left });
      }
    };

    const onBlur = () => {
      // 寤惰繜涓€甯у叧闂紝閬垮厤鐐瑰嚮姘旀场鑿滃崟鎸夐挳鏃跺洜 blur 鑰岃彍鍗曟秷澶?
      requestAnimationFrame(() => {
        if (!editor.view.hasFocus()) {
        // 濡傛灉鐒︾偣绉诲埌浜嗗脊绐楀唴锛堝瀛楀彿/棰滆壊閫夋嫨鍣級锛屼笉鍏抽棴姘旀场鑿滃崟
          const ae = document.activeElement;
          if (ae && ae !== document.body && (ae as Element).closest?.('[data-popover]')) return;
          setBubble(b => b.open ? { ...b, open: false } : b);
          setImageBubble(b => b.open ? { ...b, open: false } : b);
          // 鍙叧 caret 瑙﹀彂鐨勯摼鎺ユ皵娉★紱hover 姘旀场涓嶄緷璧栫紪杈戝櫒 focus
          setLinkBubble(b => (b.open && b.source === "caret") ? { ...b, open: false } : b);
          setTableBubble(b => b.open ? { ...b, open: false } : b);
        }
      });
    };

    editor.on("selectionUpdate", updateBubble);
    editor.on("blur", onBlur);

    // ---- hover 瑙﹀彂閾炬帴姘旀场 ----
    // ProseMirror 鐨勭紪杈戝櫒 DOM 涓嶉€傚悎鐢?React 鍚堟垚浜嬩欢锛堥渶瑕佺粰 contentEditable
    // 澶栭儴璺宠繃浜嬩欢浣撶郴锛夛紝鐩存帴鍘熺敓 addEventListener銆傜敤浜嬩欢濮旀淳锛屽湪鐖?dom 涓婂惉
    // mouseover/mouseout锛岀敤 closest('a[href]') 杩囨护銆?
    const editorDom = editor.view.dom as HTMLElement;
    const ATTACHMENT_RE = /^\/api\/attachments\/[0-9a-fA-F-]{36}/;

    const showBubbleForAnchor = (anchor: HTMLAnchorElement) => {
      const href = anchor.getAttribute("href") || "";
      if (!href) return;
      // 闄勪欢閾炬帴浼樺厛鐢?download 灞炴€э紱鎷夸笉鍒板氨浠庨摼鎺ユ枃鏈€滒煋?鍚嶅瓧 (澶у皬)鈥濋噷鎶?
      let filename = anchor.getAttribute("download") || "";
      if (!filename && ATTACHMENT_RE.test(href)) {
        const txt = anchor.textContent || "";
        const m = txt.match(/馃搸\s*(.+?)\s*\([^)]*\)\s*$/);
        filename = m ? m[1] : txt.replace(/^馃搸\s*/, "");
      }
      const rect = anchor.getBoundingClientRect();
      const { top } = placeBubble(rect, 40, 280);
      // 涓?caret 璺緞涓€鑷达細姘旀场绾?280瀹斤紝浠ラ摼鎺ユí涓负鍑嗭紝澶瑰埌瑙嗗彛鍐?
      const cx = rect.left + rect.width / 2;
      const left = Math.max(8, Math.min(cx - 140, window.innerWidth - 290));
      // 浠?anchor DOM 鍙嶆煡 ProseMirror 浣嶇疆锛屽啀娌?link mark 鍚戜袱渚ф墿鍒拌竟鐣屻€?
      // 鎷夸笉鍒颁綅缃氨璁?0/0锛岀偣鍑诲姩浣滄椂浼氶檷绾ц蛋鍘熼€夊尯閫昏緫銆?
      let from = 0, to = 0;
      try {
        const view = editor.view;
        const pos = view.posAtDOM(anchor, 0);
        if (pos >= 0) {
          const linkType = view.state.schema.marks.link;
          let s = pos, e = pos;
          while (s > 0) {
            const $p = view.state.doc.resolve(s - 1);
            if ($p.marks().some((m: any) => m.type === linkType && m.attrs.href === href)) s -= 1;
            else break;
          }
          while (e < view.state.doc.content.size) {
            const $p = view.state.doc.resolve(e);
            if ($p.marks().some((m: any) => m.type === linkType && m.attrs.href === href)) e += 1;
            else break;
          }
          from = s; to = e;
        }
      } catch { /* 浣嶇疆瀹氫笉浣忓氨淇濇寔 0/0 */ }
      setLinkBubble({ open: true, top, left, href, filename, source: "hover", from, to });
    };

    const onMouseOver = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || !editorDom.contains(anchor)) return;
      // hover 涓彇娑堝緟鍏抽棴
      if (linkHoverCloseTimer.current) {
        clearTimeout(linkHoverCloseTimer.current);
        linkHoverCloseTimer.current = null;
      }
      showBubbleForAnchor(anchor);
    };

    const onMouseOut = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor) return;
      // relatedTarget 浠嶅湪鍚屼竴涓?anchor 閲岋紙璺ㄥ瓙鑺傜偣绉诲姩锛変笉绠楃寮€
      const next = e.relatedTarget as Node | null;
      if (next && anchor.contains(next)) return;
      // 寤惰繜鍏抽棴锛岀粰榧犳爣浠庨摼鎺ヨ繃娓″埌姘旀场鐣欑紦鍐叉湡
      if (linkHoverCloseTimer.current) clearTimeout(linkHoverCloseTimer.current);
      linkHoverCloseTimer.current = setTimeout(() => {
        setLinkBubble(b => (b.open && b.source === "hover") ? { ...b, open: false } : b);
      }, 150);
    };

    editorDom.addEventListener("mouseover", onMouseOver);
    editorDom.addEventListener("mouseout", onMouseOut);

    return () => {
      editor.off("selectionUpdate", updateBubble);
      editor.off("blur", onBlur);
      editorDom.removeEventListener("mouseover", onMouseOver);
      editorDom.removeEventListener("mouseout", onMouseOut);
      if (linkHoverCloseTimer.current) {
        clearTimeout(linkHoverCloseTimer.current);
        linkHoverCloseTimer.current = null;
      }
    };
  }, [editor]);

  // Provide scrollTo callback to parent
  useEffect(() => {
    if (!editor) return;
    const scrollTo = (pos: number) => {
      editor.commands.focus();
      editor.commands.setTextSelection(pos);
      // Scroll the heading node into view
      const dom = editor.view.domAtPos(pos + 1);
      if (dom?.node) {
        const el = dom.node instanceof HTMLElement ? dom.node : dom.node.parentElement;
        el?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    onEditorReady?.(scrollTo);
  }, [editor, onEditorReady]);

  /**
   * 妗岄潰绔牸寮忚彍鍗曟ˉ锛坢acOS 鍘熺敓鑿滃崟 / 蹇嵎閿?鈫?Tiptap锛?
   * ----------------------------------------------------------------
   * 鐩戝惉 window "nowen:format" 鑷畾涔変簨浠讹紝鐢?`useDesktopMenuBridge`锛圓pp.tsx锛?
   * 鍦ㄦ敹鍒?Electron 涓昏繘绋?"menu:format" IPC 鏃舵淳鍙戙€俻ayload 褰㈠锛?
   *   { mark: "bold" | "italic" | "underline" | "strike" | "code" }
   *   { node: "heading", level: 1..6 }
   *   { node: "paragraph" }
   *
   * 涓轰粈涔堢洿鎺ョ洃鍚?window 浜嬩欢锛堣€屼笉鏄€氳繃 ref 鏆撮湶 runFormat锛夛細
   *   - editor 鏄?TiptapEditor 闂寘鍐呭彉閲忥紝绌?ref 浼氭薄鏌?NoteEditorHandle 鍚堢害锛?
   *   - EditorPane 鍚屼竴鏃跺埢鍙細娓叉煋涓€涓?TiptapEditor锛圡D/HTML 妯″紡鏃朵笉鎸傝浇锛夛紝
   *     涓嶅瓨鍦ㄥ瀹炰緥绔炴€侊紱鍗充娇鍦?RTE 妯″紡涓嬩篃鍙湁涓€涓?subscription锛?
   *   - 褰撶紪杈戝櫒鏈寕杞斤紙鍒囧埌 MD 妯″紡锛夛紝鏍煎紡鑿滃崟鏈氨搴旇鏃犲搷搴斺€斺€?
   *     娌℃湁 subscriber 鑷劧 no-op锛岃涔夋纭€?
   *
   * 鍙湪 editable 涓?editor 宸插氨缁椂鐢熸晥锛沞ditor 鏈氨缁?/ 鍙妯″紡涓嬪拷鐣ワ紝閬垮厤
   * `chain()` 鍦ㄨ閿€姣佺殑 view 涓婃姤閿欍€?
   */
  useEffect(() => {
    if (!editor || !editable) return;
    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<FormatMenuPayload>).detail;
      if (!detail || editor.isDestroyed) return;

      const chain = editor.chain().focus();
      if (detail.mark) {
        switch (detail.mark) {
          case "bold":      chain.toggleBold().run();      break;
          case "italic":    chain.toggleItalic().run();    break;
          case "underline": chain.toggleUnderline().run(); break;
          case "strike":    chain.toggleStrike().run();    break;
          case "code":      chain.toggleCode().run();      break;
        }
        return;
      }
      if (detail.node === "heading" && detail.level) {
        const lvl = detail.level as 1 | 2 | 3 | 4 | 5 | 6;
        // 鐢?smart 鐗堟湰锛氳嫢褰撳墠娈佃惤鍚?<br>锛坔ardBreak锛夛紝鍏堟媶鎴愮嫭绔嬫钀藉啀 toggle
        toggleHeadingSmart(editor, lvl);
        return;
      }
      if (detail.node === "paragraph") {
        chain.setParagraph().run();
      }
    };
    window.addEventListener("nowen:format", handler as EventListener);
    return () => window.removeEventListener("nowen:format", handler as EventListener);
  }, [editor, editable]);

  /**
   * 鍘熺敓鑿滃崟 checked 鍚屾锛圗lectron / macOS锛?
   * ----------------------------------------------------------------
   * HIG锛氳彍鍗曢」搴斿弽鏄犲綋鍓嶄笂涓嬫枃鐘舵€佲€斺€斿綋鍓嶉€夊尯宸插姞绮楋紝鍒?鏍煎紡 鈫?鍔犵矖"鏃佹樉绀?鉁撱€?
   *
   * 瀹炵幇鎬濊矾锛?
   *   - 璁㈤槄 Tiptap 鐨?`selectionUpdate`/`transaction` 浜嬩欢锛岄噰闆嗗竷灏斿揩鐓э紱
   *   - 鑺傛祦 100ms锛氫汉鐪?10fps 瓒冲鎰熺煡鑿滃崟鍕鹃€夊垏鎹紝鏇撮珮棰戝彧鏄櫧鐧界儳 IPC锛?
   *   - 娴呮瘮杈冨幓閲嶏細澶у鏁伴敭鐩樿緭鍏ヤ笉鏀瑰彉鏍煎紡鐘舵€侊紝鍘婚噸鍚?IPC 璋冪敤閲忛檷鑷?~0銆?
   *   - 缂栬緫鍣ㄥ嵏杞?/ 澶辩劍鏃跺彂 null锛岃涓昏繘绋嬫竻绌烘墍鏈?checked锛堥伩鍏?娈嬪奖"锛夈€?
   *
   * 浠呭湪 Electron 鐜涓嬫湁鏁堬紱Web / 绉诲姩绔?window.nowenDesktop 涓嶅瓨鍦紝鐩存帴鐭矾銆?
   *
   * Markdown 妯″紡涓?TiptapEditor 鏍规湰娌℃寕杞斤紝鑷劧涓嶄細涓婃姤鈥斺€旂鍚堣涔夛細
   * 鑿滃崟 checked 鍙嶆槧鐨勫缁堟槸"褰撳墠姝ｅ湪缂栬緫鐨勯偅涓笂涓嬫枃"銆侻D 鏈潵鑻ラ渶瑕佸彲浠?
   * 澶嶇敤鍚屼竴閫氶亾锛岃繖閲屼笉灞曞紑銆?
   */
  useEffect(() => {
    if (!editor) return;

    let lastKey = "";
    let timer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      timer = null;
      if (editor.isDestroyed) return;
      const state = {
        bold: editor.isActive("bold"),
        italic: editor.isActive("italic"),
        underline: editor.isActive("underline"),
        strike: editor.isActive("strike"),
        code: editor.isActive("code"),
        heading1: editor.isActive("heading", { level: 1 }),
        heading2: editor.isActive("heading", { level: 2 }),
        heading3: editor.isActive("heading", { level: 3 }),
        paragraph: editor.isActive("paragraph"),
      };
      // 娴呭幓閲嶏細鎶婂竷灏斿€间覆鎴?9-bit 瀛楃涓诧紝鐩哥瓑鍒欎笉鍙?IPC
      const key = Object.values(state).map((v) => (v ? "1" : "0")).join("");
      if (key === lastKey) return;
      lastKey = key;
      sendFormatState(state);
    };

    const schedule = () => {
      if (timer) return; // 100ms 绐楀彛鍐呭悎骞跺涓簨浠?
      timer = setTimeout(flush, 100);
    };

    const onBlur = () => {
      // blur 绔嬪嵆娓呯┖锛氱敤鎴峰垏鍒板埆澶勬椂鑿滃崟涓嶅簲淇濈暀鏃у嬀閫?
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      lastKey = "";
      sendFormatState(null);
    };

    editor.on("selectionUpdate", schedule);
    editor.on("transaction", schedule);
    editor.on("focus", schedule);
    editor.on("blur", onBlur);

    // 鎸傝浇鏃舵帹涓€娆″垵濮嬬姸鎬?
    schedule();

    return () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      editor.off("selectionUpdate", schedule);
      editor.off("transaction", schedule);
      editor.off("focus", schedule);
      editor.off("blur", onBlur);
      // 鍗歌浇娓呯┖锛岄伩鍏嶅垏鍒?MD 妯″紡鍚庤彍鍗曚粛鏄剧ず Tiptap 鐨勬棫鐘舵€?
      sendFormatState(null);
    };
  }, [editor]);

  const handleTitleChange = useCallback(() => {
    // P0-1: 浣跨敤鐙珛鐨?titleDebounceTimer锛屼笉鍐嶅鐢?debounceTimer锛?
    // 閬垮厤娓呮帀鍐呭鐨?pending debounce锛屼笖鍙彂 title 瀛楁锛岀粷涓嶅甫 content銆?
    // 杩欐牱鏃犺鏍囬淇濆瓨浣曟椂杩斿洖锛岄兘涓嶄細瑙︾ lastEmittedContentRef锛?
    // 鍚庣画涓?effect 鐨勮嚜鍐欏畧鍗户缁寜"涓婃娲惧嚭鍘荤殑鍐呭"鍒ゅ畾锛屼笉浼氳閲嶅缓缂栬緫鍣ㄣ€?
    if (titleDebounceTimer.current) clearTimeout(titleDebounceTimer.current);
    titleDebounceTimer.current = setTimeout(() => {
      titleDebounceTimer.current = null;
      const title = titleRef.current?.value || "";
      onUpdateRef.current({ title });
    }, 500);
  }, []);

  const handleImageUpload = useCallback(() => {
    if (!editor) return;
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const currentNote = noteRef.current;
      const insertAtSrc = (src: string) => {
        editor.chain().focus().setImage({ src }).run();
      };
      if (currentNote?.id) {
        // 璧?/api/attachments锛氬啓纾佺洏 + 璁板綍 attachments 琛紝缂栬緫鍣ㄥ彧寮曠敤 URL
        toast.info(t("tiptap.imageUploading") || "Uploading image...");
        api.attachments
          .upload(currentNote.id, file)
          .then(({ url }) => {
            insertAtSrc(url);
            toast.success(t("tiptap.imageUploadSuccess") || "Image uploaded");
          })
          .catch((err) => {
            console.error("Attachment upload failed, falling back to base64:", err);
            toast.error(t("tiptap.imageUploadFailed") || "Image upload failed");
            // 鍏滃簳锛氬け璐ユ椂閫€鍥?base64锛屼繚璇佺敤鎴蜂粛鍙彃鍥?
            const reader = new FileReader();
            reader.onload = (e) => {
              const src = e.target?.result as string;
              if (src) insertAtSrc(src);
            };
            reader.readAsDataURL(file);
          });
      } else {
        const reader = new FileReader();
        reader.onload = (e) => {
          const src = e.target?.result as string;
          if (src) insertAtSrc(src);
        };
        reader.readAsDataURL(file);
      }
    };
    input.click();
  }, [editor, t]);

  /**
   * 浠绘剰鏍煎紡闄勪欢涓婁紶 鈫?鍦ㄧ紪杈戝櫒褰撳墠浣嶇疆鎻掑叆锛?
   *   - 鍥剧墖锛坕mage/*锛夛細褰撲綔 <img> 鎻掑叆锛屼笌 handleImageUpload 涓€鑷磋矾寰?
   *   - 鍏跺畠锛氭彃鍏ヤ竴娈点€岄檮浠堕摼鎺ャ€岺TML锛?
   *       <a href="/api/attachments/<id>" download="<鍘熸枃浠跺悕>"
   *          data-attachment="1" data-size="<bytes>">馃搸 鏂囦欢鍚?(澶у皬)</a>
   *     - data-attachment / data-size 鐢ㄤ簬灏嗘潵璇嗗埆 / 浜屾娓叉煋锛堝鎹㈠浘鏍囷級锛?
   *     - download 灞炴€?+ 鍚庣 Content-Disposition 鍙屼繚闄╄Е鍙戜笅杞斤紱
   *     - 閾炬帴鐢?StarterKit 榛樿 Link mark 鎵胯浇锛坴3 starter-kit 榛樿鍚?link锛夛紝
   *       鍗充究娌℃湁 link mark 涔熻兘浣滀负鏅€?<a> 鏂囨湰鑺傜偣瀛樻椿涓嬫潵銆?
   *
   * 涓?handleImageUpload 瑙ｈ€︾殑濂藉锛?
   *   - 宸ュ叿鏍忓彲浠ュ悓鏃跺瓨鍦ㄣ€屾彃鍏ュ浘鐗囥€嶏紙浠呭浘鐗囨枃浠?picker锛夊拰銆屾彃鍏ラ檮浠躲€嶏紙浠绘剰锛夛紝
   *     涓や釜鍏ュ彛璇箟娓呮櫚锛?
   *   - 绮樿创 / 鎷栨嫿璺緞鍙皟鏈嚱鏁板嵆鍙紙宸茶嚜鍔ㄦ寜 mime 鍒嗘祦锛夈€?
   */
  const handleAttachmentUpload = useCallback(() => {
    if (!editor) return;
    const input = document.createElement("input");
    input.type = "file";
    // 涓嶈 accept锛氭斁寮€浠绘剰鏍煎紡
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      uploadAndInsertAttachment(file);
    };
    input.click();

    function uploadAndInsertAttachment(file: File) {
      const currentNote = noteRef.current;
      if (!currentNote?.id) {
        toast.error(t("tiptap.attachmentUploadFailed") || "Attachment upload failed");
        return;
      }
      toast.info(t("tiptap.attachmentUploading") || "Uploading attachment...");
      api.attachments
        .upload(currentNote.id, file)
        .then((res) => {
          if (res.category === "image") {
            // 鍥剧墖锛氫笌 handleImageUpload 涓€鑷达紝璧?setImage
            editor!.chain().focus().setImage({ src: res.url }).run();
          } else {
            const html = buildAttachmentLinkHtml(res.filename, res.url, res.size);
            editor!.chain().focus().insertContent(html).run();
          }
          toast.success(t("tiptap.attachmentUploaded") || "Attachment uploaded");
        })
        .catch((err: any) => {
          console.error("Attachment upload failed:", err);
          const msg = String(err?.message || "");
          if (/鏈€澶max\s+\d+\s*MB/i.test(msg)) {
            toast.error(t("tiptap.attachmentTooLarge") || "File too large");
          } else {
            toast.error(t("tiptap.attachmentUploadFailed") || "Attachment upload failed");
          }
        });
    }
  }, [editor, t]);

  /**
   * 涓ユ牸浣滅敤浜庡綋鍓嶉€夊尯鐨勪唬鐮佸潡鍒囨崲锛?
   *   - 鍏夋爣鍦ㄤ唬鐮佸潡鍐咃細鍙栨秷浠ｇ爜鍧楋紙杞负娈佃惤锛夛紝涓庨粯璁?toggleCodeBlock 涓€鑷?
   *   - 鏃犻€夊尯锛氬皢鍏夋爣鎵€鍦ㄧ殑鏁翠釜鍧楀垏鎹负浠ｇ爜鍧楋紙涓庨粯璁よ涓轰竴鑷达級
   *   - 鏈夐€夊尯锛氭妸閫夊尯瑕嗙洊鐨勬墍鏈夐《灞傚潡鍚堝苟涓轰竴涓?codeBlock
   *            锛堜互椤跺眰鍧椾负绮掑害锛屼笉鍋?鍗婂潡鍒囧嚭"澶勭悊锛岄伩鍏嶈法澶氬潡鏇挎崲浜х敓澶氫釜浠ｇ爜鍧楋級
   */
  const toggleCodeBlockStrict = useCallback(() => {
    if (!editor) return;
    const { state } = editor;
    const { selection, schema, doc } = state;
    const codeBlockType = schema.nodes.codeBlock;
    if (!codeBlockType) return;

    // 鍏夋爣宸插湪浠ｇ爜鍧楀唴锛氬彇娑堜唬鐮佸潡
    if (editor.isActive("codeBlock")) {
      editor.chain().focus().toggleCodeBlock().run();
      return;
    }

    // 鏃犻€夊尯锛氶€€鍥為粯璁よ涓猴紙杞綋鍓嶅潡涓轰唬鐮佸潡锛?
    if (selection.empty) {
      editor.chain().focus().toggleCodeBlock().run();
      return;
    }

    const { from, to } = selection;
    const $from = doc.resolve(from);

    // 浠呮敮鎸侀《灞傦紙doc 鐩存帴瀛愬潡锛夎寖鍥寸殑鏁翠綋鍖呰９锛?
    // 宓屽缁撴瀯锛堝垪琛?/ 琛ㄦ牸 / 寮曠敤鍧楃瓑锛夊唴閮ㄧ殑閫夊尯浜ょ粰榛樿鍛戒护锛岄伩鍏嶇牬鍧忕粨鏋?
    if ($from.depth !== 1) {
      editor.chain().focus().toggleCodeBlock().run();
      return;
    }
    // 涓洪伩鍏?$to.before(1) 鍦?to 姝ｅソ浣嶄簬涓ゅ潡杈圭晫鏃舵寚鍒?涓嬩竴涓潡"锛?
    // 鐢?(to - 1) 瑙ｆ瀽鏈潡浣嶇疆锛涘綋 from === to 宸茶涓婇潰 selection.empty 鎺掗櫎锛屾墍浠?to-1 >= from銆?
    const $toInside = doc.resolve(Math.max(from, to - 1));
    if ($toInside.depth !== 1) {
      editor.chain().focus().toggleCodeBlock().run();
      return;
    }

    // 閫夊尯瑕嗙洊鐨勯《灞傚潡鑼冨洿锛堝乏闂彸寮€锛夛細浠庨鍧楄捣鐐瑰埌鏈潡缁堢偣
    const blockStart = $from.before(1);
    const blockEnd = $toInside.after(1);

    // 鏀堕泦鑼冨洿鍐呮墍鏈夐《灞傚潡鐨勬枃鏈紝鎸夋崲琛屾嫾鎺?
    const lines: string[] = [];
    doc.nodesBetween(blockStart, blockEnd, (node: any, _pos: number, _parent: any, _index: number) => {
      // 鍙鐞?doc 鐨勭洿鎺ュ瓙鑺傜偣
      if (_parent === doc) {
        if (node.type.name === "codeBlock" || node.isTextblock) {
          lines.push(node.textContent);
        } else {
          // 闈炴枃鏈潡锛堝 horizontalRule銆乮mage 绛夛級锛氱敤绌鸿鍗犱綅锛岄伩鍏嶅畬鍏ㄤ涪澶?
          lines.push("");
        }
        return false; // 涓嶅啀娣卞叆璇ュ潡鍐呴儴
      }
      return true;
    });

    const codeText = lines.join("\n");
    const codeNode = codeText
      ? codeBlockType.create({}, schema.text(codeText))
      : codeBlockType.create();

    editor
      .chain()
      .focus()
      .command(( { tr, dispatch }: { tr: any; dispatch: any }) => {
        if (!dispatch) return true;
        // 鍏堝垹闄よ鐩栬寖鍥达紝鍐嶅湪鍘熶綅缃彃鍏ュ崟涓€ codeBlock
        tr.delete(blockStart, blockEnd);
        tr.insert(blockStart, codeNode);
        // 鍏夋爣瀹氫綅鍒版柊浠ｇ爜鍧楁湯灏?
        const caretPos = blockStart + codeNode.nodeSize - 1;
        const safePos = Math.min(caretPos, tr.doc.content.size);
        tr.setSelection(TextSelection.near(tr.doc.resolve(safePos), -1));
        return true;
      })
      .run();
  }, [editor]);

  const openAIAssistant = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;

    // 鈿狅笍 鍏抽敭淇锛氫笉瑕佺敤 doc.textBetween(from, to) 鈥斺€斿畠鍙彁鍙?text 鑺傜偣鐨?
    // 绾枃鏈紝浼氭妸 link mark銆乮mage 鑺傜偣銆乥old/italic 绛夋牸寮忓叏閮ㄤ涪寮冦€?
    // 鐢ㄦ埛閫変腑甯﹂摼鎺?/ 鍥剧墖鐨勫唴瀹硅 AI "Markdown 鏍煎紡鍖?鏃讹紝AI 鏀跺埌鐨勬槸
    // 宸茬粡涓㈠け閾炬帴 URL 鍜屽浘鐗?URL 鐨勭函鏂囨湰锛屽啀鎬庝箞鎺掔増涔熻ˉ涓嶅洖鏉?鈫?鏇挎崲
    // 鍐欏洖鍚庨摼鎺?鍥剧墖娑堝け锛坕ssue锛欰I 鍐欎綔鍔╂墜 markdown 鏍煎紡鍖栦涪閾炬帴鍥剧墖锛夈€?
    //
    // 姝ｇ‘鍋氭硶锛氱敤 doc.cut(from, to) 鎶婇€夊尯鍒囨垚涓€涓悎娉曠殑瀛愭枃妗?Node
    // 锛圥M 浼氳嚜鍔ㄨˉ榻愬紑鏀剧殑 block 鑺傜偣锛夛紝鍐嶈蛋 tiptap JSON 鈫?HTML 鈫?
    // Markdown 閾捐矾銆傝繖鏉￠摼璺湪 MarkdownEditor 閭ｈ竟澶╃劧娌￠棶棰橈紙鍥犱负瀹?
    // 鏈韩灏辨槸 Markdown 婧愮爜瀛楃涓诧級锛岀幇鍦?Tiptap 渚т篃瀵归綈鍒?Markdown銆?
    // 杩欐牱 AI 鎷垮埌鐨勫氨鏄?`[text](url)` / `![alt](url)` 褰㈠紡锛岃兘瀹屾暣淇濈暀銆?
    let selectedMd = "";
    if (from < to) {
      try {
        const sliceDoc = editor.state.doc.cut(from, to);
        selectedMd = tiptapJsonToMarkdown(sliceDoc.toJSON()).trim();
      } catch (err) {
        console.warn("[TiptapEditor] selection 鈫?markdown failed, fallback to textBetween:", err);
      }
    }
    // 鍏滃簳锛氳嫢 Markdown 搴忓垪鍖栧け璐ユ垨閫夊尯涓虹┖锛岄€€鍥炵函鏂囨湰锛堣嚦灏戜笉宕╋級
    if (!selectedMd) {
      selectedMd = editor.state.doc.textBetween(from, to, " ");
    }
    setAiSelectedText(selectedMd || editor.getText().slice(0, 500));

    // 鑾峰彇閫夊尯鍦ㄥ睆骞曚笂鐨勪綅缃?
    const coords = editor.view.coordsAtPos(from);
    const editorRect = editor.view.dom.getBoundingClientRect();
    setAiPosition({
      top: Math.min(coords.top + 28, window.innerHeight - 500),
      left: Math.min(coords.left, window.innerWidth - 420),
    });
    setShowAI(true);
  }, [editor]);

  /**
   * 鎶婁竴娈靛彲鑳芥槸 Markdown 鐨勬枃鏈敞鍏ュ埌缂栬緫鍣ㄧ殑 [from, to] 鑼冨洿銆?
   * - 鑻ユ娴嬪埌 Markdown 璇硶锛氱洿鎺ヨ浆鎹负瀵屾枃鏈?HTML 鍚庢彃鍏ワ紝骞跺脊 success toast 鍛婄煡鐢ㄦ埛銆?
   * - 鍚﹀垯锛氫綔涓虹函鏂囨湰鎻掑叆銆?
   *
   * 娉ㄦ剰锛氫笉璧?鍏堟彃绾枃鏈啀鏇挎崲"鐨勮矾寰勶紝鍥犱负 ProseMirror insertText 鍚?
   * 鏂囨。浣嶇疆鍋忕Щ锛圽n 鈫?娈佃惤鑺傜偣锛屾瘡涓妭鐐硅竟鐣屽崰 2 涓綅缃級涓?text.length 涓嶄竴鑷达紝
   * 浼氬鑷?replaceRange 鑼冨洿璁＄畻閿欒銆佸唴瀹瑰ぇ閲忎涪澶便€?
   */
  const insertWithMarkdownDetect = useCallback((text: string, from: number, to: number) => {
    if (!editor) return;
    const view = editor.view;

    if (looksLikeMarkdown(text)) {
      // 鐩存帴杞崲涓哄瘜鏂囨湰 HTML 鍚庢彃鍏ワ紝涓€姝ュ埌浣?
      try {
        const convertedHtml = markdownToSimpleHtml(text);
        const parser = ProseMirrorDOMParser.fromSchema(view.state.schema);
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = convertedHtml;
        const slice = parser.parseSlice(tempDiv);
        const docSize = view.state.doc.content.size;
        const safeFrom = Math.min(from, docSize);
        const safeTo = Math.min(to, docSize);
        const tr = view.state.tr.replaceRange(safeFrom, safeTo, slice).scrollIntoView();
        view.dispatch(tr);
        editor.chain().focus().run();
        showPasteToast("success", t("tiptap.markdownConvertSuccess"));
      } catch (err) {
        console.error("AI Markdown conversion failed:", err);
        // 闄嶇骇锛氱函鏂囨湰鎻掑叆
        const tr = view.state.tr.insertText(text, from, to);
        view.dispatch(tr);
        editor.chain().focus().run();
      }
    } else {
      // 闈?Markdown锛氱函鏂囨湰鎻掑叆
      const tr = view.state.tr.insertText(text, from, to);
      view.dispatch(tr);
      editor.chain().focus().run();
    }
  }, [editor, showPasteToast, t]);

  const handleAIInsert = useCallback((text: string) => {
    if (!editor) return;
    const { to } = editor.state.selection;
    insertWithMarkdownDetect(text, to, to);
  }, [editor, insertWithMarkdownDetect]);

  const handleAIReplace = useCallback((text: string) => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    insertWithMarkdownDetect(text, from, to);
  }, [editor, insertWithMarkdownDetect]);

  // 鍥炲埌椤堕儴 + sticky 宸ュ叿鏍忛槾褰憋細鍚堢敤涓€涓粴鍔ㄧ洃鍚櫒閬垮厤閲嶅璁㈤槄
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  // 鍐呭涓嶅湪椤剁锛?4px锛夋椂缁?sticky 宸ュ叿鏍忓姞搴曢儴闃村奖锛?
  // 璁╁叾瑙嗚涓娿€屾诞銆嶄簬鍐呭涔嬩笂鈥斺€旇窡 Notion / Bear / Craft 绛変富娴佺Щ鍔ㄧ缂栬緫鍣ㄤ竴鑷淬€?
  const [toolbarShadow, setToolbarShadow] = useState(false);
  // 鏌ユ壘鏇挎崲闈㈡澘寮€鍏筹紱Ctrl/Cmd+F 鍒囨崲銆?
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const onScroll = () => {
      const top = el.scrollTop;
      setShowBackToTop(top > 240);
      setToolbarShadow(top > 4);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [editor]);
  const scrollToTop = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    el.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // 鍏ㄥ眬 Ctrl/Cmd+F 蹇嵎閿墦寮€鏌ユ壘闈㈡澘锛岄伩鍏嶄笌娴忚鍣ㄥ師鐢熸煡鎵惧啿绐?
  // 浠呭綋鐒︾偣鍦ㄧ紪杈戝櫒瀹瑰櫒鍐呮椂鎵嶆嫤鎴紝鏈€澶ч檺搴﹀皧閲嶇敤鎴峰湪鏍囬杈撳叆妗嗙瓑鍏朵粬鍦版柟鐨勪範鎯€?
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "f" || e.key === "F")) {
        const root = scrollContainerRef.current?.parentElement;
        const active = document.activeElement;
        const inEditor = root && active instanceof Node && root.contains(active);
        // 缂栬緫鍣ㄥ唴 / 宸叉墦寮€鎼滅储闈㈡澘 鏃舵墠鎺ョ锛岄伩鍏嶅奖鍝嶅叏灞€娴忚鍣ㄦ煡鎵?
        if (inEditor || searchOpen) {
          e.preventDefault();
          setSearchOpen(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen]);

  // 绉诲姩绔?header 椤堕儴鐨勬悳绱㈡寜閽€氳繃娲惧彂鑷畾涔変簨浠惰Е鍙戞煡鎵鹃潰鏉裤€?
  // 鐢?CustomEvent 鑰屼笉鏄妸 setSearchOpen 鎻愬埌澶栭儴锛屾槸涓轰簡閬垮厤鏀?TiptapEditor 鐨勫澶栨帴鍙ｃ€?
  useEffect(() => {
    const onOpen = () => setSearchOpen(true);
    window.addEventListener("nowen:open-search", onOpen);
    return () => window.removeEventListener("nowen:open-search", onOpen);
  }, []);

  if (!editor) return null;

  const iconSize = 15;

  return (
    <div className="flex flex-col h-full relative">
      {/* Toolbar
          v2026-05-18锛氬彇娑堛€岄敭鐩樺脊璧锋椂闅愯棌 + 娴姩宸ュ叿鏍忛《鏇裤€嶆柟妗堬紝鏀逛负濮嬬粓淇濈暀
          鍗曚竴椤堕儴宸ュ叿鏍忓苟 sticky 鍦ㄥ鍣ㄩ《绔細
            - 閿洏寮硅捣鏃朵笉鍐嶉殣钘忥紝閬垮厤绉诲姩绔壘涓嶅埌鏍煎紡鎸夐挳锛?
            - sticky top-0 璁╅暱鍐呭婊氬姩鏃朵篃鑳介殢鏃剁偣鍒板伐鍏锋爮锛?
            - z 绱㈠紩鍘嬪湪閫夊尯/閾炬帴姘旀场涔嬩笅锛坺-50锛夛紝淇濈暀姘旀场鐨勮鐩栬兘鍔涖€?*/}
      <div
        className={cn(
          "sticky top-0 z-20 flex items-center gap-0.5 px-4 py-2 border-b border-app-border bg-app-surface/95 backdrop-blur supports-[backdrop-filter]:bg-app-surface/70 md:flex-wrap overflow-x-auto hide-scrollbar touch-pan-x transition-shadow duration-200",
          // 婊氬姩绂婚《鍚庡姞搴曢儴闃村奖锛岃〃杈俱€屽伐鍏锋爮娴簬鍐呭涔嬩笂銆?
          toolbarShadow && "shadow-[0_2px_8px_-2px_rgba(0,0,0,0.08)] dark:shadow-[0_2px_8px_-2px_rgba(0,0,0,0.4)]",
        )}
      >
        <ToolbarButton onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()} title={t('tiptap.undo')}>
          <Undo size={iconSize} />
        </ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()} title={t('tiptap.redo')}>
          <Redo size={iconSize} />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton
          onClick={() => toggleHeadingSmart(editor, 1)}
          isActive={editor.isActive("heading", { level: 1 })}
          title={t('tiptap.heading1')}
        >
          <Heading1 size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => toggleHeadingSmart(editor, 2)}
          isActive={editor.isActive("heading", { level: 2 })}
          title={t('tiptap.heading2')}
        >
          <Heading2 size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => toggleHeadingSmart(editor, 3)}
          isActive={editor.isActive("heading", { level: 3 })}
          title={t('tiptap.heading3')}
        >
          <Heading3 size={iconSize} />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBold().run()}
          isActive={editor.isActive("bold")}
          title={t('tiptap.bold')}
        >
          <Bold size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleItalic().run()}
          isActive={editor.isActive("italic")}
          title={t('tiptap.italic')}
        >
          <Italic size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleUnderline().run()}
          isActive={editor.isActive("underline")}
          title={t('tiptap.underline')}
        >
          <UnderlineIcon size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleStrike().run()}
          isActive={editor.isActive("strike")}
          title={t('tiptap.strikethrough')}
        >
          <Strikethrough size={iconSize} />
        </ToolbarButton>
        {/* 瀛楀彿 / 棰滆壊锛氬熀浜?TextStyle + Color + FontSize 涓変欢濂楋紝
            瀹為檯娓叉煋涓?<span style="font-size:..;color:..">锛?
            鑳屾櫙鑹插鐢?Highlight multicolor锛岀敱 ColorPopover 鐨勩€岃儗鏅€峊ab 鏆撮湶銆?
            鍘熷厛鍗曠嫭鐨?Highlighter 鍒囨崲鎸夐挳琚?ColorPopover 瑕嗙洊锛岀Щ闄や互閬垮厤閲嶅銆?*/}
        <FontSizePopover editor={editor} iconSize={iconSize} />
        <ColorPopover editor={editor} iconSize={iconSize} />
        <ToolbarButton
          onClick={openLinkEditor}
          isActive={editor.isActive("link")}
          title={t('tiptap.link')}
        >
          <LinkIcon size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleCode().run()}
          isActive={editor.isActive("code")}
          title={t('tiptap.inlineCode')}
        >
          <Code size={iconSize} />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBulletList().run()}
          isActive={editor.isActive("bulletList")}
          title={t('tiptap.bulletList')}
        >
          <List size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
          isActive={editor.isActive("orderedList")}
          title={t('tiptap.orderedList')}
        >
          <ListOrdered size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().toggleTaskList().run()}
          isActive={editor.isActive("taskList")}
          title={t('tiptap.taskList')}
        >
          <CheckSquare size={iconSize} />
        </ToolbarButton>

        <ToolbarDivider />

        <ToolbarButton
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
          isActive={editor.isActive("blockquote")}
          title={t('tiptap.blockquote')}
        >
          <Quote size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={toggleCodeBlockStrict}
          isActive={editor.isActive("codeBlock")}
          title={t('tiptap.codeBlock')}
        >
          <FileCode size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setHorizontalRule().run()}
          title={t('tiptap.horizontalRule')}
        >
          <Minus size={iconSize} />
        </ToolbarButton>
        <ToolbarButton onClick={handleImageUpload} title={t('tiptap.insertImage')}>
          <ImagePlus size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={async () => {
            // 寮圭獥杈撳叆瑙嗛 URL锛泂etVideo 浼氬仛 URL 瑙ｆ瀽锛屽け璐ョ粰 toast 鎻愮ず銆?
            // 鏀寔锛氱洿閾?mp4/webm/ogg + B 绔?/ YouTube / 鑵捐瑙嗛 / Vimeo銆?
            const url = await promptDialog({
              title: t('tiptap.insertVideo') || '鎻掑叆瑙嗛',
              placeholder: 'https://www.bilibili.com/video/BV...  鎴?.mp4 鐩撮摼',
              defaultValue: '',
              confirmText: t('common.confirm'),
              cancelText: t('common.cancel'),
              allowEmpty: false,
            });
            if (!url) return;
            const ok = (editor.commands as any).setVideo(url.trim());
            if (!ok) {
              toast.error(t('tiptap.videoUrlInvalid') || '鏃犳硶璇嗗埆璇ヨ棰戦摼鎺?);
            }
          }}
          title={t('tiptap.insertVideo') || '鎻掑叆瑙嗛'}
        >
          <Film size={iconSize} />
        </ToolbarButton>
        <ToolbarButton onClick={handleAttachmentUpload} title={t('tiptap.insertAttachment')}>
          <Paperclip size={iconSize} />
        </ToolbarButton>
        <TableGridPicker
          iconSize={iconSize}
          onPick={(rows, cols) =>
            editor
              .chain()
              .focus()
              .insertTable({ rows, cols, withHeaderRow: true })
              .run()
          }
        />
        {/* Mermaid 鍥捐〃锛氭彃鍏ョ┖鐨?mermaid 浠ｇ爜鍧楋紙lang=mermaid 鐢?CodeBlockView 娓叉煋鍥惧舰锛?*/}
        <ToolbarButton
          onClick={() => {
            editor
              .chain()
              .focus()
              .insertContent({
                type: "codeBlock",
                attrs: { language: "mermaid" },
                content: [{ type: "text", text: "graph TD\n  A[寮€濮媇 --> B[缁撴潫]" }],
              })
              .run();
          }}
          title={t('tiptap.insertMermaid')}
        >
          <Workflow size={iconSize} />
        </ToolbarButton>
        {/* LaTeX 鏁板鍏紡锛氬潡绾?mathBlock锛岀┖ latex 璁?NodeView 鑷姩杩涘叆缂栬緫鎬?*/}
        <ToolbarButton
          onClick={() => {
            editor
              .chain()
              .focus()
              .insertContent({
                type: "mathBlock",
                attrs: { latex: "" },
              })
              .run();
          }}
          title={t('tiptap.insertMath')}
        >
          <Sigma size={iconSize} />
        </ToolbarButton>
        {/* 鑴氭敞锛氬厜鏍囧鎻?ref + 鏂囨。鏈熬杩藉姞閰嶅 def锛宨dentifier 鑷姩鍙栦笅涓€涓湭鍗犵敤鏁板瓧 */}
        <ToolbarButton
          onClick={() => {
            const id = nextFootnoteIdentifier(editor);
            editor
              .chain()
              .focus()
              .insertContent({
                type: "footnoteReference",
                attrs: { identifier: id },
              })
              .run();
            const docEnd = editor.state.doc.content.size;
            editor
              .chain()
              .focus()
              .insertContentAt(docEnd, {
                type: "footnoteDefinition",
                attrs: { identifier: id, content: "" },
              })
              .run();
          }}
          title={t('tiptap.insertFootnote')}
        >
          <BookOpen size={iconSize} />
        </ToolbarButton>

        {/* 琛ㄦ牸鎿嶄綔鎸夐挳锛堜粎鍦ㄥ厜鏍囧湪琛ㄦ牸鍐呮椂鏄剧ず锛?*/}
        {editor.isActive('table') && (
          <>
            <ToolbarDivider />
            <ToolbarButton
              onClick={() => editor.chain().focus().addRowAfter().run()}
              title={t('tiptap.addRowAfter')}
            >
              <span className="text-[10px] font-bold leading-none">+琛?/span>
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().deleteRow().run()}
              title={t('tiptap.deleteRow')}
            >
              <span className="text-[10px] font-bold leading-none text-red-500">-琛?/span>
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().addColumnAfter().run()}
              title={t('tiptap.addColumnAfter')}
            >
              <span className="text-[10px] font-bold leading-none">+鍒?/span>
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().deleteColumn().run()}
              title={t('tiptap.deleteColumn')}
            >
              <span className="text-[10px] font-bold leading-none text-red-500">-鍒?/span>
            </ToolbarButton>
            <ToolbarButton
              onClick={() => editor.chain().focus().deleteTable().run()}
              title={t('tiptap.deleteTable')}
            >
              <Trash2 size={iconSize - 2} className="text-red-500" />
            </ToolbarButton>
          </>
        )}

        <ToolbarDivider />

        {/* 缂╄繘鎺у埗 鈥斺€?閫昏緫涓?Tab/Shift-Tab 閿洏蹇嵎閿畬鍏ㄤ竴鑷?*/}
        <ToolbarButton
          onClick={() => {
            if (editor.isActive("taskList")) {
              if (editor.chain().focus().sinkListItem("taskItem").run()) return;
            } else if (editor.isActive("bulletList") || editor.isActive("orderedList")) {
              if (editor.chain().focus().sinkListItem("listItem").run()) return;
            }
            (editor.chain().focus() as any).changeIndent(1).run();
          }}
          title={t('tiptap.indent')}
        >
          <Indent size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => {
            if (editor.isActive("taskList")) {
              if (editor.chain().focus().liftListItem("taskItem").run()) return;
            } else if (editor.isActive("bulletList") || editor.isActive("orderedList")) {
              if (editor.chain().focus().liftListItem("listItem").run()) return;
            }
            (editor.chain().focus() as any).changeIndent(-1).run();
          }}
          title={t('tiptap.outdent')}
        >
          <Outdent size={iconSize} />
        </ToolbarButton>

        <ToolbarDivider />

        {/* 娈佃惤瀵归綈 */}
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
          isActive={editor.isActive({ textAlign: 'left' })}
          title={t('tiptap.alignLeft')}
        >
          <AlignLeft size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
          isActive={editor.isActive({ textAlign: 'center' })}
          title={t('tiptap.alignCenter')}
        >
          <AlignCenter size={iconSize} />
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
          isActive={editor.isActive({ textAlign: 'right' })}
          title={t('tiptap.alignRight')}
        >
          <AlignRight size={iconSize} />
        </ToolbarButton>

        {!isGuest && <ToolbarDivider />}

        {/* 鏌ユ壘鏇挎崲锛欳trl/Cmd+F 涔熷彲鍞よ捣锛涜瀹㈠彧璇讳笅闈㈡澘浼氶殣钘忔浛鎹㈣緭鍏ユ
            绉诲姩绔?EditorPane header 宸叉彁渚涚嫭绔嬫悳绱㈡寜閽紝杩欓噷闅愯棌閬垮厤閲嶅锛堜粎妗岄潰绔?md+ 鏄剧ず锛?*/}
        <span className="hidden md:inline-flex">
          <ToolbarButton
            onClick={() => setSearchOpen((v) => !v)}
            isActive={searchOpen}
            title={t('searchReplace.toolbarTitle') || '鏌ユ壘鏇挎崲 (Ctrl+F)'}
          >
            <Search size={iconSize} />
          </ToolbarButton>
        </span>

        {!isGuest && (
          <ToolbarButton onClick={openAIAssistant} title={t('tiptap.aiAssistant')}>
            <Sparkles size={iconSize} className="text-violet-500" />
          </ToolbarButton>
        )}
      </div>

      {/* 鏌ユ壘鏇挎崲娴獥锛氫緷闄勬渶澶栧眰 relative锛屽彸涓婅搴斾簬搴忓垪銆?
          - editable=false 鐨勫彧璇诲満鏅粛鍙煡鎵撅紝鍙槸闅愯棌鏇挎崲杈撳叆妗?*/}
      {editor && (
        <SearchReplacePanel
          editor={editor}
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          editable={editable}
        />
      )}

      {/* Title */}
      <div className="px-4 md:px-8 pt-4 md:pt-6 pb-0">
        <input
          ref={titleRef}
          defaultValue={note.title}
          onChange={handleTitleChange}
          placeholder={t('tiptap.titlePlaceholder')}
          readOnly={!editable}
          className={cn(
            "w-full bg-transparent text-2xl font-bold text-tx-primary placeholder:text-tx-tertiary focus:outline-none no-focus-ring",
            !editable && "cursor-default"
          )}
        />
        <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-2 text-[10px] text-tx-tertiary">
          <span>{t('tiptap.version')}{note.version}</span>
          <span className="max-md:hidden">路</span>
          <span>{t('tiptap.updatedAt')}{new Date(note.updatedAt + "Z").toLocaleString()}</span>
          <span className="max-md:hidden">路</span>
          <span>{wordStats.words}{t('tiptap.words')}</span>
          <span className="max-md:hidden">路</span>
          <span>{wordStats.charsNoSpace}{t('tiptap.chars')}</span>
        </div>
      </div>

      {/* Tag Bar锛氳瀹㈡ā寮忎笅闅愯棌锛圱agInput 渚濊禆 AppProvider + 鐧诲綍鎬?API锛?*/}
      {!isGuest && (
        <div className="px-4 md:px-8 pb-2">
          <TagInput
            noteId={note.id}
            noteTags={note.tags || []}
            onTagsChange={onTagsChange}
          />
        </div>
      )}

      {/* 閫夊尯姘旀场鑿滃崟锛氭枃鏈牸寮忓寲锛堟墜鍔ㄥ疄鐜帮紝fixed 瀹氫綅锛岄伩鍏嶈 overflow-auto 瑁佸壀锛?*/}
      {editor && editable && bubble.open && (
        <div
          className="fixed z-50 flex items-center gap-0.5 bg-app-elevated border border-app-border rounded-lg shadow-lg p-1"
          style={{ top: bubble.top, left: bubble.left }}
          onMouseDown={(e) => e.preventDefault()} // 闃绘鐐瑰嚮鎸夐挳鏃?editor blur
        >
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            isActive={editor.isActive("bold")}
            title={t('tiptap.bold')}
          >
            <Bold size={14} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            isActive={editor.isActive("italic")}
            title={t('tiptap.italic')}
          >
            <Italic size={14} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            isActive={editor.isActive("underline")}
            title={t('tiptap.underline')}
          >
            <UnderlineIcon size={14} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            isActive={editor.isActive("strike")}
            title={t('tiptap.strikethrough')}
          >
            <Strikethrough size={14} />
          </ToolbarButton>
          {/* 瀛楀彿 + 棰滆壊 / 鑳屾櫙鑹诧細閫夊尯姘旀场鍚屾鏆撮湶锛岀Щ鍔ㄧ甯哥敤 */}
          <FontSizePopover editor={editor} iconSize={14} compact />
          <ColorPopover editor={editor} iconSize={14} compact />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCode().run()}
            isActive={editor.isActive("code")}
            title={t('tiptap.inlineCode')}
          >
            <Code size={14} />
          </ToolbarButton>
          {/* 閾炬帴锛氶€夊尯鏈夊唴瀹规椂涓€閿浆閾炬帴锛堟垨缂栬緫宸叉湁閾炬帴锛夛紝鐪佸緱璺戦《閮ㄥ伐鍏锋爮 */}
          <ToolbarButton
            onClick={openLinkEditor}
            isActive={editor.isActive("link")}
            title={t('tiptap.link')}
          >
            <LinkIcon size={14} />
          </ToolbarButton>
          <ToolbarButton
            onClick={toggleCodeBlockStrict}
            isActive={editor.isActive("codeBlock")}
            title={t('tiptap.codeBlock')}
          >
            <FileCode size={14} />
          </ToolbarButton>
          {/* 娓呴櫎鍏ㄩ儴 inline 鏂囨湰鏍煎紡锛圡od-Shift-X 鍚岀瓑鏁堟灉锛?*/}
          <ToolbarButton
            onClick={() =>
              editor
                .chain()
                .focus()
                .unsetMark("textStyle")
                .unsetMark("highlight")
                .unsetMark("bold")
                .unsetMark("italic")
                .unsetMark("underline")
                .unsetMark("strike")
                .unsetMark("code")
                .run()
            }
            title={t('tiptap.clearFormat') || "娓呴櫎鏍煎紡 (Ctrl+Shift+X)"}
          >
            <Eraser size={14} />
          </ToolbarButton>
          {!isGuest && (
            <>
              <div className="w-px h-4 bg-app-border mx-0.5" />
              <ToolbarButton onClick={openAIAssistant} title={t('tiptap.aiAssistant')}>
                <Sparkles size={14} className="text-violet-500" />
              </ToolbarButton>
            </>
          )}
        </div>
      )}

      {/* 閾炬帴姘旀场鑿滃崟锛氬厜鏍囧仠鍦ㄩ摼鎺ュ唴锛堟棤閫夊尯锛夋垨榧犳爣 hover 閾炬帴鏃舵诞鍑?鈥?鎵撳紑 / 缂栬緫 / 鍙栨秷閾炬帴 */}
      {/* 鎶藉眽鎵撳紑鏈熼棿涓嶆覆鏌撻摼鎺ユ皵娉★細鍙屼繚闄╋紝闃?hover/caret 鍦ㄦ娊灞夋墦寮€鍚庡張鎶婂畠寮瑰洖鏉ャ€?*/}
      {editor && editable && linkBubble.open && !attachmentPreview && (
        <div
          className="fixed z-50 flex items-center gap-1 bg-app-elevated border border-app-border rounded-lg shadow-lg px-2 py-1 max-w-[320px]"
          style={{ top: linkBubble.top, left: linkBubble.left }}
          onMouseDown={(e) => e.preventDefault()}
          onMouseEnter={() => {
            // 榧犳爣杩涘叆姘旀场鏈綋鏃讹紝鍙栨秷 hover 鍏抽棴瀹氭椂鍣紝淇濊瘉鐐瑰嚮鎸夐挳鍙揪
            if (linkHoverCloseTimer.current) {
              clearTimeout(linkHoverCloseTimer.current);
              linkHoverCloseTimer.current = null;
            }
          }}
          onMouseLeave={() => {
            // 浠呭 hover 瑙﹀彂鐨勬皵娉＄敓鏁堬紱caret 瑙﹀彂鐨勬皵娉¤窡闅忓厜鏍?blur 鍏抽棴
            if (linkBubble.source !== "hover") return;
            if (linkHoverCloseTimer.current) clearTimeout(linkHoverCloseTimer.current);
            linkHoverCloseTimer.current = setTimeout(() => {
              setLinkBubble(b => (b.open && b.source === "hover") ? { ...b, open: false } : b);
            }, 150);
          }}
        >
          {/* href 棰勮锛氳秴闀挎椂鎴柇锛岀粰瓒充笂涓嬫枃 + tooltip 瀹屾暣 */}
          <a
            href={linkBubble.href}
            target="_blank"
            rel="noopener noreferrer"
            title={linkBubble.href}
            className="text-xs text-app-muted hover:text-app-accent truncate max-w-[160px] underline-offset-2 hover:underline"
          >
            {linkBubble.href}
          </a>
          <div className="w-px h-4 bg-app-border mx-0.5" />
          {/* 闄勪欢閾炬帴锛坔ref 褰㈠ /api/attachments/<id>锛夊睍绀恒€屼笅杞姐€嶆寜閽€斺€?
             鐐瑰嚮閾炬帴鏂囨湰鏈韩宸插湪 handleDOMEvents.click 閲岃蛋鍐呰仈棰勮鎶藉眽锛?
             鎵€浠ユ皵娉￠噷鍙ˉ寮?涓嬭浇鍒版湰鍦?杩欎釜鏄庣‘鍔ㄤ綔銆傛櫘閫?http(s) 閾炬帴
             淇濈暀"鎵撳紑閾炬帴"鍦ㄦ柊鏍囩椤垫墦寮€銆?*/}
          {/^\/api\/attachments\//.test(linkBubble.href) ? (
            <ToolbarButton
              onClick={() => {
                void downloadAttachment(linkBubble.href, linkBubble.filename || "");
              }}
              title={t('tiptap.linkDownload')}
            >
              <Download size={14} />
            </ToolbarButton>
          ) : (
            <ToolbarButton
              onClick={() => openLinkUrl(linkBubble.href)}
              title={t('tiptap.linkOpen')}
            >
              <ExternalLink size={14} />
            </ToolbarButton>
          )}
          <ToolbarButton
            onClick={() => {
              // hover 瑙﹀彂鏃跺厜鏍囧彲鑳戒笉鍦ㄩ摼鎺ヤ笂锛屽繀椤讳紶鍏?from/to 璁╀袱涓?callback
              // 鍐呴儴鍏?setTextSelection 鍐?extendMarkRange锛屽惁鍒?unsetLink 浼氶潤榛樺け璐ャ€?
              // caret 瑙﹀彂鏃?from===to===0 涓嶄紶锛屾部鐢ㄥ綋鍓嶉€夊尯璇箟銆?
              const range = linkBubble.source === "hover" && linkBubble.from < linkBubble.to
                ? { from: linkBubble.from, to: linkBubble.to } : undefined;
              void openLinkEditor(range);
            }}
            title={t('tiptap.linkEdit')}
          >
            <LinkIcon size={14} />
          </ToolbarButton>
          <ToolbarButton
            onClick={() => {
              const range = linkBubble.source === "hover" && linkBubble.from < linkBubble.to
                ? { from: linkBubble.from, to: linkBubble.to } : undefined;
              removeLink(range);
            }}
            title={t('tiptap.linkRemove')}
          >
            <Unlink2 size={14} />
          </ToolbarButton>
        </div>
      )}

      {/* 閫夊尯姘旀场鑿滃崟锛氬浘鐗囧揩鎹峰昂瀵?*/}
      {editor && editable && imageBubble.open && (
        <div
          className="fixed z-50 flex items-center gap-0.5 bg-app-elevated border border-app-border rounded-lg shadow-lg p-1"
          style={{ top: imageBubble.top, left: imageBubble.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          {[
            { key: "25", label: t("tiptap.imageSize25"), ratio: 0.25 },
            { key: "50", label: t("tiptap.imageSize50"), ratio: 0.5 },
            { key: "75", label: t("tiptap.imageSize75"), ratio: 0.75 },
            { key: "100", label: t("tiptap.imageSize100"), ratio: 1 },
          ].map((s) => (
            <ToolbarButton
              key={s.key}
              title={s.label}
              onClick={() => {
                const root = editor.view.dom as HTMLElement;
                const contentWidth = root.clientWidth || 640;
                const target = Math.round(contentWidth * s.ratio);
                editor
                  .chain()
                  .focus()
                  .updateAttributes("image", { width: target })
                  .run();
              }}
            >
              <span className="text-xs px-1">{s.label}</span>
            </ToolbarButton>
          ))}
          <div className="w-px h-4 bg-app-border mx-0.5" />
          <ToolbarButton
            title={t("tiptap.imageSizeOriginalTitle")}
            onClick={() => {
              editor
                .chain()
                .focus()
                .updateAttributes("image", { width: null, height: null })
                .run();
            }}
          >
            <span className="text-xs px-1">{t("tiptap.imageSizeOriginal")}</span>
          </ToolbarButton>
        </div>
      )}

      {/* 閫夊尯姘旀场鑿滃崟锛氳〃鏍兼搷浣滐紙琛?鍒?鍚堝苟/鎷嗗垎/琛ㄥご/鍒犻櫎锛?
          鍏夋爣鍋滃湪琛ㄦ牸鍐咃紙绌洪€夊尯锛夋椂娴嚭锛屾寜閽洿鎺ヨ皟 Tiptap 鍐呯疆鍛戒护銆?
          鍚堝苟/鎷嗗垎渚濊禆 CellSelection鈥斺€旂敤鎴峰繀椤诲厛鎸変綇榧犳爣鎷栭€夊涓崟鍏冩牸鍐嶇偣鍚堝苟銆?*/}
      {editor && editable && tableBubble.open && (
        <div
          className="fixed z-50 flex items-center gap-px bg-app-elevated border border-app-border rounded-lg shadow-lg p-0.5"
          style={{ top: tableBubble.top, left: tableBubble.left }}
          onMouseDown={(e) => e.preventDefault()}
        >
          <ToolbarButton compact
            title={t("tiptap.addRowBefore")}
            onClick={() => editor.chain().focus().addRowBefore().run()}
          >
            <Rows3 size={14} className="rotate-180" />
          </ToolbarButton>
          <ToolbarButton compact
            title={t("tiptap.addRowAfter")}
            onClick={() => editor.chain().focus().addRowAfter().run()}
          >
            <Rows3 size={14} />
          </ToolbarButton>
          <ToolbarButton compact
            title={t("tiptap.deleteRow")}
            onClick={() => editor.chain().focus().deleteRow().run()}
          >
            <span className="flex items-center">
              <Rows3 size={14} />
              <Trash2 size={10} className="-ml-0.5" />
            </span>
          </ToolbarButton>
          <div className="w-px h-3 bg-app-border mx-0.5" />
          <ToolbarButton compact
            title={t("tiptap.addColumnBefore")}
            onClick={() => editor.chain().focus().addColumnBefore().run()}
          >
            <Columns3 size={14} className="-scale-x-100" />
          </ToolbarButton>
          <ToolbarButton compact
            title={t("tiptap.addColumnAfter")}
            onClick={() => editor.chain().focus().addColumnAfter().run()}
          >
            <Columns3 size={14} />
          </ToolbarButton>
          <ToolbarButton compact
            title={t("tiptap.deleteColumn")}
            onClick={() => editor.chain().focus().deleteColumn().run()}
          >
            <span className="flex items-center">
              <Columns3 size={14} />
              <Trash2 size={10} className="-ml-0.5" />
            </span>
          </ToolbarButton>
          <div className="w-px h-3 bg-app-border mx-0.5" />
          <ToolbarButton compact
            title={t("tiptap.mergeCells")}
            disabled={!editor.can().mergeCells()}
            onClick={() => editor.chain().focus().mergeCells().run()}
          >
            <Merge size={14} />
          </ToolbarButton>
          <ToolbarButton compact
            title={t("tiptap.splitCell")}
            disabled={!editor.can().splitCell()}
            onClick={() => editor.chain().focus().splitCell().run()}
          >
            <Split size={14} />
          </ToolbarButton>
          <ToolbarButton compact
            title={t("tiptap.toggleHeaderRow")}
            onClick={() => editor.chain().focus().toggleHeaderRow().run()}
          >
            <Heading size={14} />
          </ToolbarButton>
          <ToolbarButton compact
            title={t("tiptap.resizeTable")}
            onClick={() => {
              // 璇诲嚭褰撳墠琛ㄦ牸鐨勭湡瀹炶鍒楁暟锛氫粠鍏夋爣鎵€鍦?<table> DOM 鏁?tr / 绗竴琛?td
              const view = editor.view;
              const { from } = view.state.selection;
              let tableEl: HTMLTableElement | null = null;
              try {
                const dom = view.domAtPos(from).node as Node | null;
                const el = dom instanceof Element ? dom : dom?.parentElement ?? null;
                tableEl = el?.closest?.("table") as HTMLTableElement | null;
              } catch { /* ignore */ }
              const rows = tableEl?.querySelectorAll("tr").length ?? 3;
              const cols = tableEl?.querySelector("tr")?.children.length ?? 3;
              setResizeDialog({ open: true, rows, cols });
              setTableBubble(b => ({ ...b, open: false }));
            }}
          >
            <span className="text-[10px] px-0.5 tabular-nums">鈯?/span>
          </ToolbarButton>
          <div className="w-px h-3 bg-app-border mx-0.5" />
          <ToolbarButton compact
            title={t("tiptap.deleteTable")}
            onClick={() => editor.chain().focus().deleteTable().run()}
          >
            <Trash2 size={14} className="text-red-500" />
          </ToolbarButton>
        </div>
      )}

      {/* 璋冩暣琛ㄦ牸灏哄瀵硅瘽妗?*/}
      <TableResizeDialog
        open={resizeDialog.open}
        initialRows={resizeDialog.rows}
        initialCols={resizeDialog.cols}
        onCancel={() => setResizeDialog(d => ({ ...d, open: false }))}
        onConfirm={(targetRows, targetCols) => {
          // 鎸夊綋鍓嶈〃鏍肩殑琛屽垪鏁板樊鍊硷紝鎵归噺鍔?鍒犺鍒?
          // 娉ㄦ剰锛氬繀椤讳繚璇佸厜鏍囧湪琛ㄦ牸鍐咃紙鍏抽棴姘旀场鏃剁劍鐐瑰凡钀藉湪 cell 涓婏紝娌￠棶棰橈級
          const chain = editor.chain().focus();
          const dRow = targetRows - resizeDialog.rows;
          const dCol = targetCols - resizeDialog.cols;
          for (let i = 0; i < Math.abs(dRow); i++) {
            if (dRow > 0) chain.addRowAfter();
            else chain.deleteRow();
          }
          for (let i = 0; i < Math.abs(dCol); i++) {
            if (dCol > 0) chain.addColumnAfter();
            else chain.deleteColumn();
          }
          chain.run();
          setResizeDialog(d => ({ ...d, open: false }));
        }}
      />

      {/* Editor content
          paddingBottom 浠呭悆閿洏楂樺害鍗冲彲锛堥伩鍏夋爣琚敭鐩橀伄锛夈€?
          v2026-05-18 璧风Щ闄ゅ簳閮ㄧЩ鍔ㄦ诞鍔ㄥ伐鍏锋爮锛岀敱椤堕儴 sticky 涓诲伐鍏锋爮缁熶竴鎵挎媴
          鎵€鏈夋牸寮忓寲鍛戒护銆?*/}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto px-4 md:px-8 pb-12"
        style={{ paddingBottom: "calc(3rem + var(--keyboard-height, 0px))" }}
      >
        <EditorContent editor={editor} />
      </div>

      {/* 闄勪欢鍐呭祵棰勮锛氬鐢?AttachmentDetailDrawer
          - 瑙﹀彂锛氱偣姝ｆ枃閲岀殑 馃搸 闄勪欢閾炬帴锛堜换鎰忕被鍨嬶紝data-attachment="1"锛?
          - 绫诲瀷鍒嗘祦锛?
              .docx 鈫?閫氳繃 renderPreview 璧?DocxAttachmentPreview锛堜繚鐣?涓婁紶鏂扮増鏈?鑳藉姏锛?
              鍏朵粬  鈫?缁勪欢鍐呯疆 AttachmentPreview锛堝浘鐗?/ 瑙嗛 / 闊抽 / 鏂囨湰 / 浠ｇ爜 / SVG锛?
          - 涓庢枃浠剁鐞嗕腑蹇冨悓娆炬娊灞夛細鍚閾惧垎浜?/ 閲嶅懡鍚?/ 鍏冧俊鎭?/ 鍙嶅悜寮曠敤 / 涓嬭浇銆?
          - 涓嶅紑鍚?showDelete锛氱紪杈戝櫒鍦烘櫙閲岄檮浠跺彲鑳藉氨鏄綋鍓嶇瑪璁拌嚜宸卞紩鐢ㄧ殑锛屽垹浜嗕細鐮村浘銆?*/}
      {attachmentPreview && (
        <AttachmentDetailDrawer
          attachmentId={attachmentPreview.id}
          onClose={() => setAttachmentPreview(null)}
          renderPreview={
            attachmentPreview.isDocx
              ? (detail, expanded) => (
                  <Suspense fallback={<div className="p-6 text-xs text-tx-tertiary">鍔犺浇棰勮缁勪欢鈥?/div>}>
                    <DocxAttachmentPreview
                      url={detail.url}
                      filename={detail.filename}
                      heightClass={expanded ? "min-h-[80vh]" : "min-h-[600px]"}
                      onReplace={async (file) => {
                        // 涓婁紶鏂?.docx 瑕嗙洊鏃ч檮浠?+ 鏇存柊绗旇 content 鎸囧悜鏂?url銆?
                        const oldId = detail.id;
                        const noteId = noteRef.current?.id || "";
                        if (!noteId) {
                          toast.error("鏃犳硶璇嗗埆褰撳墠绗旇锛屽埛鏂板悗閲嶈瘯");
                          return;
                        }
                        try {
                          const { replaceWordAttachment } = await import("@/lib/wordNoteService");
                          const res = await replaceWordAttachment({ noteId, oldAttachmentId: oldId, file });
                          toast.success("宸蹭笂浼犳柊鐗堟湰");
                          // 鍏虫帀棰勮锛氭棫 id 宸插け鏁堬紝鍐嶆覆鏌撲細鎶ラ敊銆?
                          setAttachmentPreview(null);
                          // 瑙﹀彂绗旇鍐呭鍒锋柊锛氳澶栧眰 EditorPane 鎷変竴娆℃渶鏂?note銆?
                          try {
                            window.dispatchEvent(new CustomEvent("nowen:note-updated", { detail: { noteId: res.note.id } }));
                          } catch { /* ignore */ }
                        } catch (err: any) {
                          console.error("Replace docx failed:", err);
                          toast.error(err?.message || "涓婁紶鏂扮増鏈け璐?);
                        }
                      }}
                    />
                  </Suspense>
                )
              : undefined
          }
        />
      )}

      {/* 鍥炲埌椤堕儴鎸夐挳锛氭粴鍔ㄨ秴杩囬槇鍊煎悗鏄剧ず鍦ㄧ紪杈戝尯鍙充笅瑙?*/}
      <AnimatePresence>
        {showBackToTop && (
          <motion.button
            type="button"
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.9 }}
            transition={{ duration: 0.15 }}
            onClick={scrollToTop}
            title={t("tiptap.backToTop", "鍥炲埌椤堕儴")}
            aria-label={t("tiptap.backToTop", "鍥炲埌椤堕儴")}
            className="absolute right-4 md:right-6 z-30 w-9 h-9 flex items-center justify-center rounded-full bg-app-elevated border border-app-border text-tx-secondary hover:text-accent-primary hover:border-accent-primary/50 shadow-lg backdrop-blur-sm transition-colors"
            style={{ bottom: "calc(1rem + var(--keyboard-height, 0px))" }}
          >
            <ArrowUp size={16} />
          </motion.button>
        )}
      </AnimatePresence>

      {/* Markdown 绮樿创杞崲鎻愮ず Toast */}
      <AnimatePresence>
        {pasteToast && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.2 }}
            className={cn(
              "fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2.5 px-4 py-2.5 rounded-xl shadow-lg border text-sm font-medium backdrop-blur-sm",
              pasteToast.type === "converting" && "bg-accent-primary/10 border-accent-primary/20 text-accent-primary",
              pasteToast.type === "success" && "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400",
              pasteToast.type === "error" && "bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400",
              pasteToast.type === "confirm" && "bg-sky-500/10 border-sky-500/20 text-sky-600 dark:text-sky-400"
            )}
          >
            {pasteToast.type === "converting" && (
              <FileType size={16} className="animate-pulse" />
            )}
            {pasteToast.type === "success" && <Check size={16} />}
            {pasteToast.type === "error" && <AlertCircle size={16} />}
            {pasteToast.type === "confirm" && <Info size={16} />}
            <span>{pasteToast.message}</span>
            {pasteToast.type === "confirm" && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const action = pasteToast.onAction;
                    dismissPasteToast();
                    action();
                  }}
                  className="ml-1 font-semibold underline-offset-2 hover:underline focus:outline-none"
                >
                  {pasteToast.actionLabel}
                </button>
                <button
                  type="button"
                  onClick={dismissPasteToast}
                  aria-label="close"
                  className="ml-1 p-0.5 rounded hover:bg-sky-500/10 focus:outline-none"
                >
                  <X size={14} />
                </button>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 鏂滄潬鍛戒护鑿滃崟 */}
      <SlashCommandsMenu
        editor={editor}
        items={getDefaultSlashCommands(t, handleImageUpload, openAIAssistant)}
      />

      {/* 鍥剧墖棰勮 Lightbox */}
      <AnimatePresence>
        {previewImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) { setPreviewImage(null); } }}
            onWheel={handlePreviewWheel}
            onMouseMove={handlePreviewMouseMove}
            onMouseUp={handlePreviewMouseUp}
            onMouseLeave={handlePreviewMouseUp}
          >
            {/* 宸ュ叿鏍?*/}
            <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
              <button
                onClick={() => setImageZoom(prev => Math.min(5, prev + 0.25))}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                title="鏀惧ぇ"
              >
                <ZoomIn size={18} />
              </button>
              <button
                onClick={() => setImageZoom(prev => Math.max(0.1, prev - 0.25))}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                title="缂╁皬"
              >
                <ZoomOut size={18} />
              </button>
              <button
                onClick={() => { setImageZoom(1); setImageDrag({ x: 0, y: 0 }); }}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                title="閲嶇疆"
              >
                <RotateCcw size={18} />
              </button>
              <span className="text-white/70 text-xs font-mono min-w-[3rem] text-center">
                {Math.round(imageZoom * 100)}%
              </span>
              <button
                onClick={() => setPreviewImage(null)}
                className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors"
                title="鍏抽棴"
              >
                <X size={18} />
              </button>
            </div>
            {/* 鍥剧墖
                娉ㄦ剰锛氱缉鏀?骞崇Щ浜ょ粰 framer-motion 鐨勭嫭绔?transform 閫氶亾锛坰cale/x/y锛夋潵椹卞姩锛?
                涓嶈兘鍐嶅啓 style.transform 瀛楃涓测€斺€攎otion 浼氭帴绠?transform 骞惰鐩栧閮?style锛?
                瀵艰嚧 100% 鐨勬暟瀛椾竴鐩村湪鍙樹絾 DOM 涓?transform 姘歌繙鍋滃湪鍏ュ満鍔ㄧ敾缁堟€併€?
                鍏ュ満浠呯敤 opacity 鍋氭贰鍏ワ紝鍒濆 scale 鐢ㄥ綋鍓?imageZoom 闃叉鎶栧姩銆?*/}
            <motion.img
              src={previewImage}
              alt="preview"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1, scale: imageZoom, x: imageDrag.x, y: imageDrag.y }}
              exit={{ opacity: 0 }}
              transition={{ duration: isDragging ? 0 : 0.15 }}
              className="max-w-[90vw] max-h-[90vh] object-contain select-none"
              style={{
                cursor: isDragging ? 'grabbing' : 'grab',
              }}
              onMouseDown={handlePreviewMouseDown}
              draggable={false}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* AI Writing Assistant */}
      <AnimatePresence>
        {showAI && (
          <AIWritingAssistant
            selectedText={aiSelectedText}
            // fullText 浣滀负涓婁笅鏂囦紶缁?AI锛堟埅鍓?2000 瀛楋級锛屽悓鏍风敤 Markdown
            // 搴忓垪鍖栬€岄潪 editor.getText()锛屼繚鐣欓摼鎺?/ 鍥剧墖 URL锛岃 AI 鍦?
            // 缁啓銆佹敼鍐欑瓑浠诲姟閲屼篃鑳芥劅鐭ュ埌杩欎簺璧勬簮銆傚け璐ユ椂鍥為€€鍒扮函鏂囨湰銆?
            fullText={(() => {
              if (!editor) return "";
              try {
                const md = tiptapJsonToMarkdown(editor.getJSON());
                if (md) return md;
              } catch (err) {
                console.warn("[TiptapEditor] fullText 鈫?markdown failed:", err);
              }
              return editor.getText();
            })()}
            onInsert={handleAIInsert}
            onReplace={handleAIReplace}
            onClose={() => setShowAI(false)}
            position={aiPosition}
          />
        )}
      </AnimatePresence>

      {/* 绉诲姩绔伐鍏锋爮宸茶縼绉诲埌涓?Toolbar 涔嬪悗锛屽弬鑰冧笅鏂?mobileToolbarItems 娓叉煋澶?*/}
    </div>
  );
});

/**
 * 鎶婇檮浠朵俊鎭覆鏌撴垚涓€娈点€屽彲绮橀檮杩?Tiptap 鍐呭銆嶇殑 HTML 閾炬帴銆?
 *
 * 褰㈡€侊細
 *   <a href="/api/attachments/<id>" download="<filename>"
 *      data-attachment="1" data-size="<bytes>"
 *      target="_blank" rel="noopener noreferrer">馃搸 filename (澶у皬)</a>
 *
 * 璁捐鐐癸細
 *   - 鐢ㄧ浉瀵?URL锛氫笌鍥剧墖涓€鑷达紝閬垮厤鎶?lite 妯″紡涓嬬殑杩滅 host 鍐欒繘 notes.content锛?
 *     娓叉煋绔?/ 鍒嗕韩椤靛彲浠ョ敱 resolveAttachmentUrl 鑷姩琛?origin銆?
 *   - download 灞炴€?+ 鍚庣 Content-Disposition 鍙屼繚闄╋紝娴忚鍣ㄧ偣鍑昏Е鍙戜笅杞姐€?
 *   - data-attachment="1" 缁欏皢鏉?鎹㈡垚鑷畾涔夎妭鐐硅鍥?鐣欎釜鎶撴墜锛堣瘑鍒竴娈甸摼鎺ユ槸鍚?
 *     婧愯嚜闄勪欢涓婁紶锛夛紝涓嶅奖鍝嶅鍑?鍒嗕韩/SSR銆?
 *   - filename 閫氳繃 escapeHtml 鍙岄噸杞箟锛沝ata-size 鏄函鏁板瓧銆?
 */
function buildAttachmentLinkHtml(filename: string, url: string, size: number): string {
  const safeName = escapeHtml(filename || "attachment");
  const safeUrl = escapeHtml(url);
  const sizeLabel = formatBytes(size);
  // 鍔?\u00a0(NBSP) + 涓€涓櫘閫氱┖鏍硷紝閬垮厤鍚庣画 typing 绱ц创閾炬帴鏈熬瀵艰嚧鍏夋爣鍗″湪 mark 杈圭晫
  return `<a href="${safeUrl}" download="${safeName}" data-attachment="1" data-size="${size}" target="_blank" rel="noopener noreferrer">馃搸 ${safeName} (${sizeLabel})</a>&nbsp;`;
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb < 10 ? 1 : 0)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(gb < 10 ? 2 : 1)} GB`;
}

/**
 * 妫€娴嬬矘璐寸殑澶氳绾枃鏈槸鍚︾湅璧锋潵鍍忎唬鐮?鍛戒护锛岃€岄潪涓枃鑷劧璇█娈佃惤銆?
 *
 * 绛栫暐锛氳绠?涓枃瀛楃瀵嗗害"鈥斺€斿鏋滄枃鏈腑涓枃瀛楃鍗犳瘮杈冮珮锛岃鏄庢槸鑷劧璇█鏂囨湰锛?
 * 涓嶅簲鑷姩鍖呮垚 codeBlock銆傚悓鏃舵娴嬩竴浜涗唬鐮佺壒寰侊紙缂╄繘銆佸ぇ鎷彿銆佸垎鍙风粨灏剧瓑锛夈€?
 *
 * 鐢ㄤ緥瀵规瘮锛?
 *   - 浠ｇ爜锛歚const x = 1;\nif (x) {\n  return;\n}`       鈫?true锛堟棤涓枃锛屾湁浠ｇ爜鐗瑰緛锛?
 *   - 杩愮淮鏂囨。锛歚#鏌ョ湅raid淇℃伅\nyum install megacli -y\n閫氳繃鍛戒护...` 鈫?false锛堜腑鏂囧崰姣旈珮锛?
 *   - shell 鍛戒护锛歚ls -la\ncd /tmp\nmkdir test`           鈫?true锛堟棤涓枃锛屽懡浠ゆ牸寮忥級
 */
function looksLikeCode(text: string): boolean {
  // 缁熻涓枃瀛楃鏁伴噺锛圕JK缁熶竴姹夊瓧 + 鎵╁睍锛?
  const cjkChars = text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g);
  const cjkCount = cjkChars ? cjkChars.length : 0;
  // 缁熻闈炵┖鐧藉彲瑙佸瓧绗︽€绘暟
  const visibleChars = text.replace(/\s/g, "").length;
  if (visibleChars === 0) return false;

  const cjkRatio = cjkCount / visibleChars;

  // 濡傛灉涓枃瀛楃鍗犳瘮 > 20%锛屽ぇ姒傜巼鏄嚜鐒惰瑷€鏂囨湰鑰岄潪浠ｇ爜
  if (cjkRatio > 0.2) return false;

  // 濡傛灉涓枃瀛楃鍗犳瘮 > 8% 涓旀病鏈夋槑鏄剧殑浠ｇ爜鐗瑰緛锛屼篃涓嶅綋鍋氫唬鐮?
  if (cjkRatio > 0.08) {
    const lines = text.split("\n");
    let codeSignals = 0;
    for (const line of lines) {
      const trimmed = line.trimEnd();
      // 缂╄繘锛堣嚦灏?绌烘牸鎴杢ab寮€澶达級
      if (/^(\s{2,}|\t)/.test(line) && trimmed.length > 0) codeSignals++;
      // 琛屽熬鍒嗗彿銆佸ぇ鎷彿
      if (/[;{}]\s*$/.test(trimmed)) codeSignals++;
      // 璧嬪€艰鍙?
      if (/[=!<>]=|=>|->/.test(trimmed)) codeSignals++;
      // 鍑芥暟璋冪敤 xxx(...)
      if (/\w+\(.*\)\s*[;{]?\s*$/.test(trimmed)) codeSignals++;
    }
    // 濡傛灉浠ｇ爜鐗瑰緛涓嶅澶氾紝涓嶅綋鍋氫唬鐮?
    if (codeSignals < lines.length * 0.3) return false;
  }

  return true;
}

/**
 * 妫€娴嬬矘璐寸殑鏂囨湰鏄惁鍖呭惈 Markdown 鏍煎紡鏍囪
 * 閫氳繃鍖归厤澶氱 Markdown 璇硶鐗瑰緛鏉ュ垽鏂?
 */
function looksLikeMarkdown(text: string): boolean {
  // 鐭矾锛氬浘鐗?/ 閾炬帴 Markdown 璇硶鍦ㄨ嚜鐒舵枃鏈噷鍑犱箮涓嶄細鑷劧鍑虹幇锛屼竴鏃?
  // 鍛戒腑绔嬪埢鍒ゅ畾涓?Markdown銆傝繖鏄负浜嗛厤鍚?AI 鍐欎綔鍔╂墜鐨?鏍煎紡鍖?璺緞锛?
  // 鑻ョ敤鎴峰彧閫変簡涓€娈靛惈閾炬帴鐨勭煭鏂囨湰锛孉I 杈撳嚭渚濈劧鍙兘鏄崟娈碉紝鎸変笅鏂圭疮璁?
  // 璇勫垎浠?1~2 鍒嗭紙閾炬帴 +1銆佺矖浣?+1锛夋嬁涓嶅埌 3 鍒嗛槇鍊硷紝灏变細琚綋绾枃鏈?
  // 鎻掑叆 鈫?閾炬帴 URL 琚悶鎺夈€傝繖鏉＄煭璺妸杩欑鎯呭喌鍏滀綇銆?
  if (/!\[[^\]]*\]\([^)\s]+(?:\s+"[^"]*")?\)/.test(text)) return true;  // 鍥剧墖 ![](url)
  if (/(?<!!)\[[^\]]+\]\([^)\s]+(?:\s+"[^"]*")?\)/.test(text)) return true;  // 閾炬帴 [](url)

  const lines = text.split("\n");
  let score = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    // 鏍囬锛? ## ###
    if (/^#{1,6}\s+.+/.test(trimmed)) score += 2;
    // 浠ｇ爜鍧楀紑濮?缁撴潫锛歚`` 鎴?~~~
    else if (/^(`{3,}|~{3,})/.test(trimmed)) score += 2;
    // 琛ㄦ牸琛岋細| xxx | xxx |
    else if (/^\|.+\|$/.test(trimmed)) score += 2;
    // 琛ㄦ牸鍒嗛殧琛岋細|---|---|
    else if (/^\|[\s:]*-{2,}[\s:]*\|/.test(trimmed)) score += 3;
    // 鏃犲簭鍒楄〃锛? xxx 鎴?* xxx锛堟帓闄ゅ垎闅旂嚎锛?
    else if (/^[-*+]\s+(?!\[[ xX]\])/.test(trimmed) && !/^[-*_]{3,}$/.test(trimmed)) score += 1;
    // 鏈夊簭鍒楄〃锛?. xxx
    else if (/^\d+\.\s+/.test(trimmed)) score += 1;
    // 寮曠敤鍧楋細> xxx
    else if (/^>\s+/.test(trimmed)) score += 1;
    // 绮椾綋锛?*xxx**
    else if (/\*\*.+?\*\*/.test(trimmed)) score += 1;
    // 琛屽唴浠ｇ爜锛歚xxx`
    else if (/`.+?`/.test(trimmed)) score += 0.5;
    // 閾炬帴锛歔xxx](url)
    else if (/\[.+?\]\(.+?\)/.test(trimmed)) score += 1;
    // 浠诲姟鍒楄〃锛? [x] 鎴?- [ ]
    else if (/^[-*]\s+\[[ xX]\]\s+/.test(trimmed)) score += 2;
    // 姘村钩绾匡細--- *** ___
    else if (/^(---|\*\*\*|___)$/.test(trimmed)) score += 1;
  }

  // 寰楀垎闃堝€硷細鑷冲皯闇€瑕?3 鍒嗘墠璁や负鏄?Markdown 鍐呭
  // 鍗曠嫭鐨勪竴琛岀矖浣撴垨琛屽唴浠ｇ爜涓嶅簲瑙﹀彂杞崲
  return score >= 3;
}

/**
 * 瑙ｆ瀽绗旇鍐呭涓?Tiptap 鍙敤鐨?doc 缁撴瀯
 *
 * 杈撳叆鍙兘鏄細
 *   1) Tiptap ProseMirror JSON 瀛楃涓诧紙鑰佺瑪璁?/ Tiptap 淇濆瓨鐨勶級
 *   2) HTML 瀛楃涓诧紙鏋佸皯锛屽巻鍙插鍏ヨ矾寰勶級
 *   3) Markdown 瀛楃涓诧紙MD 缂栬緫鍣ㄤ繚瀛樼殑 鈫?鍒囧洖瀵屾枃鏈椂锛?
 *   4) 绾枃鏈?/ 绌?
 *
 * 鍏抽敭鐐癸細
 *   - MD 鍒嗘敮蹇呴』鍏堣浆 HTML 鍐嶄氦缁?Tiptap锛屽惁鍒欐爣棰?鍒楄〃/浠ｇ爜鍧楃瓑缁撴瀯
 *     鍏ㄩ儴濉岀缉鎴愪竴娈电函鏂囨湰 鈫?鐢ㄦ埛鍒囧洖瀵屾枃鏈悗淇敼/淇濆瓨鏃跺疄闄呬涪澶变簡缁撴瀯銆?
 *   - MD 鈫?HTML 浼樺厛鐢?`contentFormat.markdownToHtml`锛堝熀浜?@lezer/markdown + GFM锛夛紝
 *     瑕嗙洊琛ㄦ牸銆佷换鍔″垪琛ㄣ€佸垹闄ょ嚎銆乻etext 鏍囬銆佸祵濂楀垪琛ㄣ€佸潡绾?HTML 绛夛紱
 *     澶辫触鏃舵墠闄嶇骇鍒?`markdownToSimpleHtml`锛堥€愯鎵弿锛屽姛鑳芥洿寮变絾鏇村鏉撅級銆?
 *     姝ゅ墠涓€寰嬭蛋 simpleHtml 鈫?GFM 琛ㄦ牸 / 鍒犻櫎绾跨瓑鍒囧埌 RTE 鍚庝細涓㈠け缁撴瀯銆?
 *   - MD 璇嗗埆涓?contentFormat.detectFormat 淇濇寔涓€鑷达細JSON 鍚堟硶 + 鍚?Tiptap
 *     鏂囨。鐗瑰緛鎵嶈 tiptap-json锛屽惁鍒欎竴寰嬫寜 MD 澶勭悊锛堝師鍏堝厹搴曞彧淇濈暀绾枃鏈紝
 *     鏄?鍒囧埌瀵屾枃鏈唴瀹逛涪澶?鐨勭洿鎺ュ師鍥狅級銆?
 */
function parseContent(content: string): any {
  if (!content || content === "{}") {
    return { type: "doc", content: [{ type: "paragraph" }] };
  }
  if (typeof content !== "string") return content;

  const trimmed = content.trim();

  // 1) Tiptap JSON锛氬鏉惧皾璇?parse锛屾垚鍔熶笖闀垮緱鍍?doc 鎵嶆帴鍙?
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (
        parsed &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        (parsed.type === "doc" ||
          (typeof parsed.type === "string" && Array.isArray(parsed.content)))
      ) {
        // 鍘嗗彶鑴?JSON 淇锛氭棭鏈熷鍏ヨ矾寰勫彲鑳藉啓鍏ヤ簡 schema 涓嶅悎娉曠殑 doc
        // 锛堝吀鍨嬶細琛ㄦ牸 content 涓嶆弧瓒?contentMatch锛夈€傜洿鎺ュ杺缁?setContent
        // 涓嶄細绔嬪埢鎶ラ敊锛屼絾浠讳綍鍚庣画 transaction 閮戒細瑙﹀彂 contentMatchAt 宕╂簝銆?
        // 杩欓噷璧颁竴閬?headless Editor 鐨?schema fixup 鍏滃簳锛寏10-20ms 鍒囩瑪璁?
        // 鏃朵竴娆″紑閿€锛岀敤鎴锋棤鎰熴€傝瑙?tiptapSchemaRepair.ts 椤堕儴娉ㄩ噴銆?
        return repairTiptapJson(parsed);
      }
      // 鏄悎娉?JSON 浣嗕笉鏄?Tiptap doc 鈫?褰?MD / 绾枃鏈户缁線涓嬭蛋
    } catch {
      /* 涓嶆槸鍚堟硶 JSON锛岀户缁笅涓€鍒嗘敮 */
    }
  }

  // 2) HTML 瀛楃涓诧細Tiptap 鐩存帴鑳藉悆
  if (/^<\w/.test(trimmed)) {
    return content;
  }

  // 3) Markdown / 绾枃鏈?鈫?杞?HTML 鍐嶄氦缁?Tiptap
  //
  //   棣栭€?contentFormat.markdownToHtml锛氫笌 MarkdownEditor 鍚屾簮鐨?@lezer/markdown + GFM
  //   瑙ｆ瀽鍣紝瑕嗙洊鏍囬 / 鍒楄〃 / 浠诲姟鍒楄〃 / 琛ㄦ牸 / 寮曠敤 / 浠ｇ爜鍧?/ 姘村钩绾?/ 閾炬帴 / 鍥剧墖 /
  //   鍒犻櫎绾?/ 鍐呭祵 HTML 绛夊叏閮ㄨ娉曪紝涓旀牸寮忚瘑鍒笌 detectFormat 淇濇寔涓€鑷淬€?
  //
  //   闄嶇骇鍒?importService.markdownToSimpleHtml锛氬彧瑕嗙洊灏戞暟鍩烘湰璇硶锛屼笖瀵瑰鏉傚祵濂?
  //   缁撴瀯瀹规槗濉岀缉銆傚綋 mdToFullHtml 鎶涢敊锛堢悊璁轰笂涓嶄細锛夋垨杩斿洖绌烘椂鎵嶈蛋瀹冦€?
  try {
    // detectFormat 鑳芥妸 "{ foo" 杩欑浠?{ 寮€澶翠絾涓嶆槸 JSON 鐨勫唴瀹硅瘑鍒负 md锛?
    // empty/html 涔熶細鍦ㄨ繖閲岃鍒嗙被銆俬tml 宸茬粡鍦ㄤ笂闈㈠鐞嗚繃锛宔mpty 灏辩洿鎺ヨ繑鍥炵┖ doc銆?
    const fmt = detectContentFormat(content);
    if (fmt === "empty") {
      return { type: "doc", content: [{ type: "paragraph" }] };
    }
    // md / html 涓ょ閮藉皾璇曠敤瀹屾暣 parser锛坔tml 璧?markdownToHtml 鏃朵細琚綋浣滃潡绾?HTML
    // 鍘熸牱浼犻€掞紝鍏煎锛夈€俆iptap 闅忓悗浼?parseHTML銆?
    const html = mdToFullHtml(content);
    if (html && html.trim()) return html;
  } catch (err) {
    console.warn("[TiptapEditor] markdownToHtml(full) failed, falling back to simpleHtml:", err);
  }

  try {
    const html = markdownToSimpleHtml(content);
    if (html && html.trim()) return html;
  } catch (err) {
    console.warn("[TiptapEditor] markdownToSimpleHtml failed, fallback to text:", err);
  }

  // 鍏滃簳锛氱函鏂囨湰娈佃惤
  return {
    type: "doc",
    content: [{ type: "paragraph", content: [{ type: "text", text: content }] }],
  };
}
