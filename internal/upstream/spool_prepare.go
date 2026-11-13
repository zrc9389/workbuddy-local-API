package upstream

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"os"
	"sort"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"github.com/linguo2625469/workbuddy2api-panel/internal/jsonscan"
)

const (
	spoolInlineItemLimit = 2 << 20
	spoolStreamChunkSize = 64 << 10
	spoolStreamOverlap   = 4096
)

// SpoolMeta 落盘大请求的顶层元信息（仅通过 jsonscan 定位，避免整树反序列化）。
type SpoolMeta struct {
	Model           string
	Stream          bool
	HasStream       bool
	ClientHasConvID bool
	ResolvedConvID  string
	SessKey         string
	TurnKey         string
	HasImage        bool
}

// SpoolPrepareOptions 落盘大请求的流式改写选项（与小请求 prepareBody/handler 管线对齐）。
type SpoolPrepareOptions struct {
	Sanitize       bool
	Efforts        map[string][]string
	DefaultEfforts map[string]string
	MaxOut         map[string]int64
	EnsureSystem   bool
	InjectCacheKey bool
	CacheUID       string
	CacheConvID    string
	StripConvID    bool
	ApplyPrompt    string
	PromptText     string
}

// ExtractSpoolMeta 从已落盘的大请求中提取路由/粘性/轮次/图片判定所需的全部元信息，
// 支持控制字段位于 JSON 末尾（超过 64KiB Peek 窗口）的情况，且不将超大消息载入堆内存。
func ExtractSpoolMeta(ra io.ReaderAt, size int64) (SpoolMeta, error) {
	var out SpoolMeta
	if ra == nil || size <= 0 {
		return out, errors.New("empty spool payload")
	}
	spans, err := jsonscan.Object(io.NewSectionReader(ra, 0, size))
	if err != nil {
		return out, err
	}
	byKey := make(map[string]jsonscan.Span, len(spans))
	for _, sp := range spans {
		byKey[sp.Key] = sp
	}
	if sp, ok := byKey["model"]; ok {
		if sp.End-sp.Start > 65536 {
			return out, errors.New("model field too large")
		}
		if raw, rerr := readSpanBytes(ra, sp); rerr == nil {
			_ = json.Unmarshal(raw, &out.Model)
		}
	}
	if sp, ok := byKey["stream"]; ok {
		out.HasStream = true
		if sp.End-sp.Start <= 1024 {
			if raw, rerr := readSpanBytes(ra, sp); rerr == nil {
				_ = json.Unmarshal(raw, &out.Stream)
			}
		}
	}

	readSmallStr := func(key string) string {
		sp, ok := byKey[key]
		if !ok || sp.End-sp.Start > 65536 {
			return ""
		}
		raw, rerr := readSpanBytes(ra, sp)
		if rerr != nil {
			return ""
		}
		var val string
		if json.Unmarshal(raw, &val) != nil {
			return ""
		}
		return strings.TrimSpace(val)
	}
	topConvSnake := readSmallStr("conversation_id")
	topConvCamel := readSmallStr("conversationId")
	promptCacheKey := readSmallStr("prompt_cache_key")
	topUserID := readSmallStr("user_id")
	var metaConvSnake, metaConvCamel, metaUserID string
	if sp, ok := byKey["metadata"]; ok && sp.End-sp.Start <= 256*1024 {
		if raw, rerr := readSpanBytes(ra, sp); rerr == nil {
			var metaObj map[string]any
			if json.Unmarshal(raw, &metaObj) == nil {
				metaConvSnake, _ = metaObj["conversation_id"].(string)
				metaConvSnake = strings.TrimSpace(metaConvSnake)
				metaConvCamel, _ = metaObj["conversationId"].(string)
				metaConvCamel = strings.TrimSpace(metaConvCamel)
				metaUserID, _ = metaObj["user_id"].(string)
				metaUserID = strings.TrimSpace(metaUserID)
			}
		}
	}

	out.ClientHasConvID = topConvSnake != "" || topConvCamel != "" || metaConvSnake != "" || metaConvCamel != ""

	switch {
	case topConvSnake != "":
		out.ResolvedConvID = topConvSnake
	case topConvCamel != "":
		out.ResolvedConvID = topConvCamel
	case metaConvSnake != "":
		out.ResolvedConvID = metaConvSnake
	case metaConvCamel != "":
		out.ResolvedConvID = metaConvCamel
	case promptCacheKey != "":
		out.ResolvedConvID = promptCacheKey
	}

	switch {
	case metaConvSnake != "":
		out.SessKey = metaConvSnake
	case metaConvCamel != "":
		out.SessKey = metaConvCamel
	case topConvSnake != "":
		out.SessKey = topConvSnake
	case topConvCamel != "":
		out.SessKey = topConvCamel
	case promptCacheKey != "":
		out.SessKey = promptCacheKey
	}

	msgSpan, hasMsgs := byKey["messages"]
	if !hasMsgs || msgSpan.End <= msgSpan.Start {
		return out, nil
	}
	var firstByte [1]byte
	if _, err := ra.ReadAt(firstByte[:], msgSpan.Start); err != nil || firstByte[0] != '[' {
		return out, nil
	}
	msgSpans, err := jsonscan.Array(io.NewSectionReader(ra, msgSpan.Start, msgSpan.End-msgSpan.Start))
	if err != nil {
		return out, nil
	}
	for idx := range msgSpans {
		msgSpans[idx].Start += msgSpan.Start
		msgSpans[idx].End += msgSpan.Start
	}

	var sysText, firstUserSig string
	lastUserIdx := -1
	var lastUserContentSpan jsonscan.Span
	hasLastUserContent := false

	for idx, sp := range msgSpans {
		if !out.HasImage && spanContainsBytes(ra, sp, []byte("image_url")) {
			out.HasImage = true
		}
		fields, ferr := jsonscan.Object(io.NewSectionReader(ra, sp.Start, sp.End-sp.Start))
		if ferr != nil {
			continue
		}
		var roleSpan, contentSpan jsonscan.Span
		for _, fd := range fields {
			fd.Start += sp.Start
			fd.End += sp.Start
			switch fd.Key {
			case "role":
				roleSpan = fd
			case "content":
				contentSpan = fd
			}
		}
		role := readJSONStringSpan(ra, roleSpan)
		switch role {
		case "system", "developer":
			if sysText == "" && out.SessKey == "" && metaUserID == "" && topUserID == "" && contentSpan.End > contentSpan.Start {
				sysText = extractMessageTextBounded(ra, contentSpan)
			}
		case "user":
			if firstUserSig == "" && out.SessKey == "" && metaUserID == "" && topUserID == "" && contentSpan.End > contentSpan.Start {
				firstUserSig = extractStableUserSigBounded(ra, contentSpan)
			}
			lastUserIdx = idx
			lastUserContentSpan = contentSpan
			hasLastUserContent = contentSpan.End > contentSpan.Start
		}
	}

	if out.SessKey == "" && metaUserID == "" && topUserID == "" && firstUserSig != "" {
		sum := sha256.Sum256([]byte(sysText + "\x00" + firstUserSig))
		out.SessKey = "derived-" + hex.EncodeToString(sum[:16])
	}
	if lastUserIdx >= 0 && hasLastUserContent {
		sig := extractTurnContentSig(ra, lastUserContentSpan)
		if sig != "" {
			out.TurnKey = fmt.Sprintf("u%d:%s", lastUserIdx, sig)
		}
	}
	return out, nil
}

