<script lang="ts">
    import type { DiagnosticCategory, DraftNode, LegalDiagnostic, QuickFix, TermOccurrence, WorkspaceContext } from "$lib/api/ide";
    import type { BehaviorLineIndicator } from "$lib/engine/workspace-behaviors";
    import { buildLineDecorations, cursorPosition, findDiagnosticAtOffset, offsetForLine } from "$lib/ide-editor";
    import {
        applyCompletion,
        computeCompletions,
        computeEnterAutofill,
        computeInlineAutofill,
        type CompletionItem,
        type CompletionMenuState,
    } from "$lib/ide-intellisense";
    import { autoShiftOnManualPrefix, shiftAfterLineInsert } from "$lib/ide-numbering";
    import { ChevronRight, Loader, Scale, Sparkles, X } from "@lucide/svelte";
    import DiagnosticHoverTooltip from "./DiagnosticHoverTooltip.svelte";
    import IntelliSenseMenu from "./IntelliSenseMenu.svelte";

    type Props = {
        title: string;
        content: string;
        diagnostics: LegalDiagnostic[];
        termOccurrences?: TermOccurrence[];
        lineBehaviors?: BehaviorLineIndicator[];
        outline?: DraftNode[];
        workspaceContext?: WorkspaceContext | null;
        activeRef?: string | null;
        isDirty?: boolean;
        aiAuditing?: boolean;
        aiPhaseLabel?: string | null;
        selectedDiagnosticId: string | null;
        cursorOffset: number;
        onChange: (value: string) => void;
        onCursorChange: (offset: number) => void;
        onCursorDiagnostic?: (diag: LegalDiagnostic) => void;
        onSelectDiagnostic: (diag: LegalDiagnostic) => void;
        onApplyQuickFix: (fix: QuickFix) => void;
        onAiFixDiagnostic?: (diag: LegalDiagnostic) => void;
        fixingDiagnosticId?: string | null;
        onJumpToDefinition?: (term: TermOccurrence) => void;
        onSelectBehavior?: (behavior: BehaviorLineIndicator) => void;
        onOpenBehaviorsPanel?: () => void;
        onCancelAi?: () => void;
        onSaveShortcut: () => void;
    };

    let {
        title,
        content,
        diagnostics,
        termOccurrences = [],
        lineBehaviors = [],
        outline = [],
        workspaceContext = null,
        activeRef = null,
        isDirty = false,
        aiAuditing = false,
        aiPhaseLabel = null,
        selectedDiagnosticId,
        cursorOffset,
        onChange,
        onCursorChange,
        onCursorDiagnostic,
        onSelectDiagnostic,
        onApplyQuickFix,
        onAiFixDiagnostic,
        fixingDiagnosticId = null,
        onJumpToDefinition,
        onSelectBehavior,
        onOpenBehaviorsPanel,
        onCancelAi,
        onSaveShortcut,
    }: Props = $props();

    let textareaEl = $state<HTMLTextAreaElement | null>(null);
    let backdropEl = $state<HTMLDivElement | null>(null);
    let editorBoxEl = $state<HTMLDivElement | null>(null);
    let mirrorEl = $state<HTMLDivElement | null>(null);
    let mirrorMarkerEl = $state<HTMLSpanElement | null>(null);

    let completionState = $state<CompletionMenuState | null>(null);
    let completionIndex = $state(0);
    let menuPosition = $state({ top: 44, left: 72, flipUp: false });

    const HOVER_SHOW_DELAY_MS = 1000;

    let hoveredDiagnostics = $state<LegalDiagnostic[]>([]);
    let hoveredTerm = $state<TermOccurrence | null>(null);
    let hoveredBehavior = $state<BehaviorLineIndicator | null>(null);
    let hoveringBehaviorIndicator = $state(false);
    let hoverPosition = $state({ top: 44, left: 72, flipUp: false });
    let hoverHideTimer: ReturnType<typeof setTimeout> | null = null;
    let hoverShowTimer: ReturnType<typeof setTimeout> | null = null;
    let pendingHoverKey: string | null = null;
    let activeHoverKey: string | null = null;

    $effect(() => {
        return () => {
            if (hoverShowTimer) {
                clearTimeout(hoverShowTimer);
            }

            if (hoverHideTimer) {
                clearTimeout(hoverHideTimer);
            }
        };
    });

    const lines = $derived(buildLineDecorations(content, diagnostics, selectedDiagnosticId, termOccurrences));
    const cursorLine = $derived(cursorPosition(content, cursorOffset).line);
    const inlineAutofill = $derived(completionState ? null : computeInlineAutofill(content, cursorOffset, outline));
    const behaviorByLine = $derived(new Map(lineBehaviors.map((item) => [item.line, item])));

    export function focusLine(line: number, startOffset?: number): void {
        if (!textareaEl) {
            return;
        }

        const offset = startOffset ?? offsetForLine(content, line);
        textareaEl.focus();
        textareaEl.setSelectionRange(offset, offset);
        onCursorChange(offset);
        completionState = null;
        hoveredDiagnostics = [];
        hoveredTerm = null;
        hoveredBehavior = null;

        const lineHeightPx = 28;
        const targetScroll = Math.max(0, (line - 4) * lineHeightPx);
        textareaEl.scrollTop = targetScroll;

        if (backdropEl) {
            backdropEl.scrollTop = textareaEl.scrollTop;
        }
    }

    function syncScroll(): void {
        if (textareaEl && backdropEl) {
            backdropEl.scrollTop = textareaEl.scrollTop;
        }

        hoveredDiagnostics = [];
        hoveredTerm = null;
        hoveredBehavior = null;

        if (completionState) {
            updateMenuPosition(textareaEl?.selectionStart ?? cursorOffset);
        }
    }

    function refreshCompletions(nextContent: string, offset: number, manualTrigger = false): void {
        const nextMenu = computeCompletions({
            content: nextContent,
            cursorOffset: offset,
            outline,
            workspaceContext,
            manualTrigger,
        });

        completionState = nextMenu;
        completionIndex = 0;

        if (nextMenu) {
            hoveredDiagnostics = [];
        hoveredTerm = null;
        hoveredBehavior = null;
            queueMicrotask(() => updateMenuPosition(offset));
        }
    }

    function acceptCompletion(item: CompletionItem): void {
        if (!completionState) {
            return;
        }

        const applied = applyCompletion(content, completionState, item);
        completionState = null;
        completionIndex = 0;
        onChange(applied.content);

        queueMicrotask(() => {
            if (textareaEl) {
                textareaEl.focus();
                textareaEl.setSelectionRange(applied.cursorOffset, applied.cursorOffset);
                onCursorChange(applied.cursorOffset);
            }
        });
    }

    function updateMenuPosition(offset: number): void {
        if (!textareaEl || !editorBoxEl || !mirrorEl || !mirrorMarkerEl) {
            return;
        }

        const clamped = Math.max(0, Math.min(offset, content.length));
        mirrorEl.textContent = content.slice(0, clamped);
        mirrorEl.appendChild(mirrorMarkerEl);

        const editorWidth = editorBoxEl.clientWidth;
        const editorHeight = editorBoxEl.clientHeight;
        const markerTop = mirrorMarkerEl.offsetTop - textareaEl.scrollTop + 28;
        const markerLeft = mirrorMarkerEl.offsetLeft + 56;
        const clampedLeft = Math.max(60, Math.min(markerLeft, Math.max(60, editorWidth - 450)));
        const flipUp = markerTop > Math.max(200, editorHeight - 250);
        const clampedTop = Math.max(8, Math.min(markerTop, Math.max(8, editorHeight - 32)));

        menuPosition = { top: clampedTop, left: clampedLeft, flipUp };
    }

    function findBehaviorAtClientPoint(clientX: number, clientY: number): BehaviorLineIndicator | null {
        if (!backdropEl) {
            return null;
        }

        const badges = backdropEl.querySelectorAll<HTMLElement>("[data-behavior-id]");

        for (const badge of badges) {
            for (const rect of badge.getClientRects()) {
                if (
                    clientX >= rect.left - 3
                    && clientX <= rect.right + 3
                    && clientY >= rect.top - 3
                    && clientY <= rect.bottom + 3
                ) {
                    const id = badge.dataset.behaviorId;

                    return lineBehaviors.find((item) => item.id === id) ?? null;
                }
            }
        }

        return null;
    }

    function handleMouseMove(event: MouseEvent): void {
        if (completionState || !backdropEl || !editorBoxEl) {
            hoveringBehaviorIndicator = false;

            return;
        }

        const spans = backdropEl.querySelectorAll<HTMLElement>("[data-diag-id], [data-term-id], [data-behavior-id]");
        let matchedSpan: HTMLElement | null = null;
        let matchedRect: DOMRect | null = null;

        for (const span of spans) {
            for (const rect of span.getClientRects()) {
                if (
                    event.clientX >= rect.left - 2
                    && event.clientX <= rect.right + 2
                    && event.clientY >= rect.top - 3
                    && event.clientY <= rect.bottom + 3
                ) {
                    matchedSpan = span;
                    matchedRect = rect;

                    break;
                }
            }

            if (matchedSpan) {
                break;
            }
        }

        if (!matchedSpan || !matchedRect) {
            hoveringBehaviorIndicator = false;
            cancelPendingHover();
            scheduleHideHover();

            return;
        }

        hoveringBehaviorIndicator = matchedSpan.dataset.behaviorId !== undefined;

        cancelHideHover();
        const diagId = matchedSpan.dataset.diagId;
        const termId = matchedSpan.dataset.termId;
        const behaviorId = matchedSpan.dataset.behaviorId;
        const hoverKey = `${diagId ?? ""}|${termId ?? ""}|${behaviorId ?? ""}`;

        if (hoverKey === activeHoverKey || hoverKey === pendingHoverKey) {
            return;
        }

        const primary = diagId ? diagnostics.find((item) => item.id === diagId) : undefined;
        const matchedTerm = termId ? (termOccurrences.find((item) => item.id === termId) ?? null) : null;
        const matchedBehavior = behaviorId ? (lineBehaviors.find((item) => item.id === behaviorId) ?? null) : null;

        if (!primary && !matchedTerm && !matchedBehavior) {
            cancelPendingHover();

            return;
        }

        const overlapping = primary
            ? diagnostics.filter(
                (item) => item.range.startOffset < primary.range.endOffset && item.range.endOffset > primary.range.startOffset,
            )
            : [];

        const boxRect = editorBoxEl.getBoundingClientRect();
        const rawTop = matchedRect.bottom - boxRect.top + 4;
        const rawLeft = matchedRect.left - boxRect.left;
        const flipUp = rawTop > Math.max(220, editorBoxEl.clientHeight - 220);
        const clampedLeft = Math.max(58, Math.min(rawLeft, Math.max(58, editorBoxEl.clientWidth - 460)));

        cancelPendingHover();
        pendingHoverKey = hoverKey;
        hoverShowTimer = setTimeout(() => {
            hoverShowTimer = null;
            pendingHoverKey = null;
            activeHoverKey = hoverKey;
            hoveredDiagnostics = overlapping.length > 0 ? overlapping : (primary ? [primary] : []);
            hoveredTerm = matchedTerm;
            hoveredBehavior = matchedBehavior;
            hoverPosition = { top: rawTop, left: clampedLeft, flipUp };
        }, HOVER_SHOW_DELAY_MS);
    }

    function cancelPendingHover(): void {
        if (hoverShowTimer) {
            clearTimeout(hoverShowTimer);
            hoverShowTimer = null;
        }

        pendingHoverKey = null;
    }

    function scheduleHideHover(): void {
        if (hoverHideTimer || (hoveredDiagnostics.length === 0 && !hoveredTerm && !hoveredBehavior)) {
            return;
        }

        hoverHideTimer = setTimeout(() => {
            hoveredDiagnostics = [];
            hoveredTerm = null;
            hoveredBehavior = null;
            activeHoverKey = null;
            hoverHideTimer = null;
        }, 180);
    }

    function cancelHideHover(): void {
        if (hoverHideTimer) {
            clearTimeout(hoverHideTimer);
            hoverHideTimer = null;
        }
    }

    function handleCursorEvent(): void {
        if (!textareaEl) {
            return;
        }

        const offset = textareaEl.selectionStart;
        onCursorChange(offset);

        const matching = findDiagnosticAtOffset(diagnostics, offset);

        if (matching && matching.id !== selectedDiagnosticId) {
            onCursorDiagnostic?.(matching);
        }
    }

    function handleKeydown(event: KeyboardEvent): void {
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
            event.preventDefault();
            onSaveShortcut();

            return;
        }

        if ((event.ctrlKey || event.metaKey) && event.code === "Space" && textareaEl) {
            event.preventDefault();
            refreshCompletions(content, textareaEl.selectionStart, true);

            return;
        }

        if (completionState) {
            if (completionState.items.length > 0 && event.key === "ArrowDown") {
                event.preventDefault();
                completionIndex = (completionIndex + 1) % completionState.items.length;

                return;
            }

            if (completionState.items.length > 0 && event.key === "ArrowUp") {
                event.preventDefault();
                completionIndex = (completionIndex - 1 + completionState.items.length) % completionState.items.length;

                return;
            }

            if (completionState.items.length > 0 && (event.key === "Tab" || event.key === "Enter")) {
                event.preventDefault();
                const chosen = completionState.items[completionIndex] ?? completionState.items[0];

                if (chosen) {
                    acceptCompletion(chosen);
                }

                return;
            }

            if (event.key === "Escape") {
                event.preventDefault();
                completionState = null;

                return;
            }
        }

        if (
            !completionState
            && event.key === "Enter"
            && !event.shiftKey
            && !event.ctrlKey
            && !event.metaKey
            && !event.altKey
            && textareaEl
            && textareaEl.selectionStart === textareaEl.selectionEnd
        ) {
            const enterResult = computeEnterAutofill(content, textareaEl.selectionStart);

            if (enterResult) {
                event.preventDefault();
                onChange(enterResult.content);

                queueMicrotask(() => {
                    if (textareaEl) {
                        textareaEl.setSelectionRange(enterResult.cursorOffset, enterResult.cursorOffset);
                        onCursorChange(enterResult.cursorOffset);
                        syncScroll();
                    }
                });

                return;
            }
        }

        if (event.key === "Tab" && !event.shiftKey && textareaEl) {
            event.preventDefault();
            const start = textareaEl.selectionStart;
            const end = textareaEl.selectionEnd;

            if (start === end && inlineAutofill) {
                const insert = inlineAutofill.insertText;
                const rawUpdated = `${content.slice(0, start)}${insert}${content.slice(end)}`;
                const lineIdx = rawUpdated.slice(0, start).split("\n").length - 1;
                const updated = shiftAfterLineInsert(rawUpdated, lineIdx);
                onChange(updated);

                queueMicrotask(() => {
                    if (textareaEl) {
                        textareaEl.setSelectionRange(start + insert.length, start + insert.length);
                        onCursorChange(start + insert.length);
                    }
                });

                return;
            }

            const updated = `${content.slice(0, start)}    ${content.slice(end)}`;
            onChange(updated);

            queueMicrotask(() => {
                if (textareaEl) {
                    textareaEl.setSelectionRange(start + 4, start + 4);
                    onCursorChange(start + 4);
                }
            });
        }
    }

    function squiggleClass(category: DiagnosticCategory): string {
        if (category === "LOGIC") {
            return "squiggle-logic";
        }

        if (category === "LOOPHOLE") {
            return "squiggle-loophole";
        }

        return "squiggle-ambiguity";
    }

    function lineSyntaxClass(lineText: string, lineIndex: number): string {
        if (
            lineIndex === 0
            && lineText.trim().length > 0
            && !/^\s*(?:Chương\s+|Điều\s+\d+|Căn\s+cứ\s+|Theo\s+đề\s+nghị\s+|\d+\.|[a-zđ]\))/iu.test(lineText)
        ) {
            return "text-[var(--syn-chapter)]";
        }

        if (/^\s*Chương\s+/iu.test(lineText)) {
            return "text-[var(--syn-chapter)]";
        }

        if (/^\s*Điều\s+/iu.test(lineText)) {
            return "text-[var(--syn-article)]";
        }

        if (/^\s*(?:\d+\.|[a-zđ]\))\s+/u.test(lineText)) {
            return "text-foreground";
        }

        if (/^\s*Căn\s+cứ\s+/iu.test(lineText)) {
            return "text-[var(--syn-index)]";
        }

        return "text-foreground";
    }
