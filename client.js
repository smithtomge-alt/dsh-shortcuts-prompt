/**
 * Client half of 快捷指令 (quick prompts).
 *
 * Renders the saved-prompt strip inside `conversation.composer.dock` — the
 * ambient row immediately below the composer card, which is itself capped to
 * the composer's width — so the strip reads as part of the input bar and shares
 * its left and right edges. Chips wrap onto new lines. Clicking a chip inserts
 * its prompt at the draft caret; the only other strip action opens the inline
 * management panel, which expands in place between the strip and the card (no
 * dialog, no scrim). The strip itself never edits: editing lives in the panel.
 *
 * This file is a browser module-table entry: external modules come only from
 * `factory(require)`, and no Harness Client package is imported.
 */
__ModuleLoader__.load({
  id: 'dsh-shortcuts-prompt',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useRef, useCallback, useMemo } = React;

    /**
     * Package-owned style sheet text: inserted once inside `apply` and removed
     * with the Client run, so no selector lives outside this bundle.
     */

    /** Locale namespace owned by this plugin. */
    const NS = 'quick-prompts';
    /** Package name; matches the Client bundle id and the Remote owner. */
    const PACKAGE = 'dsh-shortcuts-prompt';
    /** Remote namespace, reached as `ctx.remote.quickPrompts`. */
    const NAMESPACE = 'quickPrompts';
    /** Slot for entries above the composer card; this strip is the last one. */
    const SLOT = 'conversation.input.dock';
    /** Draw closest to the card, after the shipped queue dock (order 20). */
    // Just above the built-in queue dock (20) and below the goal dock (10): the
    // strip stays out of the dock's tucking negative margin and the queue keeps
    // attaching to the composer card, as designed.
    const ORDER = 19;
    /** This entry's id inside the slot. */
    const ENTRY_ID = 'quick-prompts';
    /** Input limits enforced on the Client side for a fast local error. */
    const LIMITS = { name: 60, content: 20000 };
    /** Preview-only switch: makes every write fail so the error path is reachable. */


    // ------------------------------------------------------------------
    // Copy
    // ------------------------------------------------------------------

    const EN = {
      'chip.label': 'Quick prompts',
      'chip.manage': 'Manage',
      'chip.insert': 'Insert',
      'panel.title': 'Quick prompts',
      'panel.add': 'Add',
      'panel.close': 'Collapse',
      'panel.count': '{count} saved',
      'panel.empty': 'Nothing saved yet. Add your first prompt.',
      'panel.loading': 'Loading…',
      'form.newTitle': 'New prompt',
      'form.editTitle': 'Edit prompt',
      'form.name': 'Name',
      'form.content': 'Content',
      'form.contentPlaceholder': 'Text to insert at the caret',
      'form.save': 'Save',
      'form.cancel': 'Cancel',
      'form.nameRequired': 'Name is required.',
      'form.nameTooLong': 'Name is limited to {limit} characters.',
      'form.contentRequired': 'Content is required.',
      'form.contentTooLong': 'Content is limited to {limit} characters.',
      'row.unnamed': 'Untitled',
      'row.insert': 'Insert',
      'row.edit': 'Edit',
      'row.moveUp': 'Move up',
      'row.moveDown': 'Move down',
      'row.delete': 'Delete',
      'error.insert': 'Could not insert the prompt into the draft.',
      'error.unavailable': 'Quick prompt storage is unavailable.',
      'error.disconnected': 'Quick prompts are not connected to the harness yet. Reload the page; if this persists, check the plugin log.',
      'error.unknown': 'Unknown failure.'
    };

    const ZH = {
      'chip.label': '快捷指令',
      'chip.manage': '管理',
      'chip.insert': '插入',
      'panel.title': '快捷指令',
      'panel.add': '新增',
      'panel.close': '收起',
      'panel.count': '共 {count} 条',
      'panel.empty': '还没有任何指令，点击「新增」添加第一条。',
      'panel.loading': '加载中…',
      'form.newTitle': '新增指令',
      'form.editTitle': '编辑指令',
      'form.name': '名称',
      'form.content': '内容',
      'form.contentPlaceholder': '插入到光标处的文本',
      'form.save': '保存',
      'form.cancel': '取消',
      'form.nameRequired': '名称不能为空。',
      'form.nameTooLong': '名称最多 {limit} 个字符。',
      'form.contentRequired': '内容不能为空。',
      'form.contentTooLong': '内容最多 {limit} 个字符。',
      'row.unnamed': '未命名',
      'row.insert': '插入',
      'row.edit': '编辑',
      'row.moveUp': '上移',
      'row.moveDown': '下移',
      'row.delete': '删除',
      'error.insert': '未能插入到草稿，请重试。',
      'error.unavailable': '快捷指令的存储不可用。',
      'error.disconnected': '快捷指令尚未连接到宿主。请刷新页面；若仍如此，请查看插件日志。',
      'error.unknown': '未知错误。'
    };

    /**
     * Fill `{name}` placeholders. Runs on already-translated text so a missing
     * key still shows something readable.
     */
    function fill(template, params) {
      if (!params) return template;
      return String(template).replace(/\{(\w+)\}/g, (match, name) =>
        Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
      );
    }

    /**
     * Readable text for a thrown value.
     */
    function reasonOf(error, t) {
      if (error && typeof error.message === 'string' && error.message !== '') return error.message;
      const text = String(error ?? '');
      return text === '' || text === 'undefined' ? t('error.unknown') : text;
    }

    /**
     * One-line summary of a prompt body: newlines collapse to spaces and the
     * result is cut with an ellipsis when it exceeds the budget.
     */
    function summarize(content, max) {
      const flat = String(content ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .join(' ');
      if (flat.length <= max) return flat;
      return `${flat.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
    }

    /**
     * Display label of one instruction: its name, else a content summary, else
     * the placeholder. The empty-name case is explicitly supported by the form.
     */
    function labelOf(t, instruction) {
      const name = String(instruction?.name ?? '').trim();
      if (name !== '') return name;
      const summary = summarize(instruction?.content, 20);
      return summary === '' ? t('row.unnamed') : summary;
    }

    // ------------------------------------------------------------------
    // Draft insertion
    // ------------------------------------------------------------------

    /**
     * Resolve the composer's contenteditable root. The attribute is the stable
     * marker the LiveView publishes; candidates are scanned because several
     * conversation views can be mounted at once.
     */
    function findComposerInput() {
      if (typeof document === 'undefined') return null;
      const nodes = document.querySelectorAll('[data-composer-input]');
      for (const node of nodes) {
        if (!node.isContentEditable) continue;
        return node;
      }
      return null;
    }

    /**
     * Restore a collapsed caret where the draft selection last was. When the
     * selection sits outside the editor the caret goes to the end.
     */
    function placeCaret(root) {
      root.focus({ preventScroll: true });
      const selection = window.getSelection?.();
      if (!selection) return;
      if (selection.rangeCount > 0) {
        const current = selection.getRangeAt(selection.rangeCount - 1);
        if (root.contains(current.startContainer)) {
          const collapsed = current.cloneRange();
          collapsed.collapse(false);
          selection.removeAllRanges();
          selection.addRange(collapsed);
          return;
        }
      }
      const end = document.createRange();
      end.selectNodeContents(root);
      end.collapse(false);
      selection.removeAllRanges();
      selection.addRange(end);
    }

    /**
     * Insert plain text at the draft caret. `execCommand('insertText')` is the
     * preferred path because it flows through the editor's own input handling
     * (undo history, chip detection); the Range path is the fallback for
     * environments that reject the command.
     */
    function insertAtCaret(text) {
      const root = findComposerInput();
      if (root === null) return false;
      placeCaret(root);
      let accepted = false;
      try {
        accepted = document.execCommand('insertText', false, text);
      } catch (_error) {
        accepted = false;
      }
      if (accepted) return true;
      const selection = window.getSelection?.();
      if (!selection || selection.rangeCount === 0) return false;
      const range = selection.getRangeAt(selection.rangeCount - 1);
      if (!root.contains(range.startContainer)) return false;
      range.deleteContents();
      const node = document.createTextNode(text);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      root.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    }

    // ------------------------------------------------------------------
    // Styles
    // ------------------------------------------------------------------

    const CSS = `
.qp-root { box-sizing: border-box; width: 100%; max-width: var(--dsh-composer-card-max-width); margin: 0 auto; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.qp-strip { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.qp-chip { box-sizing: border-box; display: inline-flex; align-items: center; gap: 5px; max-width: 100%; height: 24px; padding: 0 10px; border: none; border-radius: 999px; background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; line-height: 24px; cursor: pointer; }
.qp-chip:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.qp-chip:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.qp-chip[aria-disabled="true"] { opacity: .5; cursor: default; }
.qp-chipText { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qp-chipGlyph { flex: none; width: 12px; height: 12px; display: grid; place-items: center; opacity: .8; }
.qp-empty { box-sizing: border-box; display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border: 1px dashed var(--dsw-alias-border-l2); border-radius: 999px; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px; line-height: 24px; cursor: pointer; }
.qp-empty:hover { color: var(--dsw-alias-label-primary); }
.qp-empty:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.qp-emptyDot { flex: none; width: 5px; height: 5px; border-radius: 50%; background: currentColor; opacity: .6; }
.qp-manage { margin-left: auto; flex: none; display: inline-flex; align-items: center; gap: 4px; height: 24px; padding: 0 9px; border: none; border-radius: 999px; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 12px; cursor: pointer; }
.qp-manage:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.qp-manage:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.qp-manage[aria-expanded="true"] { color: var(--dsw-alias-label-primary); }
.qp-panel { box-sizing: border-box; width: 100%; display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); }
.qp-panelHead { display: flex; align-items: center; gap: 8px; min-width: 0; }
.qp-panelTitle { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.qp-panelCount { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.qp-panelActions { margin-left: auto; display: flex; align-items: center; gap: 4px; }
.qp-btn { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 4px; height: 26px; padding: 0 10px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px; cursor: pointer; white-space: nowrap; }
.qp-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.qp-btn:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.qp-btn:disabled { opacity: .45; cursor: default; }
.qp-btnPrimary { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); font-weight: 600; }
.qp-btnPrimary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-bg-base); filter: brightness(1.06); }
.qp-btnDanger { color: var(--dsw-alias-state-error-primary); }
.qp-iconBtn { width: 24px; padding: 0; }
.qp-list { display: flex; flex-direction: column; gap: 2px; max-height: 240px; overflow-y: auto; margin: 0; padding: 0; list-style: none; }
.qp-row { display: flex; align-items: center; gap: 8px; min-height: 34px; padding: 3px 2px 3px 8px; border-radius: 8px; }
.qp-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.qp-rowText { min-width: 0; flex: 1; display: flex; flex-direction: column; }
.qp-rowName { font-size: 12px; color: var(--dsw-alias-label-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qp-rowSummary { font-size: 11px; color: var(--dsw-alias-label-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.qp-rowActions { flex: none; display: flex; align-items: center; gap: 2px; }
.qp-rowActions .qp-btn { height: 24px; font-size: 11px; padding: 0 8px; }
.qp-rowActions .qp-iconBtn { padding: 0; width: 24px; }
.qp-hint { font-size: 11px; color: var(--dsw-alias-label-tertiary); padding: 4px 2px; }
.qp-form { display: flex; flex-direction: column; gap: 8px; border-top: 1px solid var(--dsw-alias-border-l1); padding-top: 8px; }
.qp-formTitle { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.qp-field { display: flex; flex-direction: column; gap: 4px; }
.qp-label { font-size: 11px; color: var(--dsw-alias-label-secondary); }
.qp-required { color: var(--dsw-alias-state-error-primary); margin-left: 1px; }
.qp-input, .qp-textarea { box-sizing: border-box; width: 100%; font: inherit; font-size: 12px; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; padding: 6px 8px; outline: none; }
.qp-input:focus, .qp-textarea:focus { border-color: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 18%, transparent); }
.qp-textarea { min-height: 84px; resize: vertical; line-height: 1.5; font-family: inherit; }
.qp-textarea::placeholder, .qp-input::placeholder { color: var(--dsw-alias-label-tertiary); }
.qp-formActions { display: flex; align-items: center; gap: 6px; }
.qp-spacer { flex: 1; }
.qp-error[hidden] { display: none; }
.qp-error { font-size: 11px; color: var(--dsw-alias-state-error-primary); padding: 4px 8px; border-radius: 6px; background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); }
.qp-spinner { flex: none; width: 10px; height: 10px; border-radius: 50%; border: 1.5px solid var(--dsw-alias-border-l2); border-top-color: var(--dsw-alias-brand-primary); animation: qp-spin .8s linear infinite; }
@keyframes qp-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .qp-spinner { animation-duration: 2.4s; } }
`;

    // ------------------------------------------------------------------
    // Small glyphs (drawn inline; no icon package dependency)
    // ------------------------------------------------------------------

    function Glyph({ kind }) {
      const shared = { width: 12, height: 12, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true, focusable: 'false' };
      if (kind === 'plus') {
        return h('svg', shared, h('path', { d: 'M8 3.5v9M3.5 8h9', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }));
      }
      if (kind === 'sliders') {
        return h('svg', shared,
          h('path', { d: 'M3 5.5h10M3 10.5h10', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round', opacity: .8 }),
          h('circle', { cx: 6, cy: 5.5, r: 1.7, fill: 'var(--dsw-alias-bg-layer-1)', stroke: 'currentColor', strokeWidth: 1.3 }),
          h('circle', { cx: 10.5, cy: 10.5, r: 1.7, fill: 'var(--dsw-alias-bg-layer-1)', stroke: 'currentColor', strokeWidth: 1.3 }));
      }
      if (kind === 'caret') {
        return h('svg', shared, h('path', { d: 'M6.5 4.5 9.5 8l-3 3.5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }));
      }
      if (kind === 'up' || kind === 'down') {
        return h('svg', shared, h('path', {
          d: kind === 'up' ? 'M8 12.5v-9M4.8 6.5 8 3.3l3.2 3.2' : 'M8 3.5v9M4.8 9.5 8 12.7l3.2-3.2',
          stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        }));
      }
      if (kind === 'close') {
        return h('svg', shared, h('path', { d: 'M4.5 4.5l7 7M11.5 4.5l-7 7', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' }));
      }
      return null;
    }

    // ------------------------------------------------------------------
    // Components
    // ------------------------------------------------------------------


    /**
     * The strip. It inserts and it opens the manager; it never edits in place.
     */
    function Strip({ t, instructions, onInsert, onToggle, expanded, loading, unavailable }) {
      const items = instructions.map((instruction) => h('button', {
        key: instruction.id,
        type: 'button',
        className: 'qp-chip',
        title: `${t('chip.insert')}: ${labelOf(t, instruction)}`,
        onClick: () => onInsert(instruction),
      },
      h('span', { className: 'qp-chipGlyph' }, h(Glyph, { kind: 'caret' })),
      h('span', { className: 'qp-chipText' }, labelOf(t, instruction))));

      // Empty state: one dashed pill only, and it opens the manager. With
      // instructions, the chips come first and one manage control follows.
      if (instructions.length === 0) {
        return h('div', { className: 'qp-strip' },
          h('button', {
            type: 'button',
            className: 'qp-empty',
            'aria-expanded': expanded,
            'aria-controls': 'qp-panel',
            title: t('chip.label'),
            onClick: onToggle,
          }, h('span', { className: 'qp-emptyDot' }), h('span', null, t('chip.label'))));
      }
      return h('div', { className: 'qp-strip' },
        ...items,
        h('button', {
          key: '__manage',
          type: 'button',
          className: 'qp-manage',
          'aria-expanded': expanded,
          'aria-controls': 'qp-panel',
          onClick: onToggle,
        },
        loading
          ? h('span', { className: 'qp-spinner' })
          : h('span', { className: 'qp-chipGlyph' }, h(Glyph, { kind: unavailable ? 'sliders' : 'plus' })),
        h('span', null, t('chip.manage'))));
    }

    /**
     * One management row: name, summary, and the five actions.
     */
    function Row({ t, instruction, index, total, busy, onInsert, onEdit, onMove, onDelete }) {
      const named = String(instruction.name ?? '').trim() !== '';
      const summary = summarize(instruction.content, 120);
      return h('li', { className: 'qp-row' },
        h('div', { className: 'qp-rowText' },
          h('span', { className: 'qp-rowName' }, named ? instruction.name : t('row.unnamed')),
          summary !== '' ? h('span', { className: 'qp-rowSummary' }, summary) : null),
        h('div', { className: 'qp-rowActions' },
          h('button', { type: 'button', className: 'qp-btn', disabled: busy, title: t('row.insert'), onClick: () => onInsert(instruction) }, t('row.insert')),
          h('button', { type: 'button', className: 'qp-btn', disabled: busy, title: t('row.edit'), onClick: () => onEdit(instruction) }, t('row.edit')),
          h('button', { type: 'button', className: 'qp-btn qp-iconBtn', disabled: busy || index === 0, title: t('row.moveUp'), 'aria-label': t('row.moveUp'), onClick: () => onMove(instruction, 'up') }, h(Glyph, { kind: 'up' })),
          h('button', { type: 'button', className: 'qp-btn qp-iconBtn', disabled: busy || index === total - 1, title: t('row.moveDown'), 'aria-label': t('row.moveDown'), onClick: () => onMove(instruction, 'down') }, h(Glyph, { kind: 'down' })),
          h('button', {
            type: 'button',
            className: 'qp-btn qp-btnDanger',
            disabled: busy,
            title: t('row.delete'),
            onClick: () => onDelete(instruction),
          }, t('row.delete'))),
      );
    }

    /**
     * The form: name optional, content required.
     */
    function Form({ t, draft, onChange, onSubmit, onCancel, error, busy, nameRef }) {
      return h('form', {
        className: 'qp-form',
        onSubmit: (event) => { event.preventDefault(); onSubmit(); },
      },
      h('div', { className: 'qp-formTitle' }, draft.id === null ? t('form.newTitle') : t('form.editTitle')),
      h('label', { className: 'qp-field' },
        h('span', { className: 'qp-label' }, t('form.name'), h('span', { className: 'qp-required', 'aria-hidden': true }, '*')),
        h('input', {
          ref: nameRef,
          className: 'qp-input',
          type: 'text',
          value: draft.name,
          onInput: (event) => onChange({ name: event.target.value }),
          maxLength: LIMITS.name,
          spellCheck: false,
          autoComplete: 'off',
          disabled: busy,
          onChange: (event) => onChange({ name: event.target.value }),
        })),
      h('label', { className: 'qp-field' },
        h('span', { className: 'qp-label' }, t('form.content')),
        h('textarea', {
          className: 'qp-textarea',
          value: draft.content,
          placeholder: t('form.contentPlaceholder'),
          onInput: (event) => onChange({ content: event.target.value }),
          disabled: busy,
          onChange: (event) => onChange({ content: event.target.value }),
        })),
      h('div', { className: 'qp-error', role: error === '' ? undefined : 'alert', hidden: error === '' }, error),
      h('div', { className: 'qp-formActions' },
        h('button', { type: 'submit', className: 'qp-btn qp-btnPrimary', disabled: busy }, t('form.save')),
        h('button', { type: 'button', className: 'qp-btn', disabled: busy, onClick: onCancel }, t('form.cancel'))));
    }

    /**
     * Inline management panel. Everything here is in normal flow; nothing is
     * portalled, so the panel disappears with the strip and never blocks input.
     */
    function Panel(props) {
      const {
        t, instructions, loading, error, busy, form,
        onAdd, onCancelForm, onChangeForm, onClose, onDelete, onEdit, onInsert,
        onMove, onSubmitForm,
      } = props;
      const nameRef = useRef(null);

      // Focus the name field once, when a NEW form opens. Depending on `form`
      // itself would re-run on every keystroke (each edit replaces the draft
      // object) and yank the caret back here while the user types content.
      const wasOpen = useRef(false);
      useEffect(() => {
        const isOpen = form !== null;
        if (isOpen && !wasOpen.current && form.id === null && nameRef.current !== null) {
          nameRef.current.focus({ preventScroll: true });
        }
        wasOpen.current = isOpen;
      }, [form]);

      return h('div', {
        className: 'qp-panel',
        id: 'qp-panel',
        role: 'region',
        'aria-label': t('panel.title'),
      },
      h('div', { className: 'qp-panelHead' },
        h('span', { className: 'qp-panelTitle' }, t('panel.title')),
        h('span', { className: 'qp-panelCount' }, fill(t('panel.count'), { count: instructions.length })),
        h('div', { className: 'qp-panelActions' },
          h('button', { type: 'button', className: 'qp-btn', disabled: busy, onClick: onAdd }, h(Glyph, { kind: 'plus' }), t('panel.add')),
          h('button', { type: 'button', className: 'qp-btn qp-iconBtn', title: t('panel.close'), 'aria-label': t('panel.close'), onClick: onClose }, h(Glyph, { kind: 'close' })))),
      // Always rendered: inserting or removing this node would shift every
      // following child and remount the form, losing the caret.
      h('div', { className: 'qp-error', role: error === '' ? undefined : 'alert', hidden: error === '' }, error),
      loading
        ? h('div', { className: 'qp-hint' }, t('panel.loading'))
        : instructions.length === 0
          ? h('div', { className: 'qp-hint' }, t('panel.empty'))
          : h('ul', { className: 'qp-list' }, instructions.map((instruction, index) => h(Row, {
              key: instruction.id,
              t,
              instruction,
              index,
              total: instructions.length,
              busy,
              onInsert,
              onEdit,
              onMove,
              onDelete,
            }))),
      form !== null ? h(Form, {
        t,
        draft: form,
        nameRef,
        busy,
        error,
        onChange: onChangeForm,
        onSubmit: onSubmitForm,
        onCancel: onCancelForm,
      }) : null);
    }

    /**
     * Slot entry: strip plus the optional inline panel, sharing one form draft.
     * A failed write keeps the panel open and shows the reason.
     */
    function QuickPrompts({ remote, t, enabled }) {

      const [instructions, setInstructions] = useState([]);
      const [loading, setLoading] = useState(true);
      const [listError, setListError] = useState('');
      const [expanded, setExpanded] = useState(false);
      const [form, setForm] = useState(null);
      const [formError, setFormError] = useState('');
      const [busy, setBusy] = useState(false);
      const [notice, setNotice] = useState('');
      const alive = useRef(true);

      useEffect(() => () => { alive.current = false; }, []);

      const applyList = useCallback((payload) => {
        if (!alive.current) return;
        if (payload && Array.isArray(payload.instructions)) {
          setInstructions(payload.instructions);
          setListError(typeof payload.error === 'string' ? payload.error : '');
        }
        setLoading(false);
      }, []);

      useEffect(() => {
        if (typeof remote?.list !== 'function') {
          setLoading(false);
          setListError(t('error.disconnected'));
          return undefined;
        }
        let cancelled = false;
        remote.list().then((result) => {
          if (cancelled) return;
          if (result && result.ok) applyList(result.value);
          else {
            setLoading(false);
            setListError(reasonOf(result && result.error, t));
          }
        }, (error) => {
          if (cancelled) return;
          setLoading(false);
          setListError(reasonOf(error, t));
        });
        return () => { cancelled = true; };
      }, [remote, applyList, t]);

      /**
       * Run one write. Resolves to `true` on success, or `{ error }`; every
       * caller decides what stays open.
       */
      const mutate = useCallback(async (operation) => {
        setBusy(true);
        try {
          const result = await operation();
          if (result && result.ok) {
            applyList(result.value);
            return true;
          }
          return { error: reasonOf(result && result.error, t) };
        } catch (error) {
          return { error: reasonOf(error, t) };
        } finally {
          if (alive.current) setBusy(false);
        }
      }, [applyList]);

      const toggle = useCallback(() => {
        setExpanded((current) => {
          if (current) {
            setForm(null);
            setFormError('');
          }
          return !current;
        });
      }, []);

      const close = useCallback(() => {
        setExpanded(false);
        setForm(null);
        setFormError('');
        setNotice('');
      }, []);

      const insert = useCallback((instruction) => {
        const inserted = insertAtCaret(instruction.content);
        setNotice(inserted ? '' : `⚠️ ${t('error.insert')}`);
      }, [t]);

      const beginAdd = useCallback(() => {
        setForm({ id: null, name: '', content: '' });
        setFormError('');
      }, []);

      const beginEdit = useCallback((instruction) => {
        setForm({ id: instruction.id, name: instruction.name ?? '', content: instruction.content });
        setFormError('');
      }, []);

      const cancelForm = useCallback(() => {
        setForm(null);
        setFormError('');
      }, []);

      const changeForm = useCallback((patch) => {
        setForm((current) => (current === null ? current : { ...current, ...patch }));
      }, []);

      const submitForm = useCallback(async () => {
        if (form === null || busy) return;
        const name = form.name.trim();
        const content = form.content;
        if (name === '') { setFormError(t('form.nameRequired')); return; }
        if (content.trim() === '') { setFormError(t('form.contentRequired')); return; }
        if (content.length > LIMITS.content) { setFormError(fill(t('form.contentTooLong'), { limit: LIMITS.content })); return; }
        if (name.length > LIMITS.name) { setFormError(fill(t('form.nameTooLong'), { limit: LIMITS.name })); return; }
        setFormError('');
        const outcome = form.id === null
          ? await mutate(() => remote.create(name, content))
          : await mutate(() => remote.update(form.id, name, content));
        if (outcome === true) {
          // A successful add or save always collapses the panel.
          setForm(null);
          setExpanded(false);
        } else {
          // A failed write keeps everything open so the draft is not lost.
          setFormError(outcome.error);
        }
      }, [form, busy, mutate, remote, t]);

      const move = useCallback(async (instruction, direction) => {
        const outcome = await mutate(() => remote.move(instruction.id, direction));
        if (outcome !== true) setListError(outcome.error);
        else setListError('');
      }, [mutate, remote]);

      const remove = useCallback(async (instruction) => {
        const outcome = await mutate(() => remote.delete(instruction.id));
        if (outcome === true) {
          setForm((current) => (current !== null && current.id === instruction.id ? null : current));
          setListError('');
        } else setListError(outcome.error);
      }, [mutate, remote]);

      if (!enabled) return null;

      const error = form !== null ? formError : (listError || notice);

      return h('div', { className: 'qp-root', 'data-quick-prompts': '' },
        h(Strip, {
          t,
          instructions,
          loading,
          expanded,
          unavailable: listError !== '' && instructions.length === 0,
          onInsert: insert,
          onToggle: expanded ? close : () => setExpanded(true),
        }),
        expanded ? h(Panel, {
          t,
          instructions: [...instructions].sort((left, right) => left.position - right.position),
          loading,
          error,
          busy,
          form,
          onAdd: beginAdd,
          onCancelForm: cancelForm,
          onChangeForm: changeForm,
          onClose: close,
          onDelete: remove,
          onEdit: beginEdit,
          onInsert: insert,
          onMove: move,
          onSubmitForm: submitForm,
        }) : null);
    }

    // ------------------------------------------------------------------
    // Remote contract (mirrors the Host half)
    // ------------------------------------------------------------------

    /**
     * Build the contribution mounted through `ctx.remote.$mount`.
     *
     * The Gateway reads `contribution.descriptors` — an array — and requires a
     * strict-mode codec on every parameter and result. It never calls the
     * codec's `create()` for these methods: the wire shapes are validated on the
     * Host, and the reply is passed through unchanged. So the codecs here are
     * declarative, which keeps this bundle free of a schema library.
     *
     * The namespace and method names, and the parameter order, must stay in step
     * with the Host's descriptor list in `lib/service.js`.
     *
     * @returns {{package: string, descriptors: object[]}} the contribution.
     */
    function remoteContribution() {
      const codec = (typeSymbol) => ({ mode: 'strict', typeSymbol, create: () => undefined });
      const wire = (name) => ({ name, wire: name, source: 'json', codec: codec(`quickPrompts.${name}`), strictCodec: codec(`quickPrompts.${name}`) });
      const describe = (method, parameters, resultType) => ({
        id: `${PACKAGE}#${NAMESPACE}/${method}`,
        // `service` is the Host Cordis service key the Gateway dispatches to;
        // the Client typert registry rejects a descriptor without it.
        service: NAMESPACE,
        namespace: NAMESPACE,
        method,
        invocation: { kind: 'direct' },
        parameters,
        result: codec(resultType),
      });
      return {
        package: PACKAGE,
        descriptors: [
          describe('list', [], 'quickPrompts.list.result'),
          describe('create', [wire('name'), wire('content')], 'quickPrompts.listOnly.result'),
          describe('update', [wire('id'), wire('name'), wire('content')], 'quickPrompts.listOnly.result'),
          // The Gateway's namespace service owns `remove`, so the wire method is
          // `delete`; see lib/service.js.
          describe('delete', [wire('id')], 'quickPrompts.listOnly.result'),
          describe('move', [wire('id'), wire('direction')], 'quickPrompts.listOnly.result'),
        ],
      };
    }

    // ------------------------------------------------------------------
    // Activation
    // ------------------------------------------------------------------

    /**
     * Client activation. Kept as a named function so the offline preview can
     * call the same path a real page takes.
     * @param {any} ctx - Client root context.
     */
    async function apply(ctx) {
      try {
        await activate(ctx);
      } catch (error) {
        // Web boot aborts every entry that rejects, so this entry reports the
        // failure and stays out of the way instead of taking the page down.
        console.error('quick-prompts: activation failed; the strip is unavailable', error);
      }
    }

    /**
     * Register styles, dictionaries, the Remote namespace, and the slot entry.
     * @param {any} ctx - Client root context.
     * @returns {Promise<() => Promise<void>>} the cleanup.
     */
    async function activate(ctx) {
      // One style element per Client run; removing it restores the page.
      ctx.effect(() => {
        const tag = document.createElement('style');
        tag.dataset.plugin = PACKAGE;
        tag.textContent = CSS;
        document.head.appendChild(tag);
        return () => tag.remove();
      }, 'quick-prompts: styles');

      // A broken Remote contract must never abort web boot: degrade to the
      // strip's "unavailable" state and keep the rest of the app alive.
      let disposeRemote = async () => {};
      try {
        disposeRemote = await ctx.remote.$mount(remoteContribution());
      } catch (error) {
        console.error('quick-prompts: remote mount failed; the strip will report it', error);
      }

      ctx.effect(() => ctx.locale.register(NS, { en: EN, zh: ZH }), 'quick-prompts: dictionaries');

      // Re-render on dictionary/locale changes without re-registering the slot.
      const listeners = new Set();
      ctx.effect(() => ctx.locale.subscribe(() => { for (const listener of listeners) listener(); }), 'quick-prompts: locale listener');

      const translate = (key, params) => {
        let text;
        try {
          text = ctx.locale.bind(NS)(key, params);
        } catch (_error) {
          text = key;
        }
        if (text === key) {
          const fallback = EN[key] ?? ZH[key] ?? key;
          text = fallback;
        }
        return fill(text, params);
      };

      const Bound = function QuickPromptsEntry(props) {
        const [, force] = useState(0);
        useEffect(() => {
          const listener = () => force((value) => value + 1);
          listeners.add(listener);
          return () => listeners.delete(listener);
        }, []);
        return h(QuickPrompts, {
          remote: ctx.get('remote.quickPrompts'),
          t: translate,
          enabled: props.enabled !== false,
        });
      };

      ctx.slots.inject(SLOT, () => ctx.slots.register({
        name: SLOT,
        id: ENTRY_ID,
        order: ORDER,
        locale: NS,
      }, Bound));

      // A plain page has no slot host; an offline harness opts in before load.
      if (typeof window !== 'undefined' && window.__QP_DEV_PREVIEW__ === true) {
        window.__QP_PREVIEW__ = { Entry: Bound, translate, EN, ZH, apply };
      }

      return async () => {
        await disposeRemote();
      };
    }

    return {
      inject: ['remote', 'slots', 'locale'],
      apply,
    };
  },
});