// PrepareSpoolFile 对落盘大请求执行流式逐项改写并输出到私有 0600 临时文件。
// 控制字段、`tools[]` 逐项、`messages[]` 逐条局部解码或流式改写，避免整包载入堆内存。
func PrepareSpoolFile(ra io.ReaderAt, size int64, opts SpoolPrepareOptions) (io.ReadSeekCloser, int64, func(), error) {
	if ra == nil || size <= 0 {
		return nil, 0, nil, errors.New("empty spool payload")
	}
	topSpans, err := jsonscan.Object(io.NewSectionReader(ra, 0, size))
	if err != nil {
		return nil, 0, nil, err
	}

	ctrl := make(map[string]any, len(topSpans))
	giantExtra := make(map[string]jsonscan.Span)
	var msgSpan, toolsSpan jsonscan.Span
	hasMsgs, hasTools := false, false

	for _, sp := range topSpans {
		switch sp.Key {
		case "messages":
			msgSpan = sp
			hasMsgs = true
		case "tools":
			toolsSpan = sp
			hasTools = true
		default:
			if sp.End-sp.Start > spoolInlineItemLimit {
				giantExtra[sp.Key] = sp
				delete(ctrl, sp.Key)
				continue
			}
			raw, rerr := readSpanBytes(ra, sp)
			if rerr != nil {
				return nil, 0, nil, rerr
			}
			var decoded any
			if uerr := json.Unmarshal(raw, &decoded); uerr != nil {
				return nil, 0, nil, uerr
			}
			ctrl[sp.Key] = decoded
			delete(giantExtra, sp.Key)
		}
	}

	normalizeModelName(ctrl)
	ctrl["stream"] = true
	translateMaxCompletionTokens(ctrl)
	clampGPTMinMaxTokens(ctrl)
	if opts.MaxOut != nil {
		injectCatalogMaxTokens(ctrl, opts.MaxOut)
	}
	if _, has := ctrl["stream_options"]; !has {
		ctrl["stream_options"] = map[string]any{"include_usage": true}
	}
	suppressTools := shouldSuppressTools(ctrl["tool_choice"])
	normalizeToolChoice(ctrl)
	if suppressTools {
		hasTools = false
		delete(giantExtra, "tools")
		delete(giantExtra, "functions")
	}
	if opts.StripConvID {
		delete(ctrl, "conversation_id")
		delete(ctrl, "conversationId")
		if meta, ok := ctrl["metadata"].(map[string]any); ok {
			delete(meta, "conversation_id")
			delete(meta, "conversationId")
		}
	}

	modelName, _ := ctrl["model"].(string)
	injectThinking(ctrl, lookupDefaultEffort(opts.DefaultEfforts, modelName))
	effort := normalizeReasoningEffort(ctrl, opts.Efforts)
	if opts.MaxOut != nil {
		ensureMinOutputBudget(ctrl, effort, opts.MaxOut)
	}
	thinkingEnabled := false
	if th, ok := ctrl["thinking"].(map[string]any); ok {
		if typ, _ := th["type"].(string); strings.EqualFold(strings.TrimSpace(typ), "enabled") {
			thinkingEnabled = true
		}
	}

	if opts.InjectCacheKey {
		if existing, ok := ctrl["prompt_cache_key"].(string); !ok || existing == "" {
			conv := opts.CacheConvID
			if v := strField(ctrl, "conversation_id"); v != "" {
				conv = v
			} else if v := strField(ctrl, "conversationId"); v != "" {
				conv = v
			}
			ctrl["prompt_cache_key"] = buildCacheKey(opts.CacheUID, conv)
		}
	}

	type msgMeta struct {
		span        jsonscan.Span
		role        string
		toolCallID  string
		toolCallIDs []string
		hasTrace    bool
		emptyBody   bool
	}
	var metas []msgMeta
	msgsIsArray := false
	if hasMsgs && msgSpan.End > msgSpan.Start {
		var fb [1]byte
		if _, rerr := ra.ReadAt(fb[:], msgSpan.Start); rerr == nil && fb[0] == '[' {
			msgsIsArray = true
			arr, aerr := jsonscan.Array(io.NewSectionReader(ra, msgSpan.Start, msgSpan.End-msgSpan.Start))
			if aerr != nil {
				return nil, 0, nil, aerr
			}
			metas = make([]msgMeta, len(arr))
			for idx, sp := range arr {
				sp.Start += msgSpan.Start
				sp.End += msgSpan.Start
				mm := msgMeta{span: sp, emptyBody: true}
				fields, ferr := jsonscan.Object(io.NewSectionReader(ra, sp.Start, sp.End-sp.Start))
				if ferr == nil {
					for _, fd := range fields {
						fd.Start += sp.Start
						fd.End += sp.Start
						switch fd.Key {
						case "role":
							mm.role = readJSONStringSpan(ra, fd)
						case "tool_call_id":
							mm.toolCallID = readJSONStringSpan(ra, fd)
						case "reasoning_content":
							mm.hasTrace = true
						case "reasoning":
							if !isEmptyJSONStringSpan(ra, fd) {
								mm.hasTrace = true
							}
						case "content":
							if !isEmptyContentSpan(ra, fd) {
								mm.emptyBody = false
							}
						case "tool_calls":
							mm.toolCallIDs = readToolCallIDs(ra, fd)
						}
					}
				}
				metas[idx] = mm
			}
		}
	}

	hasTrace := false
	for _, mm := range metas {
		if mm.hasTrace {
			hasTrace = true
			break
		}
	}

	type emitStep struct {
		indices   []int
		keepCalls map[string]bool
		synthetic bool
		synthRole string
		synthText string
	}
	var plan []emitStep

	if msgsIsArray {
		baseOrder := make([]int, 0, len(metas))
		for idx, mm := range metas {
			if opts.ApplyPrompt == "custom" && opts.PromptText != "" && (mm.role == "system" || mm.role == "developer") {
				continue
			}
			baseOrder = append(baseOrder, idx)
		}

		type lightMsg struct {
			indices   []int
			role      string
			callIDs   []string
			resultID  string
			emptyBody bool
		}
		light := make([]lightMsg, 0, len(baseOrder))
		for _, idx := range baseOrder {
			mm := metas[idx]
			light = append(light, lightMsg{
				indices:   []int{idx},
				role:      mm.role,
				callIDs:   mm.toolCallIDs,
				resultID:  mm.toolCallID,
				emptyBody: mm.emptyBody,
			})
		}

		if len(light) >= 2 {
			merged := make([]lightMsg, 0, len(light))
			for _, cur := range light {
				if cur.role == "assistant" && len(merged) > 0 {
					prev := &merged[len(merged)-1]
					if len(cur.callIDs) > 0 && cur.emptyBody && prev.role == "assistant" && len(prev.callIDs) > 0 {
						prev.indices = append(prev.indices, cur.indices...)
						prev.callIDs = append(prev.callIDs, cur.callIDs...)
						continue
					}
					if len(cur.callIDs) == 0 && !cur.emptyBody && prev.role == "assistant" && len(prev.callIDs) > 0 && prev.emptyBody {
						if metas[cur.indices[0]].span.End-metas[cur.indices[0]].span.Start <= spoolInlineItemLimit &&
							metas[prev.indices[0]].span.End-metas[prev.indices[0]].span.Start <= spoolInlineItemLimit {
							prev.indices = append(prev.indices, cur.indices...)
							prev.emptyBody = false
							continue
						}
					}
				}
				merged = append(merged, cur)
			}
			light = merged
		}

		if len(light) >= 3 {
			repacked := make([]lightMsg, 0, len(light))
			pos := 0
			for pos < len(light) {
				cur := light[pos]
				if cur.role != "assistant" || len(cur.callIDs) == 0 {
					repacked = append(repacked, cur)
					pos++
					continue
				}
				want := make(map[string]bool, len(cur.callIDs))
				for _, cid := range cur.callIDs {
					if cid != "" {
						want[cid] = true
					}
				}
				repacked = append(repacked, cur)
				pos++
				var results, between []lightMsg
				for pos < len(light) {
					nxt := light[pos]
					if nxt.role == "tool" {
						if !want[nxt.resultID] {
							break
						}
						results = append(results, nxt)
						pos++
						continue
					}
					if len(results) == 0 {
						break
					}
					if nxt.role == "assistant" && len(nxt.callIDs) > 0 {
						break
					}
					between = append(between, nxt)
					pos++
				}
				repacked = append(repacked, results...)
				repacked = append(repacked, between...)
			}
			light = repacked
		}

		callSet := make(map[string]bool)
		resultSet := make(map[string]bool)
		for _, lm := range light {
			for _, cid := range lm.callIDs {
				if cid != "" {
					callSet[cid] = true
				}
			}
			if lm.role == "tool" && lm.resultID != "" {
				resultSet[lm.resultID] = true
			}
		}
		keepCalls := make(map[string]bool)
		for cid := range callSet {
			if resultSet[cid] {
				keepCalls[cid] = true
			}
		}

		for _, lm := range light {
			if lm.role == "tool" && (lm.resultID == "" || !keepCalls[lm.resultID]) {
				continue
			}
			step := emitStep{indices: lm.indices}
			if len(lm.callIDs) > 0 {
				filtered := false
				for _, cid := range lm.callIDs {
					if !keepCalls[cid] {
						filtered = true
						break
					}
				}
				if filtered {
					step.keepCalls = keepCalls
				}
			}
			plan = append(plan, step)
		}

		if opts.ApplyPrompt == "custom" && opts.PromptText != "" {
			plan = append([]emitStep{{synthetic: true, synthRole: "system", synthText: opts.PromptText}}, plan...)
		} else if opts.ApplyPrompt == "append" && opts.PromptText != "" {
			insertAt := 0
			for insertAt < len(plan) && !plan[insertAt].synthetic {
				firstOrig := metas[plan[insertAt].indices[0]]
				if firstOrig.role != "system" && firstOrig.role != "developer" {
					break
				}
				insertAt++
			}
			gwStep := emitStep{synthetic: true, synthRole: "system", synthText: opts.PromptText}
			tail := append([]emitStep{gwStep}, plan[insertAt:]...)
			plan = append(plan[:insertAt], tail...)
		}

		if opts.EnsureSystem && len(plan) > 0 {
			firstIsSys := false
			if plan[0].synthetic {
				firstIsSys = strings.EqualFold(plan[0].synthRole, "system")
			} else {
				firstRole := strings.TrimSpace(metas[plan[0].indices[0]].role)
				firstIsSys = strings.EqualFold(firstRole, "system") || strings.EqualFold(firstRole, "developer")
			}
			if !firstIsSys {
				plan = append([]emitStep{{synthetic: true, synthRole: "system", synthText: "You are a helpful assistant."}}, plan...)
			}
		}
	}

	outFile, err := os.CreateTemp("", "wb_spool_prep_*.tmp")
	if err != nil {
		return nil, 0, nil, fmt.Errorf("create prepared spool file: %w", err)
	}
	outPath := outFile.Name()
	_ = outFile.Chmod(0600)
	cleanup := func() {
		_ = outFile.Close()
		_ = os.Remove(outPath)
	}

	bw := bufio.NewWriterSize(outFile, 64<<10)
	writeFailed := func(e error) (io.ReadSeekCloser, int64, func(), error) {
		cleanup()
		return nil, 0, nil, e
	}

	if err := bw.WriteByte('{'); err != nil {
		return writeFailed(err)
	}
	firstField := true
	writeFieldPrefix := func(key string) error {
		if !firstField {
			if err := bw.WriteByte(','); err != nil {
				return err
			}
		}
		firstField = false
		kb, _ := json.Marshal(key)
		if _, err := bw.Write(kb); err != nil {
			return err
		}
		return bw.WriteByte(':')
	}

	ctrlKeys := make([]string, 0, len(ctrl))
	for k := range ctrl {
		ctrlKeys = append(ctrlKeys, k)
	}
	sort.Strings(ctrlKeys)
	for _, k := range ctrlKeys {
		if err := writeFieldPrefix(k); err != nil {
			return writeFailed(err)
		}
		vb, err := json.Marshal(ctrl[k])
		if err != nil {
			return writeFailed(err)
		}
		if _, err := bw.Write(vb); err != nil {
			return writeFailed(err)
		}
	}

	extraKeys := make([]string, 0, len(giantExtra))
	for k := range giantExtra {
		extraKeys = append(extraKeys, k)
	}
	sort.Strings(extraKeys)
	for _, k := range extraKeys {
		if err := writeFieldPrefix(k); err != nil {
			return writeFailed(err)
		}
		if err := jsonscan.CopySpan(bw, ra, giantExtra[k]); err != nil {
			return writeFailed(err)
		}
	}

	if hasTools && toolsSpan.End > toolsSpan.Start {
		if err := writeFieldPrefix("tools"); err != nil {
			return writeFailed(err)
		}
		var fb [1]byte
		if _, rerr := ra.ReadAt(fb[:], toolsSpan.Start); rerr == nil && fb[0] == '[' {
			tArr, aerr := jsonscan.Array(io.NewSectionReader(ra, toolsSpan.Start, toolsSpan.End-toolsSpan.Start))
			if aerr != nil {
				return writeFailed(aerr)
			}
			if err := bw.WriteByte('['); err != nil {
				return writeFailed(err)
			}
			for i, tsp := range tArr {
				tsp.Start += toolsSpan.Start
				tsp.End += toolsSpan.Start
				if i > 0 {
					if err := bw.WriteByte(','); err != nil {
						return writeFailed(err)
					}
				}
				if tsp.End-tsp.Start <= spoolInlineItemLimit {
					rawTool, rerr := readSpanBytes(ra, tsp)
					if rerr != nil {
						return writeFailed(rerr)
					}
					var toolObj any
					if uerr := json.Unmarshal(rawTool, &toolObj); uerr != nil {
						return writeFailed(uerr)
					}
					if tm, ok := toolObj.(map[string]any); ok {
						if fn, ok := tm["function"].(map[string]any); ok {
							normalizeSchemaTree(fn["parameters"])
						}
						normalizeSchemaTree(tm["parameters"])
					}
					if opts.Sanitize {
						sanitizeTools([]any{toolObj})
					}
					tb, merr := json.Marshal(toolObj)
					if merr != nil {
						return writeFailed(merr)
					}
					if _, werr := bw.Write(tb); werr != nil {
						return writeFailed(werr)
					}
				} else {
					if err := jsonscan.CopySpan(bw, ra, tsp); err != nil {
						return writeFailed(err)
					}
				}
			}
			if err := bw.WriteByte(']'); err != nil {
				return writeFailed(err)
			}
		} else {
			if err := jsonscan.CopySpan(bw, ra, toolsSpan); err != nil {
				return writeFailed(err)
			}
		}
	}

	if hasMsgs && msgSpan.End > msgSpan.Start {
		if err := writeFieldPrefix("messages"); err != nil {
			return writeFailed(err)
		}
		if !msgsIsArray {
			if err := jsonscan.CopySpan(bw, ra, msgSpan); err != nil {
				return writeFailed(err)
			}
		} else {
			if err := bw.WriteByte('['); err != nil {
				return writeFailed(err)
			}
			dsModel := isDeepSeekModel(modelName)
			for stepIdx, st := range plan {
				if stepIdx > 0 {
					if err := bw.WriteByte(','); err != nil {
						return writeFailed(err)
					}
				}
				if st.synthetic {
					txt := st.synthText
					if opts.Sanitize {
						txt = sanitizeText(txt)
					}
					sb, _ := json.Marshal(map[string]any{"role": st.synthRole, "content": txt})
					if _, werr := bw.Write(sb); werr != nil {
						return writeFailed(werr)
					}
					continue
				}

				if len(st.indices) == 1 && metas[st.indices[0]].span.End-metas[st.indices[0]].span.Start > spoolInlineItemLimit {
					if werr := writeGiantMessageStream(bw, ra, metas[st.indices[0]].span, st.indices[0], dsModel && (thinkingEnabled || hasTrace), opts.Sanitize, st.keepCalls); werr != nil {
						return writeFailed(werr)
					}
					continue
				}

				var msgObj map[string]any
				for pos, idx := range st.indices {
					rawMsg, rerr := readSpanBytes(ra, metas[idx].span)
					if rerr != nil {
						return writeFailed(rerr)
					}
					var item map[string]any
					if uerr := json.Unmarshal(rawMsg, &item); uerr != nil {
						return writeFailed(uerr)
					}
					if pos == 0 {
						msgObj = item
						continue
					}
					if tcs, ok := item["tool_calls"].([]any); ok && len(tcs) > 0 {
						if prevCalls, ok := msgObj["tool_calls"].([]any); ok {
							msgObj["tool_calls"] = append(prevCalls, tcs...)
						} else {
							msgObj["tool_calls"] = tcs
						}
					} else if txt, ok := item["content"].(string); ok && txt != "" && emptyContent(msgObj["content"]) {
						msgObj["content"] = txt
					}
					mergeReasoningContent(msgObj, item)
				}

				if len(st.keepCalls) > 0 {
					filterAssistantToolCalls(msgObj, st.keepCalls)
				}
				if role, ok := msgObj["role"].(string); ok && strings.EqualFold(strings.TrimSpace(role), "developer") {
					msgObj["role"] = "system"
					log.Printf("role normalized developer->system idx=%d", st.indices[0])
				}
				normalizeSingleImageURL(msgObj)
				if dsModel && (thinkingEnabled || hasTrace) {
					backfillSingleAssistantMessage(msgObj)
				}
				if opts.Sanitize {
					sanitizeMessages([]any{msgObj})
				}
				guardEmptyTextParts([]any{msgObj})
				MirrorAssistantMessageReasoning(msgObj, modelName)

				encoded, merr := json.Marshal(msgObj)
				if merr != nil {
					return writeFailed(merr)
				}
				if _, werr := bw.Write(encoded); werr != nil {
					return writeFailed(werr)
				}
			}
			if err := bw.WriteByte(']'); err != nil {
				return writeFailed(err)
			}
		}
	}

	if err := bw.WriteByte('}'); err != nil {
		return writeFailed(err)
	}
	if err := bw.Flush(); err != nil {
		return writeFailed(err)
	}
	if err := outFile.Sync(); err != nil {
		return writeFailed(err)
	}
	stat, err := outFile.Stat()
	if err != nil {
		return writeFailed(err)
	}
	if _, err := outFile.Seek(0, io.SeekStart); err != nil {
		return writeFailed(err)
	}
	return outFile, stat.Size(), cleanup, nil
}
func writeGiantMessageStream(bw *bufio.Writer, ra io.ReaderAt, msgSpan jsonscan.Span, msgIdx int, needDeepSeekBackfill, sanitize bool, keepCalls map[string]bool) error {
	fields, err := jsonscan.Object(io.NewSectionReader(ra, msgSpan.Start, msgSpan.End-msgSpan.Start))
	if err != nil {
		return err
	}
	if err := bw.WriteByte('{'); err != nil {
		return err
	}
	var role string
	var hasRC, hasReasoning bool
	first := true
	writeKey := func(k string) error {
		if !first {
			if err := bw.WriteByte(','); err != nil {
				return err
			}
		}
		first = false
		kb, _ := json.Marshal(k)
		if _, err := bw.Write(kb); err != nil {
			return err
		}
		return bw.WriteByte(':')
	}

	for _, fd := range fields {
		fd.Start += msgSpan.Start
		fd.End += msgSpan.Start
		switch fd.Key {
		case "role":
			role = readJSONStringSpan(ra, fd)
			if strings.EqualFold(strings.TrimSpace(role), "developer") {
				role = "system"
				log.Printf("role normalized developer->system idx=%d", msgIdx)
			}
			if err := writeKey("role"); err != nil {
				return err
			}
			rb, _ := json.Marshal(role)
			if _, err := bw.Write(rb); err != nil {
				return err
			}
		case "reasoning_content":
			hasRC = true
			if err := writeKey("reasoning_content"); err != nil {
				return err
			}
			if err := streamOrSanitizeStringSpan(bw, ra, fd, sanitize, false); err != nil {
				return err
			}
		case "reasoning":
			hasReasoning = true
			if err := writeKey("reasoning"); err != nil {
				return err
			}
			if err := streamOrSanitizeStringSpan(bw, ra, fd, sanitize, false); err != nil {
				return err
			}
		case "content":
			if err := writeKey("content"); err != nil {
				return err
			}
			if err := writeGiantContentSpan(bw, ra, fd, sanitize); err != nil {
				return err
			}
		case "tool_calls":
			if fd.End-fd.Start <= spoolInlineItemLimit {
				raw, rerr := readSpanBytes(ra, fd)
				if rerr != nil {
					return rerr
				}
				var tcs any
				if json.Unmarshal(raw, &tcs) == nil {
					holder := map[string]any{"tool_calls": tcs}
					if len(keepCalls) > 0 {
						filterAssistantToolCalls(holder, keepCalls)
					}
					if holder["tool_calls"] != nil {
						if sanitize {
							sanitizeToolCalls(holder["tool_calls"])
						}
						if err := writeKey("tool_calls"); err != nil {
							return err
						}
						tb, _ := json.Marshal(holder["tool_calls"])
						if _, err := bw.Write(tb); err != nil {
							return err
						}
					}
					continue
				}
			}
			if err := writeKey("tool_calls"); err != nil {
				return err
			}
			if err := jsonscan.CopySpan(bw, ra, fd); err != nil {
				return err
			}
		default:
			if err := writeKey(fd.Key); err != nil {
				return err
			}
			if err := jsonscan.CopySpan(bw, ra, fd); err != nil {
				return err
			}
		}
	}

	if needDeepSeekBackfill && role == "assistant" {
		if !hasRC {
			if err := writeKey("reasoning_content"); err != nil {
				return err
			}
			if _, err := bw.WriteString(`""`); err != nil {
				return err
			}
		}
		if !hasReasoning {
			if err := writeKey("reasoning"); err != nil {
				return err
			}
			if _, err := bw.WriteString(`" "`); err != nil {
				return err
			}
		}
	}
	return bw.WriteByte('}')
}