</script>

<div class="flex h-full min-h-0 flex-col bg-[var(--ide-editor)]">
    <!-- Breadcrumb -->
    <div class="flex h-7 shrink-0 items-center justify-between border-b bg-[var(--ide-editor)] px-3 text-[11px] text-muted-foreground select-none">
        <div class="flex min-w-0 items-center gap-1">
            <span class="truncate font-mono text-[10px]">{title}</span>
            {#if isDirty}
                <span class="size-1.5 shrink-0 rounded-full bg-foreground/70" title="Chưa lưu"></span>
            {/if}
            {#if activeRef}
                <ChevronRight class="size-3 shrink-0" aria-hidden="true" />
                <span class="truncate text-foreground/80">{activeRef}</span>
            {/if}
        </div>
        {#if aiAuditing}
            <div class="flex shrink-0 items-center gap-1.5 rounded-[2px] border border-primary/40 bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                <Loader class="size-3 animate-spin" aria-hidden="true" />
                <Sparkles class="size-3 animate-pulse" aria-hidden="true" />
                <span>{aiPhaseLabel ?? "AI Analyzer đang phân tích..."}</span>
                {#if onCancelAi}
                    <button
                        type="button"
                        onclick={onCancelAi}
                        title="Hủy phân tích AI"
                        class="ml-0.5 rounded-[2px] p-0.5 hover:bg-primary/20"
                    >
                        <X class="size-3" aria-hidden="true" />
                    </button>
                {/if}
            </div>
        {/if}
    </div>

    <div bind:this={editorBoxEl} class="relative min-h-0 flex-1 overflow-hidden">
        <!-- Hidden caret mirror matching textarea exact typography and padding -->
        <div
            bind:this={mirrorEl}
            aria-hidden="true"
            class="ide-editor-text pointer-events-none invisible absolute inset-y-0 right-0 left-14 overflow-y-scroll py-4 pr-6 pl-3 font-sans text-[14px] leading-[1.75rem]"
        ><span bind:this={mirrorMarkerEl}>&#8203;</span></div>

        <div
            bind:this={backdropEl}
            aria-hidden="true"
            class="ide-scroll pointer-events-none absolute inset-0 overflow-y-scroll py-4"
        >
            {#each lines as line (line.lineNumber)}
                {@const rawLine = line.segments.map((seg) => seg.text).join("")}
                {@const hasSelected = line.segments.some((seg) => seg.isSelected)}
                {@const isActiveLine = line.lineNumber === cursorLine}
                <div class={`flex items-start ${isActiveLine ? "bg-[var(--ide-active-line)]" : hasSelected ? "bg-primary/10" : ""}`}>
                    <div class="pointer-events-auto flex w-14 shrink-0 items-center justify-end gap-1 bg-[var(--ide-gutter)] pr-2 font-mono text-[11px] leading-[1.75rem] text-muted-foreground select-none">
                        {#if line.lineDiagnostics.length > 0}
                            <button
                                type="button"
                                onclick={() => onSelectDiagnostic(line.lineDiagnostics[0])}
                                title={line.lineDiagnostics[0].title}
                                class="flex items-center justify-center"
                            >
                                {#if line.gutterCategory === "LOGIC"}
                                    <span class="size-2 rounded-full bg-[var(--diag-logic)]"></span>
                                {:else if line.gutterCategory === "LOOPHOLE"}
                                    <span class="size-2 rounded-full bg-[var(--diag-loophole)]"></span>
                                {:else}
                                    <span class="size-2 rounded-full bg-[var(--diag-ambiguity)]"></span>
                                {/if}
                            </button>
                        {/if}
                        <span class={isActiveLine ? "text-foreground" : ""}>{line.lineNumber}</span>
                    </div>

                    <div
                        class={`ide-editor-text min-h-[1.75rem] min-w-0 flex-1 pr-6 pl-3 font-sans text-[14px] leading-[1.75rem] ${lineSyntaxClass(rawLine, line.lineNumber - 1)}`}
                    >
                        {#if rawLine.length === 0}
                            {#if isActiveLine && inlineAutofill && !completionState}
                                <span class="text-muted-foreground/45">{inlineAutofill.insertText}</span>
                                <span class="ml-1 rounded-[2px] border border-border/60 bg-muted/40 px-1 py-0 font-mono text-[9px] text-muted-foreground/70">Tab</span>
                            {:else}
                                <span>&nbsp;</span>
                            {/if}
                        {:else}
                            {#each line.segments as segment, segIdx (segIdx)}
                                {#if segment.diagnostic || segment.termOccurrence}
                                    <span
                                        data-diag-id={segment.diagnostic?.id}
                                        data-term-id={segment.termOccurrence?.id}
                                        class={`${segment.diagnostic ? squiggleClass(segment.diagnostic.category) : ""} ${
                                            segment.termOccurrence && segment.termOccurrence.status !== "UNDEFINED" ? "term-defined" : ""
                                        } ${segment.isSelected ? "ring-1 ring-primary/70" : ""}`}
                                    >{segment.text}</span>
                                {:else}
                                    <span>{segment.text}</span>
                                {/if}
                            {/each}
                            {@const lineBehavior = behaviorByLine.get(line.lineNumber)}
                            {#if lineBehavior}
                                <span class="relative inline-block h-0 w-0 align-baseline">
                                    <span
                                        data-behavior-id={lineBehavior.id}
                                        aria-label={lineBehavior.isNew ? "Hành vi mới" : `Hành vi (${lineBehavior.versionCount} phiên bản)`}
                                        title={lineBehavior.isNew ? "Hành vi mới — bấm để xem trong tab Hành vi" : `Hành vi (${lineBehavior.versionCount} phiên bản) — bấm để xem lịch sử`}
                                        class={`absolute -top-[0.95rem] left-2 inline-flex h-[18px] items-center justify-center rounded-[2px] border leading-none whitespace-nowrap ${
                                            lineBehavior.isNew
                                                ? "w-[18px] border-[var(--diag-ok)]/50 bg-[var(--diag-ok-bg)] text-[var(--diag-ok)]"
                                                : "gap-0.5 border-primary/40 bg-primary/15 px-1 font-mono text-[10px] text-primary"
                                        }`}
                                    >
                                        {#if lineBehavior.isNew}
                                            <Sparkles class="size-3" aria-hidden="true" />
                                        {:else}
                                            <Scale class="size-3" aria-hidden="true" />
                                            <span>{lineBehavior.versionCount}</span>
                                        {/if}
                                    </span>
                                </span>
                            {/if}
                        {/if}
                    </div>
                </div>
            {/each}
        </div>

        <textarea
            bind:this={textareaEl}
            value={content}
            spellcheck="false"
            autocomplete="off"
            aria-label="Trình soạn thảo văn bản quy phạm pháp luật"
            oninput={(event) => {
                const nextVal = event.currentTarget.value;
                const nextOffset = event.currentTarget.selectionStart;
                const adjusted = autoShiftOnManualPrefix(content, nextVal, nextOffset);
                cancelPendingHover();
                onChange(adjusted);
                onCursorChange(nextOffset);
                refreshCompletions(adjusted, nextOffset, false);
                queueMicrotask(() => {
                    if (adjusted !== nextVal && textareaEl) {
                        textareaEl.setSelectionRange(nextOffset, nextOffset);
                    }

                    syncScroll();
                });
            }}
            onscroll={() => {
                hoveringBehaviorIndicator = false;
                cancelPendingHover();
                syncScroll();
            }}
            onmousemove={handleMouseMove}
            onmouseleave={() => {
                hoveringBehaviorIndicator = false;
                cancelPendingHover();
                scheduleHideHover();
            }}
            onclick={(event) => {
                cancelPendingHover();
                const clickedBehavior = findBehaviorAtClientPoint(event.clientX, event.clientY);

                if (clickedBehavior) {
                    hoveredDiagnostics = [];
                    hoveredTerm = null;
                    hoveredBehavior = null;
                    onSelectBehavior?.(clickedBehavior);

                    return;
                }

                handleCursorEvent();
                completionState = null;
            }}
            onkeyup={(event) => {
                if (
                    completionState
                    && (event.key === "ArrowUp" || event.key === "ArrowDown" || event.key === "Escape")
                ) {
                    return;
                }

                handleCursorEvent();
            }}
            onkeydown={handleKeydown}
            onblur={() => {
                completionState = null;
            }}
            class={`ide-scroll ide-editor-text absolute inset-y-0 right-0 left-14 resize-none overflow-y-scroll border-0 bg-transparent py-4 pr-6 pl-3 font-sans text-[14px] leading-[1.75rem] text-transparent caret-foreground selection:bg-primary/25 focus:outline-none ${
                hoveringBehaviorIndicator ? "cursor-pointer" : ""
            }`}
        ></textarea>

        {#if completionState}
            <IntelliSenseMenu
                state={completionState}
                activeIndex={completionIndex}
                position={menuPosition}
                onSelect={acceptCompletion}
                onHover={(idx) => (completionIndex = idx)}
            />
        {:else if hoveredDiagnostics.length > 0 || hoveredTerm !== null || hoveredBehavior !== null}
            <DiagnosticHoverTooltip
                diagnostics={hoveredDiagnostics}
                {hoveredTerm}
                {hoveredBehavior}
                position={hoverPosition}
                onApplyQuickFix={(fix) => {
                    hoveredDiagnostics = [];
                    hoveredTerm = null;
                    hoveredBehavior = null;
                    onApplyQuickFix(fix);
                }}
                {fixingDiagnosticId}
                onAiFixDiagnostic={(diag) => {
                    hoveredDiagnostics = [];
                    hoveredTerm = null;
                    hoveredBehavior = null;
                    onAiFixDiagnostic?.(diag);
                }}
                onInspect={(diag) => {
                    hoveredDiagnostics = [];
                    hoveredTerm = null;
                    hoveredBehavior = null;

                    if (onCursorDiagnostic) {
                        onCursorDiagnostic(diag);
                    } else {
                        onSelectDiagnostic(diag);
                    }
                }}
                onJumpToDefinition={(term) => {
                    hoveredDiagnostics = [];
                    hoveredTerm = null;
                    hoveredBehavior = null;
                    onJumpToDefinition?.(term);
                }}
                onOpenBehaviorsPanel={() => {
                    const target = hoveredBehavior;
                    hoveredDiagnostics = [];
                    hoveredTerm = null;
                    hoveredBehavior = null;

                    if (target && onSelectBehavior) {
                        onSelectBehavior(target);
                    } else {
                        onOpenBehaviorsPanel?.();
                    }
                }}
                onMouseEnter={cancelHideHover}
                onMouseLeave={scheduleHideHover}
            />
        {/if}
    </div>
</div>