func writeGiantContentSpan(bw *bufio.Writer, ra io.ReaderAt, span jsonscan.Span, sanitize bool) error {
	var fb [1]byte
	if _, err := ra.ReadAt(fb[:], span.Start); err != nil {
		return err
	}
	if fb[0] == '"' {
		if span.End-span.Start <= spoolInlineItemLimit {
			return streamOrSanitizeStringSpan(bw, ra, span, sanitize, true)
		}
		if !sanitize {
			return jsonscan.CopySpan(bw, ra, span)
		}
		return sanitizeStreamJSONStringSpan(bw, ra, span)
	}
	if fb[0] != '[' {
		return jsonscan.CopySpan(bw, ra, span)
	}
	parts, err := jsonscan.Array(io.NewSectionReader(ra, span.Start, span.End-span.Start))
	if err != nil {
		return err
	}
	if err := bw.WriteByte('['); err != nil {
		return err
	}
	for i, part := range parts {
		if i > 0 {
			if err := bw.WriteByte(','); err != nil {
				return err
			}
		}
		part.Start += span.Start
		part.End += span.Start
		if part.End-part.Start <= spoolInlineItemLimit {
			rawPart, rerr := readSpanBytes(ra, part)
			if rerr != nil {
				return rerr
			}
			var partObj map[string]any
			if json.Unmarshal(rawPart, &partObj) == nil {
				if partObj["type"] == "image_url" {
					if u, ok := partObj["image_url"].(string); ok && u != "" {
						partObj["image_url"] = map[string]any{"url": u}
					}
				}
				if sanitize {
					if txt, ok := partObj["text"].(string); ok {
						partObj["text"] = sanitizeText(txt)
					}
				}
				if partType(partObj) == "text" && isEmptyText(partObj) {
					partObj["text"] = emptyTextPartFill
				}
				pb, _ := json.Marshal(partObj)
				if _, werr := bw.Write(pb); werr != nil {
					return werr
				}
				continue
			}
		}
		pFields, ferr := jsonscan.Object(io.NewSectionReader(ra, part.Start, part.End-part.Start))
		if ferr != nil {
			if err := jsonscan.CopySpan(bw, ra, part); err != nil {
				return err
			}
			continue
		}
		var pType string
		for _, pf := range pFields {
			if pf.Key == "type" {
				pf.Start += part.Start
				pf.End += part.Start
				pType = readJSONStringSpan(ra, pf)
			}
		}
		if err := bw.WriteByte('{'); err != nil {
			return err
		}
		for j, pf := range pFields {
			if j > 0 {
				if err := bw.WriteByte(','); err != nil {
					return err
				}
			}
			pf.Start += part.Start
			pf.End += part.Start
			kb, _ := json.Marshal(pf.Key)
			if _, err := bw.Write(kb); err != nil {
				return err
			}
			if err := bw.WriteByte(':'); err != nil {
				return err
			}
			if pType == "image_url" && pf.Key == "image_url" && pf.End-pf.Start > 2 {
				var pfb [1]byte
				if _, rerr := ra.ReadAt(pfb[:], pf.Start); rerr == nil && pfb[0] == '"' {
					if _, err := bw.WriteString(`{"url":`); err != nil {
						return err
					}
					if err := jsonscan.CopySpan(bw, ra, pf); err != nil {
						return err
					}
					if err := bw.WriteByte('}'); err != nil {
						return err
					}
					continue
				}
			}
			if pf.Key == "text" && sanitize {
				if err := sanitizeStreamJSONStringSpan(bw, ra, pf); err != nil {
					return err
				}
				continue
			}
			if err := jsonscan.CopySpan(bw, ra, pf); err != nil {
				return err
			}
		}
		if err := bw.WriteByte('}'); err != nil {
			return err
		}
	}
	return bw.WriteByte(']')
}

func streamOrSanitizeStringSpan(bw *bufio.Writer, ra io.ReaderAt, span jsonscan.Span, sanitize, checkSniffedParts bool) error {
	if span.End-span.Start > spoolInlineItemLimit {
		if !sanitize {
			return jsonscan.CopySpan(bw, ra, span)
		}
		return sanitizeStreamJSONStringSpan(bw, ra, span)
	}
	raw, err := readSpanBytes(ra, span)
	if err != nil {
		return err
	}
	var val string
	if json.Unmarshal(raw, &val) != nil {
		_, werr := bw.Write(raw)
		return werr
	}
	if sanitize {
		val = sanitizeText(val)
	}
	if checkSniffedParts {
		if parts := sniffParts(val); parts != nil && fillEmptyTextParts(parts) {
			if nb, merr := json.Marshal(parts); merr == nil {
				val = string(nb)
			}
		}
	}
	encoded, _ := json.Marshal(val)
	_, werr := bw.Write(encoded)
	return werr
}

func sanitizeStreamJSONStringSpan(bw *bufio.Writer, ra io.ReaderAt, span jsonscan.Span) error {
	if span.End-span.Start < 2 {
		return jsonscan.CopySpan(bw, ra, span)
	}
	var first, last [1]byte
	if _, err := ra.ReadAt(first[:], span.Start); err != nil {
		return err
	}
	if _, err := ra.ReadAt(last[:], span.End-1); err != nil {
		return err
	}
	if first[0] != '"' || last[0] != '"' {
		return jsonscan.CopySpan(bw, ra, span)
	}

	if err := bw.WriteByte('"'); err != nil {
		return err
	}
	sr := io.NewSectionReader(ra, span.Start+1, (span.End-1)-(span.Start+1))
	br := bufio.NewReaderSize(sr, 32<<10)
	pending := make([]byte, 0, spoolStreamChunkSize+spoolStreamOverlap)
	wroteAny := false

	flushWindow := func(final bool) error {
		if len(pending) == 0 {
			return nil
		}
		var emit []byte
		if final {
			cleaned := sanitizeTextCore(string(pending))
			if !wroteAny {
				cleaned = strings.TrimSpace(cleaned)
			} else if cleaned != string(pending) {
				cleaned = strings.TrimRight(cleaned, " \t\r\n")
			}
			if !hasFingerprint(string(pending)) {
				emit = pending
			} else {
				emit = []byte(cleaned)
			}
			pending = pending[:0]
		} else {
			cut := len(pending) - spoolStreamOverlap
			for cut > 0 && !utf8.RuneStart(pending[cut]) {
				cut--
			}
			if cut <= 0 {
				return nil
			}
			if nl := bytes.LastIndexByte(pending[:cut], '\n'); nl > cut-2048 && nl > 0 {
				cut = nl + 1
			}
			head := string(pending[:cut])
			cleaned := sanitizeTextCore(head)
			if !wroteAny && cleaned != head {
				cleaned = strings.TrimLeft(cleaned, " \t\r\n")
			}
			emit = []byte(cleaned)
			rem := len(pending) - cut
			copy(pending[:rem], pending[cut:])
			pending = pending[:rem]
		}
		if len(emit) > 0 {
			wroteAny = true
			if err := writeJSONEscapedUTF8(bw, emit); err != nil {
				return err
			}
		}
		return nil
	}

	for {
		b, err := br.ReadByte()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if b != '\\' {
			pending = append(pending, b)
		} else {
			esc, eerr := br.ReadByte()
			if eerr != nil {
				return eerr
			}
			switch esc {
			case '"', '\\', '/':
				pending = append(pending, esc)
			case 'b':
				pending = append(pending, '\b')
			case 'f':
				pending = append(pending, '\f')
			case 'n':
				pending = append(pending, '\n')
			case 'r':
				pending = append(pending, '\r')
			case 't':
				pending = append(pending, '\t')
			case 'u':
				var hex4 [4]byte
				if _, uerr := io.ReadFull(br, hex4[:]); uerr != nil {
					return uerr
				}
				u1, perr := strconv.ParseUint(string(hex4[:]), 16, 16)
				if perr != nil {
					return perr
				}
				r := rune(u1)
				if utf16.IsSurrogate(r) {
					peek2, pe := br.Peek(2)
					if pe == nil && peek2[0] == '\\' && peek2[1] == 'u' {
						_, _ = br.Discard(2)
						var hex4b [4]byte
						if _, uerr := io.ReadFull(br, hex4b[:]); uerr == nil {
							if u2, perr2 := strconv.ParseUint(string(hex4b[:]), 16, 16); perr2 == nil {
								r = utf16.DecodeRune(r, rune(u2))
							}
						}
					}
				}
				pending = utf8.AppendRune(pending, r)
			default:
				pending = append(pending, '\\', esc)
			}
		}
		if len(pending) >= spoolStreamChunkSize+spoolStreamOverlap {
			if err := flushWindow(false); err != nil {
				return err
			}
		}
	}
	if err := flushWindow(true); err != nil {
		return err
	}
	return bw.WriteByte('"')
}

func writeJSONEscapedUTF8(bw *bufio.Writer, raw []byte) error {
	for len(raw) > 0 {
		n := len(raw)
		if n > 16384 {
			n = 16384
			for n > 0 && !utf8.RuneStart(raw[n]) {
				n--
			}
		}
		if n == 0 {
			n = 1
		}
		encoded, err := json.Marshal(string(raw[:n]))
		if err != nil {
			return err
		}
		if _, err := bw.Write(encoded[1 : len(encoded)-1]); err != nil {
			return err
		}
		raw = raw[n:]
	}
	return nil
}

func shouldSuppressTools(tc any) bool {
	switch val := tc.(type) {
	case string:
		return strings.EqualFold(strings.TrimSpace(val), "none")
	case map[string]any:
		typ, _ := val["type"].(string)
		return strings.EqualFold(strings.TrimSpace(typ), "none")
	}
	return false
}

func filterAssistantToolCalls(msg map[string]any, keepCalls map[string]bool) {
	calls, ok := msg["tool_calls"].([]any)
	if !ok {
		return
	}
	kept := make([]any, 0, len(calls))
	for _, raw := range calls {
		tc, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		id, _ := tc["id"].(string)
		if keepCalls[id] {
			kept = append(kept, raw)
		}
	}
	if len(kept) > 0 {
		msg["tool_calls"] = kept
	} else {
		delete(msg, "tool_calls")
	}
}

func normalizeSingleImageURL(msg map[string]any) {
	parts, ok := msg["content"].([]any)
	if !ok {
		return
	}
	for _, rawPart := range parts {
		part, ok := rawPart.(map[string]any)
		if !ok || part["type"] != "image_url" {
			continue
		}
		if imageURL, ok := part["image_url"].(string); ok && imageURL != "" {
			part["image_url"] = map[string]any{"url": imageURL}
		}
	}
}

func backfillSingleAssistantMessage(msg map[string]any) {
	role, _ := msg["role"].(string)
	if role != "assistant" {
		return
	}
	rc, hasRC := msg["reasoning_content"].(string)
	if !hasRC {
		if r, ok := msg["reasoning"].(string); ok {
			rc = r
			msg["reasoning_content"] = rc
		} else {
			rc = ""
			msg["reasoning_content"] = rc
		}
	}
	if r, ok := msg["reasoning"].(string); ok && r != "" {
		return
	}
	if rc != "" {
		msg["reasoning"] = rc
	} else {
		msg["reasoning"] = " "
	}
}

func readSpanBytes(ra io.ReaderAt, sp jsonscan.Span) ([]byte, error) {
	if sp.End <= sp.Start {
		return nil, nil
	}
	buf := make([]byte, sp.End-sp.Start)
	n, err := io.ReadFull(io.NewSectionReader(ra, sp.Start, sp.End-sp.Start), buf)
	if err != nil && err != io.EOF && err != io.ErrUnexpectedEOF {
		return nil, err
	}
	return buf[:n], nil
}

func readJSONStringSpan(ra io.ReaderAt, sp jsonscan.Span) string {
	if sp.End <= sp.Start || sp.End-sp.Start > 65536 {
		return ""
	}
	raw, err := readSpanBytes(ra, sp)
	if err != nil {
		return ""
	}
	var val string
	_ = json.Unmarshal(raw, &val)
	return val
}

func isEmptyJSONStringSpan(ra io.ReaderAt, sp jsonscan.Span) bool {
	if sp.End-sp.Start <= 2 {
		return true
	}
	if sp.End-sp.Start > 65536 {
		return false
	}
	raw, err := readSpanBytes(ra, sp)
	if err != nil {
		return true
	}
	var val string
	if json.Unmarshal(raw, &val) != nil {
		return true
	}
	return val == ""
}

func isEmptyContentSpan(ra io.ReaderAt, sp jsonscan.Span) bool {
	if sp.End <= sp.Start {
		return true
	}
	if sp.End-sp.Start <= 6 {
		raw, err := readSpanBytes(ra, sp)
		if err != nil {
			return false
		}
		trimmed := strings.TrimSpace(string(raw))
		return trimmed == "null" || trimmed == `""` || trimmed == "[]"
	}
	return false
}

func readToolCallIDs(ra io.ReaderAt, sp jsonscan.Span) []string {
	if sp.End <= sp.Start {
		return nil
	}
	var fb [1]byte
	if _, err := ra.ReadAt(fb[:], sp.Start); err != nil || fb[0] != '[' {
		return nil
	}
	items, err := jsonscan.Array(io.NewSectionReader(ra, sp.Start, sp.End-sp.Start))
	if err != nil {
		return nil
	}
	ids := make([]string, 0, len(items))
	for _, it := range items {
		it.Start += sp.Start
		it.End += sp.Start
		fields, ferr := jsonscan.Object(io.NewSectionReader(ra, it.Start, it.End-it.Start))
		if ferr != nil {
			continue
		}
		for _, fd := range fields {
			if fd.Key == "id" {
				fd.Start += it.Start
				fd.End += it.Start
				if id := readJSONStringSpan(ra, fd); id != "" {
					ids = append(ids, id)
				}
			}
		}
	}
	return ids
}

func spanContainsBytes(ra io.ReaderAt, sp jsonscan.Span, needle []byte) bool {
	if sp.End <= sp.Start || len(needle) == 0 {
		return false
	}
	sr := io.NewSectionReader(ra, sp.Start, sp.End-sp.Start)
	buf := make([]byte, 32<<10)
	carry := make([]byte, 0, len(needle)-1)
	for {
		n, err := sr.Read(buf)
		if n > 0 {
			chunk := append(carry, buf[:n]...)
			if bytes.Contains(chunk, needle) {
				return true
			}
			if len(chunk) >= len(needle) {
				carry = append(carry[:0], chunk[len(chunk)-(len(needle)-1):]...)
			} else {
				carry = append(carry[:0], chunk...)
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return false
		}
	}
	return false
}

func extractMessageTextBounded(ra io.ReaderAt, sp jsonscan.Span) string {
	if sp.End-sp.Start <= spoolInlineItemLimit {
		raw, err := readSpanBytes(ra, sp)
		if err != nil {
			return ""
		}
		var str string
		if json.Unmarshal(raw, &str) == nil {
			return str
		}
		var parts []struct {
			Text string `json:"text"`
		}
		if json.Unmarshal(raw, &parts) == nil {
			var sb strings.Builder
			for _, p := range parts {
				sb.WriteString(p.Text)
			}
			return sb.String()
		}
	}
	return ""
}

func extractStableUserSigBounded(ra io.ReaderAt, sp jsonscan.Span) string {
	if sp.End-sp.Start <= spoolInlineItemLimit {
		raw, err := readSpanBytes(ra, sp)
		if err != nil {
			return ""
		}
		return stableUserSigFromRaw(raw)
	}
	var fb [1]byte
	if _, err := ra.ReadAt(fb[:], sp.Start); err != nil || fb[0] != '[' {
		return ""
	}
	parts, err := jsonscan.Array(io.NewSectionReader(ra, sp.Start, sp.End-sp.Start))
	if err != nil {
		return ""
	}
	var sb strings.Builder
	hasNonText := false
	for _, p := range parts {
		p.Start += sp.Start
		p.End += sp.Start
		pFields, ferr := jsonscan.Object(io.NewSectionReader(ra, p.Start, p.End-p.Start))
		if ferr != nil {
			return ""
		}
		var pType, pText string
		for _, pf := range pFields {
			pf.Start += p.Start
			pf.End += p.Start
			if pf.Key == "type" {
				pType = readJSONStringSpan(ra, pf)
			} else if pf.Key == "text" && pf.End-pf.Start <= spoolInlineItemLimit {
				pText = readJSONStringSpan(ra, pf)
			}
		}
		if pType == "" || pType == "text" {
			sb.WriteString(pText)
			continue
		}
		hasNonText = true
		sb.WriteString("\n[" + pType + "]\n")
	}
	out := sb.String()
	if !hasNonText {
		return out
	}
	return strings.TrimSpace(out)
}

func stableUserSigFromRaw(raw []byte) string {
	st := strings.TrimSpace(string(raw))
	if st == "" || st == "null" {
		return ""
	}
	if st[0] == '"' {
		var str string
		if json.Unmarshal(raw, &str) != nil {
			return ""
		}
		return str
	}
	if st[0] != '[' {
		return ""
	}
	var parts []json.RawMessage
	if json.Unmarshal(raw, &parts) != nil {
		return ""
	}
	var sb strings.Builder
	hasNonText := false
	for _, pr := range parts {
		var p struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}
		if json.Unmarshal(pr, &p) != nil {
			return ""
		}
		if p.Type == "" || p.Type == "text" {
			sb.WriteString(p.Text)
			continue
		}
		hasNonText = true
		sb.WriteString("\n[" + p.Type + "]\n")
	}
	out := sb.String()
	if !hasNonText {
		return out
	}
	return strings.TrimSpace(out)
}

func extractTurnContentSig(ra io.ReaderAt, sp jsonscan.Span) string {
	if sp.End-sp.Start <= spoolInlineItemLimit {
		raw, err := readSpanBytes(ra, sp)
		if err != nil {
			return ""
		}
		return turnContentSigFromRaw(raw)
	}
	var fb [1]byte
	if _, err := ra.ReadAt(fb[:], sp.Start); err != nil {
		return ""
	}
	if fb[0] == '"' {
		h := sha256.New()
		_, _ = io.CopyBuffer(h, io.NewSectionReader(ra, sp.Start, sp.End-sp.Start), make([]byte, 32<<10))
		return "[large_text:" + hex.EncodeToString(h.Sum(nil)[:8]) + "]"
	}
	if fb[0] != '[' {
		return ""
	}
	parts, err := jsonscan.Array(io.NewSectionReader(ra, sp.Start, sp.End-sp.Start))
	if err != nil {
		return ""
	}
	var sb strings.Builder
	hasNonText := false
	for _, p := range parts {
		p.Start += sp.Start
		p.End += sp.Start
		pFields, ferr := jsonscan.Object(io.NewSectionReader(ra, p.Start, p.End-p.Start))
		if ferr != nil {
			return ""
		}
		var pType, pText string
		for _, pf := range pFields {
			pf.Start += p.Start
			pf.End += p.Start
			if pf.Key == "type" {
				pType = readJSONStringSpan(ra, pf)
			} else if pf.Key == "text" && pf.End-pf.Start <= spoolInlineItemLimit {
				pText = readJSONStringSpan(ra, pf)
			}
		}
		if pType == "" || pType == "text" {
			sb.WriteString(pText)
			continue
		}
		hasNonText = true
		h := sha256.New()
		_, _ = io.CopyBuffer(h, io.NewSectionReader(ra, p.Start, p.End-p.Start), make([]byte, 32<<10))
		fmt.Fprintf(&sb, "\n[%s:%s]\n", pType, hex.EncodeToString(h.Sum(nil)[:4]))
	}
	out := sb.String()
	if !hasNonText {
		return out
	}
	return strings.TrimSpace(out)
}

func turnContentSigFromRaw(raw []byte) string {
	st := strings.TrimSpace(string(raw))
	if st == "" || st == "null" {
		return ""
	}
	if st[0] == '"' {
		var str string
		if json.Unmarshal(raw, &str) != nil {
			return ""
		}
		return str
	}
	if st[0] != '[' {
		return ""
	}
	var parts []json.RawMessage
	if json.Unmarshal(raw, &parts) != nil {
		return ""
	}
	var sb strings.Builder
	hasNonText := false
	for _, pr := range parts {
		var p struct {
			Type string `json:"type"`
			Text string `json:"text"`
		}
		if json.Unmarshal(pr, &p) != nil {
			return ""
		}
		if p.Type == "" || p.Type == "text" {
			sb.WriteString(p.Text)
			continue
		}
		hasNonText = true
		sum := sha256.Sum256(pr)
		fmt.Fprintf(&sb, "\n[%s:%s]\n", p.Type, hex.EncodeToString(sum[:4]))
	}
	out := sb.String()
	if !hasNonText {
		return out
	}
	return strings.TrimSpace(out)
}
